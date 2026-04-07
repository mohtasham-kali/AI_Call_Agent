from sqlalchemy import Column, Integer, String, Boolean, Text
from database import Base

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    phone_number = Column(String, index=True)
    context = Column(Text)
    status = Column(String, default="pending") # pending, ringing, completed, failed
    notes = Column(Text, nullable=True) # AI summarized notes

class Settings(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True, index=True)
    global_pitch = Column(Text, default="Hello, I am calling from Nexus Voice AI...")
