import React, { useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import CompanySelectGate from '../components/CompanySelectGate';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ParametresContent() {
  const { activeCompany, fiscalYears, activeFiscalYear, setActiveFiscalYear, refreshFiscalYears } = useCompany();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [creatingNext, setCreatingNext] = useState(false);
  // fiscalYears vient du contexte global ; on garde une copie locale pour
  // refléter immédiatement le changement de statut sans attendre le
  // rechargement réseau (refreshFiscalYears est quand même appelé après
  // chaque action pour rester synchronisé avec le reste de l'appli).
  const [localYears, setLocalYears] = useState(fiscalYears);
  React.useEffect(() => { setLocalYears(fiscalYears); }, [fiscalYears]);

  async function toggleCloture(fy) {
    setError('');
    setMessage('');
    setBusyId(fy.id);
    try {
      const updated = await api.setFiscalYearCloture(activeCompany.id, fy.id, !fy.cloture);
      setLocalYears((list) => list.map((y) => (y.id === updated.id ? updated : y)));
      if (activeFiscalYear?.id === updated.id) setActiveFiscalYear(updated);
      setMessage(updated.cloture ? `Exercice ${updated.date_debut} au ${updated.date_fin} clôturé.` : `Exercice ${updated.date_debut} au ${updated.date_fin} rouvert.`);
      setConfirmId(null);
      refreshFiscalYears?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function ouvrirExerciceSuivant() {
    setError('');
    setMessage('');
    setCreatingNext(true);
    try {
      const dernier = [...localYears].sort((a, b) => (a.date_fin < b.date_fin ? 1 : -1))[0];
      let dateDebut, dateFin;
      if (dernier) {
        const finPrec = new Date(dernier.date_fin);
        const debut = new Date(finPrec);
        debut.setDate(debut.getDate() + 1);
        const fin = new Date(debut.getFullYear(), 11, 31);
        dateDebut = debut.toISOString().slice(0, 10);
        dateFin = fin.toISOString().slice(0, 10);
      } else {
        const y = new Date().getFullYear();
        dateDebut = `${y}-01-01`;
        dateFin = `${y}-12-31`;
      }
      const created = await api.createFiscalYear(activeCompany.id, { date_debut: dateDebut, date_fin: dateFin });
      setLocalYears((list) => [created, ...list]);
      setMessage(`Nouvel exercice ouvert : ${created.date_debut} au ${created.date_fin}.`);
      refreshFiscalYears?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingNext(false);
    }
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Paramètres — Clôture</h1>
        <p>Fermeture du dossier (exercice comptable) : une fois clôturé, plus aucune écriture ne peut être ajoutée, modifiée ou supprimée sur cet exercice.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-notice">{message}</div>}

      <div className="card">
        <div className="flex-between">
          <h2 style={{ margin: 0 }}>Exercices comptables — {activeCompany.raison_sociale}</h2>
          <button type="button" className="btn btn-primary btn-tiny" onClick={ouvrirExerciceSuivant} disabled={creatingNext}>
            {creatingNext ? 'Ouverture…' : '+ Ouvrir l\'exercice suivant'}
          </button>
        </div>
        <table className="ledger" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Exercice</th>
              <th>Statut</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {localYears.map((fy) => (
              <tr key={fy.id}>
                <td>
                  Du {fy.date_debut} au {fy.date_fin}
                  {activeFiscalYear?.id === fy.id && <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>(exercice actif)</span>}
                </td>
                <td>
                  {fy.cloture ? (
                    <span style={{ color: 'var(--debit)', fontWeight: 700 }}>🔒 Clôturé</span>
                  ) : (
                    <span style={{ color: 'var(--credit)', fontWeight: 700 }}>● Ouvert</span>
                  )}
                </td>
                <td className="no-print">
                  {confirmId === fy.id ? (
                    <>
                      <span style={{ marginRight: 6, fontSize: 12.5 }}>Confirmer la clôture ?</span>
                      <button type="button" className="btn btn-primary btn-tiny" onClick={() => toggleCloture(fy)} disabled={busyId === fy.id}>Oui, clôturer</button>
                      <button type="button" className="btn btn-ghost btn-tiny" style={{ marginLeft: 4 }} onClick={() => setConfirmId(null)}>Annuler</button>
                    </>
                  ) : fy.cloture ? (
                    <button type="button" className="btn btn-ghost btn-tiny" onClick={() => toggleCloture(fy)} disabled={busyId === fy.id}>
                      {busyId === fy.id ? '…' : 'Rouvrir'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setConfirmId(fy.id)}>
                      Clôturer
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {localYears.length === 0 && (
              <tr><td colSpan={3} className="text-muted">Aucun exercice comptable pour cette société.</td></tr>
            )}
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          La clôture concerne l'exercice comptable (le "dossier" de l'année) — elle est indépendante d'une société à l'autre.
          Un exercice clôturé reste consultable (Écritures, Bilan, Balance…), seule la saisie est bloquée. Vous pouvez rouvrir
          un exercice à tout moment si besoin (ex : correction après clôture).
        </p>
      </div>
    </div>
  );
}

export default function Parametres() {
  return (
    <CompanySelectGate>
      <ParametresContent />
    </CompanySelectGate>
  );
}
