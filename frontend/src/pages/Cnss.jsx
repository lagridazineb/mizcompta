import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { extractDocument } from '../utils/documentText';
import { formatDateFR } from '../utils/dateFr';
import DateInputFR from '../components/DateInputFR';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Taux publiés par la CNSS, tels qu'affichés sur les bordereaux "Régime
// Général" et "AMO" (voir les captures fournies) — modifiables si un taux
// change, mais préremplis pour éviter la ressaisie.
const TAUX_REGIME_GENERAL = [
  { key: 'allocations_familiales', label: 'Allocations Familiales', taux: 6.40 },
  { key: 'prestations_sociales', label: 'Prestations Sociales', taux: 13.46 },
  { key: 'taxe_formation_pro', label: 'Taxe de Formation Professionnelle', taux: 1.60 },
];
const TAUX_AMO = [
  { key: 'participation_amo', label: 'Participation AMO', taux: 1.85 },
  { key: 'cotisation_amo', label: 'Cotisation AMO', taux: 4.52 },
];

function BordereauForm({ titre, taux, masseSalariale, setMasseSalariale, montants, setMontant }) {
  const total = round2(Object.values(montants).reduce((s, v) => s + (Number(v) || 0), 0));
  return (
    <div>
      <h3 style={{ fontSize: 14, marginTop: 0 }}>{titre}</h3>
      <div className="field" style={{ maxWidth: 260 }}>
        <label>Masse salariale (cotisable)</label>
        <input type="number" step="0.01" className="num" value={masseSalariale} onChange={(e) => setMasseSalariale(e.target.value)} />
      </div>
      <table className="ledger" style={{ marginTop: 10 }}>
        <thead><tr><th>Nature</th><th className="num">Taux</th><th className="num">Montant</th></tr></thead>
        <tbody>
          {taux.map((t) => (
            <tr key={t.key}>
              <td>{t.label}</td>
              <td className="num">{t.taux}%</td>
              <td className="num">
                <input
                  type="number" step="0.01" className="num" style={{ width: 100 }}
                  value={montants[t.key] ?? ''}
                  onChange={(e) => setMontant(t.key, e.target.value)}
                />
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={2}>Montant global du versement</td>
            <td className="num">{total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Cnss() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [accounts, setAccounts] = useState([]);
  const [mode, setMode] = useState('manuel'); // manuel | scan
  const [file, setFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');

  const [periode, setPeriode] = useState('');
  const [datePaiement, setDatePaiement] = useState(todayISO());
  const [compteTresorNumero, setCompteTresorNumero] = useState('');
  const [reference, setReference] = useState('');

  const [masseRG, setMasseRG] = useState('');
  const [montantsRG, setMontantsRG] = useState({});
  const [inclureRG, setInclureRG] = useState(true);

  const [masseAMO, setMasseAMO] = useState('');
  const [montantsAMO, setMontantsAMO] = useState({});
  const [inclureAMO, setInclureAMO] = useState(true);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Anti-doublon : historique des règlements déjà passés pour la période
  // affichée avant enregistrement, + blocage serveur qu'on ne peut lever
  // qu'en confirmant explicitement (force) que c'est volontaire.
  const [historique, setHistorique] = useState({ reglements: [], total: 0 });
  const [confirmDoublon, setConfirmDoublon] = useState(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setAccounts(await api.getAccounts(activeCompany.id));
  }, [activeCompany]);
  useEffect(() => { load(); }, [load]);

  // Dès qu'une période est saisie, on vérifie si elle a déjà été réglée —
  // affiché en avertissement avant même de cliquer sur Enregistrer, pour
  // éviter de découvrir le doublon seulement après coup.
  const loadHistorique = useCallback(async () => {
    if (!activeCompany || !activeFiscalYear || !periode.trim()) {
      setHistorique({ reglements: [], total: 0 });
      return;
    }
    try {
      const res = await api.getHistoriqueCnss(activeCompany.id, { fiscal_year_id: activeFiscalYear.id, periode: periode.trim() });
      setHistorique(res);
    } catch {
      setHistorique({ reglements: [], total: 0 });
    }
  }, [activeCompany, activeFiscalYear, periode]);
  useEffect(() => { loadHistorique(); }, [loadHistorique]);

  const tresorerieAccounts = useMemo(() => accounts.filter((a) => a.classe === 5 && (a.numero.startsWith('514') || a.numero.startsWith('516'))), [accounts]);

  // Recalcule automatiquement les montants dès que la masse salariale change
  // (l'utilisateur peut ensuite corriger chaque ligne à la main si besoin).
  useEffect(() => {
    if (!masseRG) return;
    const m = Number(masseRG) || 0;
    const next = {};
    for (const t of TAUX_REGIME_GENERAL) next[t.key] = round2((m * t.taux) / 100);
    setMontantsRG(next);
  }, [masseRG]);
  useEffect(() => {
    if (!masseAMO) return;
    const m = Number(masseAMO) || 0;
    const next = {};
    for (const t of TAUX_AMO) next[t.key] = round2((m * t.taux) / 100);
    setMontantsAMO(next);
  }, [masseAMO]);

  const totalRG = round2(Object.values(montantsRG).reduce((s, v) => s + (Number(v) || 0), 0));
  const totalAMO = round2(Object.values(montantsAMO).reduce((s, v) => s + (Number(v) || 0), 0));
  const totalGlobal = round2((inclureRG ? totalRG : 0) + (inclureAMO ? totalAMO : 0));

  // Scan : lecture du bordereau (image/PDF) entièrement dans le navigateur
  // (même moteur que le scan de factures), puis extraction des champs
  // identifiables sur ces formulaires — à vérifier avant enregistrement,
  // comme pour le scan de factures.
  async function handleScan() {
    if (!file) return;
    setError('');
    setScanning(true);
    setStatus('Lecture du document…');
    try {
      const { text } = await extractDocument(file, { onStatus: setStatus });
      const masseMatch = text.match(/(\d[\d\s]*[.,]\d{2})\s*(?:%|\n|masses? salariales?)/i) || text.match(/Masses?\s*Salariales?[\s\S]{0,30}?(\d[\d\s]*[.,]\d{2})/i);
      const raisonMatch = text.match(/Raison sociale\s*:?\s*\n?\s*([A-Z0-9 &._-]{3,60})/i);
      const periodeMatch = text.match(/VERSEMENT DU MOIS DE\s*\n?\s*([a-zûéèA-Z]+\s*\d{4})/i);
      const montantGlobalMatch = text.match(/Montant global (?:de l['e]|d['e]sement|du versement)[\s\S]{0,40}?(\d[\d\s]*[.,]\d{2})/i);
      const isAmo = /AMO|Assurance Maladie Obligatoire/i.test(text);

      const parseNum = (s) => (s ? Number(s.replace(/\s/g, '').replace(',', '.')) : null);
      const masse = parseNum(masseMatch?.[1]);
      const montantGlobal = parseNum(montantGlobalMatch?.[1]);

      if (isAmo) {
        if (masse) setMasseAMO(String(masse));
        else if (montantGlobal) setMontantsAMO({ cotisation_amo: montantGlobal });
      } else {
        if (masse) setMasseRG(String(masse));
        else if (montantGlobal) setMontantsRG({ prestations_sociales: montantGlobal });
      }
      if (periodeMatch) setPeriode(periodeMatch[1].trim());
      if (raisonMatch) setReference((r) => r || raisonMatch[1].trim());
      setMode('manuel');
      setMessage("Champs détectés — vérifiez les montants ci-dessous avant d'enregistrer (la lecture automatique peut être imprécise).");
    } catch (err) {
      setError(`Échec de la lecture du document : ${err.message}`);
    } finally {
      setScanning(false);
      setStatus('');
    }
  }

  async function handleSave(force = false) {
    setError('');
    setMessage('');
    if (!compteTresorNumero) return setError('Sélectionnez le compte de trésorerie (banque/caisse) réglé.');
    if (!activeFiscalYear) return setError('Aucun exercice comptable actif pour cette société.');
    if (totalGlobal <= 0) return setError('Le montant global du versement doit être supérieur à 0.');
    setSaving(true);
    try {
      await api.createPaiementCnss(activeCompany.id, {
        fiscal_year_id: activeFiscalYear.id,
        date_paiement: datePaiement,
        montant: totalGlobal,
        compte_tresor_numero: compteTresorNumero,
        reference,
        periode: periode.trim() || null,
        libelle: `Règlement CNSS${periode ? ' - ' + periode : ''}`,
        force,
      });
      setMessage('Paiement CNSS/AMO enregistré — visible dans Écritures comptables.');
      setConfirmDoublon(null);
      loadHistorique();
    } catch (err) {
      if (err.status === 409 && err.data) {
        // La CNSS pour cette période a déjà été soldée : on n'enregistre pas
        // automatiquement, on demande une confirmation explicite et distincte
        // du bouton normal avant de permettre un éventuel complément volontaire.
        setConfirmDoublon(err.data);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  return (
    <div>
      <div className="page-header no-print">
        <h1>CNSS / AMO</h1>
        <p>Bordereau de cotisations : saisie manuelle (calcul automatique aux taux publiés) ou scan du document.</p>
        <p className="text-muted" style={{ fontSize: 12.5 }}>
          Journal : <strong>CN — CNSS / AMO</strong> (toujours séparé du relevé bancaire dans les écritures comptables).
        </p>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${mode === 'manuel' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('manuel')}>Saisie manuelle</button>
        <button className={`btn ${mode === 'scan' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('scan')}>Scanner le bordereau</button>
      </div>

      {mode === 'scan' && (
        <div className="card no-print">
          <h2>Scanner le bordereau CNSS</h2>
          <p className="text-muted">Photo ou PDF du bordereau (Régime Général ou AMO). Les champs détectés préremplissent le formulaire ci-dessous — à vérifier avant enregistrement.</p>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn btn-primary mt-24" onClick={handleScan} disabled={!file || scanning}>
            {scanning ? `Analyse en cours… ${status}` : 'Analyser le bordereau'}
          </button>
        </div>
      )}

      <div className="card no-print">
        <div className="grid-3">
          <div className="field">
            <label>Période (mois versé)</label>
            <input value={periode} onChange={(e) => setPeriode(e.target.value)} placeholder="ex: juin 2026" />
          </div>
          <div className="field">
            <label>Date paiement</label>
            <DateInputFR value={datePaiement} onChange={(e) => setDatePaiement(e.target.value)} />
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
        <div className="field" style={{ maxWidth: 300 }}>
          <label>Référence (n° affilié / raison sociale)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>

        <div className="grid-2" style={{ marginTop: 12 }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={inclureRG} onChange={(e) => setInclureRG(e.target.checked)} /> Régime Général
            </label>
            {inclureRG && (
              <BordereauForm
                titre="" taux={TAUX_REGIME_GENERAL} masseSalariale={masseRG} setMasseSalariale={setMasseRG}
                montants={montantsRG} setMontant={(k, v) => setMontantsRG((m) => ({ ...m, [k]: v }))}
              />
            )}
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={inclureAMO} onChange={(e) => setInclureAMO(e.target.checked)} /> AMO (Assurance Maladie Obligatoire)
            </label>
            {inclureAMO && (
              <BordereauForm
                titre="" taux={TAUX_AMO} masseSalariale={masseAMO} setMasseSalariale={setMasseAMO}
                montants={montantsAMO} setMontant={(k, v) => setMontantsAMO((m) => ({ ...m, [k]: v }))}
              />
            )}
          </div>
        </div>

        <div className="flex-between mt-24" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Montant global du versement : {totalGlobal.toFixed(2)} DH</div>
          <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le paiement'}</button>
        </div>
        {historique.total > 0 && (
          <div className="alert alert-notice mt-24">
            ⚠️ La période « {periode} » a déjà été réglée pour {historique.total.toFixed(2)} DH (le {formatDateFR(historique.reglements[0]?.date_ecriture)}). Vérifiez le montant restant avant d'enregistrer un nouveau règlement pour éviter un double solde.
          </div>
        )}
        {confirmDoublon && (
          <div className="alert alert-error mt-24">
            <div>{confirmDoublon.error}</div>
            <button
              type="button"
              className="btn btn-ghost mt-24"
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              Enregistrer quand même (complément volontaire)
            </button>
            <button type="button" className="btn btn-ghost mt-24" style={{ marginLeft: 8 }} onClick={() => setConfirmDoublon(null)}>
              Annuler
            </button>
          </div>
        )}
        {error && <div className="alert alert-error mt-24">{error}</div>}
        {message && <div className="alert alert-notice mt-24">{message}</div>}
      </div>
    </div>
  );
}
