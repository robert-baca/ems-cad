import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { refreshToken } from '../services/api';

const AuthContext = createContext(null);

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const REFRESH_THRESHOLD_S = 4 * 60 * 60;    // refresh when < 4h remain

function parseJwtExp(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).exp;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('cad_user');
    return stored ? JSON.parse(stored) : null;
  });
  const refreshTimerRef = useRef(null);

  const updateToken = (token) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, token };
      localStorage.setItem('cad_user', JSON.stringify(updated));
      return updated;
    });
  };

  // Proactive token refresh: runs every 30 min, refreshes if < 4h remain.
  // Mobile browsers suspend setInterval while the tab is backgrounded, so we
  // also refresh immediately on visibilitychange — otherwise a crew phone
  // that's been locked/backgrounded for a while comes back to a stale token.
  useEffect(() => {
    const tryRefresh = async () => {
      const stored = localStorage.getItem('cad_user');
      if (!stored) return;
      const { token } = JSON.parse(stored);
      if (!token) return;
      const exp = parseJwtExp(token);
      if (!exp) return;
      const remaining = exp - Math.floor(Date.now() / 1000);
      if (remaining < REFRESH_THRESHOLD_S) {
        try {
          const res = await refreshToken();
          updateToken(res.data.token);
        } catch {
          // silent — 401 interceptor in api.js handles full expiry
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') tryRefresh();
    };

    if (user?.token) {
      tryRefresh();
      refreshTimerRef.current = setInterval(tryRefresh, REFRESH_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      clearInterval(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.token]);

  const login = (userData) => {
    localStorage.setItem('cad_user', JSON.stringify(userData));
    setUser(userData);
  };

  const updateName = (name) => {
    setUser(prev => {
      const updated = { ...prev, name };
      localStorage.setItem('cad_user', JSON.stringify(updated));
      return updated;
    });
  };

  const updateProfile = (profile) => {
    setUser(prev => {
      const updated = { ...prev, profile, name: profile.name || prev.name };
      localStorage.setItem('cad_user', JSON.stringify(updated));
      return updated;
    });
  };

  const logout = () => {
    localStorage.removeItem('cad_user');
    clearInterval(refreshTimerRef.current);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateName, updateProfile, updateToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
