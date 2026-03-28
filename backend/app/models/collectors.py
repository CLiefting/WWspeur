"""
Data collection models - stores results from each collector.
Each record tracks: what was found, where it was found (source), and when.
"""
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Text, Boolean, Date
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin


class WhoisRecord(Base, TimestampMixin):
    """WHOIS / domain registration data."""
    __tablename__ = "whois_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    # WHOIS data
    registrar = Column(String(255), nullable=True)
    registrant_name = Column(String(255), nullable=True)
    registrant_organization = Column(String(255), nullable=True)
    registrant_country = Column(String(100), nullable=True)
    registration_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)
    updated_date = Column(Date, nullable=True)
    name_servers = Column(Text, nullable=True)  # JSON list
    domain_age_days = Column(Integer, nullable=True)
    
    # Privacy / proxy registration
    is_privacy_protected = Column(Boolean, nullable=True)

    # Source tracking
    source = Column(String(255), nullable=False, default="whois_lookup")
    raw_data = Column(Text, nullable=True)  # Full raw WHOIS response
    collected_at = Column(DateTime, nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="whois_records")

    def __repr__(self):
        return f"<WhoisRecord(id={self.id}, shop_id={self.shop_id}, registrar='{self.registrar}')>"


class SSLRecord(Base, TimestampMixin):
    """SSL certificate information."""
    __tablename__ = "ssl_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    # SSL data
    has_ssl = Column(Boolean, nullable=False, default=False)
    issuer = Column(String(255), nullable=True)
    subject = Column(String(255), nullable=True)
    valid_from = Column(DateTime, nullable=True)
    valid_until = Column(DateTime, nullable=True)
    is_expired = Column(Boolean, nullable=True)
    is_self_signed = Column(Boolean, nullable=True)
    certificate_version = Column(Integer, nullable=True)
    serial_number = Column(String(255), nullable=True)
    signature_algorithm = Column(String(100), nullable=True)
    
    # Subject Alternative Names (SAN)
    san_domains = Column(Text, nullable=True)  # JSON list

    # Source tracking
    source = Column(String(255), nullable=False, default="ssl_check")
    raw_data = Column(Text, nullable=True)
    collected_at = Column(DateTime, nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="ssl_records")

    def __repr__(self):
        return f"<SSLRecord(id={self.id}, shop_id={self.shop_id}, has_ssl={self.has_ssl})>"


class ScrapeRecord(Base, TimestampMixin):
    """Data scraped from the website itself (contact info, emails, etc.)."""
    __tablename__ = "scrape_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    # Scraped data
    page_title = Column(String(500), nullable=True)
    meta_description = Column(Text, nullable=True)
    
    # Contact information found
    emails_found = Column(Text, nullable=True)       # JSON list
    phones_found = Column(Text, nullable=True)        # JSON list
    addresses_found = Column(Text, nullable=True)     # JSON list
    
    # Business identifiers found on page
    kvk_number_found = Column(String(50), nullable=True)
    btw_number_found = Column(String(50), nullable=True)
    iban_found = Column(String(50), nullable=True)
    
    # Links and references
    social_media_links = Column(Text, nullable=True)  # JSON dict
    external_links = Column(Text, nullable=True)      # JSON list
    
    # Page metadata
    has_terms_page = Column(Boolean, nullable=True)
    has_privacy_page = Column(Boolean, nullable=True)
    has_contact_page = Column(Boolean, nullable=True)
    has_return_policy = Column(Boolean, nullable=True)
    
    # Technical details
    http_status_code = Column(Integer, nullable=True)
    redirect_chain = Column(Text, nullable=True)      # JSON list
    server_header = Column(String(255), nullable=True)
    
    # Source tracking
    source_url = Column(String(2048), nullable=False)
    source = Column(String(255), nullable=False, default="html_scrape")
    raw_html_hash = Column(String(64), nullable=True)  # SHA256 of scraped HTML
    collected_at = Column(DateTime, nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="scrape_records")

    def __repr__(self):
        return f"<ScrapeRecord(id={self.id}, shop_id={self.shop_id}, page_title='{self.page_title}')>"


