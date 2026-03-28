-- ============================================
-- Migration 002: DNS/HTTP/Redirect records
-- ============================================

CREATE TABLE dns_http_records (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),

    -- DNS
    a_records TEXT,
    mx_records TEXT,
    txt_records TEXT,
    ns_records TEXT,
    has_spf BOOLEAN,
    has_dmarc BOOLEAN,
    has_mx BOOLEAN,
    spf_record TEXT,
    dmarc_record TEXT,

    -- HTTP headers
    http_status_code INTEGER,
    server_header VARCHAR(255),
    powered_by VARCHAR(255),
    security_score INTEGER,
    security_headers_present TEXT,
    security_headers_missing TEXT,

    -- Redirects
    redirect_count INTEGER,
    redirect_chain TEXT,
    http_to_https BOOLEAN,
    domain_changed BOOLEAN,
    final_url VARCHAR(2048),

    -- Source tracking
    source VARCHAR(255) NOT NULL DEFAULT 'dns_http_check',
    raw_data TEXT,
    collected_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dns_http_shop_id ON dns_http_records(shop_id);
