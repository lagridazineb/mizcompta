import React, { useState } from 'react';
import { api, getToken } from '../api/client';
import { useCompany } from '../CompanyContext';
import DateInputFR from '../components/DateInputFR';

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function lastDayOfMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

export default function Tva() {
  const { activeCompany } = useCompany();
  const [dateDebut, setDateDebut] = useState(firstDayOfMonth());
  const [dateFin, setDateFin] = useState(lastDayOfMonth());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCalcul() {
    setError('');
    setLoading(true);
    try {
      const r = await api.getTvaCalcul(activeCompany.id, dateDebut, dateFin);
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    const url = api.getTvaExportUrl(activeCompany.id, dateDebut, dateFin);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
    const text = await res.text();
    const blob = new Blob([text], { type: 'application/xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tva_${activeCompany.ice || activeCompany.id}_${dateDebut}_${dateFin}.xml`;
    link.click();
  }

  async function handleExportReleve() {
    const url = `${api.getTvaExportUrl(activeCompany.id, dateDebut, dateFin).replace('/tva/export-xml', '/tva/releve-deductions')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `releve_deductions_${dateDebut}_${dateFin}.xlsx`;
    link.click();
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  const totaux = result?.par_taux?.reduce(
    (acc, l) => ({
      achats: acc.achats + l.achats,
      achats_immo: acc.achats_immo + l.achats_immo,
      ventes: acc.ventes + l.ventes,
      ajios: acc.ajios + l.ajios,
    }),
    { achats: 0, achats_immo: 0, ventes: 0, ajios: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <h1>Télédéclaration TVA</h1>
        <p>{activeCompany.raison_sociale} — TVA calculée par taux à partir des comptes 4455 (facturée) / 34552 (récupérable charges) / 34551 (récupérable immo).</p>
      </div>

      <div className="alert alert-notice">
        L'export XML ci-dessous est un <strong>gabarit de départ</strong>. Avant toute télédéclaration réelle sur Simpl-TVA,
        faites valider la structure exacte par un expert-comptable ou selon le cahier des charges officiel de la DGI.
      </div>

      <div className="card">
        <h2>Veuillez spécifier la période</h2>
        <div className="grid-3">
          <div className="field">
            <label>Date début</label>
            <DateInputFR value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="field">
            <label>Date fin</label>
            <DateInputFR value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleCalcul} disabled={loading}>
              {loading ? 'Génération…' : 'Générer'}
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {result && (
        <>
          <div className="card">
            <h2>Détail par taux</h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Taux</th>
                  <th className="num">Achats</th>
                  <th className="num">Achats Immo</th>
                  <th className="num">Ventes</th>
                  <th className="num">Ajios</th>
                </tr>
              </thead>
              <tbody>
                {result.par_taux.map((l) => (
                  <tr key={l.taux}>
                    <td>{l.taux}%</td>
                    <td className="num">{l.achats ? l.achats.toFixed(2) : 0}</td>
                    <td className="num">{l.achats_immo ? l.achats_immo.toFixed(2) : 0}</td>
                    <td className="num">{l.ventes ? l.ventes.toFixed(2) : 0}</td>
                    <td className="num">{l.ajios ? l.ajios.toFixed(2) : 0}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Tot.</td>
                  <td className="num">{totaux.achats.toFixed(2)}</td>
                  <td className="num">{totaux.achats_immo.toFixed(2)}</td>
                  <td className="num">{totaux.ventes.toFixed(2)}</td>
                  <td className="num">{totaux.ajios.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Total TVA en cours</h2>
            <table className="ledger">
              <tbody>
                <tr>
                  <td>TVA collectée (ventes)</td>
                  <td className="num credit">{result.tva_collectee.toFixed(2)} DH</td>
                </tr>
                <tr>
                  <td>TVA déductible sur charges</td>
                  <td className="num debit">{result.tva_deductible_charges.toFixed(2)} DH</td>
                </tr>
                <tr>
                  <td>TVA déductible sur immobilisations</td>
                  <td className="num debit">{result.tva_deductible_immobilisations.toFixed(2)} DH</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>{result.tva_due_ou_credit >= 0 ? 'TVA due' : 'Crédit de TVA reportable'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {Math.abs(result.tva_due_ou_credit).toFixed(2)} DH
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost mt-24" onClick={handleExportReleve}>
                Télécharger le relevé de déductions (Excel)
              </button>
              <button className="btn btn-brass mt-24" onClick={handleExport}>
                Télécharger le fichier XML
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
