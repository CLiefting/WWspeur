"""
Settings model — slaat API-sleutels en configuratie op.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from datetime import datetime, timezone
from app.models.base import Base


class Setting(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    label = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    service = Column(String(50), nullable=False)   # google, meta, hackertarget, etc.
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
