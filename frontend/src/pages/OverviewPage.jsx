import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { shops } from '../services/api';
import { useScan } from '../hooks/useScan';

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

const SORT_KEYS = {
  domain:    s => s.domain,
  risk:      s => RISK_ORDER[s.risk_level] ?? 4,
  scanned:   s => s.last_scanned || '',
  platform:  s => s.scan_stats?.platform || '',
  age:       s => s.scan_stats?.domain_age || 0,
  ssl:       s => s.scan_stats?.ssl_valid ? 1 : 0,
  emails:    s => s.scan_stats?.emails || 0,
  phones:    s => s.scan_stats?.phones || 0,
  addresses: s => s.scan_stats?.addresses || 0,
  kvk:       s => s.scan_stats?.kvk || 0,
  btw:       s => s.scan_stats?.btw || 0,
  iban:      s => s.scan_stats?.iban || 0,
  contact:   s => s.scan_stats?.contact ? 1 : 0,
  privacy:   s => s.scan_stats?.privacy ? 1 : 0,
  terms:     s => s.scan_stats?.terms ? 1 : 0,
  returns:   s => s.scan_stats?.returns ? 1 : 0,
  keurm:     s => s.scan_stats?.trustmarks_verified || 0,
  vals:      s => s.scan_stats?.claimed_not_verified || 0,
  tp:        s => s.scan_stats?.trustpilot_score || 0,
  registrar: s => s.scan_stats?.registrar || '',
};

// dot-columns: filter by yes/no/all
const DOT_COLS = ['ssl', 'contact', 'privacy', 'terms', 'returns'];

const EMPTY_FILTERS = {
  domain: '', risk: '', platform: '', age: '', emails: '', phones: '',
  addresses: '', kvk: '', btw: '', iban: '', keurm: '', vals: '', tp: '', registrar: '',
  ssl: '', contact: '', privacy: '', terms: '', returns: '',
};

function matchesFilter(shop, colFilters) {
  const s = shop.scan_stats || {};
  const checks = {
    domain:    () => shop.domain.toLowerCase().includes(colFilters.domain.toLowerCase()),
    risk:      () => !colFilters.risk || (shop.risk_level || 'unknown') === colFilters.risk,
    platform:  () => (s.platform || '').toLowerCase().includes(colFilters.platform.toLowerCase()),
    age:       () => filterNum(s.domain_age, colFilters.age),
    emails:    () => filterNum(s.emails, colFilters.emails),
    phones:    () => filterNum(s.phones, colFilters.phones),
    addresses: () => filterNum(s.addresses, colFilters.addresses),
    kvk:       () => filterNum(s.kvk, colFilters.kvk),
    btw:       () => filterNum(s.btw, colFilters.btw),
    iban:      () => filterNum(s.iban, colFilters.iban),
    keurm:     () => filterNum(s.trustmarks_verified, colFilters.keurm),
    vals:      () => filterNum(s.claimed_not_verified, colFilters.vals),
    tp:        () => filterNum(s.trustpilot_score, colFilters.tp),
    registrar: () => (s.registrar || '').toLowerCase().includes(colFilters.registrar.toLowerCase()),
    ssl:       () => filterBool(s.ssl_valid, colFilters.ssl),
    contact:   () => filterBool(s.contact, colFilters.contact),
    privacy:   () => filterBool(s.privacy, colFilters.privacy),
    terms:     () => filterBool(s.terms, colFilters.terms),
    returns:   () => filterBool(s.returns, colFilters.returns),
  };
  return Object.entries(checks).every(([k, fn]) => !colFilters[k] ? true : fn());
}

// Supports: ">5", "<10", ">=3", "=8", or plain "5" (means >=5)
function filterNum(val, expr) {
  if (!expr) return true;
  const v = Number(val) || 0;
  const m = expr.match(/^([><=!]+)?\s*(\d+(\.\d+)?)$/);
  if (!m) return true;
  const op = m[1] || '>=';
  const n = Number(m[2]);
  if (op === '>') return v > n;
  if (op === '>=') return v >= n;
  if (op === '<') return v < n;
  if (op === '<=') return v <= n;
  if (op === '=' || op === '==') return v === n;
  if (op === '!=' || op === '!') return v !== n;
  return v >= n;
}

