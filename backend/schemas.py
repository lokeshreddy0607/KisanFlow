from pydantic import BaseModel, Field


# ============================================================
# FARMER SCHEMAS
# ============================================================

class FarmerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=15)
    village: str = Field(..., min_length=1, max_length=100)
    crop: str = Field(..., min_length=1, max_length=50)
    quantity: float = Field(..., gt=0, description="Quantity in quintals")


class FarmerUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=15)
    village: str = Field(..., min_length=1, max_length=100)
    crop: str = Field(..., min_length=1, max_length=50)
    quantity: float = Field(..., gt=0)


# ============================================================
# FARMER AUTH SCHEMAS
# ============================================================

class FarmerRegister(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=15)
    village: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=4, max_length=50)


class FarmerLogin(BaseModel):
    phone: str = Field(..., min_length=7, max_length=15)
    password: str = Field(..., min_length=4, max_length=50)


# ============================================================
# PROCUREMENT CENTRE SCHEMAS
# ============================================================

class CentreCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    location: str = Field(..., min_length=1, max_length=150)
    capacity: int = Field(..., gt=0)
    current_queue: int = Field(0, ge=0)
    processing_rate: float = Field(..., gt=0, description="Farmers processed per hour")


class CentreUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    location: str = Field(..., min_length=1, max_length=150)
    capacity: int = Field(..., gt=0)
    current_queue: int = Field(..., ge=0)
    processing_rate: float = Field(..., gt=0)


# ============================================================
# APPOINTMENT SCHEMAS
# ============================================================

class AppointmentCreate(BaseModel):
    farmer_id: int
    centre_id: int
    appointment_date: str = Field(..., min_length=1)
    appointment_time: str = Field(..., min_length=1)

class AppointmentCentreUpdate(BaseModel):
    centre_id: int

class AppointmentReschedule(BaseModel):
    centre_id: int
    appointment_date: str = Field(..., min_length=1)
    appointment_time: str = Field(..., min_length=1)

# ============================================================
# PROCUREMENT SCHEMAS
# ============================================================

class ProcurementCreate(BaseModel):
    farmer_id: int
    centre_id: int
    quantity: float = Field(..., gt=0)
    status: str = "PENDING"


# ============================================================
# ADMIN AUTH SCHEMAS
# ============================================================

class AdminLogin(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=50)
