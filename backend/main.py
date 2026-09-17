from fastapi import FastAPI, Depends, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date, datetime
import secrets

from database import Base, engine, get_db
from models import Farmer, ProcurementCentre, Appointment, Procurement, Admin
from schemas import (
    FarmerCreate,
    FarmerUpdate,
    FarmerRegister,
    FarmerLogin,
    CentreCreate,
    CentreUpdate,
    AppointmentCreate,
    AppointmentCentreUpdate,
    AppointmentReschedule,
    ProcurementCreate,
    AdminLogin,
)


# ============================================================
# APP CONFIGURATION
# ============================================================

app = FastAPI(
    title="KisanFlow API",
    description="Smart Procurement Coordination Platform for Farmers",
    version="1.1.0",
)


# ============================================================
# CORS CONFIGURATION
# ============================================================
# Explicit dev origins, plus a regex so the app also works when it's
# demoed from a phone / another laptop on the same network using
# "npm run dev -- --host" (a different port or LAN IP than localhost).

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DATABASE INITIALIZATION
# ============================================================

Base.metadata.create_all(bind=engine)


# ============================================================
# CONSTANTS
# ============================================================

ALLOWED_APPOINTMENT_STATUSES = [
    "BOOKED",
    "IN_QUEUE",
    "PROCESSING",
    "COMPLETED",
    "CANCELLED",
]

# Statuses that mean the farmer is no longer occupying a queue slot.
TERMINAL_STATUSES = {"COMPLETED", "CANCELLED"}

# The only time slots a farmer is allowed to book. Must match
# TIME_SLOTS in frontend/src/pages/FarmerDashboard.jsx.
TIME_SLOTS = [
    "09:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "02:00 PM",
    "03:00 PM",
    "04:00 PM",
]

# Maximum number of farmers allowed to book the SAME slot
# (same centre + same date + same time), regardless of the
# centre's overall capacity. Keep this in sync with SLOT_CAPACITY
# in frontend/src/pages/FarmerDashboard.jsx.
SLOT_CAPACITY = 5

# Indicative Minimum Support Price (MSP) reference rates (Rs. per quintal).
# Sourced from Government of India CCEA press releases:
#   - Paddy (Common): Kharif Marketing Season 2025-26
#   - Wheat: Rabi Marketing Season 2026-27
#   - Cotton (Medium Staple): Cotton Season 2025-26
#   - Maize: Kharif Marketing Season 2025-26
# Turmeric is not a notified MSP crop, so no central floor price applies.
MSP_RATES = {
    "Paddy": {"has_msp": True, "rate_per_quintal": 2369, "season": "Kharif MS 2025-26"},
    "Wheat": {"has_msp": True, "rate_per_quintal": 2585, "season": "Rabi MS 2026-27"},
    "Cotton": {"has_msp": True, "rate_per_quintal": 7710, "season": "Cotton Season 2025-26 (Medium Staple)"},
    "Maize": {"has_msp": True, "rate_per_quintal": 2400, "season": "Kharif MS 2025-26"},
    "Turmeric": {"has_msp": False, "rate_per_quintal": None, "season": None},
}

# A centre is flagged as "congested" when EITHER of these is crossed:
#   - its live queue reaches this fraction of capacity, OR
#   - its estimated wait reaches this many minutes.
# Tune these two numbers to make the warning more/less sensitive.
CONGESTION_UTILIZATION_THRESHOLD = 0.85  # 85% of capacity filled
CONGESTION_ETA_MINUTES_THRESHOLD = 120  # 2 hours estimated wait


# ============================================================
# HELPERS
# ============================================================

