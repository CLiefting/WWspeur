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
        default=50,
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

class DnsHttpResponse(BaseModel):
    """DNS/HTTP/redirect record response."""
    id: int
    shop_id: int
    a_records: Optional[str]
    mx_records: Optional[str]
    txt_records: Optional[str]
    ns_records: Optional[str]
    has_spf: Optional[bool]
    has_dmarc: Optional[bool]
    has_mx: Optional[bool]
    spf_record: Optional[str]
    dmarc_record: Optional[str]
    http_status_code: Optional[int]
    server_header: Optional[str]
    powered_by: Optional[str]
    security_score: Optional[int]
    security_headers_present: Optional[str]
    security_headers_missing: Optional[str]
    redirect_count: Optional[int]
    redirect_chain: Optional[str]
    http_to_https: Optional[bool]
    domain_changed: Optional[bool]
    final_url: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


class TechResponse(BaseModel):
    """Technology detection record response."""
    id: int
    shop_id: int
    technologies: Optional[str]
    all_detected: Optional[str]
    ecommerce_platform: Optional[str]
    cms: Optional[str]
    has_analytics: Optional[bool]
    has_cookie_consent: Optional[bool]
    has_trustmark: Optional[bool]
    trustmarks: Optional[str]
    payment_providers: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


class TrustmarkResponse(BaseModel):
    """Trustmark verification record response."""
    id: int
    shop_id: int
    verifications: Optional[str]
    total_checked: Optional[int]
    total_verified: Optional[int]
    total_not_found: Optional[int]
    claimed_not_verified: Optional[int]
    trustpilot_score: Optional[float]
    trustpilot_reviews: Optional[int]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True


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
    dns_http_records: List[DnsHttpResponse] = []
    tech_records: List[TechResponse] = []
    trustmark_records: List[TrustmarkResponse] = []
    ad_tracker_records: List['AdTrackerResponse'] = []

    class Config:
        from_attributes = True


class AdTrackerResponse(BaseModel):
    """Ad tracker detection record response."""
    id: int
    shop_id: int
    trackers: Optional[str]
    all_ids: Optional[str]
    all_ids_flat: Optional[str]
    total_trackers: Optional[int]
    total_unique_ids: Optional[int]
    cross_references: Optional[str]
    source: str
    collected_at: datetime

    class Config:
        from_attributes = True
