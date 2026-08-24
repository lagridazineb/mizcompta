import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { useToolbarActions } from '../ToolbarContext';
import CompanySelectGate from '../components/CompanySelectGate';
import CreateAccountModal from '../components/CreateAccountModal';
import AccountPicker from '../components/AccountPicker';
import FacturesLignesTable from '../components/FacturesLignesTable';
import { printFacture } from '../utils/invoicePrint';
import { TAUX_TVA } from '../constants/tauxTva';
import { nextTiersNumero } from '../utils/tiersNumero';
import DateInputFR from '../components/DateInputFR';

// Modes de règlement, identiques à la liste déroulante "Mode" du logiciel bureau.
// Chaque mode est associé au préfixe du compte de trésorerie qu'il doit
// proposer automatiquement (espèces -> caisse 516x, tout le reste -> banque 514x).
// Le chèque saisi avec la facture se comporte comme les autres modes : la
// banque choisie est mouvementée directement et la facture est soldée/lettrée
// tout de suite (pas de compte d'attente).
const MODES_PAIEMENT = [
  { label: 'Espèce', prefixeCompte: '516' },
  { label: 'Chèque', prefixeCompte: '514' },
  { label: 'Virement', prefixeCompte: '514' },
  { label: 'Effet', prefixeCompte: '514' },
  { label: 'Carte Bancaire', prefixeCompte: '514' },
  { label: 'Mise à disposition', prefixeCompte: '514' },
  { label: 'Prélèvement', prefixeCompte: '514' },
  { label: 'Terminal de paiement', prefixeCompte: '514' },
];

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Compte caisse à proposer par défaut pour un règlement en espèces : le
// 5161 (Caisses) exactement s'il existe, sinon le premier compte 516x
// trouvé (secours si le plan comptable a été personnalisé).
function findCaisseAccount(accounts) {
  return accounts.find((a) => a.numero === '5161') || accounts.find((a) => a.numero.startsWith('516'));
}

const emptyForm = (type) => ({
  compte_numero: type === 'vente' ? '7111' : '6111',
  montant: '',
  montant_mode: 'ht', // 'ht' | 'ttc'
  appliquer_tva: true,
  taux_tva: '20',
  immo: false,
  tiers_id: '',
  jours: '60',
  echeance: '',
  date_facture: todayISO(),
  numero_piece: '',
  libelle: '',
  saisir_paiement: false,
  paiement: {
    date_paiement: todayISO(),
    montant_paye: '',
    mode: 'Espèce',
    compte_tresor_numero: '',
    piece: '',
    date_valeur: '',
  },
});

