import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { shops } from '../services/api';
import { useScan } from '../hooks/useScan';

export default function DashboardPage() {
  const [url, setUrl] = useState('kleertjes-sale.com');
  const [shopList, setShopList] = useState([]);
  const [totalShops, setTotalShops] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [csvResult, setCsvResult] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [maxPages, setMaxPages] = useState(50);
  const [batchWithReports, setBatchWithReports] = useState(true);
  const [tick, setTick] = useState(0);
  const fileInputRef = useRef(null);

  const fmtTime = (ms) => {
    if (!ms || ms < 0) return '--:--';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const navigate = useNavigate();

  const {
    isScanning, scanStatus, scanProgress, scanningUrl, currentShopId,
    batchScanning, batchProgress,
    startScan, stopScan, restartScan,
    startBatchScan, stopBatchScan,
  } = useScan();

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

  // Reload when page becomes visible (e.g. navigating back)
  useEffect(() => {
    const handleFocus = () => loadShops();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [page, search]);

  // Reload list when a scan finishes while on this page
  useEffect(() => {
    if (!isScanning && !batchScanning) {
      loadShops();
    }
  }, [isScanning, batchScanning]);

  // Tick elke seconde tijdens batch/scan voor live tijdweergave
  useEffect(() => {
    if (!batchScanning && !isScanning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [batchScanning, isScanning]);

  const handleAddAndScan = async () => {
    if (!url.trim()) return;
    setError('');
    setIsAdding(true);

    try {
      const shop = await shops.create(url);
      const scanUrl = shop.url || url;
      setUrl('');
      startScan(shop.id, scanUrl, maxPages).then(() => {
        navigate(`/shop/${shop.id}`);
      }).catch(err => setError(err.detail || err.message));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleScanExisting = (shopId) => {
    const shop = shopList.find(s => s.id === shopId);
    const shopUrl = shop?.url || shop?.domain || '';
    startScan(shopId, shopUrl, maxPages, () => loadShops()).catch(err => setError(err.message));
  };

  const handleBatchScan = () => {
    startBatchScan(maxPages, batchWithReports, () => loadShops());
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResult(null);
    setError('');
    setCsvLoading(true);

    try {
      const result = await shops.importCSV(file);
      setCsvResult(result);
      await loadShops();
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setCsvLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
            onClick={() => !csvLoading && fileInputRef.current?.click()}
            disabled={csvLoading}
            style={{
              background: 'transparent',
              border: `1px solid ${csvLoading ? 'var(--gold-dim)' : 'var(--border)'}`,
              color: csvLoading ? 'var(--gold)' : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 500,
              padding: '6px 14px', borderRadius: 6,
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={e => { if (!csvLoading) { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.color = 'var(--gold)'; }}}
            onMouseLeave={e => { if (!csvLoading) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
          >
            {csvLoading && (
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                border: '2px solid var(--gold-dim)', borderTopColor: 'var(--gold)',
                display: 'inline-block', animation: 'spin 0.7s linear infinite',
              }} />
            )}
            {csvLoading ? 'Importeren...' : 'CSV importeren'}
          </button>
          {csvLoading && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              CSV verwerken...
            </span>
          )}
          {!csvLoading && csvResult && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {csvResult.added} toegevoegd, {csvResult.skipped} overgeslagen
              {csvResult.errors > 0 && `, ${csvResult.errors} fouten`}
            </span>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Max pages slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
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

        {/* Batch scan controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button
            onClick={handleBatchScan}
            disabled={batchScanning || totalShops === 0}
            style={{
              background: batchScanning ? 'transparent' : 'linear-gradient(135deg, var(--gold-dim), var(--gold))',
              border: batchScanning ? '1px solid var(--border)' : 'none',
              color: batchScanning ? 'var(--text-muted)' : 'var(--bg-primary)',
              fontSize: 12, fontWeight: 600,
              padding: '8px 18px', borderRadius: 6,
              transition: 'all 0.2s',
            }}
          >
            {batchScanning ? `Scannen ${batchProgress.current}/${batchProgress.total}...` : `Scan alle (${totalShops})`}
          </button>
          {batchScanning && (
            <button
              onClick={stopBatchScan}
              style={{
                background: 'transparent', border: '1px solid var(--danger)',
                color: 'var(--danger)', fontSize: 12, fontWeight: 500,
                padding: '8px 14px', borderRadius: 6,
              }}
            >
              Stop
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={batchWithReports}
              onChange={e => setBatchWithReports(e.target.checked)}
              style={{ accentColor: 'var(--gold)' }}
            />
            Rapporten downloaden
          </label>
        </div>
      </div>

      {/* Batch scanning progress */}
      {batchScanning && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--gold-dim)',
          borderRadius: 10, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--gold-light)', fontWeight: 500 }}>
              Batch scan: {batchProgress.current} / {batchProgress.total}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--gold)' }}>
                {batchProgress.currentDomain}
              </span>
            </div>
          </div>

          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%',
              width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%`,
              background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))',
              borderRadius: 2, transition: 'width 0.5s ease',
            }} />
          </div>

          {/* Tijdweergave batch */}
          {(() => {
            const now = Date.now();
            const batchElapsed = batchProgress.batchStartedAt ? now - batchProgress.batchStartedAt : 0;
            const shopElapsed = batchProgress.shopStartedAt ? now - batchProgress.shopStartedAt : 0;
            const completed = batchProgress.completedShops?.length || 0;
            // Gemiddelde per shop: gebruik voltooide shops, of huidige elapsed als schatting
            const avgMs = completed > 0 ? batchElapsed / completed : shopElapsed;
            // Resterend = shops na huidige + rest van huidige shop
            const shopsAfter = Math.max(0, batchProgress.total - batchProgress.current);
            const eta = avgMs > 0 ? (avgMs * shopsAfter) + Math.max(0, avgMs - shopElapsed) : null;
            return (
              <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Deze shop: <span style={{ color: 'var(--gold-light)' }}>{fmtTime(shopElapsed)}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Totaal verstreken: <span style={{ color: 'var(--gold-light)' }}>{fmtTime(batchElapsed)}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Nog ca: <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                    {eta !== null ? fmtTime(eta) : '--:--'}
                  </span>
                </span>
              </div>
            );
          })()}

          {batchProgress.shopProgress && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: 8,
              padding: '10px 14px', marginBottom: 12, border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                Huidige scan: {batchProgress.currentDomain}
              </div>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, ((batchProgress.shopProgress.pages_crawled || 0) / (batchProgress.shopProgress.max_pages || 50)) * 100)}%`,
                  background: 'var(--gold-dim)', borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: "Pagina's", value: batchProgress.shopProgress.pages_crawled || 0 },
                  { label: 'E-mails', value: batchProgress.shopProgress.emails_found || 0 },
                  { label: 'Telefoon', value: batchProgress.shopProgress.phones_found || 0 },
                  { label: 'KvK', value: batchProgress.shopProgress.kvk_found || 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gold)', lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchProgress.completedShops?.length > 0 && (
            <div style={{ maxHeight: 120, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Afgerond:</div>
              {batchProgress.completedShops.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '1px 0' }}>
                  <span style={{ color: s.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
                    {s.status === 'ok' ? '✓' : '✗'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{s.domain}</span>
                </div>
              ))}
            </div>
          )}

          <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      )}

      {/* Scanning indicator with progress */}
      {isScanning && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--gold-dim)',
          borderRadius: 10, padding: '18px 22px',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Onderzoekt
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--gold)' }}>
                {scanningUrl}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={stopScan}
                style={{
                  background: 'transparent', border: '1px solid var(--danger)',
                  color: 'var(--danger)', fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6, transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.background = 'rgba(248,113,113,0.15)'; }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; }}
              >
                Stop
              </button>
              <button
                onClick={restartScan}
                style={{
                  background: 'transparent', border: '1px solid var(--gold-dim)',
                  color: 'var(--gold)', fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6, transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.background = 'var(--gold-glow)'; }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; }}
              >
                Herstart
              </button>
              <button
                onClick={() => currentShopId && navigate(`/shop/${currentShopId}`)}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500,
                  padding: '6px 14px', borderRadius: 6, transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
                onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
              >
                Bekijk resultaten
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, color: 'var(--gold-light)' }}>{scanStatus}</span>
          </div>

          {scanProgress && (
            <>
              <div style={{
                height: 4, background: 'var(--border)',
                borderRadius: 2, overflow: 'hidden', marginBottom: 12,
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, ((scanProgress.pages_crawled || 0) / (scanProgress.max_pages || 200)) * 100)}%`,
                  background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))',
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {[
                  { label: "Pagina's", value: scanProgress.pages_crawled || 0 },
                  { label: 'E-mails', value: scanProgress.emails_found || 0 },
                  { label: 'Telefoon', value: scanProgress.phones_found || 0 },
                  { label: 'KvK', value: scanProgress.kvk_found || 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)', lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
              {scanProgress.current_url && (
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-primary)',
              fontSize: 12, padding: '6px 12px',
              outline: 'none', width: 200, fontFamily: 'var(--font-body)',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {shopList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: 14 }}>
            {search ? 'Geen resultaten gevonden' : 'Nog geen webwinkels toegevoegd'}
          </div>
        ) : (
          <div>
            {shopList.map(shop => (
              <div
                key={shop.id}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px 20px',
                  marginBottom: 8, display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onClick={() => navigate(`/shop/${shop.id}`)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold-dim)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 14,
                    color: 'var(--gold-light)', marginBottom: 2,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {shop.last_scanned && (
                      <span title={`Gescand: ${new Date(shop.last_scanned).toLocaleString('nl-NL')}`}
                        style={{ color: 'var(--success)', fontSize: 13 }}>✓</span>
                    )}
                    {shop.domain}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: shop.scan_stats ? 4 : 0 }}>
                    {shop.name || shop.url}
                  </div>
                  {shop.scan_stats && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                      {[
                        { label: 'email', value: shop.scan_stats.emails, icon: '✉' },
                        { label: 'tel', value: shop.scan_stats.phones, icon: '📞' },
                        { label: 'adres', value: shop.scan_stats.addresses, icon: '📍' },
                        { label: 'kvk', value: shop.scan_stats.kvk, icon: '🏢' },
                        { label: 'iban', value: shop.scan_stats.iban, icon: '💳' },
                      ].filter(s => s.value > 0).map(({ label, value, icon }) => (
                        <span key={label} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <span style={{ fontSize: 10 }}>{icon}</span>
                          <span style={{ color: 'var(--gold-light)', fontWeight: 500 }}>{value}</span>
                        </span>
                      ))}
                      {[
                        { label: 'contact', ok: shop.scan_stats.contact },
                        { label: 'privacy', ok: shop.scan_stats.privacy },
                        { label: 'voorw.', ok: shop.scan_stats.terms },
                        { label: 'retour', ok: shop.scan_stats.returns },
                      ].map(({ label, ok }) => (
                        <span key={label} style={{ fontSize: 10, color: ok ? 'var(--success)' : 'var(--danger)' }}>
                          {ok ? '●' : '○'} {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {riskBadge(shop.risk_level)}
                  {shop.risk_score != null && shop.risk_level !== 'unknown' && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                      title="Risicoscore (0=kritiek, 100=veilig)">
                      {Math.round(shop.risk_score)}/100
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleScanExisting(shop.id); }}
                    disabled={isScanning === shop.id}
                    style={{
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500,
                      padding: '4px 12px', borderRadius: 6, transition: 'all 0.2s',
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
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', fontSize: 11, fontWeight: 500,
                      padding: '4px 8px', borderRadius: 6, transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.target.style.borderColor = 'var(--danger)'; e.target.style.color = 'var(--danger)'; }}
                    onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-muted)'; }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {totalShops > 20 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
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
