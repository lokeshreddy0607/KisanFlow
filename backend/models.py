from sqlalchemy import Column, Integer, String, Float, DateTime
from database import Base


class Farmer(Base):
    __tablename__ = "farmers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    village = Column(String, nullable=False)
    crop = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    password = Column(String, nullable=True)


class ProcurementCentre(Base):
    __tablename__ = "procurement_centres"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    current_queue = Column(Integer, default=0)
    processing_rate = Column(Float, nullable=False)


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    farmer_id = Column(Integer, nullable=False)
    centre_id = Column(Integer, nullable=False)
    date = Column(String, nullable=False)
    time_slot = Column(String, nullable=False)
    status = Column(String, default="BOOKED")


class Procurement(Base):
    __tablename__ = "procurements"

    id = Column(Integer, primary_key=True, index=True)
    farmer_id = Column(Integer, nullable=False)
    centre_id = Column(Integer, nullable=False)
    quantity = Column(Float, nullable=False)
    status = Column(String, default="PENDING")
    payment_status = Column(String, default="PENDING")


class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    session_token = Column(String, nullable=True)