function filterBool(val, expr) {
  if (!expr) return true;
  if (expr === 'ja') return !!val;
  if (expr === 'nee') return !val;
  return true;
}

export default function OverviewPage() {
  const [allShops, setAllShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [colFilters, setColFilters] = useState(EMPTY_FILTERS);
  const [showColFilters, setShowColFilters] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(new Set());
  const navigate = useNavigate();
  const { startBatchScan, batchScanning, batchProgress, queueScans, scanQueue, currentShopId } = useScan();

  useEffect(() => {
    const loadAll = async () => {
      let result = [];
      let pg = 1;
      while (true) {
        const data = await shops.list(pg, 100, '');
        result = [...result, ...data.shops];
        if (result.length >= data.total) break;
        pg++;
      }
      setAllShops(result);
      setLoading(false);
    };
    loadAll();
  }, []);

  const scanned = allShops.filter(s => s.last_scanned);
  const hasColFilter = Object.values(colFilters).some(v => v !== '');

  const queuedIds = useMemo(() => new Set(scanQueue.map(s => s.id)), [scanQueue]);

  const visibleShops = useMemo(() => {
    let list = allShops;
    if (filter === 'scanned') list = list.filter(s => s.last_scanned);
    if (filter === 'unscanned') list = list.filter(s => !s.last_scanned);
    if (hasColFilter) list = list.filter(s => matchesFilter(s, colFilters));
    if (sort.key) {
      const fn = SORT_KEYS[sort.key];
      list = [...list].sort((a, b) => {
        const va = fn(a), vb = fn(b);
        if (va < vb) return sort.dir === 'asc' ? -1 : 1;
        if (va > vb) return sort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    // Always pin active scan and queue to top
    const queueOrder = scanQueue.map(s => s.id);
    list = [...list].sort((a, b) => {
      const aActive = a.id === currentShopId ? -2 : queuedIds.has(a.id) ? -1 : 0;
      const bActive = b.id === currentShopId ? -2 : queuedIds.has(b.id) ? -1 : 0;
      return aActive - bActive;
    });
    return list;
  }, [allShops, filter, sort, colFilters, scanQueue, currentShopId, queuedIds]);

  const handleSort = (key) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const setColFilter = (key, val) => setColFilters(prev => ({ ...prev, [key]: val }));
  const clearColFilters = () => setColFilters(EMPTY_FILTERS);

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const visibleIds = visibleShops.map(s => s.id);
    const allVisible = visibleIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisible) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const selectFilter = (f) => {
    setFilter(f);
    const ids = allShops
      .filter(s => f === 'all' ? true : f === 'scanned' ? !!s.last_scanned : !s.last_scanned)
      .map(s => s.id);
    setSelected(new Set(ids));
  };

  const handleCheckStatus = async (shopId, e) => {
    e.stopPropagation();
    setCheckingStatus(prev => new Set(prev).add(shopId));
    try {
      const result = await shops.checkStatus(shopId);
      setAllShops(prev => prev.map(s => s.id === shopId
        ? { ...s, scan_stats: { ...(s.scan_stats || {}), is_online: result.is_online, last_status_check: result.checked_at } }
        : s
      ));
    } catch (err) {
      // silently ignore
    } finally {
      setCheckingStatus(prev => { const n = new Set(prev); n.delete(shopId); return n; });
    }
  };

  const handleBulkCheckStatus = async () => {
    const ids = [...selected];
    setBulkStatus(`Status checken...`);
    let done = 0;
    for (const id of ids) {
      try {
        const result = await shops.checkStatus(id);
        setAllShops(prev => prev.map(s => s.id === id
          ? { ...s, scan_stats: { ...(s.scan_stats || {}), is_online: result.is_online, last_status_check: result.checked_at } }
          : s
        ));
      } catch (_) {}
      done++;
      setBulkStatus(`Status checken... ${done}/${ids.length}`);
    }
    setBulkStatus('');
  };

  const handleBulkClear = async () => {
    if (!window.confirm(`Scanresultaten wissen van ${selected.size} webwinkel(s)?`)) return;
    setBulkStatus('Wissen...');
    for (const id of selected) await shops.clearScans(id).catch(() => {});
    setAllShops(prev => prev.map(s => selected.has(s.id) ? { ...s, last_scanned: null, scan_stats: null } : s));
    setSelected(new Set());
    setBulkStatus('');
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`${selected.size} webwinkel(s) volledig verwijderen inclusief alle data?`)) return;
    setBulkStatus('Verwijderen...');
    for (const id of selected) await shops.delete(id).catch(() => {});
    setAllShops(prev => prev.filter(s => !selected.has(s.id)));
    setSelected(new Set());
    setBulkStatus('');
  };

  const handleBulkReport = async () => {
    setBulkStatus('Rapporten genereren...');
    try {
      const token = localStorage.getItem('wwspeur_token');
      const response = await fetch('/api/v1/shops/batch-reports', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([...selected]),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const match = response.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/);
        a.download = match ? match[1] : 'wwspeur_rapporten.zip';
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) { console.error(err); }
    setBulkStatus('');
  };

  const handleBulkRescan = async () => {
    const toScan = allShops.filter(s => selected.has(s.id));
    if (!window.confirm(`${toScan.length} webwinkel(s) opnieuw scannen?`)) return;
    setSelected(new Set());
    queueScans(toScan, 50, async (completedId) => {
      // Reload the list after each completed shop
      let result = [];
      let pg = 1;
      while (true) {
        const data = await shops.list(pg, 100, '');
        result = [...result, ...data.shops];
        if (result.length >= data.total) break;
        pg++;
      }
      setAllShops(result);
    });
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
        Overzicht laden...
      </div>
    );
  }

  const Dot = ({ ok }) => (
    <span style={{ color: ok ? 'var(--success)' : 'var(--danger)', fontSize: 10 }}>{ok ? '●' : '○'}</span>
  );

  const ageBadge = (days) => {
    if (!days) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    const color = days < 365 ? 'var(--danger)' : days < 730 ? 'var(--gold)' : 'var(--success)';
    return <span style={{ color, fontWeight: 500 }}>{days}d</span>;
  };

  const trustpilotBadge = (score) => {
    if (!score) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    const color = score >= 4 ? 'var(--success)' : score >= 3 ? 'var(--gold)' : 'var(--danger)';
    return <span style={{ color, fontWeight: 600 }}>{score}</span>;
  };

  const SortIcon = ({ k }) => {
    if (sort.key !== k) return <span style={{ opacity: 0.25, fontSize: 9 }}> ⇅</span>;
    return <span style={{ fontSize: 9, color: 'var(--gold)' }}> {sort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  const thBase = {
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.05em', padding: '8px 6px', borderBottom: '1px solid var(--border)',
    textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0,
    background: 'var(--bg-card)', zIndex: 1, userSelect: 'none',
  };
  const th = (k, extra) => ({
    ...thBase, cursor: 'pointer',
    color: sort.key === k ? 'var(--gold-light)' : 'var(--text-muted)',
    ...extra,
  });
  const td = { fontSize: 12, padding: '7px 6px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' };
  const tdLeft = { ...td, textAlign: 'left' };

  // Filter row cell style
  const filterTd = {
    padding: '4px 4px', borderBottom: '2px solid var(--gold-dim)',
    background: 'rgba(212,168,67,0.04)', position: 'sticky', top: 33, zIndex: 1,
  };
  const filterInput = {
    width: '100%', minWidth: 40, background: 'var(--bg-input)',
    border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-primary)', fontSize: 11, padding: '2px 5px',
    outline: 'none', fontFamily: 'var(--font-body)',
  };
  const filterSelect = { ...filterInput, padding: '2px 2px', cursor: 'pointer' };

  const visibleIds = visibleShops.map(s => s.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  const filterBtn = (val, label) => (
    <button onClick={() => setFilter(val)} style={{
      background: filter === val ? 'rgba(212,168,67,0.15)' : 'transparent',
      border: `1px solid ${filter === val ? 'var(--gold-dim)' : 'var(--border)'}`,
      color: filter === val ? 'var(--gold)' : 'var(--text-muted)',
      fontSize: 11, fontWeight: 500, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
    }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Overzicht</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {scanned.length} van {allShops.length} gescand — {visibleShops.length} zichtbaar
            {hasColFilter && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>● gefilterd</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {someSelected && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>
                {bulkStatus || `${selected.size} geselecteerd`}
              </span>
              <button onClick={handleBulkRescan} disabled={!!bulkStatus} title="Opnieuw scannen"
                style={{ background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', border: 'none', color: 'var(--bg-primary)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: bulkStatus ? 0.5 : 1 }}>
                Opnieuw scannen
              </button>
              <button onClick={handleBulkReport} disabled={!!bulkStatus} title="Rapporten downloaden als ZIP"
                style={{ background: 'transparent', border: '1px solid var(--gold-dim)', color: 'var(--gold)', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: bulkStatus ? 0.5 : 1 }}>
                Rapporten
              </button>
              <button onClick={handleBulkCheckStatus} disabled={!!bulkStatus}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: bulkStatus ? 0.5 : 1 }}>
                Check status
              </button>
              <button onClick={handleBulkClear} disabled={!!bulkStatus}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: bulkStatus ? 0.5 : 1 }}>
                Wissen
              </button>
              <button onClick={handleBulkDelete} disabled={!!bulkStatus}
                style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', opacity: bulkStatus ? 0.5 : 1 }}>
                Verwijderen
              </button>
            </>
          )}
          <button onClick={() => navigate('/')}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12, padding: '6px 14px', borderRadius: 6 }}>
            ← Dashboard
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {filterBtn('all', `Alle (${allShops.length})`)}
        {filterBtn('scanned', `Gescand (${scanned.length})`)}
        {filterBtn('unscanned', `Niet gescand (${allShops.length - scanned.length})`)}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={() => selectFilter(filter)} style={{
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-muted)', fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
        }}>Selecteer zichtbare</button>
        {someSelected && (
          <button onClick={() => setSelected(new Set())} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 11, padding: '4px 8px', cursor: 'pointer',
          }}>Deselecteer alles</button>
        )}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={() => setShowColFilters(v => !v)} style={{
          background: showColFilters ? 'rgba(212,168,67,0.1)' : 'transparent',
          border: `1px solid ${showColFilters || hasColFilter ? 'var(--gold-dim)' : 'var(--border)'}`,
          color: showColFilters || hasColFilter ? 'var(--gold)' : 'var(--text-muted)',
          fontSize: 11, fontWeight: 500, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
        }}>
          {hasColFilter ? '● Kolomfilters' : 'Kolomfilters'}
        </button>
        {hasColFilter && (
          <button onClick={clearColFilters} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 11, padding: '4px 8px', cursor: 'pointer',
          }}>✕ Wis filters</button>
        )}
      </div>

      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 200px)', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            {/* Header row */}
            <tr>
              <th style={{ ...thBase, padding: '8px 10px' }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                  title="Alles selecteren / deselecteren" style={{ accentColor: 'var(--gold)', cursor: 'pointer' }} />
              </th>
              <th style={th('risk', { minWidth: 70 })} title="Risiconiveau op basis van scanresultaten" onClick={() => handleSort('risk')}>Risico<SortIcon k="risk" /></th>
              <th style={th('domain', { textAlign: 'left', minWidth: 160 })} title="Domeinnaam" onClick={() => handleSort('domain')}>Domein<SortIcon k="domain" /></th>
              <th style={th('scanned', { minWidth: 75 })} title="Datum laatste scan" onClick={() => handleSort('scanned')}>Gescand<SortIcon k="scanned" /></th>
              <th style={th('platform', { minWidth: 80 })} title="E-commerce platform of CMS" onClick={() => handleSort('platform')}>Platform<SortIcon k="platform" /></th>
              <th style={th('age')} title="Domeinleeftijd in dagen" onClick={() => handleSort('age')}>Leeftijd<SortIcon k="age" /></th>
              <th style={th('ssl')} title="Geldig SSL-certificaat" onClick={() => handleSort('ssl')}>SSL<SortIcon k="ssl" /></th>
              <th style={th('emails')} title="Gevonden e-mailadressen" onClick={() => handleSort('emails')}>✉<SortIcon k="emails" /></th>
              <th style={th('phones')} title="Gevonden telefoonnummers" onClick={() => handleSort('phones')}>📞<SortIcon k="phones" /></th>
              <th style={th('addresses')} title="Gevonden adressen" onClick={() => handleSort('addresses')}>📍<SortIcon k="addresses" /></th>
              <th style={th('kvk')} title="KvK-nummer gevonden" onClick={() => handleSort('kvk')}>KvK<SortIcon k="kvk" /></th>
              <th style={th('btw')} title="BTW-nummer gevonden" onClick={() => handleSort('btw')}>BTW<SortIcon k="btw" /></th>
              <th style={th('iban')} title="IBAN gevonden" onClick={() => handleSort('iban')}>IBAN<SortIcon k="iban" /></th>
              <th style={th('contact')} title="Contactpagina aanwezig" onClick={() => handleSort('contact')}>Contact<SortIcon k="contact" /></th>
              <th style={th('privacy')} title="Privacyverklaring aanwezig" onClick={() => handleSort('privacy')}>Privacy<SortIcon k="privacy" /></th>
              <th style={th('terms')} title="Algemene voorwaarden aanwezig" onClick={() => handleSort('terms')}>Voorw.<SortIcon k="terms" /></th>
              <th style={th('returns')} title="Retourbeleid aanwezig" onClick={() => handleSort('returns')}>Retour<SortIcon k="returns" /></th>
              <th style={th('keurm')} title="Geverifieerde keurmerken" onClick={() => handleSort('keurm')}>Keurm.<SortIcon k="keurm" /></th>
              <th style={th('vals')} title="Valse keurmerken" onClick={() => handleSort('vals')}>Vals<SortIcon k="vals" /></th>
              <th style={th('tp')} title="Trustpilot-score" onClick={() => handleSort('tp')}>TP<SortIcon k="tp" /></th>
              <th style={th('registrar', { minWidth: 90 })} title="Domeinregistrar" onClick={() => handleSort('registrar')}>Registrar<SortIcon k="registrar" /></th>
              <th style={thBase}></th>
            </tr>

            {/* Column filter row */}
            {showColFilters && (
              <tr>
                <td style={filterTd} />
                <td style={filterTd}>
                  <select style={filterSelect} value={colFilters.risk} onChange={e => setColFilter('risk', e.target.value)}>
                    <option value="">—</option>
                    <option value="unknown">Onbekend</option>
                    <option value="low">Laag</option>
                    <option value="medium">Gemiddeld</option>
                    <option value="high">Hoog</option>
                    <option value="critical">Kritiek</option>
                  </select>
                </td>
                <td style={filterTd}>
                  <input style={filterInput} placeholder="zoek..." value={colFilters.domain}
                    onChange={e => setColFilter('domain', e.target.value)} />
                </td>
                <td style={filterTd} /> {/* scanned — no filter */}
                <td style={filterTd}>
                  <input style={filterInput} placeholder="bijv. Shopify" value={colFilters.platform}
                    onChange={e => setColFilter('platform', e.target.value)} />
                </td>
                <td style={filterTd}>
                  <input style={filterInput} placeholder=">365" value={colFilters.age}
                    onChange={e => setColFilter('age', e.target.value)} title=">365, <730, =500" />
                </td>
                {/* dot columns */}
                {['ssl', 'emails', 'phones', 'addresses', 'kvk', 'btw', 'iban', 'contact', 'privacy', 'terms', 'returns'].map(col => (
                  <td key={col} style={filterTd}>
                    {DOT_COLS.includes(col) ? (
                      <select style={filterSelect} value={colFilters[col]} onChange={e => setColFilter(col, e.target.value)}>
                        <option value="">—</option>
                        <option value="ja">ja</option>
                        <option value="nee">nee</option>
                      </select>
                    ) : (
                      <input style={filterInput} placeholder=">0" value={colFilters[col]}
                        onChange={e => setColFilter(col, e.target.value)} title=">0, >=2, =3" />
                    )}
                  </td>
                ))}
                <td style={filterTd}>
                  <input style={filterInput} placeholder=">0" value={colFilters.keurm}
                    onChange={e => setColFilter('keurm', e.target.value)} />
                </td>
                <td style={filterTd}>
                  <input style={filterInput} placeholder=">0" value={colFilters.vals}
                    onChange={e => setColFilter('vals', e.target.value)} />
                </td>
                <td style={filterTd}>
                  <input style={filterInput} placeholder=">3" value={colFilters.tp}
                    onChange={e => setColFilter('tp', e.target.value)} />
                </td>
                <td style={filterTd}>
                  <input style={filterInput} placeholder="zoek..." value={colFilters.registrar}
                    onChange={e => setColFilter('registrar', e.target.value)} />
                </td>
                <td style={filterTd} />
              </tr>
            )}
          </thead>
          <tbody>
            {visibleShops.map(shop => {
              const s = shop.scan_stats || {};
              const isScanned = !!shop.last_scanned;
              const isSelected = selected.has(shop.id);
              return (
                <tr key={shop.id} onClick={() => navigate(`/shop/${shop.id}`)}
                  style={{
                    cursor: 'pointer',
                    background: shop.id === currentShopId
                      ? 'rgba(212,168,67,0.12)'
                      : isSelected ? 'rgba(212,168,67,0.08)'
                      : queuedIds.has(shop.id) ? 'rgba(255,255,255,0.03)'
                      : isScanned ? 'transparent' : 'rgba(255,255,255,0.01)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isSelected && shop.id !== currentShopId) e.currentTarget.style.background = 'rgba(212,168,67,0.05)'; }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = shop.id === currentShopId
                      ? 'rgba(212,168,67,0.12)'
                      : isSelected ? 'rgba(212,168,67,0.08)'
                      : queuedIds.has(shop.id) ? 'rgba(255,255,255,0.03)'
                      : isScanned ? 'transparent' : 'rgba(255,255,255,0.01)';
                  }}
                >
                  <td style={{ ...td, padding: '7px 10px' }} onClick={e => toggleSelect(shop.id, e)}>
                    <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ accentColor: 'var(--gold)', cursor: 'pointer' }} />
                  </td>
                  <td style={td}>
                    {(() => {
                      const lvl = shop.risk_level || 'unknown';
                      const cfg = {
                        unknown:  { bg: 'var(--border)',                   color: 'var(--text-muted)',      label: 'Onbekend' },
                        low:      { bg: 'rgba(74,222,128,0.15)',            color: 'var(--success)',         label: 'Laag' },
                        medium:   { bg: 'rgba(232,160,32,0.15)',            color: 'var(--gold)',            label: 'Gemiddeld' },
                        high:     { bg: 'rgba(248,113,113,0.15)',           color: 'var(--danger)',          label: 'Hoog' },
                        critical: { bg: 'rgba(248,113,113,0.3)',            color: '#FF4444',                label: 'Kritiek' },
                      }[lvl] || { bg: 'var(--border)', color: 'var(--text-muted)', label: lvl };
                      return (
                        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 20, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
                          {cfg.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={tdLeft}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {shop.id === currentShopId ? (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                          background: 'rgba(212,168,67,0.2)', color: 'var(--gold)',
                          border: '1px solid var(--gold-dim)', whiteSpace: 'nowrap',
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }}>● SCAN</span>
                      ) : queuedIds.has(shop.id) ? (
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                          background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                          border: '1px solid var(--border)', whiteSpace: 'nowrap',
                        }}>WACHTRIJ</span>
                      ) : isScanned ? (
                        <span style={{ color: 'var(--success)', fontSize: 11 }}>✓</span>
                      ) : null}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: isScanned ? 'var(--gold-light)' : 'var(--text-muted)', fontWeight: isScanned ? 500 : 400 }}>
                        {shop.domain}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 10, color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {shop.last_scanned ? new Date(shop.last_scanned).toLocaleDateString('nl-NL') : '—'}
                      {s.last_status_check != null && (
                        <span
                          title={`${s.is_online ? 'Online' : 'Offline'} · gecontroleerd ${new Date(s.last_status_check).toLocaleString('nl-NL')}`}
                          style={{
                            display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: s.is_online ? 'var(--success)' : 'var(--danger)',
                            boxShadow: s.is_online ? '0 0 4px var(--success)' : '0 0 4px var(--danger)',
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>{s.platform || '—'}</td>
                  <td style={td}>{ageBadge(s.domain_age)}</td>
                  <td style={td}><Dot ok={s.ssl_valid} /></td>
                  <td style={{ ...td, color: s.emails > 0 ? 'var(--gold-light)' : 'var(--text-muted)', fontWeight: s.emails > 0 ? 500 : 400 }}>{s.emails || '—'}</td>
                  <td style={{ ...td, color: s.phones > 0 ? 'var(--gold-light)' : 'var(--text-muted)', fontWeight: s.phones > 0 ? 500 : 400 }}>{s.phones || '—'}</td>
                  <td style={{ ...td, color: s.addresses > 0 ? 'var(--gold-light)' : 'var(--text-muted)' }}>{s.addresses || '—'}</td>
                  <td style={td}><Dot ok={s.kvk > 0} /></td>
                  <td style={td}><Dot ok={s.btw > 0} /></td>
                  <td style={td}><Dot ok={s.iban > 0} /></td>
                  <td style={td}><Dot ok={s.contact} /></td>
                  <td style={td}><Dot ok={s.privacy} /></td>
                  <td style={td}><Dot ok={s.terms} /></td>
                  <td style={td}><Dot ok={s.returns} /></td>
                  <td style={{ ...td, color: s.trustmarks_verified > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 500 }}>
                    {s.trustmarks_verified > 0 ? s.trustmarks_verified : '—'}
                  </td>
                  <td style={{ ...td, color: s.claimed_not_verified > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: s.claimed_not_verified > 0 ? 600 : 400 }}>
                    {s.claimed_not_verified > 0 ? `${s.claimed_not_verified}!` : '—'}
                  </td>
                  <td style={td}>{trustpilotBadge(s.trustpilot_score)}</td>
                  <td style={{ ...td, fontSize: 10, color: 'var(--text-muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.registrar || '—'}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button
                        title="Check status (online/offline)"
                        onClick={(e) => handleCheckStatus(shop.id, e)}
                        disabled={checkingStatus.has(shop.id)}
                        style={{ background: 'transparent', border: 'none', cursor: checkingStatus.has(shop.id) ? 'not-allowed' : 'pointer', padding: '2px 4px', position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <span style={{
                          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                          background: checkingStatus.has(shop.id) ? 'var(--gold)' : '#4A90D9',
                          transition: 'background 0.2s',
                        }} />
                        <span style={{
                          position: 'absolute', fontSize: 7, fontWeight: 700, color: '#fff',
                          lineHeight: 1, pointerEvents: 'none',
                        }}>{checkingStatus.has(shop.id) ? '⟳' : '?'}</span>
                      </button>
                      <button title="Scanresultaten wissen" onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Scanresultaten van ${shop.domain} wissen?`)) {
                          shops.clearScans(shop.id).then(() => {
                            setAllShops(prev => prev.map(s => s.id === shop.id ? { ...s, last_scanned: null, scan_stats: null } : s));
                          });
                        }
                      }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '2px 4px', transition: 'color 0.2s' }}
                        onMouseEnter={e => e.target.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>🔄</button>
                      <button title="URL verwijderen" onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`${shop.domain} volledig verwijderen?`)) {
                          shops.delete(shop.id).then(() => setAllShops(prev => prev.filter(s => s.id !== shop.id)));
                        }
                      }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '2px 4px', transition: 'color 0.2s' }}
                        onMouseEnter={e => e.target.style.color = 'var(--danger)'}
                        onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
