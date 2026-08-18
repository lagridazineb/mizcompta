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
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const refreshFiscalYears = useCallback(async () => {
    if (!activeCompany) return;
    const years = await api.getFiscalYears(activeCompany.id);
    setFiscalYears(years);
    setActiveFiscalYear((prev) => years.find((y) => y.id === prev?.id) || years[0] || null);
  }, [activeCompany]);

  useEffect(() => {
    async function loadYears() {
      if (!activeCompany) return;
      const years = await api.getFiscalYears(activeCompany.id);
      setFiscalYears(years);
      setActiveFiscalYear(years[0] || null);
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
