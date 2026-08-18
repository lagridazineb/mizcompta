import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { Link } from 'react-router-dom';
import PrintHeader from '../components/PrintHeader';
import DownloadMenu from '../components/DownloadMenu';

export default function Balance() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!activeCompany) return;
    api.getBalance(activeCompany.id).then(setRows);
  }, [activeCompany]);

  const totalDebit = rows.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.total_credit, 0);
  const totalSD = rows.reduce((s, r) => s + r.solde_debiteur, 0);
  const totalSC = rows.reduce((s, r) => s + r.solde_crediteur, 0);

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Balance générale</h1>
        <p>Cumuls et soldes par compte du Plan Comptable Marocain.</p>
      </div>

      <div className="card">
        <div className="flex-between no-print">
          <h2 style={{ margin: 0 }}>Balance générale</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <DownloadMenu onDownload={(format) => api.downloadBalance(activeCompany.id, activeFiscalYear?.id, format)} />
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
          </div>
        </div>
        <PrintHeader
          company={activeCompany}
          title="BALANCE GÉNÉRALE"
          periodeDebut={activeFiscalYear?.date_debut}
          periodeFin={activeFiscalYear?.date_fin}
        />
        <table className="ledger">
          <thead>
            <tr>
              <th>N° Compte</th>
              <th>Intitulé</th>
              <th className="num">Total débit</th>
              <th className="num">Total crédit</th>
              <th className="num">Solde débiteur</th>
              <th className="num">Solde créditeur</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.total_debit || r.total_credit)
              .map((r) => (
                <tr key={r.account_id}>
                  <td>{r.numero}</td>
                  <td>{r.intitule}</td>
                  <td className="num">{r.total_debit.toFixed(2)}</td>
                  <td className="num">{r.total_credit.toFixed(2)}</td>
                  <td className="num debit">{r.solde_debiteur ? r.solde_debiteur.toFixed(2) : ''}</td>
                  <td className="num credit">{r.solde_crediteur ? r.solde_crediteur.toFixed(2) : ''}</td>
                  <td className="no-print">
                    <Link className="btn btn-ghost" to={`/grand-livre?account=${r.account_id}`}>
                      Grand livre
                    </Link>
                  </td>
                </tr>
              ))}
            {rows.filter((r) => r.total_debit || r.total_credit).length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  Aucun mouvement enregistré.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>
                Totaux
              </td>
              <td className="num" style={{ fontWeight: 700 }}>{totalDebit.toFixed(2)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{totalCredit.toFixed(2)}</td>
              <td className="num debit" style={{ fontWeight: 700 }}>{totalSD.toFixed(2)}</td>
              <td className="num credit" style={{ fontWeight: 700 }}>{totalSC.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