function FacturesContent() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [type, setType] = useState(searchParams.get('type') === 'achat' ? 'achat' : 'vente');
  const [tiersList, setTiersList] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [factures, setFactures] = useState([]);
  const [form, setForm] = useState(emptyForm(type));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef(null);
  const numeroFactureRef = useRef(null);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  // Popup "Il s'agit d'une immobilisation. Voulez-vous enregistrer les
  // informations d'amortissement ?" affiché juste après l'enregistrement
  // d'une facture d'achat cochée "Immo." — voir handleSubmit.
  const [immoPrompt, setImmoPrompt] = useState(null); // { prefill } | null
  const [editingId, setEditingId] = useState(null);

  const tiersType = type === 'vente' ? 'client' : 'fournisseur';
  const journalLabel = type === 'vente' ? 'JV — Journal de ventes' : 'JA — Journal des achats';

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const [t, f, acc] = await Promise.all([
      api.getTiers(activeCompany.id, tiersType),
      api.getFactures(activeCompany.id, type),
      api.getAccounts(activeCompany.id),
    ]);
    setTiersList(t);
    setFactures(f);
    setAccounts(acc);
  }, [activeCompany, type, tiersType]);

  useEffect(() => {
    load();
    setForm(emptyForm(type));
  }, [load, type]);

  useToolbarActions({
    onAdd: () => numeroFactureRef.current?.focus(),
    onSave: () => formRef.current?.requestSubmit(),
    addLabel: 'Nouveau (F2)',
    saveLabel: 'Enregistrer (F3)',
  });

  // Compte Trésor : uniquement la trésorerie-actif (511 chèques/effets à encaisser,
  // 514 banques, 516 caisses) — pas les comptes de trésorerie-passif (554…),
  // qui ne sont pas des comptes de règlement normaux.
  const tresorerieAccounts = useMemo(() => accounts.filter((a) => a.classe === 5 && a.numero.startsWith('51')), [accounts]);
  // Secteur immobilier (promotion, lotissement…) : une facture d'achat peut
  // porter directement sur un compte de stock (classe 3 — réserves foncières,
  // terrains, biens/produits en cours…) et pas seulement sur une charge
  // (classe 6 — ex. 6120 Achats de terrains), contrairement aux autres
  // secteurs où l'achat va uniquement en classe 6. Voir le Plan Comptable du
  // Secteur Immobilier (CNC, juin 2022), classes 3 et 6.
  const estSecteurImmobilier = activeCompany?.type_pc === 'SECT.IMMOBILIER';
  // Classe du compte Achat/Vente : 6 (charges) ou 7 (produits) en temps normal,
  // 6 ET 3 pour un achat en secteur immobilier, et 2 (immobilisations) dès que
  // la case "Immo." est cochée.
  const classesCompte = form.immo ? [2] : type === 'vente' ? [7] : estSecteurImmobilier ? [6, 3] : [6];
  const contrepartieAccount = useMemo(
    () => accounts.find((a) => a.numero === form.compte_numero),
    [accounts, form.compte_numero]
  );
  const tresorAccount = useMemo(
    () => accounts.find((a) => a.numero === form.paiement.compte_tresor_numero),
    [accounts, form.paiement.compte_tresor_numero]
  );
  const selectedTiers = useMemo(() => tiersList.find((t) => String(t.id) === String(form.tiers_id)), [tiersList, form.tiers_id]);

  // Calcul HT / TVA / TTC en direct, exactement comme les champs "Mt. TVA" / "Mt. TTC" du logiciel bureau
  const montantSaisi = Number(form.montant) || 0;
  const tauxTva = form.appliquer_tva ? Number(form.taux_tva) || 0 : 0;
  let ht, tva, ttc;
  if (form.montant_mode === 'ttc') {
    ttc = montantSaisi;
    ht = Math.round((ttc / (1 + tauxTva / 100)) * 100) / 100;
    tva = Math.round((ttc - ht) * 100) / 100;
  } else {
    ht = montantSaisi;
    tva = Math.round(((ht * tauxTva) / 100) * 100) / 100;
    ttc = Math.round((ht + tva) * 100) / 100;
  }

  const tvaRacine = type === 'achat' ? (form.immo ? '34551' : '34552') : '4455';
  const compteTvaAffiche = tva > 0 ? `${tvaRacine}${String(Math.round(tauxTva)).padStart(2, '0')}` : '—';

  // Le plafond légal de règlement en espèces (art. 106-II du CGI) ne
  // s'applique que si un règlement en espèces a été explicitement saisi
  // (case "Saisir le règlement" cochée + mode "Espèce") — tant qu'aucun
  // mode de paiement n'est choisi, le montant TTC de la facture n'est pas
  // plafonné.
  const paiementEspeces = form.saisir_paiement && /esp[eè]ce/i.test(form.paiement.mode || '');
  const paiementEspecesDepassement = paiementEspeces && ttc > 5000;

  const echeanceCalculee = form.echeance || addDays(form.date_facture, form.jours);

  function updateForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function updatePaiement(patch) {
    setForm((f) => ({ ...f, paiement: { ...f.paiement, ...patch } }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!activeFiscalYear) {
      setError('Aucun exercice comptable actif pour cette société.');
      return;
    }
    if (!form.numero_piece.trim()) {
      setError('Le numéro de facture est obligatoire.');
      return;
    }
    if (!form.tiers_id) {
      setError(`Sélectionnez un ${tiersType === 'client' ? 'client' : 'fournisseur'}.`);
      return;
    }
    // Le backend refait aussi ce contrôle (ne pas s'y fier uniquement côté React) :
    // c'est ici pour donner un retour immédiat sans aller-retour serveur.
    if (type === 'achat' && paiementEspecesDepassement) {
      setError("Le règlement en espèces d'une facture d'achat ne peut pas dépasser 5 000 DH TTC (art. 106-II du CGI). Choisissez un autre mode de paiement (chèque, virement…) ou scindez le règlement.");
      return;
    }
    setLoading(true);
    try {
      const entry = await api.createFacture(activeCompany.id, {
        type,
        tiers_id: Number(form.tiers_id),
        fiscal_year_id: activeFiscalYear.id,
        date_facture: form.date_facture,
        numero_piece: form.numero_piece || null,
        libelle: form.libelle || `FA N°: ${form.numero_piece || ''} - ${selectedTiers?.nom || ''}`.trim(),
        compte_numero: form.compte_numero,
        montant: montantSaisi,
        montant_mode: form.montant_mode,
        appliquer_tva: form.appliquer_tva,
        taux_tva: tauxTva,
        immo: form.immo,
        jours: form.jours,
        echeance: form.echeance || null,
        paiement: form.saisir_paiement
          ? {
              date_paiement: form.paiement.date_paiement,
              montant_paye: Number(form.paiement.montant_paye) || 0,
              mode: form.paiement.mode,
              compte_tresor_numero: form.paiement.compte_tresor_numero,
              piece: form.paiement.piece,
              date_valeur: form.paiement.date_valeur,
            }
          : null,
      });
      // Si on modifiait une facture existante, on ne supprime l'ancienne
      // qu'une fois la nouvelle bien enregistrée (pour ne rien perdre en cas d'erreur).
      if (editingId) {
        await api.deleteFacture(activeCompany.id, editingId);
        setEditingId(null);
      }
      const immoChecked = form.immo;
      const prefill = immoChecked
        ? {
            facture_entry_id: entry.id,
            nature: contrepartieAccount?.intitule || '',
            objet: entry.libelle,
            compte_immo_numero: form.compte_numero,
            date_acquisition: form.date_facture,
            valeur_origine: ht,
          }
        : null;
      setForm(emptyForm(type));
      load();
      // Facture d'immobilisation : demander si on saisit tout de suite le plan
      // d'amortissement (comme le pop-up "Oui/Non" du logiciel bureau) plutôt
      // que de basculer directement — l'utilisateur peut le faire plus tard.
      if (immoChecked) setImmoPrompt({ prefill });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(f) {
    const tiersLigne = f.lignes.find((l) => l.tiers && l.taux_tva == null);
    const tvaLigne = f.lignes.find((l) => l.taux_tva != null);
    const contrepartieLigne = f.lignes.find((l) => !l.tiers && l !== tvaLigne);
    const tiersMatch = tiersList.find((t) => t.account_numero === tiersLigne?.account_numero);
    const montantHt = contrepartieLigne ? contrepartieLigne.debit || contrepartieLigne.credit : 0;
    let jours = '60';
    if (f.date_ecriture && f.echeance) {
      const diff = Math.round((new Date(f.echeance) - new Date(f.date_ecriture)) / 86400000);
      if (Number.isFinite(diff) && diff >= 0) jours = String(diff);
    }
    setEditingId(f.id);
    setForm({
      compte_numero: contrepartieLigne?.account_numero || (type === 'vente' ? '7111' : '6111'),
      montant: String(montantHt),
      montant_mode: 'ht',
      appliquer_tva: !!tvaLigne,
      taux_tva: String(tvaLigne?.taux_tva || 20),
      immo: (contrepartieLigne?.account_numero || '').startsWith('2'),
      tiers_id: tiersMatch ? String(tiersMatch.id) : '',
      jours,
      echeance: f.echeance || '',
      date_facture: f.date_ecriture,
      numero_piece: f.numero_piece || '',
      libelle: f.libelle || '',
      saisir_paiement: false,
      paiement: emptyForm(type).paiement,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(f) {
    if (!window.confirm(`Supprimer la facture N°${f.numero_piece || f.id} ? Le règlement lié (s'il existe) sera aussi supprimé.`)) return;
    setError('');
    try {
      await api.deleteFacture(activeCompany.id, f.id);
      if (editingId === f.id) {
        setEditingId(null);
        setForm(emptyForm(type));
      }
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Impression au format A4 professionnel (nouvelle fenêtre dédiée), et non
  // plus un simple export de la table écran ressemblant à un ticket de caisse.
  function handlePrint(f) {
    const tiersLigne = f.lignes.find((l) => l.tiers && l.taux_tva == null);
    const tiersMatch = tiersList.find((t) => t.account_numero === tiersLigne?.account_numero);
    printFacture({ company: activeCompany, tiers: tiersMatch, facture: f, type });
  }

  return (
    <div>
      <div className="page-header no-print">
        <h1>Saisie : Factures {type === 'vente' ? 'de vente' : "d'achat"}</h1>
        <p>{activeCompany.raison_sociale} {activeCompany.ice && `— ICE:${activeCompany.ice}`}</p>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${type === 'vente' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setType('vente');
            // Une facture de vente ne peut pas être une immobilisation
            // (les immobilisations sont enregistrées côté achats) : on
            // repart d'un formulaire propre pour éviter qu'une coche
            // "Immo." restée active depuis un achat ne s'applique à tort.
            setForm(emptyForm('vente'));
          }}
        >
          Factures de Ventes
        </button>
        <button className={`btn ${type === 'achat' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('achat')}>
          Factures d'Achats
        </button>
      </div>

      <div className="card no-print">
        {error && <div className="alert alert-error">{error}</div>}
        {editingId && (
          <div className="alert alert-notice">
            Modification de la facture N°{form.numero_piece || editingId} — l'enregistrement remplacera l'écriture existante.{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm(type));
              }}
            >
              Annuler la modification
            </button>
          </div>
        )}
        {tiersList.length === 0 && (
          <div className="alert alert-notice">
            Aucun {tiersType} enregistré. Créez-en un ci-dessous avec « + Nouveau », ou dans la page <strong>Tiers</strong>.
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit}>
          {/* --- En-tête : journal, n° facture, date, échéance, libellé --- */}
          <div className="grid-3">
            <div className="field">
              <label>Code journal</label>
              <input value={journalLabel} disabled />
            </div>
            <div className="field">
              <label>N° facture *</label>
              <input required ref={numeroFactureRef} value={form.numero_piece} onChange={(e) => updateForm({ numero_piece: e.target.value })} placeholder="01" />
            </div>
            <div className="field">
              <label>Date</label>
              <DateInputFR required value={form.date_facture} onChange={(e) => updateForm({ date_facture: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Libellé</label>
            <input
              value={form.libelle}
              onChange={(e) => updateForm({ libelle: e.target.value })}
              placeholder={`FA N°: ${form.numero_piece || '…'} - ${selectedTiers?.nom || (type === 'vente' ? 'Client' : 'Fournisseur')}`}
            />
          </div>

          {/* --- Compte Achat / Vente + TVA --- */}
          <div className="card" style={{ background: 'var(--ink-800)', boxShadow: 'none' }}>
            <h2>Compte {type === 'vente' ? 'Vente' : 'Achat'}</h2>
            <div className="grid-3">
              <div className="field">
                <label>Compte {type === 'vente' ? 'Vente' : 'Achat'}</label>
                <AccountPicker
                  accounts={accounts}
                  value={contrepartieAccount?.id || ''}
                  classes={classesCompte}
                  onChange={(id) => {
                    const acc = accounts.find((a) => String(a.id) === String(id));
                    if (acc) updateForm({ compte_numero: acc.numero });
                  }}
                  companyId={activeCompany.id}
                  placeholder={form.immo ? '211 — Immobilisation…' : type === 'vente' ? '7111 — Ventes…' : '6111 — Achats…'}
                  onAccountCreated={(created) => {
                    setAccounts((prev) => [...prev, created]);
                    updateForm({ compte_numero: created.numero });
                  }}
                />
                {contrepartieAccount && <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{contrepartieAccount.intitule}</div>}
              </div>
              <div className="field">
                <label>Mt. {form.montant_mode === 'ttc' ? 'TTC' : 'HT'}</label>
                <input required type="number" step="0.01" value={form.montant} onChange={(e) => updateForm({ montant: e.target.value })} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={form.montant_mode === 'ttc'}
                    onChange={(e) => updateForm({ montant_mode: e.target.checked ? 'ttc' : 'ht' })}
                  />
                  TTC (montant saisi toutes taxes comprises)
                </label>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={form.appliquer_tva}
                    onChange={(e) => updateForm({ appliquer_tva: e.target.checked })}
                  />
                  T.TVA (appliquer la TVA)
                </label>
                <select disabled={!form.appliquer_tva} value={form.taux_tva} onChange={(e) => updateForm({ taux_tva: e.target.value })}>
                  {TAUX_TVA.map((t) => (
                    <option key={t} value={t}>
                      {t}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Mt. TVA</label>
                <input disabled value={tva.toFixed(2)} className="num" />
              </div>
              <div className="field">
                <label>Compte TVA</label>
                <input disabled value={compteTvaAffiche} />
              </div>
              {/* Immo. : une immobilisation s'acquiert par une facture d'achat,
                  jamais par une facture de vente — la case n'a donc de sens
                  (et n'est proposée) que côté "Factures d'Achats". */}
              {type === 'achat' && (
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={form.immo}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        // Bascule le compte par défaut vers la classe 2 (immobilisations)
                        // ou revient au compte de charge par défaut.
                        const defautClasseActuelle = checked ? 2 : 6;
                        const compteActuel = accounts.find((a) => a.numero === form.compte_numero);
                        const doitChanger = !compteActuel || compteActuel.classe !== defautClasseActuelle;
                        updateForm({
                          immo: checked,
                          compte_numero: doitChanger ? (checked ? '211' : '6111') : form.compte_numero,
                        });
                      }}
                    />
                    Immo. (compte d'immobilisation, classe 2)
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* --- Fournisseur / Client --- */}
          <div className="card" style={{ background: 'var(--ink-800)', boxShadow: 'none' }}>
            <h2>{type === 'vente' ? 'Client' : 'Fournisseur'}</h2>
            <div className="grid-3">
              <div className="field">
                <label>{type === 'vente' ? 'Client' : 'Fournisseur'}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select required value={form.tiers_id} onChange={(e) => updateForm({ tiers_id: e.target.value })} style={{ flex: 1 }}>
                    <option value="">Sélectionner…</option>
                    {tiersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.account_numero} — {t.nom}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowCreateAccount(true)}>
                    + Nouveau
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Jours (délai de règlement)</label>
                <input type="number" min="0" value={form.jours} onChange={(e) => updateForm({ jours: e.target.value })} />
              </div>
              <div className="field">
                <label>Échéance</label>
                <DateInputFR value={echeanceCalculee} onChange={(e) => updateForm({ echeance: e.target.value })} />
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Mt. TTC</label>
                <input disabled value={ttc.toFixed(2)} className="num" />
              </div>
              <div className="field">
                <label>ICE</label>
                <input disabled value={selectedTiers?.ice || '—'} />
              </div>
              <div className="field">
                <label>Compte</label>
                <input disabled value={selectedTiers?.account_numero || '—'} />
              </div>
            </div>
          </div>

          {/* --- Saisir le paiement --- */}
          <div className="card" style={{ background: 'rgba(126,164,118,0.10)', boxShadow: 'none' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.saisir_paiement}
                onChange={(e) => {
                  const checked = e.target.checked;
                  // Mode par défaut de la section = "Espèce" -> on présélectionne
                  // directement le compte 5161 (Caisse) plutôt qu'un compte 516x
                  // quelconque.
                  const compteAuto = checked && !form.paiement.compte_tresor_numero ? findCaisseAccount(tresorerieAccounts) : null;
                  // Réglé en espèces dès la coche : la date de facturation suit
                  // automatiquement la date de paiement (modifiable ensuite si
                  // l'utilisateur change la date de paiement).
                  const modeEspeceParDefaut = /esp[eè]ce/i.test(form.paiement.mode || '');
                  updateForm({
                    saisir_paiement: checked,
                    date_facture: checked && modeEspeceParDefaut ? form.paiement.date_paiement : form.date_facture,
                    paiement: {
                      ...form.paiement,
                      montant_paye: checked ? ttc.toFixed(2) : form.paiement.montant_paye,
                      compte_tresor_numero: compteAuto ? compteAuto.numero : form.paiement.compte_tresor_numero,
                    },
                  });
                }}
              />
              Saisir le Paiement
            </h2>
            {form.saisir_paiement && (
              <>
                <div className="grid-3">
                  <div className="field">
                    <label>Date Paiement</label>
                    <DateInputFR
                      value={form.paiement.date_paiement}
                      onChange={(e) => {
                        const value = e.target.value;
                        updatePaiement({ date_paiement: value });
                        // Paiement en espèces : la date de facturation suit
                        // automatiquement la date de paiement.
                        if (/esp[eè]ce/i.test(form.paiement.mode || '')) {
                          updateForm({ date_facture: value });
                        }
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Mt. Payé</label>
                    <input type="number" step="0.01" value={form.paiement.montant_paye} onChange={(e) => updatePaiement({ montant_paye: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Mode</label>
                    <select
                      value={form.paiement.mode}
                      onChange={(e) => {
                        const value = e.target.value;
                        const modeInfo = MODES_PAIEMENT.find((m) => m.label === value);
                        const isEspece = /esp[eè]ce/i.test(value);
                        // Bascule automatiquement vers la caisse (espèces : compte 5161
                        // précisément) ou la banque (chèque/virement/…), comme sur le
                        // logiciel bureau — l'utilisateur garde la main pour choisir un
                        // autre compte si plusieurs banques existent.
                        const compteAuto = isEspece
                          ? findCaisseAccount(tresorerieAccounts)
                          : tresorerieAccounts.find((a) => a.numero.startsWith(modeInfo?.prefixeCompte || '514'));
                        updatePaiement({ mode: value, compte_tresor_numero: compteAuto ? compteAuto.numero : form.paiement.compte_tresor_numero });
                        // Réglé en espèces : la date de facturation s'aligne
                        // immédiatement sur la date de paiement déjà saisie.
                        if (isEspece) {
                          updateForm({ date_facture: form.paiement.date_paiement });
                        }
                      }}
                    >
                      {MODES_PAIEMENT.map((m) => (
                        <option key={m.label} value={m.label}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid-3">
                  <div className="field">
                    <label>Compte Trésor</label>
                    <select value={form.paiement.compte_tresor_numero} onChange={(e) => updatePaiement({ compte_tresor_numero: e.target.value })}>
                      <option value="">Sélectionner…</option>
                      {tresorerieAccounts.map((a) => (
                        <option key={a.id} value={a.numero}>
                          {a.numero} — {a.intitule}
                        </option>
                      ))}
                    </select>
                    {tresorAccount && <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{tresorAccount.intitule}</div>}
                  </div>
                  <div className="field">
                    <label>N° Chq / Effet</label>
                    <input value={form.paiement.piece} onChange={(e) => updatePaiement({ piece: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Date Valeur</label>
                    <DateInputFR value={form.paiement.date_valeur} onChange={(e) => updatePaiement({ date_valeur: e.target.value })} />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex-between mt-24" style={{ marginBottom: 14, fontSize: 13.5 }}>
            <div>
              Mt HT : <strong className="num">{ht.toFixed(2)} DH</strong> &nbsp;·&nbsp; Mt TVA : <strong className="num">{tva.toFixed(2)} DH</strong> &nbsp;·&nbsp; Mt TTC :{' '}
              <strong className="num">{ttc.toFixed(2)} DH</strong>
            </div>
          </div>
          {type === 'achat' && paiementEspecesDepassement && (
            <div className="alert alert-error mt-24">
              Le règlement en espèces d'une facture d'achat ne peut pas dépasser 5 000 DH TTC (art. 106-II du CGI) — choisissez un autre mode de paiement (chèque, virement…) ou scindez le règlement.
            </div>
          )}

          <button className="btn btn-primary" disabled={loading || tiersList.length === 0 || (type === 'achat' && paiementEspecesDepassement)}>
            {loading ? 'Enregistrement…' : editingId ? 'Enregistrer les modifications' : 'Enregistrer (F3)'}
          </button>
        </form>
      </div>

      <FacturesLignesTable factures={factures} type={type} onEdit={handleEdit} onDelete={handleDelete} onPrint={handlePrint} />

      <CreateAccountModal
        open={showCreateAccount}
        numeroInitial={nextTiersNumero(accounts, tiersType === 'client' ? '3421' : '4411')}
        companyId={activeCompany.id}
        onClose={() => setShowCreateAccount(false)}
        onCreated={(created) => {
          setShowCreateAccount(false);
          load();
          if (created.tiers_id) updateForm({ tiers_id: created.tiers_id });
        }}
      />

      {immoPrompt && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Immobilisation</h3>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p>Il s'agit d'une immobilisation. Voulez-vous enregistrer les informations d'amortissement ?</p>
            </div>
            <div style={{ padding: '0 20px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setImmoPrompt(null)}>Non</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const { prefill } = immoPrompt;
                  setImmoPrompt(null);
                  navigate('/immobilisations/amortissement', { state: { prefill } });
                }}
              >
                Oui
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Factures() {
  return (
    <CompanySelectGate title="Factures">
      <FacturesContent />
    </CompanySelectGate>
  );
}
