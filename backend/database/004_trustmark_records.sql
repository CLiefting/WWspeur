-- Migration 004: Trustmark verification records
CREATE TABLE trustmark_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    verifications TEXT,
    total_checked INTEGER,
    total_verified INTEGER,
    total_not_found INTEGER,
    claimed_not_verified INTEGER,
    trustpilot_score FLOAT,
    trustpilot_reviews INTEGER,
    source VARCHAR(255) NOT NULL DEFAULT 'trustmark_verification',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_trustmark_shop_id ON trustmark_records(shop_id);