def _todays_active_appointment_count(db: Session, centre_id: int) -> int:
    """Count TODAY's appointments for a centre that are still occupying
    a live queue slot (status BOOKED / IN_QUEUE / PROCESSING).

    Appointments booked for a future date are deliberately excluded —
    a future booking must not inflate today's active queue. Because this
    is a live query (not a manually-incremented counter), an appointment
    automatically joins the active queue on the day it is actually due,
    with no extra "activation" step needed.
    """
    today_str = date.today().isoformat()

    return (
        db.query(Appointment)
        .filter(
            Appointment.centre_id == centre_id,
            Appointment.date == today_str,
            ~Appointment.status.in_(TERMINAL_STATUSES),
        )
        .count()
    )


def _live_queue_count(centre: ProcurementCentre, db: Session) -> int:
    """The centre's real, current queue: its admin-set walk-in baseline
    (`centre.current_queue`) plus only today's still-active appointments.
    Future-dated appointments are never included here."""
    return centre.current_queue + _todays_active_appointment_count(
        db, centre.id
    )


def _detect_congestion(
    live_queue: int, capacity: int, estimated_wait_minutes: float
) -> tuple[bool, str | None]:
    """Check a centre's utilisation and ETA against the congestion
    thresholds and return (is_congested, warning_message).

    warning_message is None when the centre is not congested.
    """
    utilization = (live_queue / capacity) if capacity > 0 else 0

    high_utilization = utilization >= CONGESTION_UTILIZATION_THRESHOLD
    high_eta = estimated_wait_minutes >= CONGESTION_ETA_MINUTES_THRESHOLD

    if not high_utilization and not high_eta:
        return False, None

    utilization_pct = round(utilization * 100)
    eta_rounded = round(estimated_wait_minutes)

    if high_utilization and high_eta:
        message = (
            f"⚠️ Congestion detected: {utilization_pct}% of capacity filled "
            f"and an estimated wait of {eta_rounded} minutes."
        )
    elif high_utilization:
        message = (
            f"⚠️ Congestion detected: {utilization_pct}% of capacity filled."
        )
    else:
        message = (
            f"⚠️ Congestion detected: estimated wait of {eta_rounded} minutes."
        )

    return True, message


def _serialize_centre(centre: ProcurementCentre, db: Session) -> dict:
    """Attach live, derived fields (ETA + status) to a centre row."""
    live_queue = _live_queue_count(centre, db)

    if centre.processing_rate > 0:
        estimated_wait = (live_queue / centre.processing_rate) * 60
    else:
        estimated_wait = 0

    if live_queue >= centre.capacity:
        status = "FULL"
    elif live_queue >= centre.capacity * 0.8:
        status = "BUSY"
    else:
        status = "OPEN"

    is_congested, congestion_warning = _detect_congestion(
        live_queue, centre.capacity, estimated_wait
    )

    return {
        "id": centre.id,
        "name": centre.name,
        "location": centre.location,
        "capacity": centre.capacity,
        "current_queue": live_queue,
        "processing_rate": centre.processing_rate,
        "estimated_wait": round(estimated_wait),
        "status": status,
        "is_congested": is_congested,
        "congestion_warning": congestion_warning,
    }

def _release_queue_slot(db: Session, centre_id: int) -> None:
    """Free up one queue slot on a centre when an active appointment
    is completed, cancelled, deleted, or its farmer is deleted."""
    centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == centre_id)
        .first()
    )

    if centre and centre.current_queue > 0:
        centre.current_queue -= 1

