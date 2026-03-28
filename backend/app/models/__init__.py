"""
Export all models for easy importing.
"""
from app.models.base import Base, TimestampMixin
from app.models.user import User
from app.models.shop import Shop, RiskLevel
from app.models.scan import Scan, ScanStatus
from app.models.collectors import WhoisRecord, SSLRecord, ScrapeRecord, KvKRecord, DnsHttpRecord, TechRecord

__all__ = [
    "Base", "TimestampMixin", "User", "Shop", "RiskLevel",
    "Scan", "ScanStatus",
    "WhoisRecord", "SSLRecord", "ScrapeRecord", "KvKRecord",
    "DnsHttpRecord", "TechRecord",
]