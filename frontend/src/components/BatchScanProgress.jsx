import { useState, useEffect } from 'react';
import { useScan } from '../hooks/useScan';
import SiteThumbnail from './SiteThumbnail';

const fmtTime = (ms) => {
  if (!ms || ms < 0) return '--:--';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const BAR_STYLE = {
  position: 'sticky', top: 68, zIndex: 50,
  background: 'var(--bg-card)', border: '1px solid var(--gold-dim)',
  borderRadius: 10, padding: '16px 20px', marginBottom: 24,
  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
};

export default function BatchScanProgress() {
  const {
    batchScanning, batchProgress, stopBatchScan,
    isScanning,
  } = useScan();

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!batchScanning && !isScanning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [batchScanning, isScanning]);

  // Batch scan heeft prioriteit
  if (batchScanning) {
    const now = Date.now();
    const batchElapsed = batchProgress.batchStartedAt ? now - batchProgress.batchStartedAt : 0;
    const shopElapsed = batchProgress.shopStartedAt ? now - batchProgress.shopStartedAt : 0;
    const completed = batchProgress.completedShops?.length || 0;
    const avgMs = completed > 0 ? batchElapsed / completed : shopElapsed;
    const shopsAfter = Math.max(0, batchProgress.total - batchProgress.current);
    const eta = avgMs > 0 ? (avgMs * shopsAfter) + Math.max(0, avgMs - shopElapsed) : null;
    const pct = batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0;

    return (
      <div style={BAR_STYLE}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
            Batch scan: {batchProgress.current} / {batchProgress.total}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <button onClick={stopBatchScan} style={{
              background: 'transparent', border: '1px solid var(--danger)',
              color: 'var(--danger)', fontSize: 11, fontWeight: 500,
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            }}>Stop</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <SiteThumbnail shopId={batchProgress.shopId} width={100} height={63} />
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--gold)',
            fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {batchProgress.currentDomain}
          </div>
        </div>

        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))',
            borderRadius: 2, transition: 'width 0.5s ease',
          }} />
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Deze shop: <span style={{ color: 'var(--gold-light)' }}>{fmtTime(shopElapsed)}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Totaal verstreken: <span style={{ color: 'var(--gold-light)' }}>{fmtTime(batchElapsed)}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Nog ca: <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{eta !== null ? fmtTime(eta) : '--:--'}</span>
          </span>
        </div>

        {batchProgress.shopProgress && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12, border: '1px solid var(--border)',
          }}>
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, ((batchProgress.shopProgress.pages_crawled || 0) / (batchProgress.shopProgress.max_pages || 50)) * 100)}%`,
                background: 'var(--gold-dim)', borderRadius: 2, transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {[
                { label: "Pagina's", value: batchProgress.shopProgress.pages_crawled || 0 },
                { label: 'E-mails', value: batchProgress.shopProgress.emails_found || 0 },
                { label: 'Telefoon', value: batchProgress.shopProgress.phones_found || 0 },
                { label: 'KvK', value: batchProgress.shopProgress.kvk_found || 0 },
                { label: 'Bewijs', value: (batchProgress.shopProgress.emails_found || 0) + (batchProgress.shopProgress.phones_found || 0) + (batchProgress.shopProgress.addresses_found || 0) + (batchProgress.shopProgress.kvk_found || 0) },
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
    );
  }



  return null;
}