def _get_current_admin(authorization: str | None, db: Session) -> Admin:
    """Look up the Admin whose active session_token matches the
    'Authorization: Bearer <token>' header. Raises 401 if missing,
    malformed, or the token doesn't match any admin."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid admin session token",
        )

    token = authorization.removeprefix("Bearer ").strip()

    admin = (
        db.query(Admin)
        .filter(Admin.session_token == token)
        .first()
    )

    if not admin:
        raise HTTPException(
            status_code=401,
            detail="Admin session is invalid or has expired. Please log in again.",
        )

    return admin


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
def root():
    return {
        "message": "KisanFlow API is running",
        "status": "success",
        "version": "1.1.0",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "KisanFlow Backend",
    }


# ============================================================
# FARMER APIs
# ============================================================

@app.post("/farmers")
def create_farmer(
    farmer: FarmerCreate,
    db: Session = Depends(get_db)
):
    new_farmer = Farmer(
        name=farmer.name,
        phone=farmer.phone,
        village=farmer.village,
        crop=farmer.crop,
        quantity=farmer.quantity,
    )

    db.add(new_farmer)
    db.commit()
    db.refresh(new_farmer)

    return new_farmer


@app.get("/farmers")
def get_farmers(
    db: Session = Depends(get_db)
):
    farmers = db.query(Farmer).all()

    return farmers


@app.get("/farmers/{farmer_id}")
def get_farmer(
    farmer_id: int,
    db: Session = Depends(get_db)
):
    farmer = (
        db.query(Farmer)
        .filter(Farmer.id == farmer_id)
        .first()
    )

    if not farmer:
        raise HTTPException(
            status_code=404,
            detail="Farmer not found"
        )

    return farmer


@app.put("/farmers/{farmer_id}")
def update_farmer(
    farmer_id: int,
    farmer: FarmerUpdate,
    db: Session = Depends(get_db)
):
    existing_farmer = (
        db.query(Farmer)
        .filter(Farmer.id == farmer_id)
        .first()
    )

    if not existing_farmer:
        raise HTTPException(
            status_code=404,
            detail="Farmer not found"
        )

    existing_farmer.name = farmer.name
    existing_farmer.phone = farmer.phone
    existing_farmer.village = farmer.village
    existing_farmer.crop = farmer.crop
    existing_farmer.quantity = farmer.quantity

    db.commit()
    db.refresh(existing_farmer)

    return existing_farmer


@app.delete("/farmers/{farmer_id}")
def delete_farmer(
    farmer_id: int,
    db: Session = Depends(get_db)
):
    farmer = (
        db.query(Farmer)
        .filter(Farmer.id == farmer_id)
        .first()
    )

    if not farmer:
        raise HTTPException(
            status_code=404,
            detail="Farmer not found"
        )

    # Delete this farmer's appointments, then the farmer. The centre's
    # live queue count is computed on the fly from the appointments
    # table (see _live_queue_count), so removing the rows here is
    # enough to free up the queue — no manual queue-slot release needed.
    db.query(Appointment).filter(
        Appointment.farmer_id == farmer_id
    ).delete(synchronize_session=False)

    db.delete(farmer)
    db.commit()

    return {
        "message": "Farmer deleted successfully",
        "farmer_id": farmer_id
    }


# ============================================================
# FARMER AUTH APIs
# ============================================================
# NOTE: prototype-level authentication for a hackathon demo —
# plaintext password comparison, no hashing, no JWTs. This is not
# a substitute for real server-side auth in a production deployment,
# same caveat as the Admin passcode gate above.

@app.post("/auth/register")
def register_farmer(
    payload: FarmerRegister,
    db: Session = Depends(get_db)
):
    existing = (
        db.query(Farmer)
        .filter(
            Farmer.phone == payload.phone,
            Farmer.password.isnot(None),
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail="An account with this phone number already exists. Please log in instead."
        )

    new_farmer = Farmer(
        name=payload.name,
        phone=payload.phone,
        village=payload.village,
        crop="",
        quantity=0,
        password=payload.password,
    )

    db.add(new_farmer)
    db.commit()
    db.refresh(new_farmer)

    return {
        "id": new_farmer.id,
        "name": new_farmer.name,
        "phone": new_farmer.phone,
        "village": new_farmer.village,
    }


@app.post("/auth/login")
def login_farmer(
    payload: FarmerLogin,
    db: Session = Depends(get_db)
):
    farmer = (
        db.query(Farmer)
        .filter(
            Farmer.phone == payload.phone,
            Farmer.password.isnot(None),
        )
        .first()
    )

    if not farmer or farmer.password != payload.password:
        raise HTTPException(
            status_code=401,
            detail="Invalid phone number or password."
        )

    return {
        "id": farmer.id,
        "name": farmer.name,
        "phone": farmer.phone,
        "village": farmer.village,
    }


# ============================================================
# PROCUREMENT CENTRE APIs
# ============================================================

@app.post("/centres")
def create_centre(
    centre: CentreCreate,
    db: Session = Depends(get_db)
):
    new_centre = ProcurementCentre(
        name=centre.name,
        location=centre.location,
        capacity=centre.capacity,
        current_queue=centre.current_queue,
        processing_rate=centre.processing_rate,
    )

    db.add(new_centre)
    db.commit()
    db.refresh(new_centre)

    return new_centre


@app.get("/centres")
def get_centres(db: Session = Depends(get_db)):
    centres = db.query(ProcurementCentre).all()

    return [_serialize_centre(centre, db) for centre in centres]


@app.get("/centres/{centre_id}")
def get_centre(
    centre_id: int,
    db: Session = Depends(get_db)
):
    centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == centre_id)
        .first()
    )

    if not centre:
        raise HTTPException(
            status_code=404,
            detail="Procurement centre not found"
        )

    return centre


@app.put("/centres/{centre_id}")
def update_centre(
    centre_id: int,
    centre: CentreUpdate,
    db: Session = Depends(get_db)
):
    existing_centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == centre_id)
        .first()
    )

    if not existing_centre:
        raise HTTPException(
            status_code=404,
            detail="Centre not found"
        )

    existing_centre.name = centre.name
    existing_centre.location = centre.location
    existing_centre.capacity = centre.capacity
    existing_centre.current_queue = centre.current_queue
    existing_centre.processing_rate = centre.processing_rate

    db.commit()
    db.refresh(existing_centre)

    return existing_centre


@app.delete("/centres/{centre_id}")
def delete_centre(
    centre_id: int,
    db: Session = Depends(get_db)
):
    centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == centre_id)
        .first()
    )

    if not centre:
        raise HTTPException(
            status_code=404,
            detail="Procurement centre not found"
        )

    # Delete appointments belonging to this centre first
    db.query(Appointment).filter(
        Appointment.centre_id == centre_id
    ).delete(synchronize_session=False)

    db.delete(centre)
    db.commit()

    return {
        "message": "Procurement centre deleted successfully",
        "centre_id": centre_id
    }


# ============================================================
# CENTRE ETA CALCULATION
# ============================================================

@app.get("/centres/{centre_id}/eta")
def get_centre_eta(
    centre_id: int,
    db: Session = Depends(get_db)
):
    centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == centre_id)
        .first()
    )

    if not centre:
        raise HTTPException(
            status_code=404,
            detail="Procurement centre not found"
        )

    if centre.processing_rate <= 0:
        raise HTTPException(
            status_code=400,
            detail="Processing rate must be greater than zero"
        )

    # Only today's still-active appointments count towards the live
    # queue — future-dated bookings haven't joined it yet.
    live_queue = _live_queue_count(centre, db)

    # Processing rate = farmers processed per hour
    eta_hours = (
        live_queue /
        centre.processing_rate
    )

    eta_minutes = round(eta_hours * 60)

    return {
        "centre_id": centre.id,
        "centre_name": centre.name,
        "current_queue": live_queue,
        "processing_rate": centre.processing_rate,
        "estimated_wait_minutes": eta_minutes,
    }


# ============================================================
# SMART CENTRE RECOMMENDATION
# ============================================================

@app.get("/recommend-centre")
def recommend_centre(db: Session = Depends(get_db)):

    centres = db.query(ProcurementCentre).all()

    if not centres:
        raise HTTPException(
            status_code=404,
            detail="No procurement centres available"
        )

    best_centre = None
    best_wait = float("inf")

    for centre in centres:
        if centre.processing_rate <= 0:
            continue

        live_queue = _live_queue_count(centre, db)

        # Don't recommend full centres
        if live_queue >= centre.capacity:
            continue

        estimated_wait = (
            live_queue /
            centre.processing_rate
        ) * 60

        if estimated_wait < best_wait:
            best_wait = estimated_wait
            best_centre = centre

    if best_centre is None:
        raise HTTPException(
            status_code=404,
            detail="All procurement centres are full"
        )

    return {
        "recommended_centre": _serialize_centre(best_centre, db),
        "reason": (
            "Lowest estimated waiting time "
            "among available procurement centres"
        )
    }


# ============================================================
# MSP / ESTIMATED PAYOUT
# ============================================================

@app.get("/msp-rates")
def get_msp_rates():
    return MSP_RATES


@app.get("/estimate-payout")
def estimate_payout(
    crop: str = Query(...),
    quantity: float = Query(..., gt=0),
):
    info = MSP_RATES.get(crop)

    if not info or not info["has_msp"]:
        return {
            "crop": crop,
            "quantity": quantity,
            "has_msp": False,
            "message": (
                f"{crop} is not a notified MSP crop. Price is set by the "
                "procurement centre or open market."
            ),
        }

    rate = info["rate_per_quintal"]
    estimated_amount = round(rate * quantity, 2)

    return {
        "crop": crop,
        "quantity": quantity,
        "has_msp": True,
        "msp_rate_per_quintal": rate,
        "season": info["season"],
        "estimated_amount": estimated_amount,
        "note": (
            "Indicative estimate based on the declared Government of India "
            "MSP. Final payment depends on quality grading at the centre."
        ),
    }


# ============================================================
# APPOINTMENT APIs
# ============================================================

@app.post("/appointments")
def create_appointment(
    appointment: AppointmentCreate,
    db: Session = Depends(get_db)
):
    # --------------------------------------------------
    # VALIDATE DATE AND TIME
    # --------------------------------------------------
    try:
        requested_date = datetime.strptime(
            appointment.appointment_date, "%Y-%m-%d"
        ).date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Please select a valid date.",
        )

    if appointment.appointment_time not in TIME_SLOTS:
        raise HTTPException(
            status_code=400,
            detail="Invalid time slot. Please select one of the available slots.",
        )

    today = date.today()

    if requested_date < today:
        raise HTTPException(
            status_code=400,
            detail="You cannot book a past date. Please choose today or a future date.",
        )

    if requested_date == today:
        slot_time = datetime.strptime(
            appointment.appointment_time, "%I:%M %p"
        ).time()

        if slot_time <= datetime.now().time():
            raise HTTPException(
                status_code=400,
                detail="This slot's time has already passed today. Please choose a later slot or another date.",
            )

    farmer = (
        db.query(Farmer)
        .filter(Farmer.id == appointment.farmer_id)
        .first()
    )
    if not farmer:
        raise HTTPException(status_code=404, detail="Farmer not found")

    centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == appointment.centre_id)
        .first()
    )
    if not centre:
        raise HTTPException(
            status_code=404, detail="Procurement centre not found"
        )

    # Prevent the same farmer from booking the exact same slot twice
    # (same farmer + same centre + same date + same time) — this also
    # blocks double submissions (e.g. rapid double-clicks) because the
    # second request will always find the first one already saved.
    existing_booking = (
        db.query(Appointment)
        .filter(
            Appointment.farmer_id == appointment.farmer_id,
            Appointment.centre_id == appointment.centre_id,
            Appointment.date == appointment.appointment_date,
            Appointment.time_slot == appointment.appointment_time,
            Appointment.status != "CANCELLED",
        )
        .first()
    )

    if existing_booking:
        raise HTTPException(
            status_code=400,
            detail=(
                "You already have a booking for this slot "
                f"at {centre.name} on {appointment.appointment_date} "
                f"at {appointment.appointment_time}."
            ),
        )

    # The centre's overall capacity only reflects who is physically
    # queued up TODAY. A future-dated booking hasn't joined that queue
    # yet, so it must never be blocked by today's congestion — only
    # a TODAY booking is checked against the centre's live queue.
    if requested_date == today:
        live_queue = _live_queue_count(centre, db)

        if live_queue >= centre.capacity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{centre.name} is currently full. "
                    "Please choose another procurement centre."
                ),
            )

    # Count active (non-cancelled) bookings for this EXACT slot only
    # (same centre + same date + same time) — independent of the
    # centre's overall capacity.
    slot_bookings = (
        db.query(Appointment)
        .filter(
            Appointment.centre_id == appointment.centre_id,
            Appointment.date == appointment.appointment_date,
            Appointment.time_slot == appointment.appointment_time,
            Appointment.status != "CANCELLED",
        )
        .count()
    )

    if slot_bookings >= SLOT_CAPACITY:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The {appointment.appointment_time} slot on "
                f"{appointment.appointment_date} is full. "
                "Please choose another slot."
            ),
        )

    new_appointment = Appointment(
        farmer_id=appointment.farmer_id,
        centre_id=appointment.centre_id,
        date=appointment.appointment_date,
        time_slot=appointment.appointment_time,
        status="BOOKED",
    )

    # NOTE: the centre's live queue is computed on the fly from today's
    # active appointments (see _live_queue_count), so there's no manual
    # queue counter to update here. This booking only starts counting
    # towards the active queue once its date is actually today — a
    # future-dated booking stays out of the queue until then.

    db.add(new_appointment)
    db.commit()
    db.refresh(new_appointment)

    return new_appointment


@app.get("/appointments")
def get_appointments(db: Session = Depends(get_db)):
    return db.query(Appointment).all()


@app.get("/appointments/{appointment_id}")
def get_appointment(
    appointment_id: int,
    db: Session = Depends(get_db)
):
    appointment = (
        db.query(Appointment)
        .filter(
            Appointment.id == appointment_id
        )
        .first()
    )

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    return appointment


@app.put("/appointments/{appointment_id}/status")
def update_appointment_status(
    appointment_id: int,
    status: str,
    db: Session = Depends(get_db)
):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.id == appointment_id)
        .first()
    )

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    if status not in ALLOWED_APPOINTMENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Invalid appointment status"
        )

    # The centre's live queue is computed from today's still-active
    # appointments (see _live_queue_count), so moving this appointment
    # to a terminal status (COMPLETED/CANCELLED) automatically frees up
    # its queue slot the next time the queue is read — no manual
    # release needed here.
    appointment.status = status

    db.commit()
    db.refresh(appointment)

    return appointment

@app.put("/appointments/{appointment_id}/centre")
def update_appointment_centre(
    appointment_id: int,
    payload: AppointmentCentreUpdate,
    db: Session = Depends(get_db)
):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.id == appointment_id)
        .first()
    )

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    new_centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == payload.centre_id)
        .first()
    )

    if not new_centre:
        raise HTTPException(
            status_code=404,
            detail="Procurement centre not found"
        )

    requested_date = datetime.strptime(
        appointment.date, "%Y-%m-%d"
    ).date()

    today = date.today()

    if requested_date == today:
        live_queue = _live_queue_count(new_centre, db)

        if live_queue >= new_centre.capacity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{new_centre.name} is currently full. "
                    "Please choose another procurement centre."
                ),
            )

    slot_bookings = (
        db.query(Appointment)
        .filter(
            Appointment.centre_id == payload.centre_id,
            Appointment.date == appointment.date,
            Appointment.time_slot == appointment.time_slot,
            Appointment.status != "CANCELLED",
        )
        .count()
    )

    if slot_bookings >= SLOT_CAPACITY:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The {appointment.time_slot} slot on "
                f"{appointment.date} is full at {new_centre.name}. "
                "Please choose another slot."
            ),
        )

    appointment.centre_id = payload.centre_id

    db.commit()
    db.refresh(appointment)

    return appointment

@app.put("/appointments/{appointment_id}/reschedule")
def reschedule_appointment(
    appointment_id: int,
    payload: AppointmentReschedule,
    db: Session = Depends(get_db)
):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.id == appointment_id)
        .first()
    )

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    if appointment.status == "CANCELLED":
        raise HTTPException(
            status_code=400,
            detail="A cancelled appointment cannot be rescheduled."
        )

    new_centre = (
        db.query(ProcurementCentre)
        .filter(ProcurementCentre.id == payload.centre_id)
        .first()
    )

    if not new_centre:
        raise HTTPException(
            status_code=404,
            detail="Procurement centre not found"
        )

    try:
        requested_date = datetime.strptime(
            payload.appointment_date,
            "%Y-%m-%d"
        ).date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Please select a valid date."
        )

    if payload.appointment_time not in TIME_SLOTS:
        raise HTTPException(
            status_code=400,
            detail="Invalid time slot. Please select one of the available slots."
        )

    today = date.today()

    if requested_date < today:
        raise HTTPException(
            status_code=400,
            detail="You cannot reschedule to a past date. Please choose today or a future date."
        )

    if requested_date == today:
        slot_time = datetime.strptime(
            payload.appointment_time,
            "%I:%M %p"
        ).time()

        if slot_time <= datetime.now().time():
            raise HTTPException(
                status_code=400,
                detail="This slot's time has already passed today. Please choose a later slot or another date."
            )

    duplicate_booking = (
        db.query(Appointment)
        .filter(
            Appointment.id != appointment_id,
            Appointment.farmer_id == appointment.farmer_id,
            Appointment.centre_id == payload.centre_id,
            Appointment.date == payload.appointment_date,
            Appointment.time_slot == payload.appointment_time,
            Appointment.status != "CANCELLED",
        )
        .first()
    )

    if duplicate_booking:
        raise HTTPException(
            status_code=400,
            detail=(
                "You already have a booking for this slot "
                f"at {new_centre.name} on {payload.appointment_date} "
                f"at {payload.appointment_time}."
            ),
        )

    if requested_date == today:
        live_queue = _live_queue_count(new_centre, db)

        already_counted_here_today = (
            appointment.centre_id == payload.centre_id
            and appointment.date == today.isoformat()
            and appointment.status not in TERMINAL_STATUSES
        )

        if already_counted_here_today:
            live_queue -= 1

        if live_queue >= new_centre.capacity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{new_centre.name} is currently full. "
                    "Please choose another procurement centre or time."
                ),
            )

    slot_bookings = (
        db.query(Appointment)
        .filter(
            Appointment.id != appointment_id,
            Appointment.centre_id == payload.centre_id,
            Appointment.date == payload.appointment_date,
            Appointment.time_slot == payload.appointment_time,
            Appointment.status != "CANCELLED",
        )
        .count()
    )

    if slot_bookings >= SLOT_CAPACITY:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The {payload.appointment_time} slot on "
                f"{payload.appointment_date} is full at {new_centre.name}. "
                "Please choose another slot."
            ),
        )

    appointment.centre_id = payload.centre_id
    appointment.date = payload.appointment_date
    appointment.time_slot = payload.appointment_time

    db.commit()
    db.refresh(appointment)

    return appointment


@app.delete("/appointments/{appointment_id}")
def delete_appointment(
    appointment_id: int,
    db: Session = Depends(get_db)
):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.id == appointment_id)
        .first()
    )

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    # Deleting the appointment row removes it from the live queue count
    # automatically (see _live_queue_count) — nothing extra to release.
    db.delete(appointment)
    db.commit()

    return {
        "message": "Appointment deleted successfully",
        "appointment_id": appointment_id
    }


# ============================================================
# PROCUREMENT APIs
# ============================================================

@app.post("/procurements")
def create_procurement(
    procurement: ProcurementCreate,
    db: Session = Depends(get_db)
):
    new_procurement = Procurement(
        farmer_id=procurement.farmer_id,
        centre_id=procurement.centre_id,
        quantity=procurement.quantity,
        status=procurement.status,
    )

    db.add(new_procurement)
    db.commit()
    db.refresh(new_procurement)

    return new_procurement


@app.get("/procurements")
def get_procurements(
    db: Session = Depends(get_db)
):
    procurements = (
        db.query(Procurement)
        .all()
    )

    return procurements


@app.get("/procurements/{procurement_id}")
def get_procurement(
    procurement_id: int,
    db: Session = Depends(get_db)
):
    procurement = (
        db.query(Procurement)
        .filter(
            Procurement.id == procurement_id
        )
        .first()
    )

    if not procurement:
        raise HTTPException(
            status_code=404,
            detail="Procurement record not found"
        )

    return procurement


@app.put("/procurements/{procurement_id}/status")
def update_procurement_status(
    procurement_id: int,
    status: str,
    db: Session = Depends(get_db)
):
    procurement = (
        db.query(Procurement)
        .filter(
            Procurement.id == procurement_id
        )
        .first()
    )

    if not procurement:
        raise HTTPException(
            status_code=404,
            detail="Procurement record not found"
        )

    procurement.status = status

    db.commit()
    db.refresh(procurement)

    return {
        "message": "Procurement status updated",
        "procurement": procurement,
    }


# ============================================================
# ADMIN AUTH APIs
# ============================================================
# NOTE: prototype-level authentication for a hackathon demo —
# plaintext password comparison, opaque bearer token stored on the
# admin row itself (one active session per admin). Same caveat as
# the farmer auth above: not a substitute for real production auth
# (password hashing, token expiry, etc.).

@app.post("/admin/auth/login")
def admin_login(
    payload: AdminLogin,
    db: Session = Depends(get_db)
):
    admin = (
        db.query(Admin)
        .filter(Admin.username == payload.username)
        .first()
    )

    if not admin or admin.password != payload.password:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin username or password.",
        )

    admin.session_token = secrets.token_hex(32)
    db.commit()
    db.refresh(admin)

    return {
        "id": admin.id,
        "username": admin.username,
        "token": admin.session_token,
    }


@app.get("/admin/auth/verify")
def admin_verify(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db)
):
    admin = _get_current_admin(authorization, db)

    return {
        "id": admin.id,
        "username": admin.username,
    }


@app.post("/admin/auth/logout")
def admin_logout(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db)
):
    admin = _get_current_admin(authorization, db)

    admin.session_token = None
    db.commit()

    return {"message": "Logged out successfully"}


# ============================================================
# ADMIN DASHBOARD
# ============================================================

@app.get("/admin/dashboard")
def admin_dashboard(
    db: Session = Depends(get_db)
):
    farmers_count = (
        db.query(Farmer).count()
    )

    centres_count = (
        db.query(ProcurementCentre).count()
    )

    appointments_count = (
        db.query(Appointment).count()
    )

    procurements_count = (
        db.query(Procurement).count()
    )

    centres = (
        db.query(ProcurementCentre)
        .all()
    )

    centre_data = []

    for centre in centres:

        live_queue = _live_queue_count(centre, db)

        if centre.capacity > 0:
            utilisation = (
                live_queue /
                centre.capacity
            ) * 100
        else:
            utilisation = 0

        if centre.processing_rate > 0:
            eta = round(
                (
                    live_queue /
                    centre.processing_rate
                ) * 60
            )
        else:
            eta = 0

        centre_data.append({
            "id": centre.id,
            "name": centre.name,
            "location": centre.location,
            "capacity": centre.capacity,
            "current_queue": live_queue,
            "processing_rate": centre.processing_rate,
            "utilisation": round(
                utilisation, 2
            ),
            "eta_minutes": eta,
        })

    return {
        "total_farmers": farmers_count,
        "total_centres": centres_count,
        "total_appointments": appointments_count,
        "total_procurements": procurements_count,
        "centres": centre_data,
    }
