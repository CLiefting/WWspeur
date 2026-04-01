import { useAuth } from '../hooks/useAuth';
import { Link } from 'react-router-dom';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100,
      borderBottom: '1px solid var(--border)',
      padding: '16px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--bg-primary)',
    }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 700, color: 'var(--bg-primary)',
        }}>W</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--gold)' }}>WW</span>
            <span style={{ color: 'var(--text-primary)' }}>Speur</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2 }}>
            Webwinkel Investigator
          </div>
        </div>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link
          to="/"
          style={{
            fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
            textDecoration: 'none', padding: '6px 14px', borderRadius: 6,
            border: '1px solid var(--border)', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
          onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
        >
          Dashboard
        </Link>
        <Link
          to="/overview"
          style={{
            fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
            textDecoration: 'none', padding: '6px 14px', borderRadius: 6,
            border: '1px solid var(--border)', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.target.style.borderColor = 'var(--gold-dim)'; e.target.style.color = 'var(--gold)'; }}
          onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
        >
          Overzicht
        </Link>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {user?.username}
        </span>
        <Link
          to="/settings"
          title="Instellingen"
          style={{
            fontSize: 18, color: 'var(--text-secondary)',
            textDecoration: 'none', padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--border)', transition: 'all 0.2s',
            lineHeight: 1, display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.color = 'var(--gold)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          ⚙
        </Link>
        <button
          onClick={logout}
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
          Uitloggen
        </button>
      </div>
    </header>
  );
}
