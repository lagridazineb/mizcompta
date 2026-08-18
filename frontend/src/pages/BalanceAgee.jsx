import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import PrintHeader from '../components/PrintHeader';
import DownloadMenu from '../components/DownloadMenu';

export default function BalanceAgee() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [type, setType] = useState('client');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const data = await api.getBalanceAgee(activeCompany.id, type);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, type]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = rows.reduce(
    (acc, r) => ({
      solde: acc.solde + r.solde,
      j0_30: acc.j0_30 + r.j0_30,
      j31_60: acc.j31_60 + r.j31_60,
      j61_90: acc.j61_90 + r.j61_90,
      j90_plus: acc.j90_plus + r.j90_plus,
    }),
    { solde: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 }
  );

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Balance âgée</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header no-print">
        <h1>Balance âgée</h1>
        <p>Soldes non lettrés des tiers, répartis par ancienneté.</p>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${type === 'client' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('client')}>
          Clients
        </button>
        <button className={`btn ${type === 'fournisseur' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('fournisseur')}>
          Fournisseurs
        </button>
      </div>

      <div className="card">
        <div className="flex-between no-print">
          <h2 style={{ margin: 0 }}>{type === 'client' ? 'Clients' : 'Fournisseurs'} — soldes non lettrés</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <DownloadMenu onDownload={(format) => api.downloadBalanceAgee(activeCompany.id, type, format)} />
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
          </div>
        </div>
        <PrintHeader
          company={activeCompany}
          title={`BALANCE ÂGÉE — ${type === 'client' ? 'CLIENTS' : 'FOURNISSEURS'}`}
          periodeDebut={activeFiscalYear?.date_debut}
          periodeFin={activeFiscalYear?.date_fin}
        />
        {loading && <p className="text-muted no-print">Chargement…</p>}
        <table className="ledger">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Nom</th>
              <th className="num">Solde</th>
              <th className="num">0-30 j</th>
              <th className="num">31-60 j</th>
              <th className="num">61-90 j</th>
              <th className="num">+90 j</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tiers_id}>
                <td>{r.account_numero}</td>
                <td>{r.nom}</td>
                <td className="num">{r.solde.toFixed(2)}</td>
                <td className="num">{r.j0_30.toFixed(2)}</td>
                <td className="num">{r.j31_60.toFixed(2)}</td>
                <td className="num">{r.j61_90.toFixed(2)}</td>
                <td className="num">{r.j90_plus.toFixed(2)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-muted">
                  Aucun solde en attente — tout est lettré ou soldé.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={2}>Total</td>
                <td className="num">{totals.solde.toFixed(2)}</td>
                <td className="num">{totals.j0_30.toFixed(2)}</td>
                <td className="num">{totals.j31_60.toFixed(2)}</td>
                <td className="num">{totals.j61_90.toFixed(2)}</td>
                <td className="num">{totals.j90_plus.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
