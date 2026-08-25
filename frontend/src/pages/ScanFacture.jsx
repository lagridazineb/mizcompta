import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import CreateAccountModal from '../components/CreateAccountModal';
import FacturesLignesTable from '../components/FacturesLignesTable';
import { extractDocument, extractDocumentPages } from '../utils/documentText';
import { extractFactureFields } from '../utils/factureExtract';
import { extractReleveDocument } from '../utils/releveExtract';
import { TAUX_TVA } from '../constants/tauxTva';
import { nextTiersNumero } from '../utils/tiersNumero';
import DateInputFR from '../components/DateInputFR';

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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const emptyFactureForm = () => ({
  tiers_id: '',
  date_facture: '',
  numero_piece: '',
  libelle: '',
  montant: '',
  taux_tva: '20',
  jours: '60',
  mode_paiement: '',
  piece_reglement: '',
  compte_tresor_numero: '',
  // Valeurs détectées sur le document, affichées telles quelles dans le
  // bandeau récapitulatif en haut (indépendamment de toute correction
  // ultérieure des champs modifiables ci-dessous).
  detecte: null,
});

// --- Onglet Facture d'achat / de vente --------------------------------------
// --- Onglet Facture d'achat / de vente --------------------------------------
// Prend en charge le scan de PLUSIEURS factures à la fois : soit plusieurs
// fichiers sélectionnés d'un coup, soit un seul PDF de plusieurs pages
// contenant une facture par page (cas très courant d'un lot scanné en une
// fois). Chaque facture détectée devient une entrée d'une file d'attente
// ("Facture 1/9", "2/9"…) que l'on parcourt et corrige avant d'enregistrer —
// au lieu de ne jamais pouvoir traiter qu'un seul document à la fois.
function FactureScanTab({ mode, activeCompany, activeFiscalYear }) {
  const [tiersList, setTiersList] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [factures, setFactures] = useState([]);
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [queue, setQueue] = useState([]); // [{ id, source, form, rawText, detected }]
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCreateTiers, setShowCreateTiers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState('');

  const tiersType = mode === 'vente' ? 'client' : 'fournisseur';

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const [t, acc, f] = await Promise.all([
      api.getTiers(activeCompany.id, tiersType),
      api.getAccounts(activeCompany.id),
      api.getFactures(activeCompany.id, mode),
    ]);
    setTiersList(t);
    setAccounts(acc);
    setFactures(f);
  }, [activeCompany, tiersType, mode]);

  useEffect(() => {
    load();
    setFiles([]);
    setQueue([]);
    setCurrentIndex(0);
    setError('');
  }, [load, mode]);

  const tresorerieAccounts = useMemo(() => accounts.filter((a) => a.classe === 5 && a.numero.startsWith('51')), [accounts]);

  // Construit une entrée de file d'attente (formulaire + libellé de source)
  // à partir des champs détectés sur UNE page/UN document.
  function buildQueueItem(fields, rawText, source) {
    const iceCible = mode === 'vente' ? fields.ice_client : fields.ice_emetteur;
    const nomCible = mode === 'vente' ? fields.nom_client : fields.nom_emetteur;
    const match =
      tiersList.find((t) => t.ice && iceCible && t.ice.replace(/\s/g, '') === iceCible) ||
      tiersList.find((t) => nomCible && t.nom.trim().toLowerCase() === nomCible.trim().toLowerCase());
    const modeInfo = MODES_PAIEMENT.find((m) => m.label.toLowerCase() === (fields.mode_paiement || '').toLowerCase());
    const compteAuto = modeInfo
      ? accounts.find((a) => a.classe === 5 && a.numero.startsWith(modeInfo.prefixeCompte === '516' ? '516' : modeInfo.prefixeCompte))
      : null;

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      rawText,
      detected: !match && (nomCible || iceCible) ? { nom: nomCible || '', ice: iceCible || '' } : null,
      status: 'pending', // pending | saved | error
      errorMsg: '',
      form: {
        ...emptyFactureForm(),
        tiers_id: match ? String(match.id) : '',
        date_facture: fields.date_facture || '',
        numero_piece: fields.numero_piece || '',
        montant: fields.montant_ht != null ? String(fields.montant_ht) : '',
        taux_tva: fields.taux_tva || '20',
        mode_paiement: fields.mode_paiement || '',
        piece_reglement: fields.piece_reglement || '',
        compte_tresor_numero: compteAuto ? compteAuto.numero : '',
        libelle: `FA N°: ${fields.numero_piece || ''} - ${nomCible || ''}`.trim(),
        detecte: {
          nom: nomCible,
          ice: iceCible,
          numero_piece: fields.numero_piece,
          montant_ht: fields.montant_ht,
          montant_tva: fields.montant_tva,
          montant_ttc: fields.montant_ttc,
        },
      },
    };
  }

  async function handleAnalyse() {
    if (files.length === 0) return;
    setError('');
    setScanning(true);
    setQueue([]);
    setCurrentIndex(0);
    const nouvelleFile = [];
    try {
      for (let fi = 0; fi < files.length; fi += 1) {
        const file = files[fi];
        setStatus(`Fichier ${fi + 1}/${files.length} : ${file.name}…`);
        // Une page = une facture (lot de plusieurs factures scannées dans un
        // seul PDF, ou plusieurs pages d'une même facture — dans ce dernier
        // cas il suffit de fusionner à la main les entrées superflues avant
        // d'enregistrer).
        const pages = await extractDocumentPages(file, {
          onStatus: (s) => setStatus(`Fichier ${fi + 1}/${files.length} (${file.name}) — ${s}`),
          onProgress: setProgress,
        });
        pages.forEach((page, pi) => {
          const fields = extractFactureFields(page.text, page.rows);
          // Ignore les pages manifestement vides (page blanche de séparation,
          // page de garde…) : ni montant, ni numéro, ni nom détecté.
          const vide = fields.montant_ht == null && fields.montant_ttc == null && !fields.numero_piece && !fields.nom_emetteur;
          if (vide && pages.length > 1) return;
          const source = files.length > 1 || pages.length > 1 ? `${file.name}${pages.length > 1 ? ` — page ${pi + 1}/${pages.length}` : ''}` : file.name;
          nouvelleFile.push(buildQueueItem(fields, page.text, source));
        });
      }
      if (nouvelleFile.length === 0) {
        setError("Aucune facture n'a pu être détectée sur le(s) document(s) fourni(s).");
      }
      setQueue(nouvelleFile);
    } catch (err) {
      setError(`Échec de la lecture du document : ${err.message}`);
    } finally {
      setScanning(false);
      setStatus('');
      setProgress(0);
    }
  }

  const current = queue[currentIndex] || null;

  function updateCurrentForm(patch) {
    setQueue((q) => q.map((item, i) => (i === currentIndex ? { ...item, form: { ...item.form, ...patch } } : item)));
  }

  function itemMontants(item) {
    const montant = Number(item.form.montant) || 0;
    const taux = Number(item.form.taux_tva) || 0;
    const tva = round2((montant * taux) / 100);
    const ttc = round2(montant + tva);
    return { montant, taux, tva, ttc };
  }

  async function saveItem(index) {
    const item = queue[index];
    if (!item || item.status === 'saved') return true;
    if (!activeFiscalYear) {
      setError('Aucun exercice comptable actif pour cette société.');
      return false;
    }
    if (!item.form.tiers_id) {
      setError(`Sélectionnez ou créez le ${tiersType === 'client' ? 'client' : 'fournisseur'} détecté avant d'enregistrer (facture : ${item.source}).`);
      return false;
    }
    if (!item.form.numero_piece.trim()) {
      setError(`Le numéro de facture est obligatoire (facture : ${item.source}).`);
      return false;
    }
    const { montant, taux, ttc } = itemMontants(item);
    try {
      await api.createFacture(activeCompany.id, {
        type: mode,
        tiers_id: Number(item.form.tiers_id),
        fiscal_year_id: activeFiscalYear.id,
        date_facture: item.form.date_facture || new Date().toISOString().slice(0, 10),
        numero_piece: item.form.numero_piece,
        libelle: item.form.libelle || `${mode === 'vente' ? 'Vente' : 'Achat'} (scan facture)`,
        compte_numero: mode === 'vente' ? '7111' : '6111',
        montant,
        montant_mode: 'ht',
        appliquer_tva: taux > 0,
        taux_tva: taux,
        immo: false,
        jours: item.form.jours || 60,
        paiement:
          item.form.mode_paiement && item.form.compte_tresor_numero
            ? {
                date_paiement: item.form.date_facture || new Date().toISOString().slice(0, 10),
                montant_paye: ttc,
                mode: item.form.mode_paiement,
                compte_tresor_numero: item.form.compte_tresor_numero,
                piece: item.form.piece_reglement,
              }
            : null,
      });
      setQueue((q) => q.map((it, i) => (i === index ? { ...it, status: 'saved', errorMsg: '' } : it)));
      return true;
    } catch (err) {
      setQueue((q) => q.map((it, i) => (i === index ? { ...it, status: 'error', errorMsg: err.message } : it)));
      return false;
    }
  }

  async function handleSaveCurrent(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const ok = await saveItem(currentIndex);
      if (ok) {
        load();
        // Avance automatiquement vers la prochaine facture non enregistrée.
        const next = queue.findIndex((it, i) => i > currentIndex && it.status !== 'saved');
        if (next !== -1) setCurrentIndex(next);
      }
    } finally {
      setSaving(false);
    }
  }

  // Enregistre en une fois toutes les factures de la file qui ont au moins
  // un fournisseur/client et un numéro de facture — répond directement à la
  // demande "elles doivent être scannées toutes en même temps" plutôt que de
  // devoir cliquer "Enregistrer" facture par facture.
  async function handleSaveAll() {
    setError('');
    setSavingAll(true);
    try {
      for (let i = 0; i < queue.length; i += 1) {
        if (queue[i].status === 'saved') continue;
        if (!queue[i].form.tiers_id || !queue[i].form.numero_piece.trim()) continue; // laissées pour correction manuelle
        // eslint-disable-next-line no-await-in-loop
        await saveItem(i);
      }
      load();
    } finally {
      setSavingAll(false);
    }
  }

  const nbEnregistrees = queue.filter((it) => it.status === 'saved').length;
  const nbIncompletes = queue.filter((it) => it.status !== 'saved' && (!it.form.tiers_id || !it.form.numero_piece.trim())).length;

  return (
    <div>
      <div className="card no-print">
        <h2>1. Scanner le(s) document(s)</h2>
        <p className="text-muted">
          Fonctionne avec une ou plusieurs <strong>photos/images</strong> ou <strong>PDF</strong> (facture générée par
          ordinateur ou scannée) — <strong>sélectionnez plusieurs fichiers, ou un seul PDF de plusieurs pages avec une
          facture par page</strong> : chacune sera détectée séparément. La lecture se fait entièrement dans votre
          navigateur — aucun fichier n'est envoyé à un service externe.
        </p>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,application/pdf"
          onChange={(e) => {
            setFiles(Array.from(e.target.files || []));
            setQueue([]);
            setCurrentIndex(0);
          }}
        />
        {files.length > 0 && <p className="text-muted" style={{ marginTop: 4 }}>{files.length} fichier(s) sélectionné(s).</p>}
        <button className="btn btn-primary mt-24" onClick={handleAnalyse} disabled={files.length === 0 || scanning}>
          {scanning ? `Analyse en cours… ${progress ? `${progress}%` : ''}` : `Analyser ${files.length > 1 ? `les ${files.length} documents` : 'le document'}`}
        </button>
        {scanning && status && <p className="text-muted" style={{ marginTop: 8 }}>{status}</p>}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {queue.length > 0 && (
        <div className="card no-print">
          <div className="flex-between">
            <h2 style={{ margin: 0 }}>
              2. Vérifier et compléter — Facture {currentIndex + 1} / {queue.length}
            </h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              >
                ← Précédente
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={currentIndex >= queue.length - 1}
                onClick={() => setCurrentIndex((i) => Math.min(queue.length - 1, i + 1))}
              >
                Suivante →
              </button>
            </div>
          </div>

          {/* Résumé de la file : statut de chaque facture détectée */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
            {queue.map((it, i) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setCurrentIndex(i)}
                title={it.source}
                className="btn btn-ghost"
                style={{
                  padding: '3px 9px',
                  fontSize: 12,
                  border: i === currentIndex ? '1px solid var(--gold)' : '1px solid var(--border)',
                  background: it.status === 'saved' ? 'rgba(126,164,118,0.18)' : it.status === 'error' ? 'rgba(196,122,99,0.18)' : 'transparent',
                }}
              >
                {it.status === 'saved' ? '✓ ' : it.status === 'error' ? '⚠ ' : ''}
                {i + 1}
              </button>
            ))}
          </div>
          <p className="text-muted" style={{ fontSize: 12.5 }}>
            {nbEnregistrees} / {queue.length} déjà enregistrée(s)
            {nbIncompletes > 0 && ` — ${nbIncompletes} à compléter (${tiersType === 'client' ? 'client' : 'fournisseur'} ou N° de facture manquant)`}.
          </p>
          {current?.status === 'saved' && <div className="alert alert-notice">Cette facture a été enregistrée.</div>}
          {current?.status === 'error' && <div className="alert alert-error">Échec de l'enregistrement : {current.errorMsg}</div>}

          <p className="text-muted" style={{ fontSize: 12.5 }}>Source : {current?.source}</p>

          {/* Bandeau récapitulatif des données détectées en haut du document (logo/entête) */}
          <div className="card" style={{ background: 'var(--ink-800)', boxShadow: 'none' }}>
            <h2>Données détectées sur le document</h2>
            <div className="grid-3" style={{ fontSize: 13.5 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>{tiersType === 'client' ? 'Client' : 'Fournisseur'}</div>
                <strong>{current?.form.detecte?.nom || '— non détecté —'}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>N° ICE</div>
                <strong>{current?.form.detecte?.ice || '— non détecté —'}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>N° de facture</div>
                <strong>{current?.form.detecte?.numero_piece || '— non détecté —'}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>Montant HT</div>
                <strong className="num">{current?.form.detecte?.montant_ht != null ? `${current.form.detecte.montant_ht.toFixed(2)} DH` : '—'}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>Montant TVA</div>
                <strong className="num">{current?.form.detecte?.montant_tva != null ? `${current.form.detecte.montant_tva.toFixed(2)} DH` : '—'}</strong>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12 }}>Montant TTC</div>
                <strong className="num">{current?.form.detecte?.montant_ttc != null ? `${current.form.detecte.montant_ttc.toFixed(2)} DH` : '—'}</strong>
              </div>
            </div>
          </div>

          {current?.detected && (
            <div className="alert alert-notice">
              {tiersType === 'client' ? 'Client' : 'Fournisseur'} détecté sur le document :{' '}
              <strong>{current.detected.nom || '(nom non détecté)'}</strong>
              {current.detected.ice && ` — ICE ${current.detected.ice}`}. Aucune fiche existante ne correspond.{' '}
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreateTiers(true)}>
                Créer cette fiche maintenant
              </button>
            </div>
          )}

          {current && (
            <form onSubmit={handleSaveCurrent}>
              <div className="grid-2">
                <div className="field">
                  <label>{tiersType === 'client' ? 'Client' : 'Fournisseur'}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={current.form.tiers_id} onChange={(e) => updateCurrentForm({ tiers_id: e.target.value })} style={{ flex: 1 }}>
                      <option value="">Sélectionner…</option>
                      {tiersList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.account_numero} — {t.nom}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-ghost" onClick={() => setShowCreateTiers(true)}>
                      + Nouveau
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label>Date de la facture (détectée à vérifier)</label>
                  <DateInputFR value={current.form.date_facture} onChange={(e) => updateCurrentForm({ date_facture: e.target.value })} />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>N° de facture * (détecté à vérifier)</label>
                  <input required value={current.form.numero_piece} onChange={(e) => updateCurrentForm({ numero_piece: e.target.value })} />
                </div>
                <div className="field">
                  <label>Taux de TVA (%)</label>
                  <select value={current.form.taux_tva} onChange={(e) => updateCurrentForm({ taux_tva: e.target.value })}>
                    <option value="0">0% (exonéré)</option>
                    {TAUX_TVA.map((t) => (
                      <option key={t} value={t}>
                        {t}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Jours (délai de règlement)</label>
                  <input type="number" min="0" value={current.form.jours} onChange={(e) => updateCurrentForm({ jours: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Libellé</label>
                <input value={current.form.libelle} onChange={(e) => updateCurrentForm({ libelle: e.target.value })} />
              </div>
              <div className="field">
                <label>Montant HT détecté (DH) — à corriger si besoin</label>
                <input required type="number" step="0.01" value={current.form.montant} onChange={(e) => updateCurrentForm({ montant: e.target.value })} />
              </div>

              {(() => {
                const { montant, tva, ttc } = itemMontants(current);
                return (
                  <p style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>
                    HT : {montant.toFixed(2)} DH · TVA : {tva.toFixed(2)} DH · TTC : {ttc.toFixed(2)} DH
                  </p>
                );
              })()}

              {current.form.mode_paiement && (
                <div className="card" style={{ background: 'rgba(126,164,118,0.10)', boxShadow: 'none' }}>
                  <h2>Règlement détecté : {current.form.mode_paiement} {current.form.piece_reglement && `n°${current.form.piece_reglement}`}</h2>
                  <div className="field">
                    <label>Compte Trésor (pour enregistrer aussi le règlement — facultatif)</label>
                    <select value={current.form.compte_tresor_numero} onChange={(e) => updateCurrentForm({ compte_tresor_numero: e.target.value })}>
                      <option value="">Ne pas saisir le règlement maintenant</option>
                      {tresorerieAccounts.map((a) => (
                        <option key={a.id} value={a.numero}>
                          {a.numero} — {a.intitule}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={saving || current.status === 'saved'}>
                  {saving ? 'Enregistrement…' : current.status === 'saved' ? 'Déjà enregistrée' : 'Enregistrer cette facture'}
                </button>
                {queue.length > 1 && (
                  <button type="button" className="btn btn-ghost" disabled={savingAll} onClick={handleSaveAll}>
                    {savingAll ? 'Enregistrement en cours…' : `Enregistrer toutes les factures complètes (${queue.length - nbEnregistrees - nbIncompletes} restante(s))`}
                  </button>
                )}
              </div>
            </form>
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Texte brut détecté par l'OCR</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>{current?.rawText}</pre>
          </details>
        </div>
      )}

      {factures.length > 0 && <FacturesLignesTable factures={factures} type={mode} />}

      <CreateAccountModal
        open={showCreateTiers}
        numeroInitial={nextTiersNumero(accounts, tiersType === 'client' ? '3421' : '4411')}
        nomInitial={current?.detected?.nom || ''}
        iceInitial={current?.detected?.ice || ''}
        companyId={activeCompany.id}
        onClose={() => setShowCreateTiers(false)}
        onCreated={(created) => {
          setShowCreateTiers(false);
          load();
          if (created.tiers_id) updateCurrentForm({ tiers_id: String(created.tiers_id) });
          setQueue((q) => q.map((it, i) => (i === currentIndex ? { ...it, detected: null } : it)));
        }}
      />
    </div>
  );
}

// --- Onglet Relevé bancaire --------------------------------------------------
function ReleveScanTab({ activeCompany, activeFiscalYear }) {
  const [accounts, setAccounts] = useState([]);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [operations, setOperations] = useState([]);
  const [pagesInfo, setPagesInfo] = useState([]);
  const [compteTresorNumero, setCompteTresorNumero] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [moisImporte, setMoisImporte] = useState('');
  const [anneeImporte, setAnneeImporte] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeCompany) return;
    api.getAccounts(activeCompany.id).then(setAccounts);
  }, [activeCompany]);

  const tresorerieAccounts = useMemo(() => accounts.filter((a) => a.classe === 5 && a.numero.startsWith('51')), [accounts]);

  // Compte Trésor présélectionné automatiquement sur 5141 (Banques, soldes
  // débiteurs) dès que les comptes sont chargés — c'est de très loin le compte
  // utilisé pour l'immense majorité des relevés bancaires, ça évite de le
  // choisir à chaque import. On ne touche pas au choix si l'utilisateur a déjà
  // sélectionné un autre compte, et on se rabat sur le premier compte de
  // trésorerie disponible si 5141 n'existe pas (plan de comptes personnalisé).
  useEffect(() => {
    if (compteTresorNumero || tresorerieAccounts.length === 0) return;
    const defaut = tresorerieAccounts.find((a) => a.numero === '5141') || tresorerieAccounts[0];
    if (defaut) setCompteTresorNumero(defaut.numero);
  }, [tresorerieAccounts, compteTresorNumero]);

  async function handleAnalyse() {
    if (!file) return;
    setError('');
    setResult(null);
    setPagesInfo([]);
    setScanning(true);
    setStatus('Préparation…');
    setProgress(0);
    try {
      const { operations: ops, pages } = await extractReleveDocument(file, { onStatus: setStatus, onProgress: setProgress });
      setOperations(ops.map((o) => ({ ...o, include: true })));
      setPagesInfo(pages || []);
      if (ops.length === 0) {
        setError("Aucune opération n'a pu être détectée automatiquement. Vérifiez que le fichier est bien un relevé de compte, ou ajoutez les lignes manuellement ci-dessous.");
      }
    } catch (err) {
      setError(`Échec de la lecture du document : ${err.message}`);
    } finally {
      setScanning(false);
      setStatus('');
    }
  }

  function updateOp(index, patch) {
    setOperations((ops) => ops.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function swapSens(index) {
    setOperations((ops) => ops.map((o, i) => (i === index ? { ...o, debit: o.credit, credit: o.debit } : o)));
  }
  function removeOp(index) {
    setOperations((ops) => ops.filter((_, i) => i !== index));
  }
  // Filet de sécurité pour les lignes que l'OCR n'aurait pas su lire (page
  // trop mal scannée, annotation manuscrite illisible…) : on peut toujours
  // compléter le relevé à la main plutôt que de perdre l'opération. Insère
  // à la position choisie (par défaut à la fin) — pour ajouter une ligne
  // oubliée AU MILIEU du relevé, pas seulement en dernière position.
  function ajouterLigneManuelle(index = operations.length) {
    const nouvelle = { date: new Date().toISOString().slice(0, 10), libelle: '', debit: '', credit: '', include: true, manuel: true };
    setOperations((ops) => [...ops.slice(0, index), nouvelle, ...ops.slice(index)]);
  }

  const pagesSansOperation = pagesInfo.filter((p) => p.count === 0);

  // Aperçu du document original à droite, pour pointer facilement les
  // informations pendant la vérification du tableau de gauche.
  const [fileUrl, setFileUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setFileUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const fileEstPdf = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));


  const totaux = operations.reduce(
    (acc, o) => (o.include ? { debit: acc.debit + (Number(o.debit) || 0), credit: acc.credit + (Number(o.credit) || 0) } : acc),
    { debit: 0, credit: 0 }
  );

  async function handleImport() {
    setError('');
    if (!activeFiscalYear) {
      setError('Aucun exercice comptable actif pour cette société.');
      return;
    }
    if (!compteTresorNumero) {
      setError('Sélectionnez le compte bancaire (Compte Trésor) concerné par ce relevé.');
      return;
    }
    const selection = operations.filter((o) => o.include).map(({ date, libelle, debit, credit }) => ({
      date,
      libelle,
      debit: Number(debit) || 0,
      credit: Number(credit) || 0,
    }));
    if (selection.length === 0) {
      setError('Aucune opération sélectionnée.');
      return;
    }
    setImporting(true);
    try {
      const res = await api.importReleveBancaire(activeCompany.id, {
        compte_tresor_numero: compteTresorNumero,
        fiscal_year_id: activeFiscalYear.id,
        operations: selection,
      });
      setResult(res);
      const premiereDate = selection[0]?.date;
      if (premiereDate) {
        const [y, m] = premiereDate.split('-');
        setAnneeImporte(y);
        setMoisImporte(m);
      }
      setOperations([]);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="scan-releve-split" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
      <div className="card no-print">
        <h2>1. Scanner le relevé bancaire</h2>
        <p className="text-muted">
          PDF (relevé téléchargé depuis votre espace banque en ligne) ou photo/scan. Chaque opération est analysée
          automatiquement : commission bancaire, cotisation CNSS, virement/retrait espèces, chèque impayé ou virement du
          gérant sont détectés dans le libellé et enregistrés directement dans le bon compte / la bonne section. Seules
          les opérations non reconnues restent sur un <strong>compte d'attente</strong> (3497/4497) à reclasser depuis les
          Écritures ou le Lettrage.
        </p>
        <input
          type="file"
          accept="image/*,.pdf,application/pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
          }}
        />
        <button className="btn btn-primary mt-24" onClick={handleAnalyse} disabled={!file || scanning}>
          {scanning ? `Analyse en cours… ${progress ? `${progress}%` : ''}` : 'Analyser le relevé'}
        </button>
        {scanning && status && <p className="text-muted" style={{ marginTop: 8 }}>{status}</p>}
        {error && <div className="alert alert-error">{error}</div>}
        {pagesInfo.length > 1 && (
          <p className="text-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            {pagesInfo.length} page(s) lue(s) : {pagesInfo.map((p) => `page ${p.page} → ${p.count} opération(s)`).join(' · ')}
            {pagesSansOperation.length > 0 && (
              <> — <strong style={{ color: 'var(--debit)' }}>
                {pagesSansOperation.length === 1
                  ? `page ${pagesSansOperation[0].page} : rien détecté (scan trop peu lisible — à ajouter à la main ci-dessous)`
                  : `pages ${pagesSansOperation.map((p) => p.page).join(', ')} : rien détecté (scan trop peu lisible — à ajouter à la main ci-dessous)`}
              </strong></>
            )}
          </p>
        )}
        {result && (
          <div className="alert alert-notice">
            {result.imported} écriture(s) importée(s) avec succès — elles apparaissent maintenant dans le journal (Écritures)
            et dans le Relevé Bancaire.
            {result.classification && (
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                {result.classification.commission > 0 && <li>{result.classification.commission} commission(s) bancaire(s) → Frais Bancaires (61473)</li>}
                {result.classification.cnss > 0 && <li>{result.classification.cnss} règlement(s) CNSS → compte 4441</li>}
                {result.classification.especes > 0 && <li>{result.classification.especes} mouvement(s) espèces → Virement de Fond</li>}
                {result.classification.impaye > 0 && <li>{result.classification.impaye} chèque(s) impayé(s) → compte 3488</li>}
                {result.classification.gerant > 0 && <li>{result.classification.gerant} virement(s) du gérant/associé → compte 4463</li>}
                {result.classification.aReclasser > 0 && <li>{result.classification.aReclasser} opération(s) non reconnue(s) → compte d'attente, à reclasser</li>}
              </ul>
            )}{' '}
            <Link to={`/releve-bancaire?compte=${compteTresorNumero}&mois=${moisImporte}&annee=${anneeImporte}`}>
              Voir dans Saisie Relevé Bancaire →
            </Link>
          </div>
        )}
      </div>

      {(operations.length > 0 || pagesInfo.length > 0) && (
        <div className="card no-print">
          <h2>2. Vérifier et importer ({operations.length} opérations détectées)</h2>
          <div className="field" style={{ maxWidth: 420 }}>
            <label>Compte Trésor (compte bancaire de ce relevé)</label>
            <select value={compteTresorNumero} onChange={(e) => setCompteTresorNumero(e.target.value)}>
              <option value="">Sélectionner…</option>
              {tresorerieAccounts.map((a) => (
                <option key={a.id} value={a.numero}>
                  {a.numero} — {a.intitule}
                </option>
              ))}
            </select>
          </div>

          <div style={{ overflowX: 'auto' }}>
          <table className="ledger" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>Page</th>
                <th>Date</th>
                <th>Libellé</th>
                <th className="num">Débit</th>
                <th className="num">Crédit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {operations.map((o, i) => (
                <tr key={i} style={o.manuel ? { background: 'rgba(201,160,90,0.10)' } : undefined}>
                  <td style={{ width: 34, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      className="row-select-checkbox"
                      checked={!!o.include}
                      onChange={(e) => updateOp(i, { include: e.target.checked })}
                    />
                  </td>
                  <td className="text-muted">{o.manuel ? 'manuel' : o.page || '—'}</td>
                  <td>
                    <DateInputFR value={o.date} onChange={(e) => updateOp(i, { date: e.target.value })} style={{ width: 130 }} />
                  </td>
                  <td>
                    <input value={o.libelle} onChange={(e) => updateOp(i, { libelle: e.target.value })} style={{ minWidth: 260 }} />
                  </td>
                  <td>
                    <input type="number" step="0.01" className="num" value={o.debit || ''} onChange={(e) => updateOp(i, { debit: e.target.value })} style={{ width: 100 }} />
                  </td>
                  <td>
                    <input type="number" step="0.01" className="num" value={o.credit || ''} onChange={(e) => updateOp(i, { credit: e.target.value })} style={{ width: 100 }} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-ghost" title="Insérer une ligne juste au-dessus" onClick={() => ajouterLigneManuelle(i)}>
                      ➕
                    </button>
                    <button type="button" className="btn btn-ghost" title="Inverser Débit / Crédit" onClick={() => swapSens(i)}>
                      ⇄
                    </button>
                    <button type="button" className="btn btn-ghost" title="Supprimer cette ligne" onClick={() => removeOp(i)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4}>Totaux sélectionnés</td>
                <td className="num">{totaux.debit.toFixed(2)}</td>
                <td className="num">{totaux.credit.toFixed(2)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          </div>
          <button type="button" className="btn btn-ghost mt-24" onClick={() => ajouterLigneManuelle()}>
            + Ajouter une ligne à la fin
          </button>
          <p className="text-muted" style={{ fontSize: 12.5 }}>
            Une opération oubliée par la lecture automatique (page trop peu lisible, annotation manuscrite…) ? Utilisez ➕ sur
            n'importe quelle ligne pour insérer une opération juste au-dessus (au milieu du relevé), ou le bouton ci-dessus
            pour ajouter à la fin.
          </p>

          <button className="btn btn-primary mt-24" onClick={handleImport} disabled={importing}>
            {importing ? 'Import en cours…' : `Importer ${operations.filter((o) => o.include).length} écriture(s)`}
          </button>
        </div>
      )}
      </div>

      {/* --- Aperçu du document original, à droite, pour pointer facilement
          les informations pendant la vérification du tableau --- */}
      {fileUrl && (
        <div
          className="no-print"
          style={{ flex: '0 0 440px', flexShrink: 0, width: 440, maxWidth: '100%', position: 'sticky', top: 12, alignSelf: 'flex-start' }}
        >
          <div className="card" style={{ padding: 10 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Document original</h2>
            {fileEstPdf ? (
              <iframe
                src={fileUrl}
                title="Relevé original"
                style={{ width: '100%', height: '82vh', border: '1px solid var(--border)', borderRadius: 6 }}
              />
            ) : (
              <img
                src={fileUrl}
                alt="Relevé original"
                style={{ width: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScanFacture() {
  const { activeCompany, activeFiscalYear } = useCompany();
  // L'onglet initial suit le paramètre ?type=achat|vente|releve de l'URL
  // (utilisé par les liens du menu Saisie / de la barre d'outils), avec
  // "achat" par défaut si absent ou invalide.
  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get('type');
  const [mode, setMode] = useState(['achat', 'vente', 'releve'].includes(typeParam) ? typeParam : 'achat');

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Scan de documents</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header no-print">
        <h1>Scan de documents</h1>
        <p>Photographiez ou importez (PDF/image) une facture ou un relevé bancaire : les champs sont détectés automatiquement, à vérifier avant enregistrement.</p>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${mode === 'achat' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('achat')}>
          Facture d'achat
        </button>
        <button className={`btn ${mode === 'vente' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('vente')}>
          Facture de vente
        </button>
        <button className={`btn ${mode === 'releve' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('releve')}>
          Relevé bancaire
        </button>
      </div>

      {mode === 'releve' ? (
        <ReleveScanTab activeCompany={activeCompany} activeFiscalYear={activeFiscalYear} />
      ) : (
        <FactureScanTab mode={mode} activeCompany={activeCompany} activeFiscalYear={activeFiscalYear} />
      )}
    </div>
  );
}
