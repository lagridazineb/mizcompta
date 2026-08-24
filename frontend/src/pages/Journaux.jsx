import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { formatDateFR } from '../utils/dateFr';
import PrintHeader from '../components/PrintHeader';
import DateInputFR from '../components/DateInputFR';

// Reproduit l'écran "Journaux" du logiciel de référence (voir capture) :
// une liste de journaux à cocher à gauche, une période Du/Au et des options
// d'affichage à droite, puis Afficher / Imprimer / (ici) Journal Centralisateur.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Journaux() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [journals, setJournals] = useState([]);
  const [checked, setChecked] = useState({});
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState(todayISO());
  const [afficherNumeroPiece, setAfficherNumeroPiece] = useState(false);
  const [regroupeParMois, setRegroupeParMois] = useState(false);
  const [neAffichePasIntitule, setNeAffichePasIntitule] = useState(false);
  const [entries, setEntries] = useState(null); // null = rien affiché encore
  const [loading, setLoading] = useState(false);
  const [vue, setVue] = useState('journal'); // 'journal' | 'centralisateur'
  const [centralisateur, setCentralisateur] = useState(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await api.getJournals(activeCompany.id);
    setJournals(rows);
    setChecked((prev) => {
      // Garde les cases déjà cochées ; coche tout par défaut au premier chargement.
      if (Object.keys(prev).length) return prev;
      const initial = {};
      rows.forEach((j) => {
        initial[j.code] = true;
      });
      return initial;
    });
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeFiscalYear && !dateDebut) setDateDebut(activeFiscalYear.date_debut);
  }, [activeFiscalYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const codesCoches = useMemo(() => journals.filter((j) => checked[j.code]).map((j) => j.code), [journals, checked]);

  function toggleJournal(code) {
    setChecked((c) => ({ ...c, [code]: !c[code] }));
  }
  function toutCocher(valeur) {
    const next = {};
    journals.forEach((j) => {
      next[j.code] = valeur;
    });
    setChecked(next);
  }

  async function afficher() {
    if (!activeCompany || codesCoches.length === 0) return;
    setLoading(true);
    setVue('journal');
    try {
      const rows = await api.getEntries(activeCompany.id, {
        journal_codes: codesCoches.join(','),
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
      });
      // Ordre chronologique pour une lecture "journal", quel que soit
      // l'ordre renvoyé par l'API (utilisé ailleurs dans l'ordre inverse).
      rows.sort((a, b) => (a.date_ecriture < b.date_ecriture ? -1 : a.date_ecriture > b.date_ecriture ? 1 : a.id - b.id));
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }

  async function afficherCentralisateur() {
    if (!activeCompany) return;
    setLoading(true);
    setVue('centralisateur');
    try {
      const res = await api.getJournalCentralisateur(activeCompany.id, {
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
      });
      setCentralisateur(res);
    } finally {
      setLoading(false);
    }
  }

  function imprimer() {
    window.print();
  }

  // Regroupement par mois (option "Regroupé par Mois") : les écritures
  // affichées sont réparties sous un intercalaire "Mois AAAA".
  const groupes = useMemo(() => {
    if (!entries) return [];
    if (!regroupeParMois) return [{ titre: null, lignes: entries }];
    const parMois = new Map();
    for (const e of entries) {
      const mois = (e.date_ecriture || '').slice(0, 7); // AAAA-MM
      if (!parMois.has(mois)) parMois.set(mois, []);
      parMois.get(mois).push(e);
    }
    return Array.from(parMois.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mois, lignes]) => ({ titre: formatMoisFR(mois), lignes }));
  }, [entries, regroupeParMois]);

  function formatMoisFR(moisISO) {
    const [y, m] = moisISO.split('-');
    const noms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    return `${noms[Number(m) - 1]} ${y}`;
  }

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Journaux</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header no-print">
        <h1>Journaux</h1>
        <p>Consultation et impression des journaux comptables — sélectionnez un ou plusieurs journaux et une période.</p>
      </div>

      <div className="card no-print" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* --- Colonne gauche : liste des journaux à cocher --- */}
        <div style={{ minWidth: 180 }}>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Journaux</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => toutCocher(true)}>
              Tout
            </button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => toutCocher(false)}>
              Aucun
            </button>
          </div>
          {journals.map((j) => (
            <label key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!checked[j.code]} onChange={() => toggleJournal(j.code)} />
              <strong style={{ minWidth: 32 }}>{j.code}</strong>
              <span className="text-muted" style={{ fontSize: 12.5 }}>{j.libelle}</span>
            </label>
          ))}
          {journals.length === 0 && <p className="text-muted">Aucun journal pour le moment.</p>}
        </div>

        {/* --- Colonne droite : période + options + actions --- */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="grid-3">
            <div className="field">
              <label>Du</label>
              <DateInputFR value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="field">
              <label>Au</label>
              <DateInputFR value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={afficherNumeroPiece} onChange={(e) => setAfficherNumeroPiece(e.target.checked)} />
            Afficher N° Pièce
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={regroupeParMois} onChange={(e) => setRegroupeParMois(e.target.checked)} />
            Regroupé par Mois
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={neAffichePasIntitule} onChange={(e) => setNeAffichePasIntitule(e.target.checked)} />
            Ne pas afficher l'intitulé du compte
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={codesCoches.length === 0 || loading} onClick={afficher}>
              Afficher (F3)
            </button>
            <button type="button" className="btn btn-ghost" disabled={!entries || loading} onClick={imprimer}>
              🖶 Imprimer (F4)
            </button>
            <button type="button" className="btn btn-ghost" disabled={loading} onClick={afficherCentralisateur}>
              État Journal Centralisateur
            </button>
          </div>
        </div>
      </div>

      {/* --- Résultat : détail par journal --- */}
      {vue === 'journal' && entries && (
        <div className="card">
          <PrintHeader company={activeCompany} title="JOURNAUX" periodeDebut={dateDebut} periodeFin={dateFin} />
          {loading && <p className="text-muted no-print">Chargement…</p>}
          {!loading && entries.length === 0 && <p className="text-muted">Aucune écriture pour cette sélection.</p>}
          {!loading &&
            groupes.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 18 }}>
                {g.titre && <h3 style={{ margin: '10px 0 6px' }}>{g.titre}</h3>}
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      {afficherNumeroPiece && <th>N° Pièce</th>}
                      {!neAffichePasIntitule && <th>Compte</th>}
                      <th>Libellé</th>
                      <th className="num">Débit</th>
                      <th className="num">Crédit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lignes.map((e) =>
                      e.lignes.map((l, li) => (
                        <tr key={`${e.id}-${l.id}`}>
                          {li === 0 ? <td>{formatDateFR(e.date_ecriture)}</td> : <td></td>}
                          {li === 0 ? <td>{journals.find((j) => j.id === e.journal_id)?.code || ''}</td> : <td></td>}
                          {afficherNumeroPiece && (li === 0 ? <td>{e.numero_piece || ''}</td> : <td></td>)}
                          {!neAffichePasIntitule && (
                            <td>
                              {l.account_numero} — {l.account_intitule}
                            </td>
                          )}
                          <td>{l.libelle || e.libelle}</td>
                          <td className="num">{l.debit ? l.debit.toFixed(2) : ''}</td>
                          <td className="num">{l.credit ? l.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      )}

      {/* --- Résultat : état Journal Centralisateur --- */}
      {vue === 'centralisateur' && centralisateur && (
        <div className="card">
          <PrintHeader company={activeCompany} title="ÉTAT JOURNAL CENTRALISATEUR" periodeDebut={dateDebut} periodeFin={dateFin} />
          {loading && <p className="text-muted no-print">Chargement…</p>}
          {!loading &&
            centralisateur.journaux
              .filter((j) => j.total_debit || j.total_credit)
              .map((j) => (
                <div key={j.journal.id} style={{ marginBottom: 18 }}>
                  <h3 style={{ margin: '10px 0 6px' }}>
                    {j.journal.code} — {j.journal.libelle}
                  </h3>
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>N° Compte</th>
                        <th>Intitulé</th>
                        <th className="num">Débit</th>
                        <th className="num">Crédit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.lignes.map((l) => (
                        <tr key={l.compte_numero}>
                          <td>{l.compte_numero}</td>
                          <td>{l.compte_intitule}</td>
                          <td className="num">{l.total_debit ? l.total_debit.toFixed(2) : ''}</td>
                          <td className="num">{l.total_credit ? l.total_credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} style={{ fontWeight: 700 }}>Total {j.journal.code}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{j.total_debit.toFixed(2)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{j.total_credit.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
          {!loading && (
            <div className="flex-between" style={{ fontWeight: 700, marginTop: 10 }}>
              <span>Total général</span>
              <span>
                Débit : {centralisateur.total_debit.toFixed(2)} — Crédit : {centralisateur.total_credit.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
