import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { useToolbarActions } from '../ToolbarContext';
import CompanySelectGate from '../components/CompanySelectGate';
import AccountPicker from '../components/AccountPicker';
import LegalWarningModal from '../components/LegalWarningModal';
import PrintHeader from '../components/PrintHeader';
import DateInputFR from '../components/DateInputFR';
import { formatDateFR } from '../utils/dateFr';

const emptyLine = () => ({ account_id: '', debit: '', credit: '', tiers: '', libelle: '' });

function EcrituresContent() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef(null);

  const [header, setHeader] = useState({ journal_id: '', date_ecriture: '', libelle: '', numero_piece: '' });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);

  // File d'attente des avertissements légaux à confirmer (solde de caisse,
  // plafond espèces fournisseur...) avant l'enregistrement définitif.
  const [pendingWarnings, setPendingWarnings] = useState([]);
  const [warningIndex, setWarningIndex] = useState(0);

  // --- Filtre de consultation (comme l'écran "Consultation des écritures
  // comptables" du logiciel de bureau : période, journal, compte avec mode
  // de recherche, montant Débit/Crédit) ---------------------------------
  const [filtre, setFiltre] = useState({
    periodeDebut: '',
    periodeFin: '',
    journalMode: 'tous', // 'tous' | 'ce'
    journalId: '',
    compteMode: 'tous', // 'tous' | 'ce'
    compteTexte: '',
    compteMatch: 'commence', // 'exact' | 'commence' | 'plage'
    comptePlageFin: '',
    montantSens: 'dac', // 'dac' | 'debit' | 'credit'
    montantOperateur: '=', // '=' | '>' | '<'
    montantValeur: '',
  });
  useEffect(() => {
    if (!activeFiscalYear) return;
    setFiltre((f) => ({ ...f, periodeDebut: activeFiscalYear.date_debut, periodeFin: activeFiscalYear.date_fin }));
  }, [activeFiscalYear]);

  // --- Clic droit sur une ligne : Réimputer / Supprimer / Valider, sur
  // cette seule écriture ou sur toutes celles actuellement affichées -----
  const [menu, setMenu] = useState(null); // { x, y, entry }
  const [reimputer, setReimputer] = useState(null); // { champ: 'compte'|'journal'|'date', portee: 'une'|'toutes' }
  const [reimputerValeur, setReimputerValeur] = useState('');
  const [reimputerBusy, setReimputerBusy] = useState(false);
  const [reimputerMessage, setReimputerMessage] = useState('');

  useEffect(() => {
    function fermerMenu() { setMenu(null); }
    window.addEventListener('click', fermerMenu);
    window.addEventListener('scroll', fermerMenu, true);
    return () => {
      window.removeEventListener('click', fermerMenu);
      window.removeEventListener('scroll', fermerMenu, true);
    };
  }, []);

  const loadEntries = useCallback(async () => {
    if (!activeCompany) return;
    const list = await api.getEntries(activeCompany.id);
    setEntries(list);
  }, [activeCompany]);

  const loadAccounts = useCallback(async () => {
    if (!activeCompany) return;
    const list = await api.getAccounts(activeCompany.id);
    setAccounts(list);
  }, [activeCompany]);

  useEffect(() => {
    if (!activeCompany) return;
    loadAccounts();
    api.getJournals(activeCompany.id).then((js) => {
      setJournals(js);
      setHeader((h) => ({ ...h, journal_id: js[0]?.id || '' }));
    });
    loadEntries();
  }, [activeCompany, loadEntries, loadAccounts]);

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  useToolbarActions({
    onAdd: addLine,
    onSave: () => formRef.current?.requestSubmit(),
    addLabel: 'Ajouter ligne',
    saveLabel: 'Enregistrer',
  });

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const equilibre = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  function buildLignesPayload() {
    return lines
      .filter((l) => l.account_id)
      .map((l) => ({
        account_id: Number(l.account_id),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        tiers: l.tiers || null,
        libelle: l.libelle || null,
      }));
  }

  async function actuallySave() {
    setLoading(true);
    try {
      await api.createEntry(activeCompany.id, {
        ...header,
        fiscal_year_id: activeFiscalYear.id,
        lignes: buildLignesPayload(),
      });
      setLines([emptyLine(), emptyLine()]);
      setHeader((h) => ({ ...h, libelle: '', numero_piece: '' }));
      loadEntries();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!activeFiscalYear) {
      setError("Aucun exercice comptable actif pour cette société.");
      return;
    }
    setLoading(true);
    try {
      const { warnings } = await api.precheckEntry(activeCompany.id, {
        date_ecriture: header.date_ecriture,
        lignes: buildLignesPayload(),
      });
      setLoading(false);
      if (warnings && warnings.length > 0) {
        setPendingWarnings(warnings);
        setWarningIndex(0);
        return;
      }
      await actuallySave();
    } catch (err) {
      setLoading(false);
      setError(err.message);
    }
  }

  function handleWarningConfirm() {
    if (warningIndex + 1 < pendingWarnings.length) {
      setWarningIndex(warningIndex + 1);
    } else {
      setPendingWarnings([]);
      setWarningIndex(0);
      actuallySave();
    }
  }

  function handleWarningCancel() {
    setPendingWarnings([]);
    setWarningIndex(0);
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette écriture ?')) return;
    await api.deleteEntry(id);
    loadEntries();
  }

  // Lignes affichées après filtre : une ligne comptable par ligne de
  // tableau (pas de regroupement par écriture), pour que le filtre "Ce
  // compte" et le montant restent lisibles — comme sur l'écran du logiciel
  // de bureau, où chaque ligne affiche toujours sa date/journal/pièce.
  const lignesAffichees = useMemo(() => {
    let res = entries.filter((entry) => {
      if (filtre.periodeDebut && entry.date_ecriture < filtre.periodeDebut) return false;
      if (filtre.periodeFin && entry.date_ecriture > filtre.periodeFin) return false;
      if (filtre.journalMode === 'ce' && filtre.journalId && String(entry.journal_id) !== String(filtre.journalId)) return false;
      return true;
    });
    let lignes = res.flatMap((entry) => entry.lignes.map((ligne) => ({ entry, ligne })));

    if (filtre.compteMode === 'ce' && filtre.compteTexte.trim()) {
      const cible = filtre.compteTexte.trim();
      lignes = lignes.filter(({ ligne }) => {
        const num = ligne.account_numero || '';
        if (filtre.compteMatch === 'exact') return num === cible;
        if (filtre.compteMatch === 'plage') return num >= cible && (!filtre.comptePlageFin || num <= filtre.comptePlageFin);
        return num.startsWith(cible); // 'commence'
      });
    }

    if (filtre.montantValeur !== '' && !Number.isNaN(Number(filtre.montantValeur))) {
      const val = Number(filtre.montantValeur);
      lignes = lignes.filter(({ ligne }) => {
        let montant;
        if (filtre.montantSens === 'debit') montant = ligne.debit || 0;
        else if (filtre.montantSens === 'credit') montant = ligne.credit || 0;
        else montant = (ligne.debit || 0) > 0 ? ligne.debit : ligne.credit || 0;
        if (filtre.montantOperateur === '=') return Math.abs(montant - val) < 0.005;
        if (filtre.montantOperateur === '>') return montant > val;
        if (filtre.montantOperateur === '<') return montant < val;
        return true;
      });
    }

    return lignes;
  }, [entries, filtre]);

  function ouvrirMenu(e, entry, ligne) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry, ligne });
  }

  function demarrerReimputer(champ, portee) {
    const { entry, ligne } = menu;
    setMenu(null);
    setReimputerMessage('');
    setReimputerValeur(champ === 'date' ? entry.date_ecriture : '');
    setReimputer({ champ, portee, entryId: entry.id, ligneId: ligne.id });
  }

  async function confirmerReimputer() {
    if (!reimputer || !reimputerValeur) return;
    setReimputerBusy(true);
    setReimputerMessage('');
    try {
      const { champ, portee } = reimputer;
      let ids;
      let res;
      if (champ === 'compte') {
        ids = portee === 'une' ? [reimputer.ligneId] : lignesAffichees.map(({ ligne }) => ligne.id);
        res = await api.reimputerCompte(activeCompany.id, ids, reimputerValeur.trim());
        setReimputerMessage(`${res.updated} ligne(s) réimputée(s) vers le compte ${res.compte.numero} — ${res.compte.intitule}.`);
      } else if (champ === 'journal') {
        ids = portee === 'une' ? [reimputer.entryId] : [...new Set(lignesAffichees.map(({ entry: e }) => e.id))];
        res = await api.reimputerJournal(activeCompany.id, ids, reimputerValeur.trim());
        setReimputerMessage(`${res.updated} écriture(s) réimputée(s) vers le journal ${res.journal.code}.`);
      } else {
        ids = portee === 'une' ? [reimputer.entryId] : [...new Set(lignesAffichees.map(({ entry: e }) => e.id))];
        res = await api.reimputerDate(activeCompany.id, ids, reimputerValeur);
        setReimputerMessage(`${res.updated} écriture(s) réimputée(s) à la date ${formatDateFR(reimputerValeur)}.`);
      }
      await loadEntries();
    } catch (err) {
      setReimputerMessage(`Erreur : ${err.message}`);
    } finally {
      setReimputerBusy(false);
    }
  }

  async function handleDeleteMasse() {
    const ids = [...new Set(lignesAffichees.map(({ entry: e }) => e.id))];
    if (ids.length === 0) return;
    if (!confirm(`Supprimer les ${ids.length} écriture(s) actuellement affichée(s) ? Cette action est irréversible.`)) return;
    setMenu(null);
    try {
      const res = await api.supprimerEntriesMasse(activeCompany.id, ids);
      if (res.ignorees > 0) {
        alert(`${res.deleted} écriture(s) supprimée(s). ${res.ignorees} écriture(s) validée(s) n'ont pas été supprimées.`);
      }
      await loadEntries();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <div className="page-header no-print">
        <h1>Écritures comptables — Par pièce</h1>
        <p>Saisie en partie double — le débit doit toujours équilibrer le crédit. Tapez un numéro de compte inexistant pour le créer à la volée.</p>
        <Link to="/cnss" className="btn btn-ghost" style={{ marginTop: 8, display: 'inline-block' }}>🛡️ Déclaration CNSS / AMO →</Link>
      </div>

      <div className="card no-print">
        <h2>Nouvelle écriture</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="grid-3">
            <div className="field">
              <label>Journal</label>
              <select required value={header.journal_id} onChange={(e) => setHeader({ ...header, journal_id: e.target.value })}>
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.libelle}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <DateInputFR required value={header.date_ecriture} onChange={(e) => setHeader({ ...header, date_ecriture: e.target.value })} />
            </div>
            <div className="field">
              <label>N° pièce</label>
              <input value={header.numero_piece} onChange={(e) => setHeader({ ...header, numero_piece: e.target.value })} placeholder="F001, BQ012…" />
            </div>
          </div>
          <div className="field">
            <label>Libellé de l'écriture</label>
            <input required value={header.libelle} onChange={(e) => setHeader({ ...header, libelle: e.target.value })} placeholder="Ex : Vente marchandises facture F001" />
          </div>

          <div className="field">
            <label>Lignes</label>
            {lines.map((line, idx) => (
              <div key={idx} className="lines-entry-row">
                <AccountPicker
                  accounts={accounts}
                  value={line.account_id}
                  onChange={(accountId) => updateLine(idx, { account_id: accountId })}
                  companyId={activeCompany.id}
                  onAccountCreated={(created) => setAccounts((prev) => [...prev, created].sort((a, b) => a.numero.localeCompare(b.numero)))}
                />
                <input placeholder="Tiers (optionnel)" value={line.tiers} onChange={(e) => updateLine(idx, { tiers: e.target.value })} />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Débit"
                  value={line.debit}
                  onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Crédit"
                  value={line.credit}
                  onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                />
                <button type="button" className="btn btn-ghost" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={addLine}>
              + Ajouter une ligne
            </button>
          </div>

          <div className="flex-between mt-24" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13 }}>
              Débit : <strong className="num debit">{totalDebit.toFixed(2)} DH</strong> &nbsp;·&nbsp; Crédit :{' '}
              <strong className="num credit">{totalCredit.toFixed(2)} DH</strong>
            </div>
            {equilibre ? <span className="badge badge-ok">Équilibrée</span> : <span className="badge badge-warn">Non équilibrée</span>}
          </div>

          <button className="btn btn-primary" disabled={loading || !equilibre}>
            {loading ? 'Enregistrement…' : "Enregistrer l'écriture"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="flex-between no-print">
          <h2>Consultation des écritures comptables</h2>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
        </div>

        {/* --- Panneau de filtrage (période / journaux / comptes / montant) --- */}
        <div className="no-print" style={{ background: 'var(--ink-800)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Période</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="text-muted" style={{ fontSize: 12.5 }}>Du</span>
                <DateInputFR value={filtre.periodeDebut} onChange={(e) => setFiltre({ ...filtre, periodeDebut: e.target.value })} style={{ width: 130 }} />
                <span className="text-muted" style={{ fontSize: 12.5 }}>Au</span>
                <DateInputFR value={filtre.periodeFin} onChange={(e) => setFiltre({ ...filtre, periodeFin: e.target.value })} style={{ width: 130 }} />
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Journaux</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.journalMode === 'tous'} onChange={() => setFiltre({ ...filtre, journalMode: 'tous' })} /> Tous
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.journalMode === 'ce'} onChange={() => setFiltre({ ...filtre, journalMode: 'ce' })} /> Ce journal
                </label>
                <select
                  value={filtre.journalId}
                  onChange={(e) => setFiltre({ ...filtre, journalMode: 'ce', journalId: e.target.value })}
                  style={{ width: 150 }}
                  disabled={filtre.journalMode !== 'ce'}
                >
                  <option value="">Sélectionner…</option>
                  {journals.map((j) => (
                    <option key={j.id} value={j.id}>{j.code} — {j.libelle}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Comptes</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.compteMode === 'tous'} onChange={() => setFiltre({ ...filtre, compteMode: 'tous' })} /> Tous
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.compteMode === 'ce'} onChange={() => setFiltre({ ...filtre, compteMode: 'ce' })} /> Ce compte
                </label>
                <input
                  value={filtre.compteTexte}
                  onChange={(e) => setFiltre({ ...filtre, compteMode: 'ce', compteTexte: e.target.value })}
                  placeholder="N° de compte…"
                  style={{ width: 110 }}
                  disabled={filtre.compteMode !== 'ce'}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.compteMatch === 'exact'} onChange={() => setFiltre({ ...filtre, compteMatch: 'exact' })} disabled={filtre.compteMode !== 'ce'} /> =
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.compteMatch === 'commence'} onChange={() => setFiltre({ ...filtre, compteMatch: 'commence' })} disabled={filtre.compteMode !== 'ce'} /> commence par
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.compteMatch === 'plage'} onChange={() => setFiltre({ ...filtre, compteMatch: 'plage' })} disabled={filtre.compteMode !== 'ce'} /> +/-
                </label>
                {filtre.compteMatch === 'plage' && (
                  <input
                    value={filtre.comptePlageFin}
                    onChange={(e) => setFiltre({ ...filtre, comptePlageFin: e.target.value })}
                    placeholder="…jusqu'à"
                    style={{ width: 110 }}
                    disabled={filtre.compteMode !== 'ce'}
                  />
                )}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Montant</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select value={filtre.montantOperateur} onChange={(e) => setFiltre({ ...filtre, montantOperateur: e.target.value })} style={{ width: 60 }}>
                  <option value="=">=</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={filtre.montantValeur}
                  onChange={(e) => setFiltre({ ...filtre, montantValeur: e.target.value })}
                  placeholder="Montant"
                  style={{ width: 100 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.montantSens === 'dac'} onChange={() => setFiltre({ ...filtre, montantSens: 'dac' })} /> D&C
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.montantSens === 'debit'} onChange={() => setFiltre({ ...filtre, montantSens: 'debit' })} /> Débit
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                  <input type="radio" checked={filtre.montantSens === 'credit'} onChange={() => setFiltre({ ...filtre, montantSens: 'credit' })} /> Crédit
                </label>
              </div>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            {lignesAffichees.length} ligne(s) affichée(s). Clic droit sur une ligne pour Réimputer (Journal / Compte / Date) ou Supprimer — sur cette écriture ou sur toutes celles affichées.
          </p>
        </div>

        <PrintHeader
          company={activeCompany}
          title="ÉCRITURES COMPTABLES — PAR PIÈCE"
          periodeDebut={filtre.periodeDebut || activeFiscalYear?.date_debut}
          periodeFin={filtre.periodeFin || activeFiscalYear?.date_fin}
        />
        <table className="ledger">
          <thead>
            <tr>
              <th>N° Écri.</th>
              <th>Date</th>
              <th>Jrn</th>
              <th>Pièce</th>
              <th>Libellé</th>
              <th>Compte</th>
              <th>Intitulé</th>
              <th className="num">Débit</th>
              <th className="num">Crédit</th>
              <th>Lettré</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.length === 0 && (
              <tr>
                <td colSpan={11} className="text-muted">Aucune écriture pour ce filtre.</td>
              </tr>
            )}
            {lignesAffichees.map(({ entry, ligne: l }) => {
              const jd = journals.find((j) => j.id === entry.journal_id);
              return (
                <tr key={`${entry.id}-${l.id}`} onContextMenu={(e) => ouvrirMenu(e, entry, l)} style={{ cursor: 'context-menu' }}>
                  <td>{`EC${String(entry.id).padStart(6, '0')}`}</td>
                  <td>{formatDateFR(entry.date_ecriture)}</td>
                  <td>{jd?.code || entry.journal_id}</td>
                  <td>{entry.numero_piece || '—'}</td>
                  <td>{l.libelle || entry.libelle}</td>
                  <td>{l.account_numero}</td>
                  <td>{l.account_intitule}</td>
                  <td className="num debit">{l.debit ? l.debit.toFixed(2) : ''}</td>
                  <td className="num credit">{l.credit ? l.credit.toFixed(2) : ''}</td>
                  <td>{l.lettrage || ''}</td>
                  <td className="no-print">
                    <button type="button" className="btn-icon danger" title="Supprimer" aria-label="Supprimer" onClick={() => handleDelete(entry.id)}>
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>TOTAL</td>
              <td className="num">{lignesAffichees.reduce((s, { ligne }) => s + (ligne.debit || 0), 0).toFixed(2)}</td>
              <td className="num">{lignesAffichees.reduce((s, { ligne }) => s + (ligne.credit || 0), 0).toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* --- Menu contextuel (clic droit) --- */}
      {menu && (
        <div
          className="no-print"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000,
            background: 'var(--land-card)', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 240, fontSize: 13, padding: '6px 0',
          }}
        >
          <div className="ctx-item" onClick={() => { handleDelete(menu.entry.id); setMenu(null); }}>Supprimer cette écriture</div>
          <div className="ctx-item" onClick={handleDeleteMasse}>Supprimer les {lignesAffichees.length} écriture(s) affichée(s)</div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <div style={{ padding: '4px 14px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11.5 }}>RÉIMPUTER CETTE ÉCRITURE</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('journal', 'une')}>→ Journal…</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('compte', 'une')}>→ Compte…</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('date', 'une')}>→ Date…</div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <div style={{ padding: '4px 14px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11.5 }}>RÉIMPUTER LES {lignesAffichees.length} LIGNE(S) AFFICHÉE(S)</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('journal', 'toutes')}>→ Journal…</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('compte', 'toutes')}>→ Compte…</div>
          <div className="ctx-item" onClick={() => demarrerReimputer('date', 'toutes')}>→ Date…</div>
        </div>
      )}

      {/* --- Pop-up Réimputer : "j'écris le compte/journal/date avec quoi on
          voulait changer", exactement comme Réimputer > Compte > Sélection --- */}
      {reimputer && (
        <div className="modal-overlay" onClick={() => setReimputer(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2>
              Réimputer {reimputer.champ === 'compte' ? 'le compte' : reimputer.champ === 'journal' ? 'le journal' : 'la date'}
              {' — '}
              {reimputer.portee === 'une' ? 'cette écriture' : `${lignesAffichees.length} ligne(s) affichée(s)`}
            </h2>
            {reimputerMessage && (
              <div className={`alert ${reimputerMessage.startsWith('Erreur') ? 'alert-error' : 'alert-notice'}`}>{reimputerMessage}</div>
            )}
            {reimputer.champ === 'compte' && (
              <div className="field">
                <label>Nouveau compte (Sélection)</label>
                <AccountPicker
                  accounts={accounts}
                  value={accounts.find((a) => a.numero === reimputerValeur)?.id || ''}
                  onChange={(accountId) => setReimputerValeur(accounts.find((a) => String(a.id) === String(accountId))?.numero || '')}
                  companyId={activeCompany.id}
                  onAccountCreated={(created) => setAccounts((prev) => [...prev, created].sort((a, b) => a.numero.localeCompare(b.numero)))}
                />
              </div>
            )}
            {reimputer.champ === 'journal' && (
              <div className="field">
                <label>Nouveau journal</label>
                <select value={reimputerValeur} onChange={(e) => setReimputerValeur(e.target.value)}>
                  <option value="">Sélectionner…</option>
                  {journals.map((j) => (
                    <option key={j.id} value={j.code}>{j.code} — {j.libelle}</option>
                  ))}
                </select>
              </div>
            )}
            {reimputer.champ === 'date' && (
              <div className="field">
                <label>Nouvelle date</label>
                <DateInputFR value={reimputerValeur} onChange={(e) => setReimputerValeur(e.target.value)} />
              </div>
            )}
            <div className="mt-24" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setReimputer(null)}>Fermer</button>
              <button type="button" className="btn btn-primary" onClick={confirmerReimputer} disabled={reimputerBusy || !reimputerValeur}>
                {reimputerBusy ? 'Application…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LegalWarningModal warning={pendingWarnings[warningIndex]} onConfirm={handleWarningConfirm} onCancel={handleWarningCancel} />
    </div>
  );
}

export default function Ecritures() {
  return (
    <CompanySelectGate title="Écritures comptables — Par pièce">
      <EcrituresContent />
    </CompanySelectGate>
  );
}
