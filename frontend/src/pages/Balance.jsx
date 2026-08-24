import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { Link } from 'react-router-dom';
import PrintHeader from '../components/PrintHeader';
import DownloadMenu from '../components/DownloadMenu';
import DateInputFR from '../components/DateInputFR';

// Types de comptes proposés au filtre : "Tous", puis les racines du plan
// comptable pour isoler rapidement les comptes Clients (34) ou Fournisseurs
// (44), comme demandé ("filtrer par ... client fournisseur").
const FILTRES_TYPE = [
  { value: 'tous', label: 'Tous les comptes' },
  { value: '34', label: 'Clients (34)' },
  { value: '44', label: 'Fournisseurs (44)' },
];

export default function Balance() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  // Par défaut : la balance porte sur tout l'exercice en cours (l'année
  // entière), mais reste modifiable pour filtrer sur une période précise.
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [typeCompte, setTypeCompte] = useState('tous');
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (activeFiscalYear) {
      setDateDebut(activeFiscalYear.date_debut);
      setDateFin(activeFiscalYear.date_fin);
    }
  }, [activeFiscalYear]);

  useEffect(() => {
    if (!activeCompany || !dateDebut || !dateFin) return;
    setLoading(true);
    api
      .getBalance(activeCompany.id, { date_debut: dateDebut, date_fin: dateFin })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [activeCompany, dateDebut, dateFin]);

  const rowsFiltrees = useMemo(() => {
    const rechercheLow = recherche.trim().toLowerCase();
    return rows
      .filter((r) => r.total_debit || r.total_credit)
      .filter((r) => typeCompte === 'tous' || r.numero.startsWith(typeCompte))
      .filter((r) => !rechercheLow || r.numero.toLowerCase().includes(rechercheLow) || r.intitule.toLowerCase().includes(rechercheLow));
  }, [rows, typeCompte, recherche]);

  const totalDebit = rowsFiltrees.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = rowsFiltrees.reduce((s, r) => s + r.total_credit, 0);
  const totalSD = rowsFiltrees.reduce((s, r) => s + r.solde_debiteur, 0);
  const totalSC = rowsFiltrees.reduce((s, r) => s + r.solde_crediteur, 0);

  function resetAnnee() {
    if (activeFiscalYear) {
      setDateDebut(activeFiscalYear.date_debut);
      setDateFin(activeFiscalYear.date_fin);
    }
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Balance générale</h1>
        <p>Cumuls et soldes par compte du Plan Comptable Marocain, sur toute l'année ou une période choisie.</p>
      </div>

      <div className="card no-print">
        <div className="grid-3">
          <div className="field">
            <label>Du</label>
            <DateInputFR value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="field">
            <label>Au</label>
            <DateInputFR value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-ghost" onClick={resetAnnee}>
              Toute l'année {activeFiscalYear ? `(${activeFiscalYear.date_debut.slice(0, 4)})` : ''}
            </button>
          </div>
        </div>
        <div className="grid-3">
          <div className="field">
            <label>Type de compte</label>
            <select value={typeCompte} onChange={(e) => setTypeCompte(e.target.value)}>
              {FILTRES_TYPE.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Recherche (N° compte / client / fournisseur)</label>
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Ex : 3421, nom du client…" />
          </div>
        </div>
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
          periodeDebut={dateDebut || activeFiscalYear?.date_debut}
          periodeFin={dateFin || activeFiscalYear?.date_fin}
        />
        {loading && <p className="text-muted no-print">Chargement…</p>}
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
            {rowsFiltrees.map((r) => (
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
            {rowsFiltrees.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-muted">
                  Aucun mouvement enregistré sur cette période / ce filtre.
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