class KvKRecord(Base, TimestampMixin):
    """KvK (Kamer van Koophandel) business registration data."""
    __tablename__ = "kvk_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    # KvK data
    kvk_number = Column(String(20), nullable=True)
    company_name = Column(String(255), nullable=True)
    trade_names = Column(Text, nullable=True)         # JSON list
    legal_form = Column(String(100), nullable=True)
    registration_date = Column(Date, nullable=True)
    
    # Address
    street = Column(String(255), nullable=True)
    house_number = Column(String(20), nullable=True)
    postal_code = Column(String(10), nullable=True)
    city = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    
    # Status
    is_active = Column(Boolean, nullable=True)
    
    # SBI codes (business activity classification)
    sbi_codes = Column(Text, nullable=True)           # JSON list

    # Source tracking
    source = Column(String(255), nullable=False, default="kvk_api")
    raw_data = Column(Text, nullable=True)
    collected_at = Column(DateTime, nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="kvk_records")

    def __repr__(self):
        return f"<KvKRecord(id={self.id}, shop_id={self.shop_id}, kvk_number='{self.kvk_number}')>"


class DnsHttpRecord(Base, TimestampMixin):
    """DNS records, HTTP security headers, and redirect chain data."""
    __tablename__ = "dns_http_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    # DNS
    a_records = Column(Text, nullable=True)       # JSON list
    mx_records = Column(Text, nullable=True)      # JSON list
    txt_records = Column(Text, nullable=True)      # JSON list
    ns_records = Column(Text, nullable=True)       # JSON list
    has_spf = Column(Boolean, nullable=True)
    has_dmarc = Column(Boolean, nullable=True)
    has_mx = Column(Boolean, nullable=True)
    spf_record = Column(Text, nullable=True)
    dmarc_record = Column(Text, nullable=True)

    # HTTP headers
    http_status_code = Column(Integer, nullable=True)
    server_header = Column(String(255), nullable=True)
    powered_by = Column(String(255), nullable=True)
    security_score = Column(Integer, nullable=True)  # 0-100
    security_headers_present = Column(Text, nullable=True)  # JSON
    security_headers_missing = Column(Text, nullable=True)  # JSON

    # Redirects
    redirect_count = Column(Integer, nullable=True)
    redirect_chain = Column(Text, nullable=True)   # JSON
    http_to_https = Column(Boolean, nullable=True)
    domain_changed = Column(Boolean, nullable=True)
    final_url = Column(String(2048), nullable=True)

    # Source tracking
    source = Column(String(255), nullable=False, default="dns_http_check")
    raw_data = Column(Text, nullable=True)
    collected_at = Column(DateTime, nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="dns_http_records")

    def __repr__(self):
        return f"<DnsHttpRecord(id={self.id}, shop_id={self.shop_id}, security_score={self.security_score})>"


class TechRecord(Base, TimestampMixin):
    """Technology detection results."""
    __tablename__ = "tech_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    technologies = Column(Text, nullable=True)        # JSON: category -> [names]
    all_detected = Column(Text, nullable=True)         # JSON: [{category, name}]
    ecommerce_platform = Column(String(100), nullable=True)
    cms = Column(String(100), nullable=True)
    has_analytics = Column(Boolean, nullable=True)
    has_cookie_consent = Column(Boolean, nullable=True)
    has_trustmark = Column(Boolean, nullable=True)
    trustmarks = Column(Text, nullable=True)           # JSON list
    payment_providers = Column(Text, nullable=True)    # JSON list

    source = Column(String(255), nullable=False, default="tech_detection")
    raw_data = Column(Text, nullable=True)
    collected_at = Column(DateTime, nullable=False)

    shop = relationship("Shop", back_populates="tech_records")

    def __repr__(self):
        return f"<TechRecord(id={self.id}, shop_id={self.shop_id}, platform={self.ecommerce_platform})>"


class TrustmarkRecord(Base, TimestampMixin):
    """Trustmark/keurmerk verification results."""
    __tablename__ = "trustmark_records"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=True)

    verifications = Column(Text, nullable=True)       # JSON: full verification results
    total_checked = Column(Integer, nullable=True)
    total_verified = Column(Integer, nullable=True)
    total_not_found = Column(Integer, nullable=True)
    claimed_not_verified = Column(Integer, nullable=True)

    # Trustpilot specific
    trustpilot_score = Column(Float, nullable=True)
    trustpilot_reviews = Column(Integer, nullable=True)

    source = Column(String(255), nullable=False, default="trustmark_verification")
    raw_data = Column(Text, nullable=True)
    collected_at = Column(DateTime, nullable=False)

    shop = relationship("Shop", back_populates="trustmark_records")

    def __repr__(self):
        return f"<TrustmarkRecord(id={self.id}, shop_id={self.shop_id}, verified={self.total_verified})>"
