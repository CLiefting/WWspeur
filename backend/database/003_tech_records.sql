-- Migration 003: Technology detection records
CREATE TABLE tech_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    technologies TEXT,
    all_detected TEXT,
    ecommerce_platform VARCHAR(100),
    cms VARCHAR(100),
    has_analytics BOOLEAN,
    has_cookie_consent BOOLEAN,
    has_trustmark BOOLEAN,
    trustmarks TEXT,
    payment_providers TEXT,
    source VARCHAR(255) NOT NULL DEFAULT 'tech_detection',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tech_shop_id ON tech_records(shop_id);
