import { useState, useEffect, createContext, useContext } from 'react';
import { auth, setAuthFailureCallback } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthFailureCallback(() => setUser(null));
    return () => setAuthFailureCallback(null);
  }, []);

  useEffect(() => {
    if (auth.isLoggedIn()) {
      auth.getProfile()
        .then(setUser)
        .catch(() => {
          console.debug('[Auth] Profile fetch failed, clearing token');
          localStorage.removeItem('wwspeur_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    console.debug('[Auth] Login:', username);
    await auth.login(username, password);
    console.debug('[Auth] Token stored, fetching profile');
    const profile = await auth.getProfile();
    console.debug('[Auth] Profile:', profile);
    setUser(profile);
    return profile;
  };

  const register = async (email, username, password, fullName) => {
    console.debug('[Auth] Register:', username);
    await auth.register(email, username, password, fullName);
    console.debug('[Auth] Registered, now logging in');
    return login(username, password);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('wwspeur_token');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
