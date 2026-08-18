import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import PrintHeader from '../components/PrintHeader';
import AnnexeManuelle from '../components/AnnexeManuelle';
import DownloadMenu from '../components/DownloadMenu';

function fmt(n) {
  if (n == null || n === 0) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function fmtDateFR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Ligne({ label, brut, amort, net, precedent, indent, bold, sub }) {
  return (
    <tr>
      <td style={{ paddingLeft: sub ? 38 : indent ? 22 : 8, fontWeight: bold ? 700 : 400, fontSize: sub ? 12.5 : undefined, color: sub ? 'var(--text-muted)' : undefined }}>{label}</td>
      <td className="num" style={{ fontSize: sub ? 12.5 : undefined }}>{fmt(brut)}</td>
      <td className="num" style={{ fontSize: sub ? 12.5 : undefined }}>{fmt(amort)}</td>
      <td className="num" style={{ fontWeight: bold ? 700 : 400, fontSize: sub ? 12.5 : undefined }}>{fmt(net)}</td>
      <td className="num" style={{ fontSize: sub ? 12.5 : undefined }}>{fmt(precedent)}</td>
    </tr>
  );
}
function Ligne2 ({ label, montant, precedent, bold, indent, sub }) {
  return (
    <tr>
      <td style={{ paddingLeft: sub ? 38 : indent ? 22 : 8, fontWeight: bold ? 700 : 400, fontSize: sub ? 12.5 : undefined, color: sub ? 'var(--text-muted)' : undefined }}>{label}</td>
      <td className="num" style={{ fontWeight: bold ? 700 : 400, fontSize: sub ? 12.5 : undefined }}>{fmt(montant)}</td>
      <td className="num" style={{ fontSize: sub ? 12.5 : undefined }}>{fmt(precedent)}</td>
    </tr>
  );
}
// Sous-postes détaillés d'une rubrique du Bilan Actif (ex: Terrains,
// Constructions… sous IMMOBILISATIONS CORPORELLES) — toujours affichés,
// même à 0, pour reproduire la forme complète du modèle officiel.
function SousLignesActif({ items }) {
  if (!items || items.length === 0) return null;
  return items.map((it, i) => (
    <Ligne key={i} label={it.label} brut={it.brut} amort={it.amort} net={it.net} precedent={it.precedentNet} sub />
  ));
}
function SousLignesPassif({ items }) {
  if (!items || items.length === 0) return null;
  return items.map((it, i) => (
    <Ligne2 key={i} label={it.label} montant={it.montant} precedent={it.precedent} sub />
  ));
}

const COLONNES = {
  T7: [
    { key: 'nature', label: 'Nature' }, { key: 'rubrique', label: 'Rubrique' }, { key: 'date_contrat', label: 'Échéance' },
    { key: 'duree_contrat_mois', label: 'Durée (mois)' }, { key: 'valeur_contrat', label: 'Valeur au contrat' },
    { key: 'redevance_exercice', label: 'Redevance exercice' }, { key: 'redevance_precedent', label: 'Redevance N-1' },
    { key: 'redevance_restant_moins_1an', label: 'Restant (-1 an)' }, { key: 'redevance_restant_plus_1an', label: 'Restant (+1 an)' },
    { key: 'prix_residuel', label: 'Prix résiduel' }, { key: 'observation', label: 'Observation' },
  ],
  T9: [
    { key: 'nature', label: 'Nature' }, { key: 'montant_debut', label: 'Montant début exercice' },
    { key: 'dotation_exploitation', label: 'Dotations exploitation' }, { key: 'dotation_financiere', label: 'Dotations financières' },
    { key: 'dotation_non_courante', label: 'Dotations non courantes' }, { key: 'reprise_exploitation', label: 'Reprises exploitation' },
    { key: 'reprise_financiere', label: 'Reprises financières' }, { key: 'reprise_non_courante', label: 'Reprises non courantes' },
    { key: 'montant_fin', label: 'Montant fin exercice' },
  ],
  T10: [
    { key: 'date_cession', label: 'Date cession' }, { key: 'compte', label: 'Compte principal' }, { key: 'montant_brut', label: 'Montant brut' },
    { key: 'amort_cumules', label: 'Amort. cumulés' }, { key: 'valeur_nette', label: 'Val. nette amortie' },
    { key: 'produit_cession', label: 'Produit de cession' }, { key: 'plus_value', label: 'Plus-value' }, { key: 'moins_value', label: 'Moins-value' },
  ],
  T11: [
    { key: 'raison_sociale', label: 'Raison sociale émettrice' }, { key: 'secteur_activite', label: "Secteur d'activité" },
    { key: 'capital_social', label: 'Capital social' }, { key: 'participation_pct', label: 'Participation %' },
    { key: 'prix_acquisition', label: "Prix d'acquisition" }, { key: 'valeur_comptable', label: 'Valeur comptable' },
    { key: 'date_cloture', label: 'Date de clôture' }, { key: 'situation_nette', label: 'Situation nette' },
    { key: 'resultat_net', label: 'Résultat net' }, { key: 'produits_inscrits_cpc', label: 'Produits inscrits au CPC' },
  ],
  T13: [
    { key: 'nom_associe', label: 'Nom / Raison sociale associé' }, { key: 'if_associe', label: 'N° IF' }, { key: 'cin', label: 'N° CIN' },
    { key: 'adresse', label: 'Adresse' }, { key: 'nombre_titres_exercice_precedent', label: 'Titres N-1' },
    { key: 'nombre_titres_exercice_actuel', label: 'Titres N' }, { key: 'part_social_pct', label: 'Part %' },
    { key: 'capital_souscrit', label: 'Capital souscrit' }, { key: 'capital_appele', label: 'Capital appelé' }, { key: 'capital_libere', label: 'Capital libéré' },
  ],
  T14: [{ key: 'libelle', label: 'Libellé' }, { key: 'montant', label: 'Montant' }],
  T16: [
    { key: 'designation', label: 'Désignation' }, { key: 'date_entree', label: "Date d'entrée" }, { key: 'prix_acquisition', label: 'Prix acquisition' },
    { key: 'valeur_comptable', label: 'Valeur comptable' }, { key: 'amortissements_anterieurs', label: 'Amort. antérieurs' },
    { key: 'taux', label: 'Taux %' }, { key: 'duree', label: 'Durée (ans)' }, { key: 'dotation_exercice', label: 'Dotation exercice' },
    { key: 'total_amortissements', label: 'Total amortissements' }, { key: 'observation', label: 'Observation' },
  ],
  T17: [
    { key: 'element', label: 'Éléments' }, { key: 'valeur_apport', label: "Valeur d'apport" }, { key: 'valeur_nette_comptable', label: 'VNC' },
    { key: 'plus_value_constatee', label: 'Plus-value constatée' }, { key: 'plus_value_anterieure', label: 'Plus-value antérieure' },
    { key: 'plus_value_actuelle', label: 'Plus-value actuelle' }, { key: 'cumul_plus_value_rapportee', label: 'Cumul rapporté' },
    { key: 'solde_non_impute', label: 'Solde non imputé' }, { key: 'observation', label: 'Observation' },
  ],
  T18: [
    { key: 'raison_sociale', label: 'Raison sociale' }, { key: 'adresse', label: 'Adresse' }, { key: 'cin', label: 'CIN' },
    { key: 'montant_pret', label: 'Montant du prêt' }, { key: 'date_pret', label: 'Date du prêt' }, { key: 'duree_mois', label: 'Durée (mois)' },
    { key: 'taux_interet', label: "Taux d'intérêt" }, { key: 'charge_financiere', label: 'Charge financière' },
    { key: 'remboursement_principal', label: 'Remb. principal' }, { key: 'remboursement_interet', label: 'Remb. intérêt' }, { key: 'observation', label: 'Observation' },
  ],
  T19: [
    { key: 'nature_bien', label: 'Nature du bien loué' }, { key: 'lieu', label: 'Lieu de situation' }, { key: 'proprietaire', label: 'Propriétaire' },
    { key: 'adresse_proprietaire', label: 'Adresse propriétaire' }, { key: 'if_proprietaire', label: 'IF propriétaire' },
    { key: 'date_conclusion', label: 'Date de conclusion' }, { key: 'montant_annuel', label: 'Montant annuel' },
    { key: 'montant_charge_exercice', label: 'Montant en charges' }, { key: 'type_contrat', label: 'Type de contrat' }, { key: 'observation', label: 'Observation' },
  ],
  T20: [
    { key: 'libelle', label: 'Libellé' }, { key: 'stock_initial_brut', label: 'Stock initial brut' }, { key: 'stock_initial_provision', label: 'Provision initiale' },
    { key: 'stock_initial_net', label: 'Stock initial net' }, { key: 'stock_final_brut', label: 'Stock final brut' },
    { key: 'stock_final_provision', label: 'Provision finale' }, { key: 'stock_final_net', label: 'Stock final net' }, { key: 'variation', label: 'Variation' },
  ],
};

const TABLEAUX = [
  { key: 'garde', label: 'Page de garde (déclaration fiscale)' },
  { key: 'actif', label: 'T1 — Bilan Actif' },
  { key: 'passif', label: 'T1 — Bilan Passif' },
  { key: 'cpc', label: 'T2 — C.P.C.' },
  { key: 'T3', label: 'T3 — Passage résultat comptable → fiscal' },
  { key: 'T4', label: 'T4 — Tableau des immobilisations' },
  { key: 'T5', label: 'T5 — État des Soldes de Gestion (ESG)' },
  { key: 'T6', label: 'T6 — Détail des postes du CPC' },
  { key: 'T7', label: 'T7 — Biens en crédit-bail' },
  { key: 'T8', label: 'T8 — Tableau des amortissements' },
  { key: 'T9', label: 'T9 — Tableau des provisions' },
  { key: 'T10', label: 'T10 — Plus/moins-values sur cessions' },
  { key: 'T11', label: 'T11 — Titres de participation' },
  { key: 'T12', label: 'T12 — Détail de la TVA' },
  { key: 'T13', label: 'T13 — Répartition du capital social' },
  { key: 'T14', label: "T14 — Affectation des résultats" },
  { key: 'T16', label: 'T16 — État des dotations aux amortissements' },
  { key: 'T17', label: 'T17 — Plus-values constatées en cas de fusion' },
  { key: 'T18', label: 'T18 — Intérêts des emprunts auprès des associés' },
  { key: 'T19', label: 'T19 — Locations et baux (hors crédit-bail)' },
  { key: 'T20', label: 'T20 — État détaillé des stocks' },
  { key: 'financement', label: 'Tableau de financement — synthèse des masses' },
];

export default function Bilan() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [data, setData] = useState(null);
  const [annexes, setAnnexes] = useState(null);
  const [immobilisations, setImmobilisations] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingTableau, setSavingTableau] = useState('');
  const [selection, setSelection] = useState(() => Object.fromEntries(TABLEAUX.map((t) => [t.key, true])));
  const [t3Overrides, setT3Overrides] = useState({});

  const load = useCallback(() => {
    if (!activeCompany || !activeFiscalYear) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.getLiasseComplete(activeCompany.id, activeFiscalYear.id, t3Overrides),
      api.getEtatsAnnexes(activeCompany.id, activeFiscalYear.id),
      api.getImmobilisations(activeCompany.id),
    ])
      .then(([liasse, ann, immos]) => {
        setData(liasse);
        setAnnexes(ann.tableaux);
        setImmobilisations(immos);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeCompany, activeFiscalYear, t3Overrides]);

  useEffect(() => { load(); }, [load]);

  // T16 — "État des dotations aux amortissements" : au lieu de partir d'un
  // tableau vide à remplir à la main, on le préremplit automatiquement à
  // partir des plans d'amortissement du module Immobilisations pour
  // l'exercice affiché (avec la date d'acquisition et le prorata déjà
  // calculés là-bas). Reste modifiable/complétable comme les autres annexes
  // manuelles ; dès qu'une version a été enregistrée (annexes.T16 non vide),
  // on affiche celle-ci plutôt que de régénérer par-dessus.
  const anneeExercice = data?.exercice ? Number(data.exercice.date_fin.slice(0, 4)) : null;
  const t16Auto = React.useMemo(() => {
    if (!anneeExercice) return [];
    const lignes = [];
    for (const immo of immobilisations) {
      const l = (immo.lignes || []).find((x) => x.annee === anneeExercice);
      if (!l || l.dotation <= 0) continue;
      lignes.push({
        designation: `${immo.objet}${immo.nature ? ' — ' + immo.nature : ''}`,
        date_entree: fmtDateFR(immo.date_acquisition),
        prix_acquisition: l.base_amortissable.toFixed(2),
        valeur_comptable: l.base_amortissable.toFixed(2),
        amortissements_anterieurs: (l.cumul - l.dotation).toFixed(2),
        taux: `${l.taux}`,
        duree: `${immo.duree_annees}`,
        dotation_exercice: l.dotation.toFixed(2),
        total_amortissements: l.cumul.toFixed(2),
        observation: l.journal_entry_id ? 'Écriture générée' : '',
      });
    }
    return lignes;
  }, [immobilisations, anneeExercice]);
  const t16Lignes = annexes?.T16 && annexes.T16.length > 0 ? annexes.T16 : t16Auto;

  function toggleAll(value) {
    setSelection(Object.fromEntries(TABLEAUX.map((t) => [t.key, value])));
  }

  async function saveAnnexe(code, lignes) {
    setSavingTableau(code);
    try {
      await api.saveEtatAnnexe(activeCompany.id, code, activeFiscalYear.id, lignes);
      setAnnexes({ ...annexes, [code]: lignes });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTableau('');
    }
  }

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;
  if (!activeFiscalYear) return <p className="text-muted">Aucun exercice comptable actif pour cette société.</p>;

  const selectedCount = Object.values(selection).filter(Boolean).length;
  const periodeDebut = data?.exercice.date_debut;
  const periodeFin = data?.exercice.date_fin;

  return (
    <div>
      <div className="page-header no-print">
        <h1>Bilan &amp; Liasse fiscale</h1>
        <p>États de synthèse complets (modèle normal du PCGM) — calculés depuis vos écritures quand c'est possible, saisissables sinon.</p>
      </div>

      <div className="card no-print">
        <div className="flex-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={() => toggleAll(true)}>Sélectionner tous</button>
            <button type="button" className="btn btn-ghost" onClick={() => toggleAll(false)}>Désélectionner tous</button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={selectedCount === 0}>
            🖶 Imprimer ({selectedCount} tableau{selectedCount > 1 ? 'x' : ''})
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 20px' }}>
          {TABLEAUX.map((t) => (
            <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={selection[t.key]}
                onChange={(e) => setSelection({ ...selection, [t.key]: e.target.checked })}
              />
              {t.label}
            </label>
          ))}
        </div>
        {error && <div className="alert alert-error mt-24">{error}</div>}
        {loading && <p className="text-muted mt-24">Calcul des états…</p>}
        {data && !data.bilan.equilibre && (
          <div className="alert alert-error mt-24">
            Le bilan n'est pas équilibré (écart de {fmt(data.bilan.ecart)} DH) — vérifiez vos écritures.
          </div>
        )}
      </div>

      {data && (
        <>
          {selection.garde && (
            <div className="card">
              <div style={{ maxWidth: 640, margin: '0 auto', padding: '10px 0' }}>
                <p style={{ textAlign: 'right', fontStyle: 'italic' }}>MODEL : 100/I.S/N</p>
                <h1 style={{ textAlign: 'center', marginTop: 30 }}>PIECES ANNEXES A LA DECLARATION FISCALE</h1>
                <div style={{ border: '3px solid var(--brass)', padding: 20, margin: '40px 0', textAlign: 'center' }}>
                  <h2 style={{ margin: '0 0 10px' }}>Impôt sur les sociétés</h2>
                  <p style={{ fontStyle: 'italic', fontSize: 17 }}>Modèle Comptable Normal</p>
                  <p style={{ fontWeight: 700, fontSize: 20 }}>Année : {data.exercice.date_fin.slice(0, 4)}</p>
                  <p><strong>Du :</strong> {fmtDateFR(data.exercice.date_debut)} &nbsp;&nbsp; <strong>Au :</strong> {fmtDateFR(data.exercice.date_fin)}</p>
                </div>
                <table className="ledger" style={{ width: '100%', fontSize: 14, lineHeight: 2 }}>
                  <tbody>
                    <tr><td style={{ width: 180, fontWeight: 700 }}>Nom / Raison sociale</td><td>: {data.company.raison_sociale}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>Patente</td><td>: {data.company.patente || '—'}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>RC</td><td>: {data.company.rc || '—'}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>ICE</td><td>: {data.company.ice || '—'}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>Identifiant fiscal</td><td>: {data.company.if_fiscal || '—'}</td></tr>
                    <tr><td style={{ fontWeight: 700, verticalAlign: 'top' }}>Adresse</td><td>: {data.company.adresse || '—'}{data.company.ville ? `, ${data.company.ville}` : ''}</td></tr>
                  </tbody>
                </table>
                <p style={{ marginTop: 50, textAlign: 'right' }}>
                  A : {data.company.ville || '____________'} &nbsp;&nbsp; Le : {fmtDateFR(new Date().toISOString().slice(0, 10))}
                </p>
                <p style={{ marginTop: 60, borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>CADRE RESERVE A L'ADMINISTRATION</p>
                <p style={{ fontSize: 12 }}>Numéro d'Enregistrement de la Déclaration : ……………………………………………………</p>
                <p style={{ fontSize: 12 }}>Date : ……………………………………</p>
              </div>
            </div>
          )}

          {selection.actif && (
            <div className={`card ${selection.garde ? 'page-break' : ''}`}>
              <div className="no-print" style={{ textAlign: 'right', marginBottom: 6 }}>
                <DownloadMenu onDownload={(format) => api.downloadBilan(activeCompany.id, activeFiscalYear.id, 'actif', format)} />
              </div>
              <PrintHeader company={data.company} title="BILAN ACTIF" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead>
                  <tr><th>ACTIF</th><th className="num">Brut</th><th className="num">Amort./Prov.</th><th className="num">Net</th><th className="num">Exercice préc. Net</th></tr>
                </thead>
                <tbody>
                  <Ligne label={data.bilan.actif.A.label} {...data.bilan.actif.A} precedent={data.bilan.actif.precedent?.A} indent bold />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.A} />
                  <Ligne label={data.bilan.actif.B.label} {...data.bilan.actif.B} precedent={data.bilan.actif.precedent?.B} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.B} />
                  <Ligne label={data.bilan.actif.C.label} {...data.bilan.actif.C} precedent={data.bilan.actif.precedent?.C} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.C} />
                  <Ligne label={data.bilan.actif.D.label} {...data.bilan.actif.D} precedent={data.bilan.actif.precedent?.D} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.D} />
                  <Ligne label={data.bilan.actif.E.label} {...data.bilan.actif.E} precedent={data.bilan.actif.precedent?.E} indent />
                  <Ligne label={data.bilan.actif.totalI.label} {...data.bilan.actif.totalI} precedent={data.bilan.actif.precedent?.totalI} bold />
                  <Ligne label={data.bilan.actif.F.label} {...data.bilan.actif.F} precedent={data.bilan.actif.precedent?.F} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.F} />
                  <Ligne label={data.bilan.actif.G.label} {...data.bilan.actif.G} precedent={data.bilan.actif.precedent?.G} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.G} />
                  <Ligne label={data.bilan.actif.H.label} {...data.bilan.actif.H} precedent={data.bilan.actif.precedent?.H} indent />
                  <Ligne label={data.bilan.actif.I.label} {...data.bilan.actif.I} precedent={data.bilan.actif.precedent?.I} indent />
                  <Ligne label={data.bilan.actif.totalII.label} {...data.bilan.actif.totalII} precedent={data.bilan.actif.precedent?.totalII} bold />
                  <Ligne {...data.bilan.actif.tresorerieActif} label="TRESORERIE ACTIF" precedent={data.bilan.actif.precedent?.totalIII} indent />
                  <SousLignesActif items={data.bilan.actif.sousPostes?.tresorerieActif} />
                  <Ligne label={data.bilan.actif.totalIII.label} {...data.bilan.actif.totalIII} precedent={data.bilan.actif.precedent?.totalIII} bold />
                  <Ligne label={data.bilan.actif.totalGeneral.label} {...data.bilan.actif.totalGeneral} precedent={data.bilan.actif.precedent?.totalGeneral} bold />
                </tbody>
              </table>
            </div>
          )}

          {selection.passif && (
            <div className={`card ${selection.actif ? 'page-break' : ''}`}>
              <div className="no-print" style={{ textAlign: 'right', marginBottom: 6 }}>
                <DownloadMenu onDownload={(format) => api.downloadBilan(activeCompany.id, activeFiscalYear.id, 'passif', format)} />
              </div>
              <PrintHeader company={data.company} title="BILAN PASSIF" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>PASSIF</th><th className="num">Exercice</th><th className="num">Exercice précédent</th></tr></thead>
                <tbody>
                  <Ligne2 label="Capitaux propres" montant={data.bilan.passif.capitauxPropres} precedent={data.bilan.passif.precedent?.capitauxPropres} bold />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.A} />
                  <Ligne2 label="Capitaux propres assimilés" montant={data.bilan.passif.capitauxPropresAssimiles} precedent={data.bilan.passif.precedent?.capitauxPropresAssimiles} />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.B} />
                  <Ligne2 label="Dettes de financement" montant={data.bilan.passif.dettesFinancement} precedent={data.bilan.passif.precedent?.dettesFinancement} />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.C} />
                  <Ligne2 label="Provisions durables pour risques et charges" montant={data.bilan.passif.provisionsDurables} precedent={data.bilan.passif.precedent?.provisionsDurables} />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.D} />
                  <Ligne2 label="Écarts de conversion passif" montant={data.bilan.passif.ecartsConversionPassif} precedent={data.bilan.passif.precedent?.ecartsConversionPassif} />
                  <Ligne2 label="TOTAL I (A+B+C+D+E)" montant={data.bilan.passif.totalI} precedent={data.bilan.passif.precedent?.totalI} bold />
                  <Ligne2 label="Dettes du passif circulant" montant={data.bilan.passif.dettesPassifCirculant} precedent={data.bilan.passif.precedent?.dettesPassifCirculant} />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.F} />
                  <Ligne2 label="Autres provisions pour risques et charges" montant={data.bilan.passif.autresProvisions} precedent={data.bilan.passif.precedent?.autresProvisions} />
                  <Ligne2 label="Écarts de conversion passif (éléments circulants)" montant={data.bilan.passif.ecartsConversionPassifCirc} precedent={data.bilan.passif.precedent?.ecartsConversionPassifCirc} />
                  <Ligne2 label="TOTAL II (F+G+H)" montant={data.bilan.passif.totalII} precedent={data.bilan.passif.precedent?.totalII} bold />
                  <Ligne2 label="Trésorerie passif" montant={data.bilan.passif.tresoreriePassif} precedent={data.bilan.passif.precedent?.tresoreriePassif} />
                  <SousLignesPassif items={data.bilan.passif.sousPostes?.tresoreriePassif} />
                  <Ligne2 label="TOTAL III" montant={data.bilan.passif.totalIII} precedent={data.bilan.passif.precedent?.totalIII} bold />
                  <Ligne2 label="TOTAL GENERAL (I+II+III)" montant={data.bilan.passif.totalGeneral} precedent={data.bilan.passif.precedent?.totalGeneral} bold />
                </tbody>
              </table>
            </div>
          )}

          {selection.cpc && (
            <div className={`card ${selection.actif || selection.passif ? 'page-break' : ''}`}>
              <div className="no-print" style={{ textAlign: 'right', marginBottom: 6 }}>
                <DownloadMenu onDownload={(format) => api.downloadBilan(activeCompany.id, activeFiscalYear.id, 'cpc', format)} />
              </div>
              <PrintHeader company={data.company} title="COMPTE DE PRODUITS ET CHARGES (hors taxes)" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>OPÉRATIONS</th><th className="num">Propre à l'exercice</th><th className="num">Exercice précédent</th></tr></thead>
                <tbody>
                  <Ligne2 label="I. Produits d'exploitation" montant={data.cpc.exploitation.totalI} precedent={data.cpcPrecedent?.exploitation.totalI} bold />
                  <Ligne2 label="Ventes de marchandises" montant={data.cpc.exploitation.ventesMarchandises} precedent={data.cpcPrecedent?.exploitation.ventesMarchandises} indent />
                  <Ligne2 label="Ventes de biens et services produits" montant={data.cpc.exploitation.ventes} precedent={data.cpcPrecedent?.exploitation.ventes} indent />
                  <Ligne2 label="Chiffre d'affaires" montant={round2(data.cpc.exploitation.ventes + data.cpc.exploitation.ventesMarchandises)} precedent={data.cpcPrecedent && round2(data.cpcPrecedent.exploitation.ventes + data.cpcPrecedent.exploitation.ventesMarchandises)} bold indent />
                  <Ligne2 label="II. Charges d'exploitation" montant={data.cpc.exploitation.totalII} precedent={data.cpcPrecedent?.exploitation.totalII} bold />
                  <Ligne2 label="III. Résultat d'exploitation (I - II)" montant={data.cpc.exploitation.resultatExploitation} precedent={data.cpcPrecedent?.exploitation.resultatExploitation} bold />
                  <Ligne2 label="IV. Produits financiers" montant={data.cpc.financier.totalIV} precedent={data.cpcPrecedent?.financier.totalIV} />
                  <Ligne2 label="V. Charges financières" montant={data.cpc.financier.totalV} precedent={data.cpcPrecedent?.financier.totalV} />
                  <Ligne2 label="VI. Résultat financier (IV - V)" montant={data.cpc.financier.resultatFinancier} precedent={data.cpcPrecedent?.financier.resultatFinancier} bold />
                  <Ligne2 label="VII. Résultat courant (III + VI)" montant={data.cpc.resultatCourant} precedent={data.cpcPrecedent?.resultatCourant} bold />
                  <Ligne2 label="VIII. Produits non courants" montant={data.cpc.nonCourant.totalVIII} precedent={data.cpcPrecedent?.nonCourant.totalVIII} />
                  <Ligne2 label="IX. Charges non courantes" montant={data.cpc.nonCourant.totalIX} precedent={data.cpcPrecedent?.nonCourant.totalIX} />
                  <Ligne2 label="X. Résultat non courant (VIII - IX)" montant={data.cpc.nonCourant.resultatNonCourant} precedent={data.cpcPrecedent?.nonCourant.resultatNonCourant} bold />
                  <Ligne2 label="XI. Résultat avant impôts (VII + X)" montant={data.cpc.resultatAvantImpots} precedent={data.cpcPrecedent?.resultatAvantImpots} bold />
                  <Ligne2 label="XII. Impôts sur les résultats" montant={data.cpc.impotsResultats} precedent={data.cpcPrecedent?.impotsResultats} />
                  <Ligne2 label="XIII. RÉSULTAT NET (XI - XII)" montant={data.cpc.resultatNet} precedent={data.cpcPrecedent?.resultatNet} bold />
                  <Ligne2 label="TOTAL DES PRODUITS (I+IV+VIII)" montant={data.cpc.totalProduits} precedent={data.cpcPrecedent?.totalProduits} />
                  <Ligne2 label="TOTAL DES CHARGES (II+V+IX+XII)" montant={data.cpc.totalCharges} precedent={data.cpcPrecedent?.totalCharges} />
                  <Ligne2 label="RÉSULTAT NET" montant={data.cpc.resultatNet} precedent={data.cpcPrecedent?.resultatNet} bold />
                </tbody>
              </table>
            </div>
          )}

          {selection.T3 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="PASSAGE DU RESULTAT NET COMPTABLE AU RESULTAT NET FISCAL" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <div className="no-print" style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Réintégrations/déductions additionnelles éventuelles (au-delà de l'IS et des charges non courantes, déjà réintégrés automatiquement) :
                <div className="grid-3" style={{ marginTop: 6 }}>
                  <div className="field"><label>Autres réintégrations</label><input type="number" step="0.01" value={t3Overrides.reintegrations_courantes || ''} onChange={(e) => setT3Overrides({ ...t3Overrides, reintegrations_courantes: Number(e.target.value) })} onBlur={load} /></div>
                  <div className="field"><label>Déductions fiscales</label><input type="number" step="0.01" value={t3Overrides.deductions_courantes || ''} onChange={(e) => setT3Overrides({ ...t3Overrides, deductions_courantes: Number(e.target.value) })} onBlur={load} /></div>
                  <div className="field"><label>Reports déficitaires imputés</label><input type="number" step="0.01" value={t3Overrides.reports_deficitaires_imputes || ''} onChange={(e) => setT3Overrides({ ...t3Overrides, reports_deficitaires_imputes: Number(e.target.value) })} onBlur={load} /></div>
                </div>
              </div>
              <table className="ledger">
                <tbody>
                  <Ligne2 label="I. Résultat net comptable (bénéfice)" montant={data.tableau3.benefice} bold />
                  <Ligne2 label="I. Résultat net comptable (perte)" montant={data.tableau3.perte} bold />
                  <Ligne2 label="II. Réintégrations fiscales — courantes" montant={data.tableau3.reintegrationCourantes} />
                  <Ligne2 label="II. Réintégrations fiscales — non courantes (dont IS et charges non déductibles)" montant={data.tableau3.reintegrationNonCourantes} />
                  <Ligne2 label="Total réintégrations" montant={data.tableau3.totalReintegrations} bold />
                  <Ligne2 label="III. Déductions fiscales" montant={data.tableau3.totalDeductions} />
                  <Ligne2 label="IV. Résultat brut fiscal" montant={data.tableau3.resultatBrutFiscal} bold />
                  <Ligne2 label="V. Reports déficitaires imputés" montant={data.tableau3.reportsDeficitairesImputes} />
                  <Ligne2 label="VI. RÉSULTAT NET FISCAL" montant={data.tableau3.resultatNetFiscal} bold />
                </tbody>
              </table>
            </div>
          )}

          {selection.T4 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="TABLEAU DES IMMOBILISATIONS AUTRES QUE FINANCIERES" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>Nature</th><th className="num">Brut début exercice</th><th className="num">Acquisition</th><th className="num">Cession</th><th className="num">Brut fin exercice</th></tr></thead>
                <tbody>
                  {data.tableauImmobilisations.lignes.map((l) => (
                    <tr key={l.label}><td>{l.label}</td><td className="num">{fmt(l.brutDebut)}</td><td className="num">{fmt(l.acquisition)}</td><td className="num">{fmt(l.cession)}</td><td className="num">{fmt(l.brutFin)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>TOTAL</td><td className="num">{fmt(data.tableauImmobilisations.total.brutDebut)}</td><td className="num">{fmt(data.tableauImmobilisations.total.acquisition)}</td><td className="num">{fmt(data.tableauImmobilisations.total.cession)}</td><td className="num">{fmt(data.tableauImmobilisations.total.brutFin)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}

          {selection.T5 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="ETAT DES SOLDES DE GESTION (E.S.G.)" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>Opérations</th><th className="num">Exercice</th><th className="num">Exercice précédent</th></tr></thead>
                <tbody>
                  <Ligne2 label="Marge brute sur ventes en l'état" montant={data.esg.margeBrute} precedent={data.esgPrecedent?.margeBrute} />
                  <Ligne2 label="Production de l'exercice" montant={data.esg.produitExercice} precedent={data.esgPrecedent?.produitExercice} />
                  <Ligne2 label="Consommation de l'exercice" montant={data.esg.consommationExercice} precedent={data.esgPrecedent?.consommationExercice} />
                  <Ligne2 label="VALEUR AJOUTÉE" montant={data.esg.valeurAjoutee} precedent={data.esgPrecedent?.valeurAjoutee} bold />
                  <Ligne2 label="EXCEDENT BRUT D'EXPLOITATION (EBE)" montant={data.esg.ebe} precedent={data.esgPrecedent?.ebe} bold />
                  <Ligne2 label="RÉSULTAT D'EXPLOITATION" montant={data.esg.resultatExploitation} precedent={data.esgPrecedent?.resultatExploitation} bold />
                  <Ligne2 label="RÉSULTAT COURANT" montant={data.esg.resultatCourant} precedent={data.esgPrecedent?.resultatCourant} bold />
                  <Ligne2 label="RÉSULTAT NON COURANT" montant={data.esg.resultatNonCourant} precedent={data.esgPrecedent?.resultatNonCourant} />
                  <Ligne2 label="RÉSULTAT NET DE L'EXERCICE" montant={data.esg.resultatNet} precedent={data.esgPrecedent?.resultatNet} bold />
                  <Ligne2 label="CAPACITÉ D'AUTOFINANCEMENT (CAF)" montant={data.esg.caf} precedent={data.esgPrecedent?.caf} bold />
                  <Ligne2 label="AUTOFINANCEMENT" montant={data.esg.autofinancement} precedent={data.esgPrecedent?.autofinancement} bold />
                </tbody>
              </table>
            </div>
          )}

          {selection.T6 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title='DETAIL DES POSTES DU C.P.C. "Charges"' periodeDebut={periodeDebut} periodeFin={periodeFin} />
              {data.detailPostesCpc.charges.map((p) => (
                <table className="ledger mt-24" key={p.poste}>
                  <thead><tr><th colSpan={3}>{p.poste} — {p.label}</th></tr></thead>
                  <tbody>
                    {p.comptes.length === 0 && <tr><td colSpan={3} className="text-muted">NEANT</td></tr>}
                    {p.comptes.map((c) => (
                      <tr key={c.numero}><td>{c.numero} {c.intitule}</td><td className="num">{fmt(c.montant)}</td><td className="num">{fmt(c.montantPrec)}</td></tr>
                    ))}
                    <tr><td style={{ fontWeight: 700 }}>TOTAL</td><td className="num" style={{ fontWeight: 700 }}>{fmt(p.total)}</td><td className="num" style={{ fontWeight: 700 }}>{fmt(p.totalPrec)}</td></tr>
                  </tbody>
                </table>
              ))}

              <div className="page-break" />
              <PrintHeader company={data.company} title='DETAIL DES POSTES DU C.P.C. "Produits"' periodeDebut={periodeDebut} periodeFin={periodeFin} />
              {data.detailPostesCpc.produits.map((p) => (
                <table className="ledger mt-24" key={p.poste}>
                  <thead><tr><th colSpan={3}>{p.poste} — {p.label}</th></tr></thead>
                  <tbody>
                    {p.comptes.length === 0 && <tr><td colSpan={3} className="text-muted">NEANT</td></tr>}
                    {p.comptes.map((c) => (
                      <tr key={c.numero}><td>{c.numero} {c.intitule}</td><td className="num">{fmt(c.montant)}</td><td className="num">{fmt(c.montantPrec)}</td></tr>
                    ))}
                    <tr><td style={{ fontWeight: 700 }}>TOTAL</td><td className="num" style={{ fontWeight: 700 }}>{fmt(p.total)}</td><td className="num" style={{ fontWeight: 700 }}>{fmt(p.totalPrec)}</td></tr>
                  </tbody>
                </table>
              ))}
            </div>
          )}

          {selection.T7 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="TABLEAU DES BIENS EN CREDIT-BAIL" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T7} lignes={annexes?.T7 || []} onSave={(l) => saveAnnexe('T7', l)} saving={savingTableau === 'T7'} />
            </div>
          )}

          {selection.T8 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="TABLEAU DES AMORTISSEMENTS" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>Nature</th><th className="num">Cumul début exercice</th><th className="num">Dotation exercice</th><th className="num">Amort. sur immob. sortie</th><th className="num">Cumul fin exercice</th></tr></thead>
                <tbody>
                  {data.tableauAmortissements.lignes.map((l) => (
                    <tr key={l.label}><td>{l.label}</td><td className="num">{fmt(l.cumulDebut)}</td><td className="num">{fmt(l.dotation)}</td><td className="num">{fmt(l.sortie)}</td><td className="num">{fmt(l.cumulFin)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>TOTAL</td><td className="num">{fmt(data.tableauAmortissements.total.cumulDebut)}</td><td className="num">{fmt(data.tableauAmortissements.total.dotation)}</td><td className="num">{fmt(data.tableauAmortissements.total.sortie)}</td><td className="num">{fmt(data.tableauAmortissements.total.cumulFin)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}

          {selection.T9 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="TABLEAU DES PROVISIONS" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T9} lignes={annexes?.T9 || []} onSave={(l) => saveAnnexe('T9', l)} saving={savingTableau === 'T9'} />
            </div>
          )}

          {selection.T10 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="TABLEAU DES PLUS OU MOINS-VALUES SUR CESSIONS OU RETRAIT D'IMMOBILISATIONS" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T10} lignes={annexes?.T10 || []} onSave={(l) => saveAnnexe('T10', l)} saving={savingTableau === 'T10'} />
            </div>
          )}

          {selection.T11 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="TABLEAU DES TITRES DE PARTICIPATION" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T11} lignes={annexes?.T11 || []} onSave={(l) => saveAnnexe('T11', l)} saving={savingTableau === 'T11'} />
            </div>
          )}

          {selection.T12 && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="DETAIL DE LA TAXE SUR LA VALEUR AJOUTEE" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>Nature</th><th className="num">Solde début exercice</th><th className="num">Opérations comptables exercice</th><th className="num">Solde fin exercice</th></tr></thead>
                <tbody>
                  <Ligne2 label="A) TVA facturée" montant={data.tableauTva.soldeDebut} />
                  <tr><td>&nbsp;</td><td className="num">{fmt(data.tableauTva.soldeDebut)}</td><td className="num">{fmt(data.tableauTva.tvaFactureeExercice)}</td><td className="num"></td></tr>
                  <tr><td>B) TVA récupérable</td><td className="num"></td><td className="num">{fmt(data.tableauTva.tvaRecuperableExercice)}</td><td className="num"></td></tr>
                  <tr style={{ fontWeight: 700 }}><td>C) TVA due ou crédit (A - B)</td><td className="num">{fmt(data.tableauTva.soldeDebut)}</td><td className="num">{fmt(data.tableauTva.tvaDueExercice)}</td><td className="num">{fmt(data.tableauTva.soldeFin)}</td></tr>
                </tbody>
              </table>
              <p className="text-muted no-print" style={{ marginTop: 10, fontSize: 12.5 }}>
                Calcul simplifié à partir des comptes de TVA facturée/récupérable et du solde antérieur — vérifiez la concordance avec vos déclarations effectivement déposées.
              </p>
            </div>
          )}

          {selection.T13 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="ETAT DE REPARTITION DU CAPITAL SOCIAL" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T13} lignes={annexes?.T13 || []} onSave={(l) => saveAnnexe('T13', l)} saving={savingTableau === 'T13'} />
            </div>
          )}

          {selection.T14 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="ETAT D'AFFECTATION DES RESULTATS INTERVENUE AU COURS DE L'EXERCICE" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T14} lignes={annexes?.T14 || []} onSave={(l) => saveAnnexe('T14', l)} saving={savingTableau === 'T14'} />
            </div>
          )}

          {selection.T16 && (
            <div className="page-break">
              {t16Auto.length > 0 && !(annexes?.T16?.length > 0) && (
                <p className="text-muted no-print" style={{ fontSize: 12.5 }}>
                  Prérempli automatiquement depuis le module Immobilisations (date d'acquisition et prorata déjà calculés) — modifiable ci-dessous puis Enregistrer.
                </p>
              )}
              <AnnexeManuelle key={`T16-${anneeExercice}-${t16Lignes.length}`} company={data.company} title="ETAT DES DOTATIONS AUX AMORTISSEMENTS RELATIFS AUX IMMOBILISATIONS" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T16} lignes={t16Lignes} onSave={(l) => saveAnnexe('T16', l)} saving={savingTableau === 'T16'} />
            </div>
          )}

          {selection.T17 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="ETAT DES PLUS-VALUES CONSTATEES EN CAS DE FUSION" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T17} lignes={annexes?.T17 || []} onSave={(l) => saveAnnexe('T17', l)} saving={savingTableau === 'T17'} />
            </div>
          )}

          {selection.T18 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="ETAT DES INTERETS DES EMPRUNTS CONTRACTES AUPRES DES ASSOCIES ET DES TIERS" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T18} lignes={annexes?.T18 || []} onSave={(l) => saveAnnexe('T18', l)} saving={savingTableau === 'T18'} />
            </div>
          )}

          {selection.T19 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="TABLEAU DES LOCATIONS ET BAUX AUTRE QUE LE CREDIT-BAIL" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T19} lignes={annexes?.T19 || []} onSave={(l) => saveAnnexe('T19', l)} saving={savingTableau === 'T19'} />
            </div>
          )}

          {selection.T20 && (
            <div className="page-break">
              <AnnexeManuelle company={data.company} title="ETAT DETAILLE DES STOCKS" periodeDebut={periodeDebut} periodeFin={periodeFin}
                columns={COLONNES.T20} lignes={annexes?.T20 || []} onSave={(l) => saveAnnexe('T20', l)} saving={savingTableau === 'T20'} />
            </div>
          )}

          {selection.financement && (
            <div className="card page-break">
              <PrintHeader company={data.company} title="TABLEAU DE FINANCEMENT — SYNTHESE DES MASSES DU BILAN" periodeDebut={periodeDebut} periodeFin={periodeFin} />
              <table className="ledger">
                <thead><tr><th>Masses</th><th className="num">Exercice (N)</th><th className="num">Exercice (N-1)</th><th className="num">Variation (a-b)</th></tr></thead>
                <tbody>
                  <Ligne2 label="Financement permanent" montant={data.tableauFinancement.financementPermanent} precedent={data.tableauFinancement.financementPermanentPrec} />
                  <Ligne2 label="Actif immobilisé" montant={data.tableauFinancement.actifImmobilise} precedent={data.tableauFinancement.actifImmobilisePrec} />
                  <Ligne2 label="Fonds de roulement fonctionnel (A)" montant={data.tableauFinancement.fdr} precedent={data.tableauFinancement.fdrPrec} bold />
                  <Ligne2 label="Actif circulant (hors trésorerie)" montant={data.tableauFinancement.actifCirculant} precedent={data.tableauFinancement.actifCirculantPrec} />
                  <Ligne2 label="Passif circulant" montant={data.tableauFinancement.passifCirculant} precedent={data.tableauFinancement.passifCirculantPrec} />
                  <Ligne2 label="Besoin de financement global (B)" montant={data.tableauFinancement.bfg} precedent={data.tableauFinancement.bfgPrec} bold />
                  <Ligne2 label="Trésorerie nette (A - B)" montant={data.tableauFinancement.tresorerieNette} precedent={data.tableauFinancement.tresorerieNettePrec} bold />
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
