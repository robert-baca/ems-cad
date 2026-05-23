import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = sessionStorage.getItem('cad_user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = (userData) => {
    sessionStorage.setItem('cad_user', JSON.stringify(userData));
    setUser(userData);
  };

  const updateName = (name) => {
    setUser(prev => {
      const updated = { ...prev, name };
      sessionStorage.setItem('cad_user', JSON.stringify(updated));
      return updated;
    });
  };

  const updateProfile = (profile) => {
    setUser(prev => {
      const updated = { ...prev, profile, name: profile.name || prev.name };
      sessionStorage.setItem('cad_user', JSON.stringify(updated));
      return updated;
    });
  };

  const logout = () => {
    sessionStorage.removeItem('cad_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateName, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
