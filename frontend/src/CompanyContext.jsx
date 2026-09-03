import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api/client';
import { useAuth } from './AuthContext';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompany] = useState(null);
  const [fiscalYears, setFiscalYears] = useState([]);
  const [activeFiscalYear, setActiveFiscalYear] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshCompanies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await api.getCompanies();
      setCompanies(list);
      if (!activeCompany && list.length > 0) {
        setActiveCompany(list[0]);
      }
    } catch (err) {
      // Ne pas laisser planter la promesse en silence dans la console
      // (rejet non intercepté) : une session expirée est déjà gérée
      // globalement (déconnexion automatique, voir client.js/AuthContext),
      // les autres erreurs (réseau, serveur lent) sont simplement journalisées
      // — la liste des sociétés reste alors vide plutôt que de planter la page.
      console.error('Impossible de charger les sociétés :', err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const refreshFiscalYears = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const years = await api.getFiscalYears(activeCompany.id);
      setFiscalYears(years);
      setActiveFiscalYear((prev) => years.find((y) => y.id === prev?.id) || years[0] || null);
    } catch (err) {
      console.error('Impossible de charger les exercices comptables :', err.message);
    }
  }, [activeCompany]);

  useEffect(() => {
    async function loadYears() {
      if (!activeCompany) return;
      try {
        const years = await api.getFiscalYears(activeCompany.id);
        setFiscalYears(years);
        setActiveFiscalYear(years[0] || null);
      } catch (err) {
        console.error('Impossible de charger les exercices comptables :', err.message);
      }
    }
    loadYears();
  }, [activeCompany]);

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompany,
        setActiveCompany,
        fiscalYears,
        activeFiscalYear,
        setActiveFiscalYear,
        refreshFiscalYears,
        loading,
        refreshCompanies,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
