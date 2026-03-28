import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { shops, scans } from '../services/api';

export default function DashboardPage() {
  const [url, setUrl] = useState('kleertjes-sale.com');
  const [shopList, setShopList] = useState([]);
  const [totalShops, setTotalShops] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [isScanning, setIsScanning] = useState(null); // shop id being scanned
  const [scanStatus, setScanStatus] = useState('');
  const [error, setError] = useState('');
  const [csvResult, setCsvResult] = useState(null);
  const [maxPages, setMaxPages] = useState(200);
  const [scanningUrl, setScanningUrl] = useState('');
  const [currentScanId, setCurrentScanId] = useState(null);
  const [currentShopId, setCurrentShopId] = useState(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const loadShops = async () => {
    try {
      const data = await shops.list(page, 20, search);
      setShopList(data.shops);
      setTotalShops(data.total);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { loadShops(); }, [page, search]);

  const [scanProgress, setScanProgress] = useState(null);

  const _runScanWithPolling = async (shopId, shopUrl) => {
    setIsScanning(shopId);
    setCurrentShopId(shopId);
    setScanningUrl(shopUrl);
    setScanStatus('Scan gestart...');
    setScanProgress(null);
    abortRef.current = false;

    const scan = await scans.create(shopId, ['whois', 'ssl', 'dns_http', 'tech', 'trustmark', 'ad_tracker', 'scrape', 'kvk'], maxPages);
    setCurrentScanId(scan.id);

    await scans.pollUntilDone(
      scan.id,
      (s) => {
        if (s.status === 'completed') setScanStatus('Scan voltooid!');
        else if (s.status === 'failed') setScanStatus('Scan mislukt');
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
      1500,
      () => abortRef.current,
    );

    return shopId;
  };

  const handleAddAndScan = async () => {
    if (!url.trim()) return;
    setError('');
    setIsAdding(true);

    try {
      const shop = await shops.create(url);
      const scanUrl = shop.url || url;
      setUrl('');

      const shopId = await _runScanWithPolling(shop.id, scanUrl);

      if (!abortRef.current) {
        setIsScanning(null);
        setScanStatus('');
        setScanProgress(null);
        await loadShops();
        navigate(`/shop/${shopId}`);
      }
    } catch (err) {
      setError(err.detail || err.message);
      setIsScanning(null);
      setScanStatus('');
      setScanProgress(null);
    } finally {
      setIsAdding(false);
    }
  };

  const handleScanExisting = async (shopId) => {
    const shop = shopList.find(s => s.id === shopId);
    const shopUrl = shop?.url || shop?.domain || '';

    try {
      await _runScanWithPolling(shopId, shopUrl);
      if (!abortRef.current) {
        navigate(`/shop/${shopId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (!abortRef.current) {
        setIsScanning(null);
        setScanStatus('');
        setScanProgress(null);
      }
    }
  };

  const handleStopScan = () => {
    abortRef.current = true;
    setIsScanning(null);
    setScanStatus('');
    setScanProgress(null);
    setScanningUrl('');
    setCurrentScanId(null);
    setCurrentShopId(null);
    setIsAdding(false);
    loadShops();
  };

  const handleRestartScan = async () => {
    const shopId = currentShopId;
    const shopUrl = scanningUrl;
    handleStopScan();
    if (shopId) {
      // Small delay to let state reset
      setTimeout(() => handleScanExisting(shopId), 100);
    }
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResult(null);
    setError('');

    try {
      const result = await shops.importCSV(file);
      setCsvResult(result);
      await loadShops();
    } catch (err) {
      setError(err.detail || err.message);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAddAndScan();
  };

  const riskBadge = (level) => {
    const colors = {
      unknown: { bg: 'var(--border)', text: 'var(--text-muted)' },
      low: { bg: 'rgba(74, 222, 128, 0.15)', text: 'var(--success)' },
      medium: { bg: 'rgba(232, 160, 32, 0.15)', text: 'var(--gold)' },
      high: { bg: 'rgba(248, 113, 113, 0.15)', text: 'var(--danger)' },
      critical: { bg: 'rgba(248, 113, 113, 0.3)', text: '#FF4444' },
    };
    const c = colors[level] || colors.unknown;
    const labels = {
      unknown: 'Onbekend', low: 'Laag', medium: 'Gemiddeld',
      high: 'Hoog', critical: 'Kritiek',
    };
    return (
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', padding: '3px 10px',
        borderRadius: 20, background: c.bg, color: c.text,
      }}>
        {labels[level] || level}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      
      {/* URL Input */}
      <div style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
          marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Onderzoek een webwinkel
        </div>
        <div style={{
          display: 'flex', gap: 0,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 16px', color: 'var(--text-muted)', fontSize: 14,
            display: 'flex', alignItems: 'center',
            borderRight: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.02)', userSelect: 'none',
          }}>
            https://
          </div>
          <input
            type="text"
            placeholder="kleertjes-sale.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isAdding}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 15,
              fontFamily: 'var(--font-mono)', padding: '14px 16px',
            }}
          />
          <button
            onClick={handleAddAndScan}
            disabled={isAdding || !url.trim()}
            style={{
              background: isAdding ? 'transparent' : 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
              border: isAdding ? '1px solid var(--border)' : 'none',
              color: isAdding ? 'var(--text-secondary)' : 'var(--bg-primary)',
              fontWeight: 600, fontSize: 14,
              padding: '14px 28px',
              transition: 'all 0.2s', whiteSpace: 'nowrap',
            }}
          >
            {isAdding ? 'Bezig...' : 'Scan starten'}
          </button>
        </div>

        {/* CSV import */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12, fontWeight: 500,
              padding: '6px 14px', borderRadius: 6,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
            onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
          >
            CSV importeren
          </button>
          {csvResult && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {csvResult.added} toegevoegd, {csvResult.skipped} overgeslagen
              {csvResult.errors > 0 && `, ${csvResult.errors} fouten`}
            </span>
          )}
        </div>

        {/* Max pages slider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, marginTop: 12,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Max pagina's
          </span>
          <input
            type="range"
            min="10"
            max="1000"
            step="10"
            value={maxPages}
            onChange={e => setMaxPages(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--gold)' }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13,
            color: 'var(--gold-light)', minWidth: 40, textAlign: 'right',
          }}>
            {maxPages}
          </span>
        </div>
      </div>

      {/* Scanning indicator with progress */}
      {isScanning && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--gold-dim)',
          borderRadius: 10, padding: '18px 22px',
          marginBottom: 24,
        }}>
          {/* URL being scanned + controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Onderzoekt
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--gold)',
              }}>
                {scanningUrl}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleStopScan}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.background = 'rgba(248,113,113,0.15)'; }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; }}
              >
                Stop
              </button>
              <button
                onClick={handleRestartScan}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--gold-dim)',
                  color: 'var(--gold)',
                  fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.background = 'var(--gold-glow)'; }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; }}
              >
                Herstart
              </button>
              <button
                onClick={() => currentShopId && navigate(`/shop/${currentShopId}`)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
                onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
              >
                Bekijk resultaten
              </button>
            </div>
          </div>

          {/* Status line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--gold)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, color: 'var(--gold-light)' }}>{scanStatus}</span>
          </div>
          
          {scanProgress && (
            <>
              {/* Progress bar */}
              <div style={{
                height: 4, background: 'var(--border)',
                borderRadius: 2, overflow: 'hidden', marginBottom: 12,
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, ((scanProgress.pages_crawled || 0) / (scanProgress.max_pages || 200)) * 100)}%`,
                  background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))',
                  borderRadius: 2,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              
              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {[
                  { label: "Pagina's", value: scanProgress.pages_crawled || 0 },
                  { label: 'E-mails', value: scanProgress.emails_found || 0 },
                  { label: 'Telefoon', value: scanProgress.phones_found || 0 },
                  { label: 'KvK', value: scanProgress.kvk_found || 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)', lineHeight: 1 }}>
                      {value}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Current URL being scraped */}
              {scanProgress.current_url && (
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: 10, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  ↳ {scanProgress.current_url}
                </div>
              )}
            </>
          )}
          
          <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
          borderRadius: 10, padding: '12px 18px',
          marginBottom: 24, fontSize: 13, color: 'var(--danger)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {error}
          <button
            onClick={() => setError('')}
            style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, padding: '0 4px' }}
          >×</button>
        </div>
      )}

      {/* Shop list */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Webwinkels ({totalShops})
          </div>
          <input
            type="text"
            placeholder="Zoeken..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 12, padding: '6px 12px',
              outline: 'none', width: 200,
              fontFamily: 'var(--font-body)',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {shopList.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            color: 'var(--text-muted)', fontSize: 14,
          }}>
            {search ? 'Geen resultaten gevonden' : 'Nog geen webwinkels toegevoegd'}
          </div>
        ) : (
          <div>
            {shopList.map(shop => (
              <div
                key={shop.id}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                  marginBottom: 8, display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onClick={() => navigate(`/shop/${shop.id}`)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold-dim)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 14,
                    color: 'var(--gold-light)', marginBottom: 4,
                  }}>
                    {shop.domain}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {shop.name || shop.url}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {riskBadge(shop.risk_level)}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleScanExisting(shop.id); }}
                    disabled={isScanning === shop.id}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      fontSize: 11, fontWeight: 500,
                      padding: '4px 12px', borderRadius: 6,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
                    onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
                  >
                    {isScanning === shop.id ? '...' : 'Scan'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Weet je zeker dat je ${shop.domain} wilt verwijderen? Alle scanresultaten worden ook verwijderd.`)) {
                        shops.delete(shop.id).then(() => loadShops()).catch(err => setError(err.message));
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontSize: 11, fontWeight: 500,
                      padding: '4px 8px', borderRadius: 6,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.target.style.borderColor = 'var(--danger)'; e.target.style.color = 'var(--danger)'; }}
                    onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-muted)'; }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalShops > 20 && (
              <div style={{
                display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20,
              }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 12,
                    padding: '6px 12px', borderRadius: 6,
                  }}
                >Vorige</button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 12px' }}>
                  Pagina {page} van {Math.ceil(totalShops / 20)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(totalShops / 20)}
                  style={{
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 12,
                    padding: '6px 12px', borderRadius: 6,
                  }}
                >Volgende</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
