"""
Scan model - represents a single investigation run on a shop.
"""
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.models.base import Base, TimestampMixin


class ScanStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class Scan(Base, TimestampMixin):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    status = Column(
        SAEnum("pending", "running", "completed", "failed", "partial",
               name="scan_status", create_type=False),
        default="pending",
        server_default="pending",
        nullable=False,
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    collectors_requested = Column(String(500), nullable=True)
    collectors_completed = Column(String(500), nullable=True)
    
    error_message = Column(Text, nullable=True)

    # Relationships
    shop = relationship("Shop", back_populates="scans")
    user = relationship("User", back_populates="scans")

    def __repr__(self):
        return f"<Scan(id={self.id}, shop_id={self.shop_id}, status='{self.status}')>"
