-- Migration 005: Ad tracker detection records
CREATE TABLE ad_tracker_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    trackers TEXT,
    all_ids TEXT,
    all_ids_flat TEXT,
    total_trackers INTEGER,
    total_unique_ids INTEGER,
    cross_references TEXT,
    source VARCHAR(255) NOT NULL DEFAULT 'ad_tracker_detection',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ad_tracker_shop_id ON ad_tracker_records(shop_id);
CREATE INDEX idx_ad_tracker_ids_flat ON ad_tracker_records USING gin(to_tsvector('simple', all_ids_flat));
