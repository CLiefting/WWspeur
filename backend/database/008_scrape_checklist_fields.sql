-- Migration 008: Checklist velden voor scrape_records
-- Voegt toe: binnenkort geopend, in onderhoud, talen, levertijd, pre-order, WhatsApp, verdachte prijzen

ALTER TABLE scrape_records
    ADD COLUMN IF NOT EXISTS is_opening_soon     BOOLEAN,
    ADD COLUMN IF NOT EXISTS is_maintenance      BOOLEAN,
    ADD COLUMN IF NOT EXISTS detected_languages  TEXT,
    ADD COLUMN IF NOT EXISTS has_delivery_time   BOOLEAN,
    ADD COLUMN IF NOT EXISTS has_preorder        BOOLEAN,
    ADD COLUMN IF NOT EXISTS has_whatsapp_contact BOOLEAN,
    ADD COLUMN IF NOT EXISTS has_suspicious_prices BOOLEAN;
