import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from './api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('mc_user');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email, password) => {
    const { user, token } = await api.login(email, password);
    localStorage.setItem('mc_token', token);
    localStorage.setItem('mc_user', JSON.stringify(user));
    localStorage.removeItem('mc_session_expired');
    setUser(user);
  }, []);

  const register = useCallback(async (payload) => {
    const { user, token } = await api.register(payload);
    localStorage.setItem('mc_token', token);
    localStorage.setItem('mc_user', JSON.stringify(user));
    localStorage.removeItem('mc_session_expired');
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    setUser(null);
  }, []);

  // Le client API (client.js) déclenche cet événement dès qu'une requête
  // authentifiée reçoit un 401 : le jeton stocké n'est plus valide (expiré, ou
  // le serveur a redémarré avec un autre secret). On déconnecte immédiatement
  // au lieu de laisser l'interface dans un état "connecté" trompeur.
  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
    }
    window.addEventListener('mc:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('mc:unauthorized', handleUnauthorized);
  }, []);

  return <AuthContext.Provider value={{ user, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
