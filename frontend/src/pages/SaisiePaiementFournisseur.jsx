import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { formatDateFR } from '../utils/dateFr';
import DateInputFR from '../components/DateInputFR';

const MODES = ['Espèce', 'Chèque', 'Virement', 'Effet', 'Carte Bancaire', 'Prélèvement'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Reproduit l'écran "Saisie : Paiement Fournisseur" du logiciel de
// référence : sélection du fournisseur, date, montant, mode de paiement et
// N° de facture, avec un panneau de lettrage des factures ouvertes de ce
// fournisseur (les factures qu'on choisit d'associer au règlement).
export default function SaisiePaiementFournisseur() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [fournisseurs, setFournisseurs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [tiersId, setTiersId] = useState('');
  const [datePaiement, setDatePaiement] = useState(todayISO());
  const [montant, setMontant] = useState('');
  const [factureNumero, setFactureNumero] = useState('');
  const [modePaiement, setModePaiement] = useState('');
  const [compteTresorNumero, setCompteTresorNumero] = useState('');
  const [libelle, setLibelle] = useState('');
  const [candidats, setCandidats] = useState([]);
  const [selectedLineIds, setSelectedLineIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const [f, acc] = await Promise.all([api.getTiers(activeCompany.id, 'fournisseur'), api.getAccounts(activeCompany.id)]);
    setFournisseurs(f);
    setAccounts(acc);
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load]);

  const tresorerieAccounts = useMemo(() => accounts.filter((a) => a.classe === 5 && (a.numero.startsWith('514') || a.numero.startsWith('516'))), [accounts]);
  const fournisseurActif = fournisseurs.find((f) => String(f.id) === String(tiersId));

  // Quand on choisit "Espèce", on présélectionne automatiquement la première
  // caisse (compte 516x) plutôt que de laisser l'utilisateur rechercher le
  // compte trésorerie à la main — il peut toujours le changer ensuite.
  function handleModeChange(value) {
    setModePaiement(value);
    if (value === 'Espèce') {
      const caisse = accounts.find((a) => a.numero.startsWith('516'));
      if (caisse) setCompteTresorNumero(caisse.numero);
    } else if (value === 'Chèque') {
      // Le chèque se comporte comme les autres modes : on présélectionne la
      // banque, qui sera mouvementée directement (comme l'espèce/le virement).
      const banque = accounts.find((a) => a.numero.startsWith('514'));
      if (banque) setCompteTresorNumero(banque.numero);
    }
  }

  const loadCandidats = useCallback(async () => {
    if (!activeCompany || !fournisseurActif) return setCandidats([]);
    const res = await api.getLettrageCandidats(activeCompany.id, fournisseurActif.account_id);
    setCandidats(res.lignes || []);
    setSelectedLineIds([]);
  }, [activeCompany, fournisseurActif]);

  useEffect(() => {
    loadCandidats();
  }, [loadCandidats]);

  function toggleLine(id) {
    setSelectedLineIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  const totalSelectionne = round2(candidats.filter((l) => selectedLineIds.includes(l.id)).reduce((s, l) => s + (l.credit || 0), 0));

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!tiersId) return setError('Sélectionnez un fournisseur.');
    if (!montant) return setError('Le montant est requis.');
    if (!compteTresorNumero) return setError('Sélectionnez le compte de trésorerie (banque/caisse) réglé.');
    if (!activeFiscalYear) return setError('Aucun exercice comptable actif pour cette société.');
    setSaving(true);
    try {
      const res = await api.createPaiementFournisseur(activeCompany.id, {
        tiers_id: Number(tiersId),
        fiscal_year_id: activeFiscalYear.id,
        date_paiement: datePaiement,
        montant: Number(montant),
        mode_paiement: modePaiement,
        compte_tresor_numero: compteTresorNumero,
        facture_numero: factureNumero,
        libelle,
        line_ids: selectedLineIds,
      });
      setMessage(res.lettrage ? `Paiement enregistré et lettré (${res.lettrage}).` : 'Paiement enregistré.');
      setMontant('');
      setFactureNumero('');
      setLibelle('');
      loadCandidats();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Saisie : Paiement Fournisseur</h1>
        <p>Règlement d'un fournisseur, avec lettrage optionnel des factures ouvertes.</p>
      </div>

      <div className="card no-print">
        <form onSubmit={handleSave}>
          <div className="grid-3">
            <div className="field">
              <label>Fournisseur</label>
              <select value={tiersId} onChange={(e) => setTiersId(e.target.value)}>
                <option value="">Choisir…</option>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.account_numero} — {f.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Date paiement</label>
              <DateInputFR value={datePaiement} onChange={(e) => setDatePaiement(e.target.value)} />
            </div>
            <div className="field">
              <label>Montant</label>
              <input type="number" step="0.01" className="num" value={montant} onChange={(e) => setMontant(e.target.value)} />
            </div>
          </div>
          <div className="grid-3">
            <div className="field">
              <label>Facture N°</label>
              <input value={factureNumero} onChange={(e) => setFactureNumero(e.target.value)} />
            </div>
            <div className="field">
              <label>Mode paiement</label>
              <select value={modePaiement} onChange={(e) => handleModeChange(e.target.value)}>
                <option value="">Choisir…</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Compte Trésor (banque/caisse)</label>
              <select value={compteTresorNumero} onChange={(e) => setCompteTresorNumero(e.target.value)}>
                <option value="">Choisir…</option>
                {tresorerieAccounts.map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Libellé</label>
            <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder={fournisseurActif ? `Règlement ${fournisseurActif.nom}` : ''} />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-notice">{message}</div>}
          <button className="btn btn-primary mt-24" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer (F3)'}</button>
        </form>
      </div>

      {fournisseurActif && (
        <div className="card no-print">
          <div className="flex-between">
            <h2 style={{ margin: 0 }}>Lettrage — factures ouvertes de {fournisseurActif.nom}</h2>
            <div style={{ fontWeight: 700 }}>Total sélectionné : {totalSelectionne.toFixed(2)}</div>
          </div>
          <table className="ledger" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th></th><th>Date</th><th>Pièce</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th>
              </tr>
            </thead>
            <tbody>
              {candidats.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={selectedLineIds.includes(l.id)} onChange={() => toggleLine(l.id)} /></td>
                  <td>{formatDateFR(l.date_ecriture)}</td>
                  <td>{l.numero_piece || '—'}</td>
                  <td>{l.libelle || l.libelle_ecriture}</td>
                  <td className="num">{l.debit ? l.debit.toFixed(2) : ''}</td>
                  <td className="num">{l.credit ? l.credit.toFixed(2) : ''}</td>
                </tr>
              ))}
              {candidats.length === 0 && (
                <tr><td colSpan={6} className="text-muted">Aucune facture ouverte pour ce fournisseur.</td></tr>
              )}
            </tbody>
          </table>
          <p className="text-muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            Cochez les factures que ce paiement solde : si leur total correspond exactement au montant réglé, elles sont
            automatiquement lettrées avec le paiement.
          </p>
        </div>
      )}
    </div>
  );
}
