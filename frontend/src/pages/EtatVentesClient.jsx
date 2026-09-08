import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { formatDateFR } from '../utils/dateFr';

function fmt(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Etat des ventes par client — Articles 20 et 82 du Code Général des Impôts.
// Reproduit la présentation officielle (voir modèle ADC1 de la DGI) : logo du
// Royaume, identité du contribuable (raison sociale / IF / ICE), puis un
// tableau par client avec son ICE, le montant HT et le montant TTC facturés
// sur l'exercice. Imprimable (mise en page dédiée, voir styles.css) et
// exportable en Excel.
export default function EtatVentesClient() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeCompany || !activeFiscalYear) return;
    setLoading(true);
    setError('');
    api
      .getEtatVentesClient(activeCompany.id, activeFiscalYear.id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeCompany, activeFiscalYear]);

  function handleExport() {
    if (!data) return;
    const rows = [
      ['Nom et prénom ou raison sociale du client', 'ICE du client', 'Montant HT', 'Montant TTC'],
      ...data.clients.map((c) => [c.nom, c.ice, c.ht, c.ttc]),
      ['TOTAL', '', data.total_ht, data.total_ttc],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ventes par client');
    XLSX.writeFile(workbook, `etat_ventes_client_${activeCompany.raison_sociale}_${activeFiscalYear.date_debut}.xlsx`);
  }

  if (!activeCompany) return <div className="card">Sélectionnez d'abord une société.</div>;
  if (loading) return <div className="card">Chargement…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  return (
    <div className="card etat-ventes-client">
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button type="button" className="btn" onClick={handleExport}>Exporter (Excel)</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Imprimer</button>
      </div>

      <div className="evc-header">
        <img src="/logo-royaume-maroc.png" alt="Royaume du Maroc" className="evc-logo" />
        <div className="evc-header-text">
          <div className="evc-header-ministere">Ministère de l'Économie et des Finances</div>
          <div className="evc-header-direction">Direction Générale des Impôts</div>
          <h1>Etat des ventes par client</h1>
          <p className="text-muted">(Articles 20 et 82 du Code Général des Impôts)</p>
          <p><strong>Exercice du {formatDateFR(data.exercice.debut)} au {formatDateFR(data.exercice.fin)}</strong></p>
        </div>
        <img src="/logo-royaume-maroc.png" alt="Royaume du Maroc" className="evc-logo" />
      </div>

      <div className="evc-identite">
        <h2>Identité du contribuable</h2>
        <div className="evc-identite-grid">
          <div><span className="text-muted">Nom et prénom ou raison sociale : </span><strong>{data.company.raison_sociale}</strong></div>
          <div><span className="text-muted">I.F : </span><strong>{data.company.if_fiscal || '—'}</strong></div>
          <div><span className="text-muted">ICE : </span><strong>{data.company.ice || '—'}</strong></div>
        </div>
      </div>

      <table className="ledger evc-table">
        <thead>
          <tr>
            <th>Nom et prénom ou raison sociale du client</th>
            <th>ICE du client</th>
            <th className="num">Montant HT</th>
            <th className="num">Montant TTC</th>
          </tr>
        </thead>
        <tbody>
          {data.clients.length === 0 && (
            <tr><td colSpan={4} className="text-muted">Aucune vente enregistrée sur cet exercice.</td></tr>
          )}
          {data.clients.map((c) => (
            <tr key={c.nom}>
              <td>{c.nom}</td>
              <td>{c.ice || '—'}</td>
              <td className="num">{fmt(c.ht)}</td>
              <td className="num">{fmt(c.ttc)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}><strong>TOTAL</strong></td>
            <td className="num"><strong>{fmt(data.total_ht)}</strong></td>
            <td className="num"><strong>{fmt(data.total_ttc)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
