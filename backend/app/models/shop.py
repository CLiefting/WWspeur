"""
Shop model - represents a webshop being investigated.
"""
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import relationship
import enum
from app.models.base import Base, TimestampMixin


class RiskLevel(str, enum.Enum):
    UNKNOWN = "unknown"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Shop(Base, TimestampMixin):
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String(2048), unique=True, nullable=False, index=True)
    domain = Column(String(255), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    
    # Risk assessment
    risk_score = Column(Float, nullable=True)
    risk_level = Column(
        SAEnum("unknown", "low", "medium", "high", "critical",
               name="risk_level", create_type=False),
        default="unknown",
        server_default="unknown",
        nullable=False,
    )
    
    # Notes
    notes = Column(Text, nullable=True)
    
    # Who added this shop
    added_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    added_by_user = relationship("User", back_populates="shops")
    scans = relationship("Scan", back_populates="shop", cascade="all, delete-orphan")
    whois_records = relationship("WhoisRecord", back_populates="shop", cascade="all, delete-orphan")
    ssl_records = relationship("SSLRecord", back_populates="shop", cascade="all, delete-orphan")
    scrape_records = relationship("ScrapeRecord", back_populates="shop", cascade="all, delete-orphan")
    kvk_records = relationship("KvKRecord", back_populates="shop", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Shop(id={self.id}, domain='{self.domain}', risk_level='{self.risk_level}')>"
