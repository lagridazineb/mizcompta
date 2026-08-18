import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { formatDateFR } from '../utils/dateFr';
import CompanySelectGate from '../components/CompanySelectGate';
import PrintHeader from '../components/PrintHeader';
import DownloadMenu from '../components/DownloadMenu';
import DateInputFR from '../components/DateInputFR';

const MOIS = [
  { v: '01', l: 'Janvier' }, { v: '02', l: 'Février' }, { v: '03', l: 'Mars' },
  { v: '04', l: 'Avril' }, { v: '05', l: 'Mai' }, { v: '06', l: 'Juin' },
  { v: '07', l: 'Juillet' }, { v: '08', l: 'Août' }, { v: '09', l: 'Septembre' },
  { v: '10', l: 'Octobre' }, { v: '11', l: 'Novembre' }, { v: '12', l: 'Décembre' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function journalInfo(numero) {
  if (!numero) return { code: '', libelle: '' };
  return numero.startsWith('516') ? { code: 'CA', libelle: 'Journal de caisse' } : { code: 'BQ', libelle: 'Journal de banque' };
}

const emptyLigne = () => ({
  date_ecriture: todayISO(),
  compte_numero: '',
  libelle: '',
  remise_numero: '',
  libelle_banque: '',
  debit: '',
  credit: '',
  piece_cheque: '',
  numero_facture: '',
});

function SaisieReleveBancaireContent() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const now = new Date();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [mois, setMois] = useState(searchParams.get('mois') || String(now.getMonth() + 1).padStart(2, '0'));
  const [annee, setAnnee] = useState(searchParams.get('annee') || String(now.getFullYear()));
  const [compteNumero, setCompteNumero] = useState(searchParams.get('compte') || '');

  const [fraisChecked, setFraisChecked] = useState(false);
  const [virementChecked, setVirementChecked] = useState(false);

  const [frais, setFrais] = useState({ compte_charge_numero: '', montant: '', libelle: 'Frais et commissions sur services bancaires', date_ecriture: todayISO() });
  const [virement, setVirement] = useState({ sourceType: 'caisse', compte_source_numero: '', destType: 'banque', compte_destinataire_numero: '', montant: '', date_ecriture: todayISO() });

  const [releve, setReleve] = useState(null);
  const [cheques, setCheques] = useState([]);
  const [ligneForm, setLigneForm] = useState(emptyLigne());
  // Édition d'une ligne existante (bouton "Modifier") : on enregistre l'id de
  // l'écriture en cours d'édition — la sauvegarde met à jour cette écriture
  // au lieu d'en créer une nouvelle, pour ne jamais dupliquer.
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingLoading, setEditingLoading] = useState(false);
  // Refs pour tous les champs de la ligne de saisie rapide (façon tableur) :
  // permet de passer d'un champ à l'autre avec la touche Entrée, comme dans
  // le logiciel de bureau.
  const dateLigneRef = useRef(null);
  const compteLigneRef = useRef(null);
  const libelleLigneRef = useRef(null);
  const remiseLigneRef = useRef(null);
  const libelleBanqueLigneRef = useRef(null);
  const debitLigneRef = useRef(null);
  const creditLigneRef = useRef(null);
  const pieceLigneRef = useRef(null);
  const factureLigneRef = useRef(null);
  const ligneFieldOrder = [
    dateLigneRef, compteLigneRef, libelleLigneRef, remiseLigneRef,
    libelleBanqueLigneRef, debitLigneRef, creditLigneRef, pieceLigneRef, factureLigneRef,
  ];
  // Au Entrée dans un champ de la ligne, passe au suivant ; sur le dernier
  // champ, Entrée soumet la ligne (comme un tableur).
  function focusNextLigneField(currentRef) {
    return (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const idx = ligneFieldOrder.indexOf(currentRef);
      const next = ligneFieldOrder[idx + 1];
      if (next && next.current) {
        next.current.focus();
        next.current.select?.();
      } else {
        e.target.form?.requestSubmit();
      }
    };
  }

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeCompany) return;
    api.getAccounts(activeCompany.id).then(setAccounts);
    api.getChequesEnAttente(activeCompany.id).then(setCheques);
  }, [activeCompany]);

  // Noms des associés (Bilan > T13 "Etat de répartition du capital social")
  // — utilisés pour reconnaître un virement du gérant/associé dans le
  // libellé du relevé et le router automatiquement vers le compte courant
  // associé (4463).
  const [nomsAssocies, setNomsAssocies] = useState([]);
  useEffect(() => {
    if (!activeCompany || !activeFiscalYear) return;
    api.getEtatsAnnexes(activeCompany.id, activeFiscalYear.id)
      .then((res) => {
        const noms = (res?.tableaux?.T13 || []).map((l) => (l.nom_associe || '').trim()).filter(Boolean);
        setNomsAssocies(noms);
      })
      .catch(() => setNomsAssocies([]));
  }, [activeCompany, activeFiscalYear]);

  // ---------------------------------------------------------------------
  // Détection automatique du type de mouvement à partir du libellé saisi
  // (ou copié depuis le relevé bancaire), comme demandé : commission ->
  // 61473 (Frais Bancaires), CNSS -> 4441 (partie CNSS/AMO), virement ou
  // retrait espèces -> Virement de Fond (caisse <-> banque), chèque impayé
  // -> 3488, virement du gérant/associé -> 4463 (compte courant associé).
  // Pour les cas qui changent de section (frais/CNSS/virement de fond), on
  // affiche une suggestion à confirmer d'un clic plutôt que de basculer
  // sans prévenir. Pour les cas qui restent dans la ligne normale (chèque
  // impayé, gérant), le compte est prérempli directement.
  // ---------------------------------------------------------------------
  function trouverCompte(prefixe) {
    return accounts.find((a) => a.numero.startsWith(prefixe))?.numero || '';
  }
  function detecterMouvement(texte) {
    const t = (texte || '').toLowerCase();
    if (!t.trim()) return null;
    if (/commission|agios?\b|frais de tenue/i.test(t)) {
      return { type: 'frais', compte: trouverCompte('61473') || '61473', label: 'Commission bancaire', cible: 'Frais Bancaires (compte 61473)' };
    }
    if (/\bcnss\b/i.test(t)) {
      return { type: 'cnss', compte: trouverCompte('4441') || '4441', label: 'Cotisation CNSS', cible: 'écran CNSS / AMO (compte 4441)' };
    }
    if (/impay[ée]|rejet[ée]?/i.test(t)) {
      return { type: 'compte-direct', compte: trouverCompte('3488') || '3488', label: 'Chèque impayé', cible: 'compte 3488' };
    }
    if (/retrait/i.test(t)) {
      return { type: 'virement', sens: 'banque-caisse', label: 'Retrait (chèque/espèces/GAB)', cible: 'Virement de Fond (Banque → Caisse)' };
    }
    if (/vir(ement)?\s*esp|remise\s*esp|d[ée]p[oô]t\s*esp/i.test(t)) {
      return { type: 'virement', sens: 'caisse-banque', label: 'Virement espèces', cible: 'Virement de Fond (Caisse → Banque)' };
    }
    const associe = nomsAssocies.find((n) => n && t.includes(n.toLowerCase()));
    if (associe || /g[ée]rant/i.test(t)) {
      return { type: 'compte-direct', compte: trouverCompte('4463') || '4463', label: `Virement du gérant${associe ? ' (' + associe + ')' : ''}`, cible: 'compte courant associé 4463' };
    }
    return null;
  }

  const [detection, setDetection] = useState(null);
  const [detectionIgnoree, setDetectionIgnoree] = useState('');
  useEffect(() => {
    const texte = `${ligneForm.libelle} ${ligneForm.libelle_banque}`.trim();
    if (!texte || fraisChecked || virementChecked) { setDetection(null); return; }
    const timer = setTimeout(() => {
      const d = detecterMouvement(texte);
      if (d && d.type === 'compte-direct') {
        // Cas simple : on préremplit directement le champ Compte de la ligne
        // en cours, sans changer de section (réversible, l'utilisateur peut
        // toujours retaper autre chose).
        setLigneForm((f) => (f.compte_numero ? f : { ...f, compte_numero: d.compte }));
        setDetection(null);
      } else if (d && texte !== detectionIgnoree) {
        setDetection(d);
      } else if (!d) {
        setDetection(null);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligneForm.libelle, ligneForm.libelle_banque, fraisChecked, virementChecked, accounts, nomsAssocies]);

  function appliquerDetection() {
    if (!detection) return;
    if (detection.type === 'frais') {
      setFraisChecked(true);
      setVirementChecked(false);
      setFrais((f) => ({
        ...f,
        compte_charge_numero: detection.compte,
        montant: ligneForm.debit || ligneForm.credit || f.montant,
        libelle: ligneForm.libelle || f.libelle,
        date_ecriture: ligneForm.date_ecriture || f.date_ecriture,
      }));
      setLigneForm(emptyLigne());
    } else if (detection.type === 'cnss') {
      navigate('/cnss');
    } else if (detection.type === 'virement') {
      const caisseNum = autoCompte('caisse', comptesCaisse);
      setVirementChecked(true);
      setFraisChecked(false);
      setVirement((v) => ({
        ...v,
        compte_source_numero: detection.sens === 'caisse-banque' ? caisseNum : compteNumero,
        compte_destinataire_numero: detection.sens === 'caisse-banque' ? compteNumero : caisseNum,
        montant: ligneForm.debit || ligneForm.credit || v.montant,
        date_ecriture: ligneForm.date_ecriture || v.date_ecriture,
      }));
      setLigneForm(emptyLigne());
    }
    setDetection(null);
  }
  function ignorerDetection() {
    setDetectionIgnoree(`${ligneForm.libelle} ${ligneForm.libelle_banque}`.trim());
    setDetection(null);
  }

  const comptesTresorerie = useMemo(
    () => accounts.filter((a) => a.classe === 5 && (a.numero.startsWith('511') || a.numero.startsWith('514') || a.numero.startsWith('516'))),
    [accounts]
  );
  const comptesCaisse = useMemo(() => comptesTresorerie.filter((a) => a.numero.startsWith('516')), [comptesTresorerie]);
  const comptesBanque = useMemo(() => comptesTresorerie.filter((a) => !a.numero.startsWith('516')), [comptesTresorerie]);

  // Comme dans le logiciel de bureau, la grille de saisie (compte, journal,
  // tableau des lignes) s'affiche directement à l'ouverture de l'écran : on
  // présélectionne automatiquement le premier compte banque (514…), sinon le
  // premier compte de trésorerie disponible, sans attendre un choix manuel.
  useEffect(() => {
    if (compteNumero || comptesTresorerie.length === 0) return;
    const defaut = comptesBanque.find((a) => a.numero === '5141')?.numero || comptesBanque[0]?.numero || comptesTresorerie[0]?.numero || '';
    if (defaut) setCompteNumero(defaut);
  }, [comptesTresorerie, comptesBanque, compteNumero]);

  // Présélectionne automatiquement le compte banque (5141) ou caisse (5161)
  // dès qu'on clique "Banque"/"Caisse" — l'utilisateur peut toujours changer
  // ensuite si plusieurs comptes banque existent.
  function autoCompte(type, list) {
    const prefixe = type === 'caisse' ? '5161' : '5141';
    return list.find((a) => a.numero === prefixe)?.numero || list[0]?.numero || '';
  }

  const compteActif = useMemo(() => accounts.find((a) => a.numero === compteNumero), [accounts, compteNumero]);
  const journal = journalInfo(compteNumero);

  const loadReleve = useCallback(async () => {
    if (!activeCompany || !compteNumero) return;
    const data = await api.getReleveLignes(activeCompany.id, {
      compte_numero: compteNumero,
      mois: String(Number(mois)),
      annee,
      ...(activeFiscalYear ? { fiscal_year_id: activeFiscalYear.id } : {}),
    });
    setReleve(data);
  }, [activeCompany, compteNumero, mois, annee, activeFiscalYear]);

  useEffect(() => {
    loadReleve();
  }, [loadReleve]);

  function refreshAll() {
    loadReleve();
    api.getChequesEnAttente(activeCompany.id).then(setCheques);
    api.getAccounts(activeCompany.id).then(setAccounts);
  }

  // Après un enregistrement, on cale le filtre Mois/Année sur la date de la
  // ligne qui vient d'être saisie : sinon, si elle tombe hors de la période
  // actuellement affichée, elle semble "ne pas apparaître dans le Relevé
  // Bancaire" alors qu'elle a bien été enregistrée (visible dans Par Pièce).
  function syncPeriode(dateStr) {
    if (!dateStr) return;
    const [y, m] = dateStr.split('-');
    setAnnee(y);
    setMois(m);
  }

  async function handleSaveFrais(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!compteNumero) return setError('Sélectionnez d\'abord le Compte Comptable (compte bancaire/caisse) en haut de l\'écran.');
    if (!frais.compte_charge_numero || !frais.montant) return setError('Compte et montant sont requis pour les frais bancaires.');
    if (!activeFiscalYear) return setError('Aucun exercice comptable actif pour cette société.');
    setSaving(true);
    try {
      await api.createReleveFrais(activeCompany.id, {
        compte_tresor_numero: compteNumero,
        compte_charge_numero: frais.compte_charge_numero,
        montant: Number(frais.montant),
        libelle: frais.libelle,
        date_ecriture: frais.date_ecriture,
        fiscal_year_id: activeFiscalYear.id,
      });
      setMessage('Frais bancaires enregistrés.');
      setFrais({ ...frais, compte_charge_numero: '', montant: '' });
      syncPeriode(frais.date_ecriture);
      refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVirement(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!virement.compte_source_numero || !virement.compte_destinataire_numero || !virement.montant) {
      return setError('Compte source, compte destinataire et montant sont requis pour le virement de fonds.');
    }
    if (!activeFiscalYear) return setError('Aucun exercice comptable actif pour cette société.');
    setSaving(true);
    try {
      await api.createReleveVirement(activeCompany.id, {
        compte_source_numero: virement.compte_source_numero,
        compte_destinataire_numero: virement.compte_destinataire_numero,
        montant: Number(virement.montant),
        date_ecriture: virement.date_ecriture,
        fiscal_year_id: activeFiscalYear.id,
      });
      setMessage('Virement de fonds enregistré (caisse ↔ banque).');
      setVirement({ ...virement, compte_source_numero: '', compte_destinataire_numero: '', montant: '' });
      syncPeriode(virement.date_ecriture);
      refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLigne(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!compteNumero) return setError('Sélectionnez d\'abord le Compte Comptable (compte bancaire/caisse) en haut de l\'écran.');
    if (!ligneForm.debit && !ligneForm.credit) return setError('Indiquez un montant au débit ou au crédit.');
    if (!activeFiscalYear) return setError('Aucun exercice comptable actif pour cette société.');
    setSaving(true);
    try {
      if (editingEntryId) {
        // Modification d'une ligne existante : on met à jour la même écriture,
        // on n'en crée jamais une nouvelle (pas de doublon dans Écritures).
        await api.updateReleveLigne(activeCompany.id, editingEntryId, {
          compte_tresor_numero: compteNumero,
          compte_numero: ligneForm.compte_numero,
          date_ecriture: ligneForm.date_ecriture,
          libelle: ligneForm.libelle,
          remise_numero: ligneForm.remise_numero,
          libelle_banque: ligneForm.libelle_banque,
          debit: Number(ligneForm.debit) || 0,
          credit: Number(ligneForm.credit) || 0,
          numero_facture: ligneForm.numero_facture,
        });
        setMessage('Ligne du relevé modifiée.');
        setEditingEntryId(null);
        syncPeriode(ligneForm.date_ecriture);
        setLigneForm(emptyLigne());
        refreshAll();
        return;
      }
      const res = await api.createReleveLigne(activeCompany.id, {
        compte_tresor_numero: compteNumero,
        compte_numero: ligneForm.compte_numero,
        date_ecriture: ligneForm.date_ecriture,
        libelle: ligneForm.libelle,
        remise_numero: ligneForm.remise_numero,
        libelle_banque: ligneForm.libelle_banque,
        debit: Number(ligneForm.debit) || 0,
        credit: Number(ligneForm.credit) || 0,
        piece_cheque: ligneForm.piece_cheque,
        numero_facture: ligneForm.numero_facture,
        fiscal_year_id: activeFiscalYear.id,
      });
      setMessage(
        res.rapproche
          ? `Ligne enregistrée — le chèque n°${ligneForm.piece_cheque} a été rapproché : la facture correspondante est désormais soldée (5 lignes : facture, règlement fournisseur, chèque en attente, attente soldée, relevé bancaire).`
          : 'Ligne du relevé enregistrée.'
      );
      syncPeriode(ligneForm.date_ecriture);
      setLigneForm(emptyLigne());
      refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Charge une ligne existante dans le formulaire pour modification (au lieu
  // de la supprimer puis la resaisir) — récupère le compte de contrepartie
  // réel, absent de la liste affichée (qui ne montre que le côté banque/caisse).
  async function handleEditLigne(l) {
    setError('');
    setMessage('');
    setEditingLoading(true);
    // La grille de saisie (où vit le formulaire d'édition) n'est visible que
    // lorsque ni "Frais Bancaires" ni "Virement de Fond" n'est coché.
    setFraisChecked(false);
    setVirementChecked(false);
    try {
      const detail = await api.getReleveLigneDetail(activeCompany.id, l.entry_id);
      const ligneTresor = detail.lignes[0];
      const ligneContrepartie = detail.lignes[1];
      setLigneForm({
        date_ecriture: detail.date_ecriture,
        compte_numero: ligneContrepartie?.account_numero || '',
        libelle: ligneTresor?.libelle || detail.libelle || '',
        libelleAuto: false,
        remise_numero: ligneTresor?.remise_numero || '',
        libelle_banque: ligneTresor?.libelle_banque || '',
        debit: ligneTresor?.debit ? String(ligneTresor.debit) : '',
        credit: ligneTresor?.credit ? String(ligneTresor.credit) : '',
        piece_cheque: ligneTresor?.piece_reglement || '',
        numero_facture: ligneTresor?.numero_facture_ref || '',
      });
      setEditingEntryId(detail.id);
      compteLigneRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setEditingLoading(false);
    }
  }

  function handleCancelEdit() {
    setEditingEntryId(null);
    setLigneForm(emptyLigne());
    setError('');
  }

  async function handleDeleteLigne(entryId) {
    if (!window.confirm('Supprimer cette écriture ?')) return;
    try {
      await api.deleteEntry(entryId);
      refreshAll();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!activeCompany) return null;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Saisie Relevé Bancaire</h1>
        <p>Frais bancaires, virements de fonds (caisse ↔ banque) et saisie ligne à ligne du relevé, avec rapprochement automatique des chèques.</p>
      </div>

      {/* --- En-tête : Mois / Année / Compte Comptable / Journal --- */}
      <div className="card no-print">
        <div className="grid-3">
          <div className="field">
            <label>Mois</label>
            <select value={mois} onChange={(e) => setMois(e.target.value)}>
              {MOIS.map((m) => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Année</label>
            <input type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} />
          </div>
          <div className="field">
            <label>Compte Comptable</label>
            <select value={compteNumero} onChange={(e) => setCompteNumero(e.target.value)}>
              <option value="">Sélectionner…</option>
              {comptesTresorerie.map((a) => (
                <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
              ))}
            </select>
          </div>
        </div>
        {compteActif && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 12px',
              background: 'rgba(201,160,90,0.10)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 12.5,
            }}
          >
            <span><strong>{compteActif.intitule}</strong></span>
            <span>
              Journal&nbsp;: <strong>{journal.code}</strong> — {journal.libelle}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={fraisChecked} onChange={(e) => { setFraisChecked(e.target.checked); if (e.target.checked) setVirementChecked(false); }} />
            Frais Bancaires
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={virementChecked} onChange={(e) => { setVirementChecked(e.target.checked); if (e.target.checked) setFraisChecked(false); }} />
            Virement de Fond
          </label>
        </div>

        {error && <div className="alert alert-error mt-24">{error}</div>}
        {message && <div className="alert alert-notice mt-24">{message}</div>}
      </div>

      {/* --- Frais Bancaires --- */}
      {fraisChecked && (
        <form className="card no-print" onSubmit={handleSaveFrais}>
          <h2>Frais Bancaires</h2>
          <p className="text-muted">Le compte de charge doit être un compte de classe 6 (charges).</p>
          <div className="grid-3">
            <div className="field">
              <label>Compte de charge (classe 6)</label>
              <select value={frais.compte_charge_numero} onChange={(e) => setFrais({ ...frais, compte_charge_numero: e.target.value })}>
                <option value="">Sélectionner…</option>
                {accounts.filter((a) => a.classe === 6).map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Montant (Dhs)</label>
              <input type="number" step="0.01" className="num" value={frais.montant} onChange={(e) => setFrais({ ...frais, montant: e.target.value })} />
            </div>
            <div className="field">
              <label>Date</label>
              <DateInputFR value={frais.date_ecriture} onChange={(e) => setFrais({ ...frais, date_ecriture: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Libellé</label>
            <input value={frais.libelle} onChange={(e) => setFrais({ ...frais, libelle: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={saving}>Enregistrer (F3)</button>
        </form>
      )}
      {fraisChecked && releve && (
        <div className="card no-print">
          <h2 style={{ fontSize: 14 }}>Frais bancaires déjà enregistrés sur la période (détectés ou saisis)</h2>
          <table className="ledger">
            <thead>
              <tr><th>Date</th><th>Libellé</th><th>Compte</th><th className="num">Montant</th></tr>
            </thead>
            <tbody>
              {releve.lignes.filter((l) => (l.compte_contrepartie_numero || '').startsWith('6147')).map((l) => (
                <tr key={l.ligne_id}>
                  <td>{formatDateFR(l.date_ecriture)}</td>
                  <td>{l.libelle || l.libelle_ecriture}</td>
                  <td>{l.compte_contrepartie_numero}</td>
                  <td className="num">{(l.debit || l.credit).toFixed(2)}</td>
                </tr>
              ))}
              {releve.lignes.filter((l) => (l.compte_contrepartie_numero || '').startsWith('6147')).length === 0 && (
                <tr><td colSpan={4} className="text-muted">Aucun frais bancaire sur cette période pour ce compte.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {virementChecked && (
        <form className="card no-print" onSubmit={handleSaveVirement}>
          <h2>Virement de Fond</h2>
          <p className="text-muted">
            Virement de la caisse à la banque, ou de la banque à la caisse, d'un montant de {round2(virement.montant).toFixed(2)} Dhs — transite par le compte transitoire 5115.
          </p>
          <div className="grid-2">
            <div className="card" style={{ background: 'var(--ink-800)', boxShadow: 'none' }}>
              <h2 style={{ fontSize: 14 }}>Compte Source</h2>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={virement.sourceType === 'caisse'} onChange={() => setVirement({ ...virement, sourceType: 'caisse', compte_source_numero: autoCompte('caisse', comptesCaisse) })} />
                  Caisse
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={virement.sourceType === 'banque'} onChange={() => setVirement({ ...virement, sourceType: 'banque', compte_source_numero: autoCompte('banque', comptesBanque) })} />
                  Banque
                </label>
              </div>
              <select value={virement.compte_source_numero} onChange={(e) => setVirement({ ...virement, compte_source_numero: e.target.value })}>
                <option value="">Sélectionner…</option>
                {(virement.sourceType === 'caisse' ? comptesCaisse : comptesBanque).map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
            <div className="card" style={{ background: 'var(--ink-800)', boxShadow: 'none' }}>
              <h2 style={{ fontSize: 14 }}>Compte Destinataire</h2>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={virement.destType === 'caisse'} onChange={() => setVirement({ ...virement, destType: 'caisse', compte_destinataire_numero: autoCompte('caisse', comptesCaisse) })} />
                  Caisse
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={virement.destType === 'banque'} onChange={() => setVirement({ ...virement, destType: 'banque', compte_destinataire_numero: autoCompte('banque', comptesBanque) })} />
                  Banque
                </label>
              </div>
              <select value={virement.compte_destinataire_numero} onChange={(e) => setVirement({ ...virement, compte_destinataire_numero: e.target.value })}>
                <option value="">Sélectionner…</option>
                {(virement.destType === 'caisse' ? comptesCaisse : comptesBanque).map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid-3 mt-24">
            <div className="field">
              <label>Compte Transitoire</label>
              <input disabled value="5115 — Virement de fonds" />
            </div>
            <div className="field">
              <label>Montant (Dhs)</label>
              <input type="number" step="0.01" className="num" value={virement.montant} onChange={(e) => setVirement({ ...virement, montant: e.target.value })} />
            </div>
            <div className="field">
              <label>Date</label>
              <DateInputFR value={virement.date_ecriture} onChange={(e) => setVirement({ ...virement, date_ecriture: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={saving}>Enregistrer (F3)</button>
        </form>
      )}
      {virementChecked && releve && (
        <div className="card no-print">
          <h2 style={{ fontSize: 14 }}>Virements de fonds déjà enregistrés sur la période (détectés ou saisis)</h2>
          <table className="ledger">
            <thead>
              <tr><th>Date</th><th>Libellé</th><th className="num">Montant</th></tr>
            </thead>
            <tbody>
              {releve.lignes.filter((l) => (l.compte_contrepartie_numero || '') === '5115').map((l) => (
                <tr key={l.ligne_id}>
                  <td>{formatDateFR(l.date_ecriture)}</td>
                  <td>{l.libelle || l.libelle_ecriture}</td>
                  <td className="num">{(l.debit || l.credit).toFixed(2)}</td>
                </tr>
              ))}
              {releve.lignes.filter((l) => (l.compte_contrepartie_numero || '') === '5115').length === 0 && (
                <tr><td colSpan={3} className="text-muted">Aucun virement de fonds sur cette période pour ce compte.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Chèques en attente d'encaissement --- */}
      {!fraisChecked && !virementChecked && compteNumero && cheques.length > 0 && (
        <div className="card no-print">
          <h2 style={{ fontSize: 14 }}>Chèques en attente d'encaissement (à rapprocher via "Pièce N° (Chèque)")</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Date</th><th>Tiers</th><th>Pièce N°</th><th>Compte cible</th><th className="num">Montant</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => (
                <tr key={c.ligne_id}>
                  <td>{formatDateFR(c.date_ecriture)}</td>
                  <td>{c.tiers || '—'}</td>
                  <td>{c.piece_reglement || '—'}</td>
                  <td>{c.compte_cible_numero || '—'}</td>
                  <td className="num">{round2(c.debit || c.credit).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Relevé du compte (grille + impression façon Grand Livre) --- */}
      {compteNumero && (
        <div className="card">
          <div className="flex-between no-print">
            <h2>
              Relevé — {compteActif ? `${compteActif.numero} ${compteActif.intitule}` : compteNumero} ({MOIS.find((m) => m.v === mois)?.l} {annee})
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <DownloadMenu
                onDownload={(format) =>
                  api.downloadReleve(
                    activeCompany.id,
                    { compte_numero: compteNumero, mois: String(Number(mois)), annee, ...(activeFiscalYear ? { fiscal_year_id: activeFiscalYear.id } : {}) },
                    format
                  )
                }
              />
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
            </div>
          </div>
          <PrintHeader
            company={activeCompany}
            title="RELEVÉ BANCAIRE — SAISIE"
            periodeDebut={`${annee}-${mois}-01`}
            periodeFin={`${annee}-${mois}-${String(new Date(Number(annee), Number(mois), 0).getDate()).padStart(2, '0')}`}
            compte={compteActif ? `${compteActif.numero}   ${compteActif.intitule}` : compteNumero}
          />
          {!fraisChecked && !virementChecked && (
            <p className="text-muted no-print" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>
              Saisissez directement la ligne dans le tableau ci-dessous : Compte, Débit ou Crédit, etc. Appuyez sur{' '}
              <strong>Entrée</strong> pour passer d'un champ au suivant, jusqu'à <strong>{editingEntryId ? 'Enregistrer les modifications' : 'Ajouter la ligne'}</strong>.
              Le compte de contrepartie (classes 1 à 8) équilibre l'écriture.
            </p>
          )}
          {detection && (
            <div className="alert alert-notice no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>🔎 Détecté : <strong>{detection.label}</strong> → {detection.cible}</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn btn-primary btn-tiny" onClick={appliquerDetection}>Utiliser</button>
                <button type="button" className="btn btn-ghost btn-tiny" style={{ marginLeft: 6 }} onClick={ignorerDetection}>Ignorer</button>
              </span>
            </div>
          )}
          {releve && (
            <>
              <form onSubmit={handleSaveLigne}>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>JR</th><th>Date</th><th>Compte</th><th>Libellé</th><th>Remise N°</th><th>Libellé Banque</th>
                    <th className="num">Débit</th><th className="num">Crédit</th><th>Pièce N° (Chèque)</th><th>N° Facture</th><th className="num">Solde</th>
                    <th className="no-print"></th>
                  </tr>
                </thead>
                <tbody>
                  {!fraisChecked && !virementChecked && (
                    <tr className="no-print" style={{ background: 'rgba(201,160,90,0.10)' }}>
                      <td style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{journal.code}</td>
                      <td>
                        <DateInputFR
                          ref={dateLigneRef}
                          value={ligneForm.date_ecriture}
                          onChange={(e) => setLigneForm({ ...ligneForm, date_ecriture: e.target.value })}
                          onKeyDown={focusNextLigneField(dateLigneRef)}
                          style={{ minWidth: 130 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={compteLigneRef}
                          list="comptes-releve-datalist"
                          value={ligneForm.compte_numero}
                          placeholder="N° compte…"
                          onChange={(e) => {
                            const numero = e.target.value;
                            const compte = accounts.find((a) => a.numero === numero);
                            setLigneForm((f) => ({
                              ...f,
                              compte_numero: numero,
                              // Le libellé se remplit automatiquement avec l'intitulé du compte
                              // choisi, tant que l'utilisateur ne l'a pas déjà modifié à la main.
                              libelle: compte && (!f.libelle || f.libelleAuto) ? compte.intitule : f.libelle,
                              libelleAuto: !!compte,
                            }));
                          }}
                          onKeyDown={focusNextLigneField(compteLigneRef)}
                          style={{ minWidth: 110 }}
                        />
                        <datalist id="comptes-releve-datalist">
                          {accounts.map((a) => (
                            <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                          ))}
                        </datalist>
                      </td>
                      <td>
                        <input
                          ref={libelleLigneRef}
                          value={ligneForm.libelle}
                          onChange={(e) => setLigneForm({ ...ligneForm, libelle: e.target.value, libelleAuto: false })}
                          onKeyDown={focusNextLigneField(libelleLigneRef)}
                          style={{ minWidth: 140 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={remiseLigneRef}
                          value={ligneForm.remise_numero}
                          onChange={(e) => setLigneForm({ ...ligneForm, remise_numero: e.target.value })}
                          onKeyDown={focusNextLigneField(remiseLigneRef)}
                          style={{ minWidth: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={libelleBanqueLigneRef}
                          value={ligneForm.libelle_banque}
                          onChange={(e) => setLigneForm({ ...ligneForm, libelle_banque: e.target.value })}
                          onKeyDown={focusNextLigneField(libelleBanqueLigneRef)}
                          style={{ minWidth: 120 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={debitLigneRef}
                          type="number"
                          step="0.01"
                          className="num"
                          value={ligneForm.debit}
                          onChange={(e) => setLigneForm({ ...ligneForm, debit: e.target.value, credit: '' })}
                          onKeyDown={focusNextLigneField(debitLigneRef)}
                          style={{ minWidth: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={creditLigneRef}
                          type="number"
                          step="0.01"
                          className="num"
                          value={ligneForm.credit}
                          onChange={(e) => setLigneForm({ ...ligneForm, credit: e.target.value, debit: '' })}
                          onKeyDown={focusNextLigneField(creditLigneRef)}
                          style={{ minWidth: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={pieceLigneRef}
                          value={ligneForm.piece_cheque}
                          placeholder="N° chèque"
                          onChange={(e) => setLigneForm({ ...ligneForm, piece_cheque: e.target.value })}
                          onKeyDown={focusNextLigneField(pieceLigneRef)}
                          style={{ minWidth: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          ref={factureLigneRef}
                          value={ligneForm.numero_facture}
                          onChange={(e) => setLigneForm({ ...ligneForm, numero_facture: e.target.value })}
                          onKeyDown={focusNextLigneField(factureLigneRef)}
                          style={{ minWidth: 90 }}
                        />
                      </td>
                      <td className="num text-muted">—</td>
                      <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                        <button type="submit" className="btn btn-primary btn-tiny" disabled={saving || editingLoading}>
                          {editingEntryId ? 'Enregistrer' : 'Ajouter'}
                        </button>
                        {editingEntryId && (
                          <button type="button" className="btn btn-ghost btn-tiny" style={{ marginLeft: 4 }} onClick={handleCancelEdit}>
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={10} style={{ fontWeight: 700 }}>Solde départ au {mois}/{annee}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{releve.solde_depart.toFixed(2)}</td>
                    <td className="no-print"></td>
                  </tr>
                  {releve.lignes.map((l) => (
                    <tr key={l.ligne_id}>
                      <td>{l.journal_code}</td>
                      <td>{formatDateFR(l.date_ecriture)}</td>
                      <td>{l.compte_contrepartie_numero || '—'}</td>
                      <td>{l.libelle || l.libelle_ecriture}</td>
                      <td>{l.remise_numero || '—'}</td>
                      <td>{l.libelle_banque || '—'}</td>
                      <td className="num debit">{l.debit ? l.debit.toFixed(2) : ''}</td>
                      <td className="num credit">{l.credit ? l.credit.toFixed(2) : ''}</td>
                      <td>{l.piece_reglement || '—'}</td>
                      <td>{l.numero_facture_ref || '—'}</td>
                      <td className="num">{l.solde_cumule.toFixed(2)}{l.solde_cumule >= 0 ? 'D' : 'C'}</td>
                      <td className="no-print">
                        <button type="button" className="btn btn-ghost btn-tiny" onClick={() => handleEditLigne(l)} disabled={editingLoading}>Modifier</button>{' '}
                        <button type="button" className="btn btn-ghost btn-tiny" onClick={() => handleDeleteLigne(l.entry_id)}>Suppr.</button>
                      </td>
                    </tr>
                  ))}
                  {releve.lignes.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-muted">Aucun mouvement pour ce compte sur cette période.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>TOTAL</td>
                    <td className="num">{releve.lignes.reduce((s, l) => s + (l.debit || 0), 0).toFixed(2)}</td>
                    <td className="num">{releve.lignes.reduce((s, l) => s + (l.credit || 0), 0).toFixed(2)}</td>
                    <td colSpan={2}></td>
                    <td className="num">{releve.solde_fin.toFixed(2)}{releve.solde_fin >= 0 ? 'D' : 'C'}</td>
                    <td className="no-print"></td>
                  </tr>
                </tfoot>
              </table>
              </form>
              <div className="mt-24" style={{ textAlign: 'right', fontWeight: 700 }}>
                Solde fin de période : {releve.solde_fin.toFixed(2)} DH {releve.solde_fin >= 0 ? 'Débiteur' : 'Créditeur'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function SaisieReleveBancaire() {
  return (
    <CompanySelectGate title="Saisie Relevé Bancaire">
      <SaisieReleveBancaireContent />
    </CompanySelectGate>
  );
}
