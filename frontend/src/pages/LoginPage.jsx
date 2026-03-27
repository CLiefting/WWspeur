import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, username, password, fullName);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err.detail || err.message || 'Er is iets misgegaan');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'var(--font-body)',
    padding: '12px 16px',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 700, color: 'var(--bg-primary)',
            marginBottom: 16,
          }}>W</div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--gold)' }}>WW</span>
            <span style={{ color: 'var(--text-primary)' }}>Speur</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Webwinkel Investigator
          </div>
        </div>

        {/* Form card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 28,
        }}>
          <div style={{
            fontSize: 16, fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 24,
          }}>
            {isRegister ? 'Account aanmaken' : 'Inloggen'}
          </div>

          {error && (
            <div style={{
              background: 'rgba(248, 113, 113, 0.1)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--danger)',
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                    Volledige naam
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Jan de Vries"
                    style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                    E-mail
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="jan@voorbeeld.nl"
                    required
                    style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                </div>
              </>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                Gebruikersnaam
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="jandevries"
                required
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                Wachtwoord
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Minimaal 8 tekens"
                required
                minLength={8}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--gold-dim)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                background: loading ? 'var(--border)' : 'linear-gradient(135deg, var(--gold), var(--gold-dim))',
                border: 'none',
                color: 'var(--bg-primary)',
                fontSize: 14, fontWeight: 600,
                padding: '12px 0',
                borderRadius: 8,
                transition: 'all 0.2s',
              }}
            >
              {loading ? 'Even geduld...' : isRegister ? 'Registreren' : 'Inloggen'}
            </button>
          </form>

          <div style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}>
            {isRegister ? 'Al een account?' : 'Nog geen account?'}{' '}
            <button
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              style={{
                background: 'none', border: 'none',
                color: 'var(--gold)', fontSize: 13,
                fontWeight: 500, textDecoration: 'underline',
                fontFamily: 'var(--font-body)',
              }}
            >
              {isRegister ? 'Inloggen' : 'Registreren'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
