-- ============================================
-- Webwinkel Investigator - Database Schema
-- Initial migration: Create all tables
-- ============================================

-- Create enum types
CREATE TYPE risk_level AS ENUM ('unknown', 'low', 'medium', 'high', 'critical');
CREATE TYPE scan_status AS ENUM ('pending', 'running', 'completed', 'failed', 'partial');

-- ============================================
-- 1. Users table
-- ============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- ============================================
-- 2. Shops table
-- ============================================
CREATE TABLE shops (
    id SERIAL PRIMARY KEY,
    url VARCHAR(2048) UNIQUE NOT NULL,
    domain VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    risk_score FLOAT,
    risk_level risk_level NOT NULL DEFAULT 'unknown',
    notes TEXT,
    added_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shops_url ON shops(url);
CREATE INDEX idx_shops_domain ON shops(domain);
CREATE INDEX idx_shops_risk_level ON shops(risk_level);

-- ============================================
-- 3. Scans table
-- ============================================
CREATE TABLE scans (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status scan_status NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    collectors_requested VARCHAR(500),
    collectors_completed VARCHAR(500),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scans_shop_id ON scans(shop_id);
CREATE INDEX idx_scans_user_id ON scans(user_id);
CREATE INDEX idx_scans_status ON scans(status);

-- ============================================
-- 4. WHOIS Records
-- ============================================
CREATE TABLE whois_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    registrar VARCHAR(255),
    registrant_name VARCHAR(255),
    registrant_organization VARCHAR(255),
    registrant_country VARCHAR(100),
    registration_date DATE,
    expiration_date DATE,
    updated_date DATE,
    name_servers TEXT,
    domain_age_days INTEGER,
    is_privacy_protected BOOLEAN,
    source VARCHAR(255) NOT NULL DEFAULT 'whois_lookup',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whois_shop_id ON whois_records(shop_id);

-- ============================================
-- 5. SSL Records
-- ============================================
CREATE TABLE ssl_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    has_ssl BOOLEAN NOT NULL DEFAULT FALSE,
    issuer VARCHAR(255),
    subject VARCHAR(255),
    valid_from TIMESTAMP,
    valid_until TIMESTAMP,
    is_expired BOOLEAN,
    is_self_signed BOOLEAN,
    certificate_version INTEGER,
    serial_number VARCHAR(255),
    signature_algorithm VARCHAR(100),
    san_domains TEXT,
    source VARCHAR(255) NOT NULL DEFAULT 'ssl_check',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ssl_shop_id ON ssl_records(shop_id);

-- ============================================
-- 6. Scrape Records
-- ============================================
CREATE TABLE scrape_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    page_title VARCHAR(500),
    meta_description TEXT,
    emails_found TEXT,
    phones_found TEXT,
    addresses_found TEXT,
    kvk_number_found VARCHAR(50),
    btw_number_found VARCHAR(50),
    iban_found VARCHAR(50),
    social_media_links TEXT,
    external_links TEXT,
    has_terms_page BOOLEAN,
    has_privacy_page BOOLEAN,
    has_contact_page BOOLEAN,
    has_return_policy BOOLEAN,
    http_status_code INTEGER,
    redirect_chain TEXT,
    server_header VARCHAR(255),
    source_url VARCHAR(2048) NOT NULL,
    source VARCHAR(255) NOT NULL DEFAULT 'html_scrape',
    raw_html_hash VARCHAR(64),
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scrape_shop_id ON scrape_records(shop_id);

-- ============================================
-- 7. KvK Records
-- ============================================
CREATE TABLE kvk_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    kvk_number VARCHAR(20),
    company_name VARCHAR(255),
    trade_names TEXT,
    legal_form VARCHAR(100),
    registration_date DATE,
    street VARCHAR(255),
    house_number VARCHAR(20),
    postal_code VARCHAR(10),
    city VARCHAR(100),
    country VARCHAR(100),
    is_active BOOLEAN,
    sbi_codes TEXT,
    source VARCHAR(255) NOT NULL DEFAULT 'kvk_api',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kvk_shop_id ON kvk_records(shop_id);
CREATE INDEX idx_kvk_number ON kvk_records(kvk_number);
