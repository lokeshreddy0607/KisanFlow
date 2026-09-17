"""
Populate KisanFlow with demo procurement centres.

Run this once after setting up the backend (or any time you want to
reset the demo data before a presentation):

    cd backend
    python seed_data.py

It is safe to re-run: it clears existing centres/appointments/farmers
and reloads a fresh, presentation-ready dataset.
"""

from database import Base, engine, SessionLocal
from models import Farmer, ProcurementCentre, Appointment, Procurement, Admin

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "KISAN2026"

DEMO_CENTRES = [
    {
        "name": "Sindhuja Rice Mill",
        "location": "Mangalpalle",
        "capacity": 130,
        "current_queue": 30,
        "processing_rate": 13,
    },
    {
        "name": "Shazad Wheat Agro Pvt Ltd",
        "location": "Uppariguda",
        "capacity": 90,
        "current_queue": 45,
        "processing_rate": 6,
    },
    {
        "name": "Neha Cotton Industries",
        "location": "Yamjal",
        "capacity": 120,
        "current_queue": 37,
        "processing_rate": 5,
    },
    {
        "name": "Harish Maize Centre",
        "location": "Sheriguda",
        "capacity": 50,
        "current_queue": 12,
        "processing_rate": 4,
    },
    {
        "name": "Sanjay Turmeric Centre",
        "location": "Bongloor",
        "capacity": 100,
        "current_queue": 69,
        "processing_rate": 7,
    },
]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        print("Clearing existing demo data...")
        db.query(Appointment).delete()
        db.query(Procurement).delete()
        db.query(ProcurementCentre).delete()
        db.query(Farmer).delete()
        db.commit()

        print(f"Inserting {len(DEMO_CENTRES)} procurement centres...")
        for centre in DEMO_CENTRES:
            db.add(ProcurementCentre(**centre))
        db.commit()

        existing_admin = (
            db.query(Admin)
            .filter(Admin.username == DEFAULT_ADMIN_USERNAME)
            .first()
        )

        if not existing_admin:
            print(f"Creating default admin account ('{DEFAULT_ADMIN_USERNAME}')...")
            db.add(Admin(
                username=DEFAULT_ADMIN_USERNAME,
                password=DEFAULT_ADMIN_PASSWORD,
            ))
            db.commit()
        else:
            print("Default admin account already exists, leaving it as-is.")

        print("Done. KisanFlow is ready for a demo run.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
