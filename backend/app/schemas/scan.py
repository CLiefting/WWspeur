"""
Pydantic schemas for scans and collector results.
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from app.models.scan import ScanStatus


# ── Scan schemas ──

class ScanCreate(BaseModel):
    """Schema for starting a new scan."""
    shop_id: int
    collectors: List[str] = Field(
        default=["whois", "ssl", "scrape", "kvk"],
        description="Which collectors to run: whois, ssl, scrape, kvk"
    )
    max_pages: int = Field(
        default=200,
        ge=10,
        le=2000,
        description="Maximum aantal pagina's om te scrapen (10-2000)"
    )


class ScanResponse(BaseModel):
    """Scan result information."""
    id: int
    shop_id: int
    user_id: int
    status: ScanStatus
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    collectors_requested: Optional[str]
    collectors_completed: Optional[str]
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Collector result schemas ──

class WhoisResponse(BaseModel):
    """WHOIS record response."""
    id: int
    shop_id: int
    registrar: Optional[str]
    registrant_name: Optional[str]
    registrant_organization: Optional[str]
    registrant_country: Optional[str]
    registration_date: Optional[date]
    expiration_date: Optional[date]
    domain_age_days: Optional[int]
    is_privacy_protected: Optional[bool]
    name_servers: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


class SSLResponse(BaseModel):
    """SSL record response."""
    id: int
    shop_id: int
    has_ssl: bool
    issuer: Optional[str]
    subject: Optional[str]
    valid_from: Optional[datetime]
    valid_until: Optional[datetime]
    is_expired: Optional[bool]
    is_self_signed: Optional[bool]
    signature_algorithm: Optional[str]
    san_domains: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


class ScrapeResponse(BaseModel):
    """Scrape record response."""
    id: int
    shop_id: int
    page_title: Optional[str]
    meta_description: Optional[str]
    emails_found: Optional[str]
    phones_found: Optional[str]
    addresses_found: Optional[str]
    kvk_number_found: Optional[str]
    btw_number_found: Optional[str]
    iban_found: Optional[str]
    social_media_links: Optional[str]
    has_terms_page: Optional[bool]
    has_privacy_page: Optional[bool]
    has_contact_page: Optional[bool]
    has_return_policy: Optional[bool]
    http_status_code: Optional[int]
    source_url: str
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


class KvKResponse(BaseModel):
    """KvK record response."""
    id: int
    shop_id: int
    kvk_number: Optional[str]
    company_name: Optional[str]
    trade_names: Optional[str]
    legal_form: Optional[str]
    registration_date: Optional[date]
    street: Optional[str]
    house_number: Optional[str]
    postal_code: Optional[str]
    city: Optional[str]
    country: Optional[str]
    is_active: Optional[bool]
    sbi_codes: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


# ── Combined shop detail ──

class ShopDetailResponse(BaseModel):
    """Full shop details including all collector results."""
    id: int
    url: str
    domain: str
    name: Optional[str]
    risk_score: Optional[float]
    risk_level: str
    notes: Optional[str]
    added_by: int
    created_at: datetime
    scans: List[ScanResponse] = []
    whois_records: List[WhoisResponse] = []
    ssl_records: List[SSLResponse] = []
    scrape_records: List[ScrapeResponse] = []
    kvk_records: List[KvKResponse] = []

    class Config:
        from_attributes = True
