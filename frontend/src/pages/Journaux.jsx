import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';

export default function Journaux() {
  const { activeCompany } = useCompany();
  const [journals, setJournals] = useState([]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await api.getJournals(activeCompany.id);
    setJournals(rows);
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Journaux</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Journaux</h1>
        <p>Journaux comptables de la société — créés automatiquement à l'ouverture du dossier.</p>
      </div>

      <div className="card">
        <h2>Liste des journaux ({journals.length})</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th>Code</th>
              <th>Libellé</th>
            </tr>
          </thead>
          <tbody>
            {journals.map((j) => (
              <tr key={j.id}>
                <td>{j.code}</td>
                <td>{j.libelle}</td>
              </tr>
            ))}
            {journals.length === 0 && (
              <tr>
                <td colSpan={2} className="text-muted">
                  Aucun journal pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
