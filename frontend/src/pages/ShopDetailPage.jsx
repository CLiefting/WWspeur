import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { shops, scans } from '../services/api';

function DataCard({ icon, label, values }) {
  if (!values || values.length === 0) return null;
  const items = typeof values === 'string' ? JSON.parse(values) : values;
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 20px', marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10,
      }}>
        {icon} {label} ({items.length})
      </div>
      {items.map((v, i) => (
        <div key={i} style={{
          fontFamily: 'var(--font-mono)', fontSize: 13,
          color: 'var(--gold-light)', padding: '6px 0',
          borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
          wordBreak: 'break-all',
        }}>
          {v}
        </div>
      ))}
    </div>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8,
      borderRadius: '50%',
      background: active ? 'var(--success)' : 'var(--danger)',
      boxShadow: active ? '0 0 8px var(--success)' : '0 0 8px var(--danger)',
      marginRight: 8,
    }} />
  );
}

export default function ShopDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');

  const loadShop = async () => {
    try {
      const data = await shops.get(id);
      setShop(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadShop(); }, [id]);

  const handleScan = async () => {
    setIsScanning(true);
    setScanStatus('Scan gestart...');

    try {
      const scan = await scans.create(parseInt(id), ['scrape']);
      await scans.pollUntilDone(scan.id, (s) => {
        if (s.status === 'running') setScanStatus('Pagina\'s worden gescraped...');
        else if (s.status === 'completed') setScanStatus('Voltooid!');
        else if (s.status === 'failed') setScanStatus('Mislukt');
      });
      await loadShop();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsScanning(false);
      setScanStatus('');
    }
  };

  if (loading) {
    return (
      <div style={{
        maxWidth: 960, margin: '0 auto', padding: '60px 24px',
        textAlign: 'center', color: 'var(--text-muted)',
      }}>
        Laden...
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--danger)', marginBottom: 16 }}>{error || 'Niet gevonden'}</div>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 13,
            padding: '8px 16px', borderRadius: 6,
          }}
        >Terug</button>
      </div>
    );
  }

  // Get latest scrape record
  const latestScrape = shop.scrape_records?.[shop.scrape_records.length - 1];
  const latestWhois = shop.whois_records?.[shop.whois_records.length - 1];
  const latestSSL = shop.ssl_records?.[shop.ssl_records.length - 1];
  const latestDnsHttp = shop.dns_http_records?.[shop.dns_http_records.length - 1];

  const parseJSON = (str) => {
    if (!str) return [];
    try { return JSON.parse(str); } catch { return []; }
  };
  const parseJSONObj = (str) => {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
  };

  const emails = latestScrape ? parseJSON(latestScrape.emails_found) : [];
  const phones = latestScrape ? parseJSON(latestScrape.phones_found) : [];
  const addresses = latestScrape ? parseJSON(latestScrape.addresses_found) : [];
  const socialMedia = latestScrape ? parseJSONObj(latestScrape.social_media_links) : {};
  const externalLinks = latestScrape ? parseJSON(latestScrape.external_links) : [];
  const nameServers = latestWhois ? parseJSON(latestWhois.name_servers) : [];
  const sanDomains = latestSSL ? parseJSON(latestSSL.san_domains) : [];
  const dnsARecords = latestDnsHttp ? parseJSON(latestDnsHttp.a_records) : [];
  const dnsMxRecords = latestDnsHttp ? parseJSON(latestDnsHttp.mx_records) : [];
  const secHeadersPresent = latestDnsHttp ? parseJSON(latestDnsHttp.security_headers_present) : [];
  const secHeadersMissing = latestDnsHttp ? parseJSON(latestDnsHttp.security_headers_missing) : [];
  const redirectChain = latestDnsHttp ? parseJSON(latestDnsHttp.redirect_chain) : [];

  const riskColors = {
    unknown: 'var(--text-muted)', low: 'var(--success)',
    medium: 'var(--gold)', high: 'var(--danger)', critical: '#FF4444',
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      
      {/* Back + title */}
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-muted)', fontSize: 12,
            marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          ← Terug naar overzicht
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 22,
              color: 'var(--gold)', fontWeight: 600, marginBottom: 4,
            }}>
              {shop.domain}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{shop.url}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {shop.risk_score !== null && (
              <div style={{
                fontSize: 28, fontWeight: 700,
                color: riskColors[shop.risk_level] || 'var(--text-muted)',
              }}>
                {Math.round(shop.risk_score)}
              </div>
            )}
            <button
              onClick={handleScan}
              disabled={isScanning}
              style={{
                background: isScanning ? 'transparent' : 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
                border: isScanning ? '1px solid var(--border)' : 'none',
                color: isScanning ? 'var(--text-secondary)' : 'var(--bg-primary)',
                fontWeight: 600, fontSize: 13,
                padding: '10px 20px', borderRadius: 8,
                transition: 'all 0.2s',
              }}
            >
              {isScanning ? scanStatus : 'Opnieuw scannen'}
            </button>
          </div>
        </div>
      </div>

      {/* No data yet */}
      {!latestScrape && !latestWhois && !latestSSL && !latestDnsHttp && (
        <div style={{
          textAlign: 'center', padding: '60px 0',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 15, marginBottom: 8 }}>Nog geen scanresultaten</div>
          <div style={{ fontSize: 13 }}>Klik op "Opnieuw scannen" om deze webwinkel te onderzoeken.</div>
        </div>
      )}

      {/* Results */}
      {(latestScrape || latestWhois || latestSSL || latestDnsHttp) && (
        <>
          {/* Stats row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 10, marginBottom: 24,
          }}>
            {[
              { label: "E-mails", value: emails.length },
              { label: "Telefoon", value: phones.length },
              { label: "Adressen", value: addresses.length },
              { label: "Externe links", value: externalLinks.length },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10, padding: '14px 18px', textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 26, fontWeight: 600, color: 'var(--gold)',
                  lineHeight: 1, marginBottom: 4,
                }}>
                  {value}
                </div>
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Page checks */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
            marginBottom: 24,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              gridColumn: '1 / -1', marginBottom: 4,
            }}>
              Pagina checks
            </div>
            {[
              { label: 'Contactpagina', ok: latestScrape.has_contact_page },
              { label: 'Privacybeleid', ok: latestScrape.has_privacy_page },
              { label: 'Algemene voorwaarden', ok: latestScrape.has_terms_page },
              { label: 'Retourbeleid', ok: latestScrape.has_return_policy },
            ].map(({ label, ok }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', fontSize: 13 }}>
                <StatusDot active={ok} />
                <span style={{ color: ok ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Business identifiers */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px', marginBottom: 24,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
            }}>
              Bedrijfsgegevens
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
              {[
                { label: 'KvK-nummer', value: latestScrape?.kvk_number_found },
                { label: 'BTW-nummer', value: latestScrape?.btw_number_found },
                { label: 'IBAN', value: latestScrape?.iban_found },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 14,
                    color: value ? 'var(--gold-light)' : 'var(--text-muted)',
                  }}>
                    {value || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WHOIS & SSL side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            {/* WHOIS card */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
              }}>
                🌐 WHOIS domeinregistratie
              </div>
              {latestWhois ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    { label: 'Registrar', value: latestWhois.registrar },
                    { label: 'Registrant', value: latestWhois.registrant_name },
                    { label: 'Organisatie', value: latestWhois.registrant_organization },
                    { label: 'Land', value: latestWhois.registrant_country },
                    { label: 'Geregistreerd', value: latestWhois.registration_date },
                    { label: 'Vervalt', value: latestWhois.expiration_date },
                    { label: 'Domein leeftijd', value: latestWhois.domain_age_days ? `${latestWhois.domain_age_days} dagen` : null },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
                      <span style={{
                        fontSize: 13, fontFamily: 'var(--font-mono)',
                        color: value ? 'var(--gold-light)' : 'var(--text-muted)',
                      }}>
                        {value || '—'}
                      </span>
                    </div>
                  ))}
                  {/* Privacy indicator */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Privacy beschermd</span>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 20,
                      background: latestWhois.is_privacy_protected ? 'rgba(232, 160, 32, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                      color: latestWhois.is_privacy_protected ? 'var(--gold)' : 'var(--success)',
                      fontWeight: 600,
                    }}>
                      {latestWhois.is_privacy_protected ? 'Ja' : 'Nee'}
                    </span>
                  </div>
                  {/* Nameservers */}
                  {nameServers.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nameservers</div>
                      {nameServers.map((ns, i) => (
                        <div key={i} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{ns}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Geen WHOIS data beschikbaar</div>
              )}
            </div>

            {/* SSL card */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
              }}>
                🔒 SSL certificaat
              </div>
              {latestSSL ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {/* SSL status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>SSL actief</span>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 20,
                      background: latestSSL.has_ssl ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                      color: latestSSL.has_ssl ? 'var(--success)' : 'var(--danger)',
                      fontWeight: 600,
                    }}>
                      {latestSSL.has_ssl ? 'Ja' : 'Nee'}
                    </span>
                  </div>
                  {[
                    { label: 'Uitgever', value: latestSSL.issuer },
                    { label: 'Geldig vanaf', value: latestSSL.valid_from ? new Date(latestSSL.valid_from).toLocaleDateString('nl-NL') : null },
                    { label: 'Geldig tot', value: latestSSL.valid_until ? new Date(latestSSL.valid_until).toLocaleDateString('nl-NL') : null },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
                      <span style={{
                        fontSize: 13, fontFamily: 'var(--font-mono)',
                        color: value ? 'var(--gold-light)' : 'var(--text-muted)',
                      }}>
                        {value || '—'}
                      </span>
                    </div>
                  ))}
                  {/* Expired badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Verlopen</span>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 20,
                      background: latestSSL.is_expired ? 'rgba(248, 113, 113, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                      color: latestSSL.is_expired ? 'var(--danger)' : 'var(--success)',
                      fontWeight: 600,
                    }}>
                      {latestSSL.is_expired ? 'Ja' : 'Nee'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Self-signed</span>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 20,
                      background: latestSSL.is_self_signed ? 'rgba(248, 113, 113, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                      color: latestSSL.is_self_signed ? 'var(--danger)' : 'var(--success)',
                      fontWeight: 600,
                    }}>
                      {latestSSL.is_self_signed ? 'Ja' : 'Nee'}
                    </span>
                  </div>
                  {/* SAN domains */}
                  {sanDomains.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                        SAN domeinen ({sanDomains.length})
                      </div>
                      {sanDomains.slice(0, 5).map((d, i) => (
                        <div key={i} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{d}</div>
                      ))}
                      {sanDomains.length > 5 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          + {sanDomains.length - 5} meer
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Geen SSL data beschikbaar</div>
              )}
            </div>
          </div>

          {/* DNS / HTTP Headers / Redirects */}
          {latestDnsHttp && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

                {/* DNS card */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
                  }}>
                    📡 DNS records
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>A records</span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {dnsARecords.length > 0 ? dnsARecords[0] : '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>MX (e-mail)</span>
                      <StatusDot active={latestDnsHttp.has_mx} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>SPF</span>
                      <StatusDot active={latestDnsHttp.has_spf} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>DMARC</span>
                      <StatusDot active={latestDnsHttp.has_dmarc} />
                    </div>
                    {dnsMxRecords.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, marginTop: 4 }}>MX servers</div>
                        {dnsMxRecords.slice(0, 3).map((mx, i) => (
                          <div key={i} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {mx.host || mx}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* HTTP Security Headers card */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span>🛡️ Security headers</span>
                    <span style={{
                      fontSize: 16, fontWeight: 700,
                      color: latestDnsHttp.security_score >= 70 ? 'var(--success)' :
                             latestDnsHttp.security_score >= 40 ? 'var(--gold)' : 'var(--danger)',
                    }}>
                      {latestDnsHttp.security_score}%
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {secHeadersPresent.map((h, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ color: 'var(--success)' }}>✓</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{h.name}</span>
                      </div>
                    ))}
                    {secHeadersMissing.map((h, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ color: 'var(--danger)' }}>✗</span>
                        <span style={{ color: 'var(--text-muted)' }}>{h.name}</span>
                      </div>
                    ))}
                  </div>
                  {latestDnsHttp.server_header && (
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                      Server: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{latestDnsHttp.server_header}</span>
                    </div>
                  )}
                  {latestDnsHttp.powered_by && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Powered by: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{latestDnsHttp.powered_by}</span>
                    </div>
                  )}
                </div>

                {/* Redirects card */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
                  }}>
                    🔀 Redirects
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aantal redirects</span>
                      <span style={{
                        fontSize: 13, fontFamily: 'var(--font-mono)',
                        color: latestDnsHttp.redirect_count > 3 ? 'var(--danger)' : 'var(--gold-light)',
                      }}>
                        {latestDnsHttp.redirect_count}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>HTTP → HTTPS</span>
                      <StatusDot active={latestDnsHttp.http_to_https} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Domein wijzigt</span>
                      <span style={{
                        fontSize: 11, padding: '2px 10px', borderRadius: 20,
                        background: latestDnsHttp.domain_changed ? 'rgba(248, 113, 113, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                        color: latestDnsHttp.domain_changed ? 'var(--danger)' : 'var(--success)',
                        fontWeight: 600,
                      }}>
                        {latestDnsHttp.domain_changed ? 'Ja' : 'Nee'}
                      </span>
                    </div>
                    {latestDnsHttp.final_url && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, marginTop: 4 }}>Eindbestemming</div>
                        <div style={{
                          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {latestDnsHttp.final_url}
                        </div>
                      </div>
                    )}
                    {redirectChain.length > 1 && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, marginTop: 4 }}>Redirect keten</div>
                        {redirectChain.map((step, i) => (
                          <div key={i} style={{
                            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                            padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {step.status_code} → {step.url}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Data cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <DataCard icon="📧" label="E-mailadressen" values={emails} />
              <DataCard icon="📞" label="Telefoonnummers" values={phones} />
              <DataCard icon="📍" label="Adressen" values={addresses} />
            </div>
            <div>
              {/* Social media */}
              {Object.keys(socialMedia).length > 0 && (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px', marginBottom: 12,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10,
                  }}>
                    🌐 Social media
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(socialMedia).map(([platform, link]) => (
                      <a
                        key={platform}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12, padding: '4px 12px', borderRadius: 20,
                          background: 'var(--gold-glow)',
                          border: '1px solid var(--gold-dim)',
                          color: 'var(--gold-light)', fontWeight: 500,
                          textTransform: 'capitalize', textDecoration: 'none',
                        }}
                      >
                        {platform}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* External links (first 20) */}
              {externalLinks.length > 0 && (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10,
                  }}>
                    🔗 Externe links ({externalLinks.length})
                  </div>
                  {externalLinks.slice(0, 20).map((link, i) => (
                    <div key={i} style={{
                      fontSize: 12, padding: '4px 0',
                      borderBottom: i < Math.min(externalLinks.length, 20) - 1 ? '1px solid var(--border)' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      <a href={link} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                      >
                        {link}
                      </a>
                    </div>
                  ))}
                  {externalLinks.length > 20 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                      + {externalLinks.length - 20} meer
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Scan history */}
          {shop.scans && shop.scans.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
              }}>
                Scangeschiedenis
              </div>
              {shop.scans.map(scan => (
                <div key={scan.id} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 16px',
                  marginBottom: 6, display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusDot active={scan.status === 'completed'} />
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Scan #{scan.id}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, color: 'var(--text-muted)' }}>
                    <span>{scan.status}</span>
                    <span>{new Date(scan.created_at).toLocaleString('nl-NL')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Meta info */}
          <div style={{
            marginTop: 24, padding: '12px 0',
            borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Laatst gescraped: {new Date(latestScrape.collected_at).toLocaleString('nl-NL')}</span>
            <span>Bron: {latestScrape.source}</span>
          </div>
        </>
      )}
    </div>
  );
}
