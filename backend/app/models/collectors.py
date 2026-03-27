"""
Data collection models - stores results from each collector.
Each record tracks: what was found, where it was found (source), and when.
"""
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Boolean, Date
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
