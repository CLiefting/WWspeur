import { useState, useEffect } from 'react';
import { settings as settingsApi } from '../services/api';

const SERVICE_LABELS = {
  meta: { label: 'Meta / Facebook', color: '#1877F2' },
  hackertarget: { label: 'HackerTarget', color: '#E8A020' },
  spyonweb: { label: 'SpyOnWeb', color: '#9B59B6' },
  google: { label: 'Google', color: '#4285F4' },
};

export default function SettingsPage() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState({});   // key → draft value
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    settingsApi.list()
      .then(setItems)
      .catch(e => setError(e.message));
  }, []);

  const handleEdit = (key, currentMasked) => {
    setEditing(prev => ({ ...prev, [key]: '' }));
  };

  const handleSave = async (key) => {
    const value = editing[key] ?? '';
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      const result = await settingsApi.update(key, value);
      setItems(prev => prev.map(i => i.key === key
        ? { ...i, is_configured: result.is_configured, masked_value: result.masked_value }
        : i
      ));
      setEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
      setSaved(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setSaved(prev => { const n = { ...prev }; delete n[key]; return n; }), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const handleClear = async (key) => {
    if (!window.confirm('Sleutel verwijderen?')) return;
    try {
      await settingsApi.clear(key);
      setItems(prev => prev.map(i => i.key === key
        ? { ...i, is_configured: false, masked_value: '' }
        : i
      ));
      setEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e) {
      setError(e.message);
    }
  };

  const grouped = items.reduce((acc, item) => {
    if (!acc[item.service]) acc[item.service] = [];
    acc[item.service].push(item);
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Beheer
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          API-sleutels & Integraties
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          Configureer externe diensten voor uitgebreide tracker-verificatie en cross-referenties.
          Sleutels worden versleuteld opgeslagen en nooit volledig getoond.
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {Object.entries(grouped).map(([service, serviceItems]) => {
        const svc = SERVICE_LABELS[service] || { label: service, color: 'var(--gold)' };
        return (
          <div key={service} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: svc.color }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {svc.label}
              </span>
            </div>

            {serviceItems.map(item => (
              <div key={item.key} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '18px 20px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 520, lineHeight: 1.5 }}>
                      {item.description}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                    background: item.is_configured ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                    color: item.is_configured ? 'var(--success)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap', marginLeft: 12,
                  }}>
                    {item.is_configured ? 'Geconfigureerd' : 'Niet ingesteld'}
                  </span>
                </div>

                {/* Huidige waarde + acties */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                  {editing[item.key] !== undefined ? (
                    <>
                      <input
                        type="password"
                        placeholder="Plak hier je sleutel..."
                        value={editing[item.key]}
                        onChange={e => setEditing(prev => ({ ...prev, [item.key]: e.target.value }))}
                        autoFocus
                        style={{
                          flex: 1, background: 'var(--bg-input)', border: '1px solid var(--gold-dim)',
                          borderRadius: 6, color: 'var(--text-primary)', fontSize: 13,
                          fontFamily: 'var(--font-mono)', padding: '8px 12px', outline: 'none',
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(item.key); if (e.key === 'Escape') setEditing(prev => { const n = {...prev}; delete n[item.key]; return n; }); }}
                      />
                      <button
                        onClick={() => handleSave(item.key)}
                        disabled={saving[item.key]}
                        style={{
                          background: 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
                          border: 'none', color: 'var(--bg-primary)',
                          fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 6,
                        }}
                      >
                        {saving[item.key] ? 'Opslaan...' : 'Opslaan'}
                      </button>
                      <button
                        onClick={() => setEditing(prev => { const n = {...prev}; delete n[item.key]; return n; })}
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, padding: '8px 12px', borderRadius: 6 }}
                      >
                        Annuleren
                      </button>
                    </>
                  ) : (
                    <>
                      {item.is_configured && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
                          {item.masked_value}
                        </span>
                      )}
                      {saved[item.key] && (
                        <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Opgeslagen</span>
                      )}
                      <button
                        onClick={() => handleEdit(item.key, item.masked_value)}
                        style={{
                          background: 'transparent', border: '1px solid var(--border)',
                          color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500,
                          padding: '6px 14px', borderRadius: 6, transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
                        onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
                      >
                        {item.is_configured ? 'Wijzigen' : 'Instellen'}
                      </button>
                      {item.is_configured && (
                        <button
                          onClick={() => handleClear(item.key)}
                          style={{
                            background: 'transparent', border: '1px solid var(--border)',
                            color: 'var(--text-muted)', fontSize: 12, padding: '6px 10px', borderRadius: 6,
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.target.style.borderColor = 'var(--danger)'; e.target.style.color = 'var(--danger)'; }}
                          onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-muted)'; }}
                        >
                          Verwijderen
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
