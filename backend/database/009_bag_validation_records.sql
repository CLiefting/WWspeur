-- Migration 009: BAG/PDOK adresvalidatie resultaten
CREATE TABLE IF NOT EXISTS bag_validation_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,

    addresses_checked  INTEGER NOT NULL DEFAULT 0,
    addresses_valid    INTEGER NOT NULL DEFAULT 0,
    addresses_invalid  INTEGER NOT NULL DEFAULT 0,
    validation_results TEXT,

    collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bag_validation_records_shop_id ON bag_validation_records(shop_id);
