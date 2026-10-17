import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('pmfby_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('pmfby_token', res.data.token);
    localStorage.setItem('pmfby_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pmfby_token');
    localStorage.removeItem('pmfby_user');
    setUser(null);
  }, []);

  // Called right after a successful POST /api/auth/change-password so RequireAuth's
  // mandatory-change gate releases immediately, without waiting for the next full
  // login/token refresh to pick up the server's now-false force_password_change.
  const clearForcePasswordChange = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, forcePasswordChange: false };
      localStorage.setItem('pmfby_user', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, clearForcePasswordChange }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
