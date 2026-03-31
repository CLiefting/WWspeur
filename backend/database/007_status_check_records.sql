-- Migration 007: Website status check records
-- Slaat op of een website online of offline is, inclusief responstijd en HTTP-statuscode

CREATE TABLE IF NOT EXISTS status_check_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

    is_online BOOLEAN NOT NULL,
    http_status_code INTEGER,
    response_time_ms INTEGER,
    error_message VARCHAR(500),
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_status_check_records_shop_id ON status_check_records(shop_id);
CREATE INDEX IF NOT EXISTS ix_status_check_records_checked_at ON status_check_records(checked_at);
