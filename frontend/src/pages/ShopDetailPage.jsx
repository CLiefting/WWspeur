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

  const [scanProgress, setScanProgress] = useState(null);
  const [riskDetail, setRiskDetail] = useState(null);
  const [recalculating, setRecalculating] = useState(false);

  const handleRecalculateRisk = async () => {
    setRecalculating(true);
    try {
      const token = localStorage.getItem('wwspeur_token');
      const res = await fetch(`/api/v1/shops/${id}/recalculate-risk`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRiskDetail(data);
        await loadShop();
      }
    } catch (err) { console.error(err); }
    finally { setRecalculating(false); }
  };

  const handleScan = async () => {
    setIsScanning(true);
    setScanStatus('Scan gestart...');
    setScanProgress(null);

    try {
      const scan = await scans.create(parseInt(id), ['whois', 'ssl', 'dns_http', 'tech', 'trustmark', 'ad_tracker', 'scrape', 'kvk'], 50);
      await scans.pollUntilDone(
        scan.id,
        (s) => {
          if (s.status === 'completed') setScanStatus('Voltooid!');
          else if (s.status === 'failed') setScanStatus('Mislukt');
        },
        (progressData) => {
          if (progressData.progress && Object.keys(progressData.progress).length > 0) {
            setScanProgress(progressData.progress);
            const p = progressData.progress;
            setScanStatus(
              `Pagina ${p.pages_crawled || 0}/${p.max_pages || '?'} — ` +
              `${p.emails_found || 0} emails, ${p.phones_found || 0} tel, ` +
              `${p.kvk_found || 0} KvK`
            );
          }
        },
      );
      await loadShop();
      // Herbereken risicoscore na scan
      const token = localStorage.getItem('wwspeur_token');
      const res = await fetch(`/api/v1/shops/${id}/recalculate-risk`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) { setRiskDetail(await res.json()); await loadShop(); }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsScanning(false);
      setScanStatus('');
      setScanProgress(null);
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
  const latestTech = shop.tech_records?.[shop.tech_records.length - 1];

  const parseJSON = (str) => {
    if (!str) return [];
    try { return JSON.parse(str); } catch { return []; }
  };
  const parseJSONObj = (str) => {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
  };

  const emails = latestScrape ? parseJSON(latestScrape?.emails_found) : [];
  const phones = latestScrape ? parseJSON(latestScrape?.phones_found) : [];
  const addresses = latestScrape ? parseJSON(latestScrape?.addresses_found) : [];
  const socialMedia = latestScrape ? parseJSONObj(latestScrape?.social_media_links) : {};
  const externalLinks = latestScrape ? parseJSON(latestScrape?.external_links) : [];
  const nameServers = latestWhois ? parseJSON(latestWhois.name_servers) : [];
  const sanDomains = latestSSL ? parseJSON(latestSSL.san_domains) : [];
  const dnsARecords = latestDnsHttp ? parseJSON(latestDnsHttp.a_records) : [];
  const dnsMxRecords = latestDnsHttp ? parseJSON(latestDnsHttp.mx_records) : [];
  const secHeadersPresent = latestDnsHttp ? parseJSON(latestDnsHttp.security_headers_present) : [];
  const secHeadersMissing = latestDnsHttp ? parseJSON(latestDnsHttp.security_headers_missing) : [];
  const redirectChain = latestDnsHttp ? parseJSON(latestDnsHttp.redirect_chain) : [];
  const techAll = latestTech ? parseJSON(latestTech.all_detected) : [];
  const techTrustmarks = latestTech ? parseJSON(latestTech.trustmarks) : [];
  const techPayment = latestTech ? parseJSON(latestTech.payment_providers) : [];
  const techCategories = latestTech ? parseJSONObj(latestTech.technologies) : {};
  const latestTrustmark = shop.trustmark_records?.[shop.trustmark_records.length - 1];
  const trustmarkVerifications = latestTrustmark ? parseJSON(latestTrustmark.verifications) : [];
  const latestAdTracker = shop.ad_tracker_records?.[shop.ad_tracker_records.length - 1];
  const adTrackers = latestAdTracker ? parseJSON(latestAdTracker.trackers) : [];
  const adCrossRefs = latestAdTracker ? parseJSON(latestAdTracker.cross_references) : [];
  const adRawData = latestAdTracker ? parseJSONObj(latestAdTracker.raw_data) : {};
  const hackerTarget = adRawData?.hackertarget;
  const kvkRecords = shop.kvk_records || [];
  const latestKvk = kvkRecords.length > 0 ? kvkRecords[kvkRecords.length - 1] : null;

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
            <button
              onClick={async () => {
                try {
                  const token = localStorage.getItem('wwspeur_token');
                  const response = await fetch(`/api/v1/shops/${id}/report`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                  });
                  if (!response.ok) throw new Error('Download mislukt');
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const contentDisp = response.headers.get('content-disposition');
                  const match = contentDisp?.match(/filename="?([^"]+)"?/);
                  a.download = match ? match[1] : `wwspeur_${shop.domain.replace(/\./g,'_')}_${new Date().toISOString().slice(0,19).replace(/[:-]/g,'')}.docx`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (err) {
                  alert('Rapport downloaden mislukt: ' + err.message);
                }
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontWeight: 500, fontSize: 13,
                padding: '10px 20px', borderRadius: 8,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
              onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
            >
              📄 Download rapport
            </button>
          </div>
        </div>
      </div>

      {/* Scan progress indicator */}
      {isScanning && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--gold-dim)',
          borderRadius: 10, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: scanProgress ? 12 : 0 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, color: 'var(--gold-light)' }}>{scanStatus}</span>
          </div>
          {scanProgress && (
            <>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, ((scanProgress.pages_crawled || 0) / (scanProgress.max_pages || 50)) * 100)}%`,
                  background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))',
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: "Pagina's", value: scanProgress.pages_crawled || 0 },
                  { label: 'E-mails', value: scanProgress.emails_found || 0 },
                  { label: 'Telefoon', value: scanProgress.phones_found || 0 },
                  { label: 'KvK', value: scanProgress.kvk_found || 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--gold)', lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      )}

      {/* No data yet */}
      {!latestScrape && !latestWhois && !latestSSL && !latestDnsHttp && !latestTech && (
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
      {(latestScrape || latestWhois || latestSSL || latestDnsHttp || latestTech) && (
        <>
          {/* Risicobeoordeling */}
          {(() => {
            const level = shop.risk_level || 'unknown';
            const score = shop.risk_score;
            const cfg = {
              unknown:  { color: 'var(--text-muted)',  bg: 'var(--border)',              label: 'Onbekend' },
              low:      { color: 'var(--success)',      bg: 'rgba(74,222,128,0.12)',      label: 'Laag risico' },
              medium:   { color: 'var(--gold)',         bg: 'rgba(232,160,32,0.12)',      label: 'Gemiddeld risico' },
              high:     { color: 'var(--danger)',       bg: 'rgba(248,113,113,0.12)',     label: 'Hoog risico' },
              critical: { color: '#FF4444',             bg: 'rgba(248,113,113,0.25)',     label: 'Kritiek risico' },
            }[level] || { color: 'var(--text-muted)', bg: 'var(--border)', label: level };
            const tips = riskDetail?.tips || [];
            return (
              <div style={{
                background: cfg.bg, border: `1px solid ${cfg.color}33`,
                borderRadius: 10, padding: '16px 20px', marginBottom: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tips.length > 0 ? 12 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                    {score != null && (
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        score: <span style={{ color: cfg.color, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{Math.round(score)}/100</span>
                      </span>
                    )}
                    {score == null && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— nog niet berekend</span>
                    )}
                  </div>
                  <button
                    onClick={handleRecalculateRisk}
                    disabled={recalculating}
                    style={{
                      background: 'transparent', border: `1px solid ${cfg.color}66`,
                      color: cfg.color, fontSize: 11, padding: '4px 12px',
                      borderRadius: 6, cursor: 'pointer', opacity: recalculating ? 0.5 : 1,
                    }}
                  >
                    {recalculating ? 'Berekenen...' : 'Herbereken'}
                  </button>
                </div>
                {tips.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {tips.map(t => (
                      <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ color: 'var(--danger)', fontWeight: 700, minWidth: 28, textAlign: 'right' }}>−{t.impact}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{t.tip}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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
              { label: 'Contactpagina', ok: latestScrape?.has_contact_page },
              { label: 'Privacybeleid', ok: latestScrape?.has_privacy_page },
              { label: 'Algemene voorwaarden', ok: latestScrape?.has_terms_page },
              { label: 'Retourbeleid', ok: latestScrape?.has_return_policy },
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
              ].map(({ label, value }) => {
                // Parse JSON arrays
                let display = value;
                try {
                  const parsed = JSON.parse(value);
                  if (Array.isArray(parsed)) display = parsed.join(', ');
                } catch {}
                return (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 14,
                      color: display ? 'var(--gold-light)' : 'var(--text-muted)',
                    }}>
                      {display || '—'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* IBAN section with country flags */}
            {(() => {
              const COUNTRY_FLAGS = {
                NL: '🇳🇱', DE: '🇩🇪', BE: '🇧🇪', GB: '🇬🇧', FR: '🇫🇷', ES: '🇪🇸',
                IT: '🇮🇹', PT: '🇵🇹', AT: '🇦🇹', CH: '🇨🇭', PL: '🇵🇱', CZ: '🇨🇿',
                DK: '🇩🇰', SE: '🇸🇪', NO: '🇳🇴', FI: '🇫🇮', IE: '🇮🇪', LU: '🇱🇺',
                RO: '🇷🇴', BG: '🇧🇬', HR: '🇭🇷', HU: '🇭🇺', SK: '🇸🇰', SI: '🇸🇮',
                LT: '🇱🇹', LV: '🇱🇻', EE: '🇪🇪', MT: '🇲🇹', CY: '🇨🇾', GR: '🇬🇷',
                TR: '🇹🇷', US: '🇺🇸', RU: '🇷🇺', UA: '🇺🇦', CN: '🇨🇳',
              };
              const COUNTRY_NAMES = {
                NL: 'Nederland', DE: 'Duitsland', BE: 'België', GB: 'Verenigd Koninkrijk',
                FR: 'Frankrijk', ES: 'Spanje', IT: 'Italië', PT: 'Portugal',
                AT: 'Oostenrijk', CH: 'Zwitserland', PL: 'Polen', CZ: 'Tsjechië',
                DK: 'Denemarken', SE: 'Zweden', NO: 'Noorwegen', FI: 'Finland',
                IE: 'Ierland', LU: 'Luxemburg', RO: 'Roemenië', BG: 'Bulgarije',
                HR: 'Kroatië', HU: 'Hongarije', SK: 'Slowakije', SI: 'Slovenië',
                LT: 'Litouwen', LV: 'Letland', EE: 'Estland', MT: 'Malta',
                CY: 'Cyprus', GR: 'Griekenland', TR: 'Turkije', US: 'VS',
                RU: 'Rusland', UA: 'Oekraïne', CN: 'China',
              };

              let ibans = [];
              try {
                const raw = latestScrape?.iban_found;
                if (raw) {
                  const parsed = JSON.parse(raw);
                  ibans = Array.isArray(parsed) ? parsed : [parsed];
                }
              } catch {
                if (latestScrape?.iban_found) ibans = [latestScrape.iban_found];
              }

              if (ibans.length === 0) return (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>IBAN</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-muted)' }}>—</div>
                </div>
              );

              // Group by country
              const byCountry = {};
              ibans.forEach(iban => {
                const cc = iban.substring(0, 2).toUpperCase();
                if (!byCountry[cc]) byCountry[cc] = [];
                byCountry[cc].push(iban);
              });

              // Sort: NL first, then alphabetical
              const sortedCountries = Object.keys(byCountry).sort((a, b) => {
                if (a === 'NL') return -1;
                if (b === 'NL') return 1;
                return a.localeCompare(b);
              });

              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    IBAN ({ibans.length})
                  </div>
                  {sortedCountries.map(cc => (
                    <div key={cc} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 18 }}>{COUNTRY_FLAGS[cc] || '🏳️'}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {COUNTRY_NAMES[cc] || cc}
                        </span>
                        {cc !== 'NL' && (
                          <span style={{
                            fontSize: 10, padding: '1px 8px', borderRadius: 12,
                            background: 'rgba(248, 113, 113, 0.15)',
                            color: 'var(--danger)', fontWeight: 600,
                          }}>
                            Buitenlands
                          </span>
                        )}
                      </div>
                      {byCountry[cc].map((iban, i) => (
                        <div key={i} style={{
                          fontFamily: 'var(--font-mono)', fontSize: 14,
                          color: 'var(--gold-light)', paddingLeft: 30, padding: '2px 0 2px 30px',
                        }}>
                          {iban}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
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
                    {/* A records with org */}
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>A records</div>
                      {dnsARecords.length > 0 ? dnsARecords.map((rec, i) => (
                        <div key={i} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', padding: '2px 0' }}>
                          {rec.ip || rec}
                          {rec.org && (
                            <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)', marginLeft: 6, fontSize: 11 }}>
                              ({rec.org})
                            </span>
                          )}
                        </div>
                      )) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</div>
                      )}
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

          {/* Technology detection */}
          {latestTech && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px', marginBottom: 24,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>⚙️ Technologie detectie</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'none', fontWeight: 400 }}>
                  {techAll.length} technologieen
                </span>
              </div>

              {/* Platform + CMS highlight */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                {latestTech.ecommerce_platform && (
                  <div style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'var(--gold-glow)', border: '1px solid var(--gold-dim)',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Platform</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gold)' }}>{latestTech.ecommerce_platform}</div>
                  </div>
                )}
                {latestTech.cms && (
                  <div style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.3)',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>CMS</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>{latestTech.cms}</div>
                  </div>
                )}
              </div>

              {/* All categories with details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { key: 'analytics', icon: '📊', label: 'Analytics', color: 'var(--gold)' },
                  { key: 'privacy', icon: '🍪', label: 'Cookie consent', color: 'var(--success)' },
                  { key: 'payment', icon: '💳', label: 'Betaalmethoden', color: 'var(--gold)' },
                  { key: 'trustmark', icon: '✅', label: 'Keurmerken', color: 'var(--success)' },
                  { key: 'framework', icon: '🔧', label: 'Frameworks', color: 'var(--text-secondary)' },
                  { key: 'hosting', icon: '☁️', label: 'Hosting / CDN', color: 'var(--text-secondary)' },
                  { key: 'security', icon: '🛡️', label: 'Beveiliging', color: 'var(--text-secondary)' },
                ].map(({ key, icon, label, color }) => {
                  const items = techCategories[key] || [];
                  return (
                    <div key={key} style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: items.length > 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      border: items.length > 0 ? '1px solid var(--border)' : '1px solid transparent',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: items.length > 0 ? 8 : 0 }}>
                        <StatusDot active={items.length > 0} />
                        <span style={{
                          fontSize: 12, fontWeight: 500,
                          color: items.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}>
                          {icon} {label}
                        </span>
                      </div>
                      {items.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 20 }}>
                          {items.map((name, i) => (
                            <span key={i} style={{
                              fontSize: 11, padding: '2px 10px', borderRadius: 16,
                              background: key === 'trustmark' ? 'rgba(74, 222, 128, 0.1)'
                                : key === 'payment' ? 'var(--gold-glow)'
                                : 'var(--border)',
                              border: key === 'trustmark' ? '1px solid rgba(74, 222, 128, 0.3)'
                                : key === 'payment' ? '1px solid var(--gold-dim)'
                                : '1px solid transparent',
                              color: key === 'trustmark' ? 'var(--success)'
                                : key === 'payment' ? 'var(--gold-light)'
                                : 'var(--text-secondary)',
                              fontWeight: 500,
                            }}>
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Shopify IDs */}
              {(() => {
                const rawData = latestTech?.raw_data ? parseJSONObj(latestTech.raw_data) : {};
                const shopifyIds = rawData.shopify_ids;
                if (!shopifyIds || Object.keys(shopifyIds).length === 0) return null;
                return (
                  <div style={{
                    marginTop: 12, padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                      🛒 Shopify Identiteit
                    </div>
                    {shopifyIds.myshopify_domain && (
                      <div style={{ fontSize: 13, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                        {shopifyIds.myshopify_domain[0]}
                      </div>
                    )}
                    {shopifyIds.shopify_shop && !shopifyIds.myshopify_domain && (
                      <div style={{ fontSize: 13, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                        {shopifyIds.shopify_shop[0]}
                      </div>
                    )}
                    {shopifyIds.shop_id && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Shop ID: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{shopifyIds.shop_id[0]}</span>
                      </div>
                    )}
                    {shopifyIds.storefront_token && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Storefront token: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{shopifyIds.storefront_token[0]}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Trustmark verification */}
          {latestTrustmark && trustmarkVerifications.length > 0 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px', marginBottom: 24,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>🏅 Keurmerk verificatie</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{
                    fontSize: 11, padding: '2px 10px', borderRadius: 20,
                    background: 'rgba(74, 222, 128, 0.15)', color: 'var(--success)',
                    fontWeight: 600, textTransform: 'none',
                  }}>
                    {latestTrustmark.total_verified} geverifieerd
                  </span>
                  {latestTrustmark.claimed_not_verified > 0 && (
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 20,
                      background: 'rgba(248, 113, 113, 0.15)', color: 'var(--danger)',
                      fontWeight: 600, textTransform: 'none',
                    }}>
                      {latestTrustmark.claimed_not_verified} vals geclaimed!
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {trustmarkVerifications.map((v, i) => {
                  const statusConfig = {
                    verified: { icon: '✅', color: 'var(--success)', bg: 'rgba(74, 222, 128, 0.08)' },
                    found: { icon: '✅', color: 'var(--success)', bg: 'rgba(74, 222, 128, 0.08)' },
                    likely_verified: { icon: '🟡', color: 'var(--gold)', bg: 'var(--gold-glow)' },
                    not_found: { icon: '❌', color: 'var(--text-muted)', bg: 'transparent' },
                    check_failed: { icon: '⚠️', color: 'var(--text-muted)', bg: 'transparent' },
                  };
                  const cfg = statusConfig[v.status] || statusConfig.not_found;

                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', borderRadius: 8,
                      background: cfg.bg,
                      border: v.claimed && !v.verified ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: cfg.color }}>
                            {v.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {v.details || (v.error ? 'Controle mislukt' : '')}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {v.score && (
                          <div style={{
                            fontSize: 16, fontWeight: 600,
                            color: parseFloat(v.score) >= 4.0 ? 'var(--success)' :
                                   parseFloat(v.score) >= 3.0 ? 'var(--gold)' : 'var(--danger)',
                          }}>
                            {v.score}/5
                          </div>
                        )}
                        {v.reviews && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {v.reviews.toLocaleString('nl-NL')} reviews
                          </div>
                        )}
                        {v.claimed && !v.verified && (
                          <div style={{
                            fontSize: 10, fontWeight: 600, color: 'var(--danger)',
                            textTransform: 'uppercase', marginTop: 2,
                          }}>
                            Vals geclaimed!
                          </div>
                        )}
                        {v.claimed && v.verified && (
                          <div style={{
                            fontSize: 10, fontWeight: 600, color: 'var(--success)',
                            marginTop: 2,
                          }}>
                            Bevestigd
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KVK Lookup Results */}
          {(kvkRecords.length > 0 || shop.kvk_records?.length > 0) && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px', marginBottom: 24,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
              }}>
                🏢 KVK Handelsregister
              </div>

              {/* Domain search result */}
              {(() => {
                // Try to get domain_search from latest KVK raw_data
                const latestKvkRaw = kvkRecords.length > 0 ? parseJSONObj(kvkRecords[0]?.raw_data) : null;
                const domainSearch = latestKvkRaw?.domain_search;
                if (!domainSearch) return null;

                return (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                    background: domainSearch.found ? 'rgba(74, 222, 128, 0.06)' : 'rgba(248, 113, 113, 0.06)',
                    border: domainSearch.found ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid rgba(248, 113, 113, 0.2)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {domainSearch.found ? '✅' : '❌'} Domein "{domainSearch.search_term}" zoeken bij KVK
                    </div>
                    {domainSearch.found && domainSearch.results?.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                          {domainSearch.results.length} registratie(s) gevonden:
                        </div>
                        {domainSearch.results.slice(0, 3).map((r, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', paddingLeft: 12 }}>
                            {r.kvk_number && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>KVK {r.kvk_number} </span>}
                            {r.name}
                            {r.city && <span style={{ color: 'var(--text-muted)' }}> — {r.city}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Geen bedrijf gevonden met deze handelsnaam bij de KVK
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'grid', gap: 10 }}>
                {kvkRecords.map((kvk, ki) => {
                  const tradeNames = parseJSON(kvk.trade_names);
                  const sbiCodes = parseJSON(kvk.sbi_codes);
                  const rawData = parseJSONObj(kvk.raw_data);
                  const domainMatch = rawData?.domain_match;

                  return (
                    <div key={ki} style={{
                      padding: '12px 16px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: kvk.is_active === false ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--gold)' }}>
                            KVK {kvk.kvk_number}
                          </span>
                          <span style={{
                            fontSize: 10, marginLeft: 8, padding: '2px 8px', borderRadius: 12,
                            background: kvk.source === 'kvk_api' ? 'rgba(74, 222, 128, 0.15)' : 'var(--border)',
                            color: kvk.source === 'kvk_api' ? 'var(--success)' : 'var(--text-muted)',
                          }}>
                            {kvk.source === 'kvk_api' ? 'Officieel' : 'OpenKVK'}
                          </span>
                        </div>
                        {kvk.is_active !== null && (
                          <span style={{
                            fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
                            background: kvk.is_active ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                            color: kvk.is_active ? 'var(--success)' : 'var(--danger)',
                          }}>
                            {kvk.is_active ? 'Actief' : 'Uitgeschreven!'}
                          </span>
                        )}
                      </div>

                      {kvk.company_name && (
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                          {kvk.company_name}
                        </div>
                      )}

                      {tradeNames.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                          Handelsnamen: {tradeNames.join(', ')}
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                        {kvk.legal_form && (
                          <div><span style={{ color: 'var(--text-muted)' }}>Rechtsvorm: </span><span style={{ color: 'var(--text-secondary)' }}>{kvk.legal_form}</span></div>
                        )}
                        {kvk.city && (
                          <div><span style={{ color: 'var(--text-muted)' }}>Plaats: </span><span style={{ color: 'var(--text-secondary)' }}>{kvk.city}</span></div>
                        )}
                        {kvk.street && (
                          <div><span style={{ color: 'var(--text-muted)' }}>Adres: </span><span style={{ color: 'var(--text-secondary)' }}>{kvk.street} {kvk.house_number}</span></div>
                        )}
                        {kvk.postal_code && (
                          <div><span style={{ color: 'var(--text-muted)' }}>Postcode: </span><span style={{ color: 'var(--text-secondary)' }}>{kvk.postal_code}</span></div>
                        )}
                      </div>

                      {sbiCodes.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Activiteiten (SBI)</div>
                          {sbiCodes.slice(0, 3).map((sbi, si) => (
                            <div key={si} style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '1px 0' }}>
                              {typeof sbi === 'object' ? (sbi.code ? sbi.code + ' — ' : '') + (sbi.description || '') : sbi}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Domain match indicator */}
                      {domainMatch && (
                        <div style={{
                          marginTop: 8, padding: '6px 10px', borderRadius: 6,
                          background: domainMatch.match === 'strong' ? 'rgba(74, 222, 128, 0.08)' :
                                     domainMatch.match === 'partial' ? 'var(--gold-glow)' :
                                     'rgba(248, 113, 113, 0.08)',
                          border: domainMatch.match === 'none' ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid transparent',
                        }}>
                          <span style={{ fontSize: 12 }}>
                            {domainMatch.match === 'strong' ? '✅' : domainMatch.match === 'partial' ? '🟡' : '❌'}
                          </span>
                          <span style={{
                            fontSize: 11, marginLeft: 6,
                            color: domainMatch.match === 'none' ? 'var(--danger)' : 'var(--text-secondary)',
                          }}>
                            {domainMatch.details}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ad Tracker Detection */}
          {latestAdTracker && adTrackers.length > 0 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 20px', marginBottom: 24,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>📢 Advertentie trackers</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'none', fontWeight: 400 }}>
                  {latestAdTracker.total_unique_ids} ID('s) op {latestAdTracker.total_trackers} platform(s)
                </span>
              </div>

              {/* Tracker IDs per platform */}
              <div style={{ display: 'grid', gap: 10, marginBottom: adCrossRefs.length > 0 ? 16 : 0 }}>
                {adTrackers.map((tracker, ti) => (
                  <div key={ti} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                      {tracker.name}
                    </div>
                    {tracker.ids?.map((idInfo, ii) => (
                      <div key={ii} style={{ marginBottom: 10 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 13,
                          color: 'var(--gold-light)', padding: '2px 0',
                        }}>
                          {idInfo.display_id}
                        </div>

                        {/* Owner info */}
                        {idInfo.owner && (
                          <div style={{ paddingLeft: 12, marginTop: 4, marginBottom: 4 }}>
                            {idInfo.owner.advertiser_name && (
                              <div style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 500 }}>
                                👤 Adverteerder: {idInfo.owner.advertiser_name}
                              </div>
                            )}
                            {idInfo.owner.transparency_url && (
                              <div style={{ fontSize: 10, marginTop: 2 }}>
                                <a href={idInfo.owner.transparency_url} target="_blank" rel="noopener noreferrer"
                                   style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
                                  Google Ads Transparency →
                                </a>
                              </div>
                            )}
                            {idInfo.owner.ad_library_url && (
                              <div style={{ fontSize: 10, marginTop: 2 }}>
                                <a href={idInfo.owner.ad_library_url} target="_blank" rel="noopener noreferrer"
                                   style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
                                  Meta Ad Library →
                                </a>
                              </div>
                            )}
                            {idInfo.owner.other_domains?.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500, marginBottom: 3 }}>
                                  Andere sites van deze adverteerder:
                                </div>
                                {idInfo.owner.other_domains.slice(0, 5).map((site, si) => (
                                  <div key={si} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '1px 0' }}>
                                    → {site.domain || site}
                                  </div>
                                ))}
                              </div>
                            )}
                            {idInfo.owner.other_ads?.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500, marginBottom: 3 }}>
                                  Andere sites met deze pixel:
                                </div>
                                {idInfo.owner.other_ads.slice(0, 5).map((site, si) => (
                                  <div key={si} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '1px 0' }}>
                                    → {site.domain || site}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* SpyOnWeb results */}
                        {idInfo.spyonweb?.related_sites?.length > 0 && (
                          <div style={{ paddingLeft: 12, marginTop: 4 }}>
                            <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500, marginBottom: 3 }}>
                              🔗 SpyOnWeb: {idInfo.spyonweb.related_sites.length} gerelateerde site(s)
                            </div>
                            {idInfo.spyonweb.related_sites.slice(0, 5).map((site, si) => (
                              <div key={si} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '1px 0' }}>
                                → {site}
                              </div>
                            ))}
                            {idInfo.spyonweb.related_sites.length > 5 && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                + {idInfo.spyonweb.related_sites.length - 5} meer
                              </div>
                            )}
                            <a href={idInfo.spyonweb.spyonweb_url} target="_blank" rel="noopener noreferrer"
                               style={{ fontSize: 10, color: 'var(--text-muted)', textDecoration: 'underline' }}>
                              Bekijk op SpyOnWeb →
                            </a>
                          </div>
                        )}

                        {/* DuckDuckGo cross-reference results */}
                        {idInfo.online_results?.other_sites?.length > 0 && (
                          <div style={{ paddingLeft: 12, marginTop: 4 }}>
                            <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500, marginBottom: 3 }}>
                              🔍 Ook gevonden op {idInfo.online_results.other_sites.length} andere site(s):
                            </div>
                            {idInfo.online_results.other_sites.slice(0, 5).map((site, si) => (
                              <div key={si} style={{
                                fontSize: 11, color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)', padding: '1px 0',
                              }}>
                                → {site.domain}
                              </div>
                            ))}
                            {idInfo.online_results.other_sites.length > 5 && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                + {idInfo.online_results.other_sites.length - 5} meer
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* HackerTarget: all analytics IDs for this domain */}
              {hackerTarget?.analytics_ids?.length > 0 && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 10,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                    🌐 Alle analytics IDs voor dit domein
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                      (via HackerTarget)
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 2 }}>
                    {hackerTarget.analytics_ids.slice(0, 15).map((entry, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, fontSize: 11, padding: '2px 0' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-light)', minWidth: 120 }}>
                          {entry.id}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {entry.subdomain}
                        </span>
                      </div>
                    ))}
                    {hackerTarget.analytics_ids.length > 15 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        + {hackerTarget.analytics_ids.length - 15} meer
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cross-reference warnings */}
              {adCrossRefs.length > 0 && (
                <div style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(248, 113, 113, 0.08)',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>
                    ⚠️ Cross-referenties gevonden
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Dezelfde advertentie-ID('s) zijn ook gevonden op andere websites.
                    Dit kan betekenen dat dezelfde eigenaar meerdere webwinkels beheert.
                  </div>
                  {adCrossRefs.map((xref, xi) => (
                    <div key={xi} style={{ marginBottom: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--gold)' }}>
                        {xref.id}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                        ({xref.platform})
                      </span>
                      <div style={{ paddingLeft: 12 }}>
                        {xref.other_domains?.slice(0, 5).map((d, di) => (
                          <div key={di} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>
                            → {d}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
            <span>Laatst gescraped: {new Date(latestScrape?.collected_at).toLocaleString('nl-NL')}</span>
            <span>Bron: {latestScrape?.source}</span>
          </div>
        </>
      )}
    </div>
  );
}
