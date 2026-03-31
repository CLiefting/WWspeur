-- Migration 006: Scam database check records
-- Slaat resultaten op van checks bij opgelicht.nl, fraudehelpdesk.nl en watchlistinternet.nl

CREATE TABLE IF NOT EXISTS scam_check_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,

    domain VARCHAR(255),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    total_hits INTEGER NOT NULL DEFAULT 0,

    -- opgelicht.nl
    opgelicht_found BOOLEAN NOT NULL DEFAULT FALSE,
    opgelicht_count INTEGER NOT NULL DEFAULT 0,
    opgelicht_hits TEXT,

    -- fraudehelpdesk.nl
    fraudehelpdesk_found BOOLEAN NOT NULL DEFAULT FALSE,
    fraudehelpdesk_count INTEGER NOT NULL DEFAULT 0,
    fraudehelpdesk_hits TEXT,

    -- watchlistinternet.nl
    watchlist_found BOOLEAN NOT NULL DEFAULT FALSE,
    watchlist_count INTEGER NOT NULL DEFAULT 0,
    watchlist_hits TEXT,
    watchlist_warning_level VARCHAR(50),

    source VARCHAR(255) NOT NULL DEFAULT 'scam_check',
    raw_data TEXT,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_scam_check_records_shop_id ON scam_check_records(shop_id);
CREATE INDEX IF NOT EXISTS ix_scam_check_records_flagged ON scam_check_records(flagged);
