const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const {
  computeBilan, computeCPC, computeBilanDetaille, computeCPCDetaille,
  computeTableau3, computeESG, computeTableauImmobilisations, computeTableauAmortissements,
  computeDetailPostesCPC, computeTableauFinancement, computeTableauTVA,
} = require('../services/syntheseService');
const { buildExport } = require('../services/exportService');
const { fmtMontant } = require('../services/format');

const router = express.Router();
router.use(requireAuth);

// Bilan (Actif/Passif) arrêté à une date donnée
router.get('/companies/:companyId/reports/bilan', (req, res) => {
  const { date_arrete } = req.query;
  if (!date_arrete) return res.status(400).json({ error: 'date_arrete est requis (format YYYY-MM-DD).' });
  res.json(computeBilan(req.params.companyId, date_arrete));
});

// Compte de Produits et Charges (CPC) sur une période
router.get('/companies/:companyId/reports/cpc', (req, res) => {
  const { date_debut, date_fin } = req.query;
  if (!date_debut || !date_fin) {
    return res.status(400).json({ error: 'date_debut et date_fin sont requis (format YYYY-MM-DD).' });
  }
  res.json(computeCPC(req.params.companyId, date_debut, date_fin));
});

// Liasse fiscale complète (tous les tableaux calculables) : la page de garde,
// le bilan actif/passif détaillé, le CPC détaillé, et tous les tableaux
// annexes calculables depuis les écritures (3, 4, 5, 6, 8, TVA, tableau de
// financement) — en un seul appel, pour l'écran "Bilan & États de synthèse".
router.get('/companies/:companyId/reports/liasse-complete', (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id } = req.query;
  if (!fiscal_year_id) return res.status(400).json({ error: 'fiscal_year_id est requis.' });

  const exercice = db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId);
  if (!exercice) return res.status(404).json({ error: 'Exercice introuvable.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);

  const precedent = db
    .prepare('SELECT * FROM fiscal_years WHERE company_id = ? AND date_fin < ? ORDER BY date_fin DESC LIMIT 1')
    .get(companyId, exercice.date_debut);

  const bilan = computeBilanDetaille(companyId, exercice.date_debut, exercice.date_fin, precedent?.date_debut, precedent?.date_fin);
  const cpc = computeCPCDetaille(companyId, exercice.date_debut, exercice.date_fin);
  const cpcPrecedent = precedent ? computeCPCDetaille(companyId, precedent.date_debut, precedent.date_fin) : null;

  const tableau3Overrides = req.query.tableau3 ? JSON.parse(req.query.tableau3) : {};
  const tableau3 = computeTableau3(cpc, tableau3Overrides);
  const esg = computeESG(cpc);
  const esgPrecedent = cpcPrecedent ? computeESG(cpcPrecedent) : null;
  const tableauImmobilisations = computeTableauImmobilisations(companyId, exercice.date_debut, exercice.date_fin);
  const tableauAmortissements = computeTableauAmortissements(companyId, exercice.date_debut, exercice.date_fin);
  const detailPostesCpc = computeDetailPostesCPC(companyId, exercice.date_debut, exercice.date_fin, precedent?.date_debut, precedent?.date_fin);
  const tableauFinancement = computeTableauFinancement(bilan, cpc);
  const tableauTva = computeTableauTVA(companyId, exercice.date_debut, exercice.date_fin);

  res.json({
    company,
    exercice,
    precedent: precedent || null,
    bilan,
    cpc,
    cpcPrecedent,
    tableau3,
    esg,
    esgPrecedent,
    tableauImmobilisations,
    tableauAmortissements,
    detailPostesCpc,
    tableauFinancement,
    tableauTva,
  });
});

// Liasse fiscale détaillée (Bilan Actif/Passif + CPC), au format officiel du
// modèle normal du PCGM, comparée à l'exercice précédent quand il existe —
// utilisée par l'écran "Bilan" (Etats > Bilan & CPC).
router.get('/companies/:companyId/reports/bilan-detaille', (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id } = req.query;
  if (!fiscal_year_id) return res.status(400).json({ error: 'fiscal_year_id est requis.' });

  const exercice = db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId);
  if (!exercice) return res.status(404).json({ error: 'Exercice introuvable.' });

  const precedent = db
    .prepare('SELECT * FROM fiscal_years WHERE company_id = ? AND date_fin < ? ORDER BY date_fin DESC LIMIT 1')
    .get(companyId, exercice.date_debut);

  const bilan = computeBilanDetaille(
    companyId,
    exercice.date_debut,
    exercice.date_fin,
    precedent?.date_debut,
    precedent?.date_fin
  );
  const cpc = computeCPCDetaille(companyId, exercice.date_debut, exercice.date_fin);
  const cpcPrecedent = precedent ? computeCPCDetaille(companyId, precedent.date_debut, precedent.date_fin) : null;

  res.json({ exercice, precedent: precedent || null, bilan, cpc, cpcPrecedent });
});


// État "Journal Centralisateur" : pour chaque journal, le total des débits
// et crédits par compte mouvementé sur la période — la vue de synthèse qui
// centralise tous les journaux auxiliaires (Achats, Ventes, Banque,
// Caisse…) avant le report à la balance générale.
router.get('/companies/:companyId/reports/journal-centralisateur', (req, res) => {
  const companyId = req.params.companyId;
  const { date_debut, date_fin, fiscal_year_id } = req.query;

  let dateFilter = '';
  const params = [companyId];
  if (fiscal_year_id) {
    dateFilter += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  if (date_debut) {
    dateFilter += ' AND je.date_ecriture >= ?';
    params.push(date_debut);
  }
  if (date_fin) {
    dateFilter += ' AND je.date_ecriture <= ?';
    params.push(date_fin);
  }

  const journaux = db.prepare('SELECT id, code, libelle FROM journals WHERE company_id = ? ORDER BY code').all(companyId);

  const lignesStmt = db.prepare(`
    SELECT a.numero AS compte_numero, a.intitule AS compte_intitule,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ? AND je.journal_id = ? ${dateFilter}
    GROUP BY a.id
    ORDER BY a.numero
  `);

  const centralisateur = journaux.map((j) => {
    const lignes = lignesStmt.all(companyId, j.id, ...params.slice(1));
    const totalDebit = lignes.reduce((s, l) => s + l.total_debit, 0);
    const totalCredit = lignes.reduce((s, l) => s + l.total_credit, 0);
    return { journal: j, lignes, total_debit: totalDebit, total_credit: totalCredit };
  });

  const totalGeneralDebit = centralisateur.reduce((s, j) => s + j.total_debit, 0);
  const totalGeneralCredit = centralisateur.reduce((s, j) => s + j.total_credit, 0);

  res.json({ journaux: centralisateur, total_debit: totalGeneralDebit, total_credit: totalGeneralCredit });
});

// Balance générale : cumul débit/crédit et solde par compte, sur une période.
// Avec ?condense=1 : "Balance condensée" — les sous-comptes auxiliaires de
// tiers (clients 3421xx, fournisseurs 4411xx — voir RACINE dans
// tiersService.js) sont regroupés sous leur compte racine (3421 "Clients",
// 4411 "Fournisseur") au lieu d'apparaître un par un, comme dans le
// logiciel de référence.
router.get('/companies/:companyId/reports/balance', (req, res) => {
  const { fiscal_year_id, date_debut, date_fin, condense } = req.query;
  const companyId = req.params.companyId;

  let dateFilter = '';
  const params = [companyId];
  if (fiscal_year_id) {
    dateFilter += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  if (date_debut) {
    dateFilter += ' AND je.date_ecriture >= ?';
    params.push(date_debut);
  }
  if (date_fin) {
    dateFilter += ' AND je.date_ecriture <= ?';
    params.push(date_fin);
  }

  const rows = db
    .prepare(
      `
    SELECT a.id AS account_id, a.numero, a.intitule, a.classe,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id ${dateFilter ? '' : 'AND 1=1'}
    WHERE a.company_id = ? ${dateFilter}
    GROUP BY a.id
    ORDER BY a.numero
  `
    )
    .all(...(dateFilter ? [companyId, ...params.slice(1)] : [companyId]));

  // Recalcul propre (la requête ci-dessus jointe peut inclure des comptes sans mouvement)
  let balance = rows.map((r) => {
    const solde = r.total_debit - r.total_credit;
    return {
      ...r,
      solde_debiteur: solde > 0 ? solde : 0,
      solde_crediteur: solde < 0 ? -solde : 0,
    };
  });

  if (condense === '1' || condense === 'true') {
    // Racines de regroupement des tiers (mêmes valeurs que RACINE dans
    // services/tiersService.js — dupliquées ici plutôt qu'importées pour ne
    // pas coupler ce endpoint de lecture au module d'écriture des tiers).
    const RACINES_TIERS = { '3421': 'Clients', '4411': 'Fournisseur' };
    const tiersAccountIds = new Set(
      db.prepare('SELECT account_id FROM tiers WHERE company_id = ?').all(companyId).map((t) => t.account_id)
    );

    // 1) Sépare les vraies lignes de sous-comptes tiers (ex: 342104, 441101)
    // du reste. On ne condense QUE les comptes présents dans la table
    // `tiers`, jamais un compte générique du PCGM qui partagerait le même
    // préfixe par coïncidence (ex: 34551 TVA récupérable ne doit pas être
    // aspiré sous 3421 "Clients").
    const sousComptesTiers = [];
    const autresLignes = [];
    for (const r of balance) {
      const racineNumero = Object.keys(RACINES_TIERS).find((rac) => r.numero.startsWith(rac) && r.numero !== rac);
      if (racineNumero && tiersAccountIds.has(r.account_id)) {
        sousComptesTiers.push({ ...r, racineNumero });
      } else {
        autresLignes.push(r);
      }
    }

    // 2) Cumule chaque groupe de sous-comptes sous sa racine, en partant des
    // mouvements déjà portés par la racine elle-même si elle en a (retirée
    // de `autresLignes` pour ne pas la dupliquer).
    const racinesTouchees = new Set(sousComptesTiers.map((r) => r.racineNumero));
    const lignesFinales = autresLignes.filter((r) => !racinesTouchees.has(r.numero));
    for (const racineNumero of racinesTouchees) {
      const ligneRacineExistante = autresLignes.find((r) => r.numero === racineNumero);
      const totalDebit =
        (ligneRacineExistante?.total_debit || 0) +
        sousComptesTiers.filter((r) => r.racineNumero === racineNumero).reduce((s, r) => s + r.total_debit, 0);
      const totalCredit =
        (ligneRacineExistante?.total_credit || 0) +
        sousComptesTiers.filter((r) => r.racineNumero === racineNumero).reduce((s, r) => s + r.total_credit, 0);
      const solde = totalDebit - totalCredit;
      lignesFinales.push({
        account_id: ligneRacineExistante?.account_id ?? `racine-${racineNumero}`,
        numero: racineNumero,
        intitule: RACINES_TIERS[racineNumero],
        classe: ligneRacineExistante?.classe ?? Number(racineNumero[0]),
        total_debit: totalDebit,
        total_credit: totalCredit,
        solde_debiteur: solde > 0 ? solde : 0,
        solde_crediteur: solde < 0 ? -solde : 0,
      });
    }
    balance = lignesFinales.sort((a, b) => (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0));
  }


  res.json(balance);
});

// Grand livre d'un compte : détail de tous les mouvements
router.get('/companies/:companyId/reports/grand-livre/:accountId', (req, res) => {
  const { fiscal_year_id, date_debut, date_fin, lettrage } = req.query;
  let query = `
    SELECT je.id AS entry_id, je.date_ecriture, je.libelle AS libelle_ecriture, je.numero_piece,
           jr.code AS journal_code,
           jl.libelle AS libelle_ligne, jl.debit, jl.credit, jl.tiers, jl.lettrage
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN journals jr ON jr.id = je.journal_id
    WHERE jl.account_id = ? AND je.company_id = ?
  `;
  const params = [req.params.accountId, req.params.companyId];
  if (fiscal_year_id) {
    query += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  // Période libre "Du … Au …", indépendante de l'exercice sélectionné —
  // comme le filtre de date du logiciel de référence (voir GrandLivre.jsx).
  if (date_debut) {
    query += ' AND je.date_ecriture >= ?';
    params.push(date_debut);
  }
  if (date_fin) {
    query += ' AND je.date_ecriture <= ?';
    params.push(date_fin);
  }
  // lettrage: 'lettre' -> uniquement les lignes lettrées, 'non_lettre' ->
  // uniquement les lignes non lettrées, absent/'tous' -> pas de filtre.
  if (lettrage === 'lettre') {
    query += " AND jl.lettrage IS NOT NULL AND jl.lettrage != ''";
  } else if (lettrage === 'non_lettre') {
    query += " AND (jl.lettrage IS NULL OR jl.lettrage = '')";
  }
  query += ' ORDER BY je.date_ecriture, je.id';

  const mouvements = db.prepare(query).all(...params);
  let solde = 0;
  const detail = mouvements.map((m) => {
    solde += (m.debit || 0) - (m.credit || 0);
    return { ...m, solde_cumule: solde };
  });
  const totalDebit = detail.reduce((s, m) => s + (m.debit || 0), 0);
  const totalCredit = detail.reduce((s, m) => s + (m.credit || 0), 0);

  res.json({ mouvements: detail, solde_final: solde, total_debit: totalDebit, total_credit: totalCredit });
});

// Balance âgée : solde non lettré des tiers, réparti par ancienneté (0-30 / 31-60 / 61-90 / 90+ jours)
router.get('/companies/:companyId/reports/balance-agee', (req, res) => {
  const { type } = req.query; // 'client' | 'fournisseur'
  const companyId = req.params.companyId;
  if (!type || !['client', 'fournisseur'].includes(type)) {
    return res.status(400).json({ error: "type doit être 'client' ou 'fournisseur'." });
  }

  const tiersList = db
    .prepare(
      `SELECT t.*, a.numero AS account_numero FROM tiers t JOIN accounts a ON a.id = t.account_id
       WHERE t.company_id = ? AND t.type = ? ORDER BY t.nom`
    )
    .all(companyId, type);

  const lineStmt = db.prepare(
    `SELECT je.date_ecriture, jl.debit, jl.credit
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ? AND (jl.lettrage IS NULL OR jl.lettrage = '')`
  );

  const today = new Date();
  const result = tiersList.map((t) => {
    const lignes = lineStmt.all(t.account_id);
    const buckets = { j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 };
    let solde = 0;
    for (const l of lignes) {
      const montant = (l.debit || 0) - (l.credit || 0);
      solde += montant;
      const ageJours = Math.floor((today - new Date(l.date_ecriture)) / 86400000);
      if (ageJours <= 30) buckets.j0_30 += montant;
      else if (ageJours <= 60) buckets.j31_60 += montant;
      else if (ageJours <= 90) buckets.j61_90 += montant;
      else buckets.j90_plus += montant;
    }
    return {
      tiers_id: t.id,
      nom: t.nom,
      account_numero: t.account_numero,
      solde,
      ...buckets,
    };
  });

  res.json(result.filter((r) => Math.abs(r.solde) > 0.005));
});

// ---------------------------------------------------------------------------
// Téléchargement (PDF/Excel/Word) de la Balance générale, du Grand livre et
// de la Balance âgée — même contenu que l'écran, via le moteur d'export
// commun (voir exportService), pour que "Télécharger" soit disponible
// partout où "Imprimer" l'est déjà.
router.get('/companies/:companyId/reports/balance-export', async (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id, format } = req.query;
  if (!format) return res.status(400).json({ error: 'format (pdf|xlsx|docx) est requis.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const exercice = fiscal_year_id ? db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId) : null;

  let dateFilter = '';
  const params = [companyId];
  if (fiscal_year_id) {
    dateFilter += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  const rows = db
    .prepare(
      `SELECT a.id AS account_id, a.numero, a.intitule,
              COALESCE(SUM(jl.debit), 0) AS total_debit, COALESCE(SUM(jl.credit), 0) AS total_credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.entry_id
       WHERE a.company_id = ? ${dateFilter}
       GROUP BY a.id ORDER BY a.numero`
    )
    .all(...params);

  const mouvements = rows
    .map((r) => ({ ...r, solde_debiteur: Math.max(0, r.total_debit - r.total_credit), solde_crediteur: Math.max(0, r.total_credit - r.total_debit) }))
    .filter((r) => r.total_debit || r.total_credit);

  const bodyRows = mouvements.map((r) => ({
    cells: [r.numero, r.intitule, fmtMontant(r.total_debit), fmtMontant(r.total_credit), r.solde_debiteur ? fmtMontant(r.solde_debiteur) : '', r.solde_crediteur ? fmtMontant(r.solde_crediteur) : ''],
  }));
  const totaux = mouvements.reduce((a, r) => ({ debit: a.debit + r.total_debit, credit: a.credit + r.total_credit, sd: a.sd + r.solde_debiteur, sc: a.sc + r.solde_crediteur }), { debit: 0, credit: 0, sd: 0, sc: 0 });
  bodyRows.push({ cells: ['TOTAUX', '', fmtMontant(totaux.debit), fmtMontant(totaux.credit), fmtMontant(totaux.sd), fmtMontant(totaux.sc)], bold: true });

  try {
    const { buffer, contentType, ext } = await buildExport(format, {
      company,
      title: 'BALANCE GÉNÉRALE',
      periodeDebut: exercice?.date_debut,
      periodeFin: exercice?.date_fin,
      landscape: true,
      columns: [
        { label: 'N° Compte', width: 1 }, { label: 'Intitulé', width: 2.5 },
        { label: 'Total débit', width: 1.2, align: 'right' }, { label: 'Total crédit', width: 1.2, align: 'right' },
        { label: 'Solde débiteur', width: 1.2, align: 'right' }, { label: 'Solde créditeur', width: 1.2, align: 'right' },
      ],
      rows: bodyRows,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="balance.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/companies/:companyId/reports/grand-livre-export', async (req, res) => {
  const companyId = req.params.companyId;
  const { account_id, fiscal_year_id, date_debut, date_fin, lettrage, format } = req.query;
  if (!account_id || !format) return res.status(400).json({ error: 'account_id et format (pdf|xlsx|docx) sont requis.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const exercice = fiscal_year_id ? db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId) : null;
  const compte = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ?').get(account_id, companyId);

  let query = `
    SELECT je.date_ecriture, je.numero_piece, jr.code AS journal_code,
           jl.libelle AS libelle_ligne, je.libelle AS libelle_ecriture, jl.debit, jl.credit, jl.tiers
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN journals jr ON jr.id = je.journal_id
    WHERE jl.account_id = ? AND je.company_id = ?`;
  const params = [account_id, companyId];
  if (fiscal_year_id) {
    query += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  if (date_debut) {
    query += ' AND je.date_ecriture >= ?';
    params.push(date_debut);
  }
  if (date_fin) {
    query += ' AND je.date_ecriture <= ?';
    params.push(date_fin);
  }
  if (lettrage === 'lettre') {
    query += " AND jl.lettrage IS NOT NULL AND jl.lettrage != ''";
  } else if (lettrage === 'non_lettre') {
    query += " AND (jl.lettrage IS NULL OR jl.lettrage = '')";
  }
  query += ' ORDER BY je.date_ecriture, je.id';
  const mouvements = db.prepare(query).all(...params);

  let solde = 0;
  const bodyRows = mouvements.map((m) => {
    solde += (m.debit || 0) - (m.credit || 0);
    return {
      cells: [m.date_ecriture, m.journal_code, m.libelle_ligne || m.libelle_ecriture, m.tiers || '—', m.debit ? fmtMontant(m.debit) : '', m.credit ? fmtMontant(m.credit) : '', `${fmtMontant(solde)} ${solde >= 0 ? 'D' : 'C'}`],
    };
  });
  const totalDebit = mouvements.reduce((s, m) => s + (m.debit || 0), 0);
  const totalCredit = mouvements.reduce((s, m) => s + (m.credit || 0), 0);
  bodyRows.push({ cells: ['', '', 'TOTAL', '', fmtMontant(totalDebit), fmtMontant(totalCredit), `${fmtMontant(solde)} ${solde >= 0 ? 'D' : 'C'}`], bold: true });

  try {
    const { buffer, contentType, ext } = await buildExport(format, {
      company,
      title: 'GRAND LIVRE',
      periodeDebut: exercice?.date_debut,
      periodeFin: exercice?.date_fin,
      compte: compte ? `${compte.numero}   ${compte.intitule}` : '',
      landscape: true,
      columns: [
        { label: 'Date', width: 0.9 }, { label: 'Jrn', width: 0.5 }, { label: 'Libellé', width: 2.4 }, { label: 'Tiers', width: 1.2 },
        { label: 'Débit', width: 1, align: 'right' }, { label: 'Crédit', width: 1, align: 'right' }, { label: 'Solde', width: 1.2, align: 'right' },
      ],
      rows: bodyRows,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="grand_livre_${compte?.numero || account_id}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/companies/:companyId/reports/balance-agee-export', async (req, res) => {
  const companyId = req.params.companyId;
  const { type, format } = req.query;
  if (!type || !['client', 'fournisseur'].includes(type) || !format) {
    return res.status(400).json({ error: "type (client|fournisseur) et format (pdf|xlsx|docx) sont requis." });
  }
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);

  const tiersList = db
    .prepare(`SELECT t.*, a.numero AS account_numero FROM tiers t JOIN accounts a ON a.id = t.account_id WHERE t.company_id = ? AND t.type = ? ORDER BY t.nom`)
    .all(companyId, type);
  const lineStmt = db.prepare(
    `SELECT je.date_ecriture, jl.debit, jl.credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ? AND (jl.lettrage IS NULL OR jl.lettrage = '')`
  );
  const today = new Date();
  const result = tiersList
    .map((t) => {
      const lignes = lineStmt.all(t.account_id);
      const buckets = { j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 };
      let solde = 0;
      for (const l of lignes) {
        const montant = (l.debit || 0) - (l.credit || 0);
        solde += montant;
        const ageJours = Math.floor((today - new Date(l.date_ecriture)) / 86400000);
        if (ageJours <= 30) buckets.j0_30 += montant;
        else if (ageJours <= 60) buckets.j31_60 += montant;
        else if (ageJours <= 90) buckets.j61_90 += montant;
        else buckets.j90_plus += montant;
      }
      return { account_numero: t.account_numero, nom: t.nom, solde, ...buckets };
    })
    .filter((r) => Math.abs(r.solde) > 0.005);

  const bodyRows = result.map((r) => ({ cells: [r.account_numero, r.nom, fmtMontant(r.solde), fmtMontant(r.j0_30), fmtMontant(r.j31_60), fmtMontant(r.j61_90), fmtMontant(r.j90_plus)] }));
  const totaux = result.reduce((a, r) => ({ solde: a.solde + r.solde, j0_30: a.j0_30 + r.j0_30, j31_60: a.j31_60 + r.j31_60, j61_90: a.j61_90 + r.j61_90, j90_plus: a.j90_plus + r.j90_plus }), { solde: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 });
  bodyRows.push({ cells: ['TOTAL', '', fmtMontant(totaux.solde), fmtMontant(totaux.j0_30), fmtMontant(totaux.j31_60), fmtMontant(totaux.j61_90), fmtMontant(totaux.j90_plus)], bold: true });

  try {
    const { buffer, contentType, ext } = await buildExport(format, {
      company,
      title: `BALANCE ÂGÉE — ${type === 'client' ? 'CLIENTS' : 'FOURNISSEURS'}`,
      landscape: true,
      columns: [
        { label: 'Compte', width: 0.9 }, { label: 'Nom', width: 2 }, { label: 'Solde', width: 1, align: 'right' },
        { label: '0-30 j', width: 1, align: 'right' }, { label: '31-60 j', width: 1, align: 'right' },
        { label: '61-90 j', width: 1, align: 'right' }, { label: '+90 j', width: 1, align: 'right' },
      ],
      rows: bodyRows,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="balance_agee_${type}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Téléchargement du Bilan/CPC en PDF, Excel ou Word — même contenu que
// l'écran, mis en forme avec le moteur d'export commun (voir exportService).
router.get('/companies/:companyId/reports/bilan-export', async (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id, tableau, format } = req.query;
  if (!fiscal_year_id || !tableau || !format) {
    return res.status(400).json({ error: 'fiscal_year_id, tableau (actif|passif|cpc) et format (pdf|xlsx|docx) sont requis.' });
  }
  const exercice = db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId);
  if (!exercice) return res.status(404).json({ error: 'Exercice introuvable.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const precedent = db
    .prepare('SELECT * FROM fiscal_years WHERE company_id = ? AND date_fin < ? ORDER BY date_fin DESC LIMIT 1')
    .get(companyId, exercice.date_debut);
  const bilan = computeBilanDetaille(companyId, exercice.date_debut, exercice.date_fin, precedent?.date_debut, precedent?.date_fin);

  // Comme à l'écran (voir fmt() dans Bilan.jsx) : un montant à 0 reste vide,
  // conformément au modèle officiel où les lignes non mouvementées sont
  // laissées en blanc plutôt que d'afficher "0,00" partout.
  const fmt = (n) => (n == null || n === 0 ? '' : fmtMontant(n));
  let tableDef;

  if (tableau === 'actif') {
    const a = bilan.actif;
    const rubrique = (r, key, indent = true, bold = false) => ({ cells: [r.label, fmt(r.brut), fmt(r.amort), fmt(r.net), fmt(a.precedent?.[key])], indent, bold });
    const sousLignes = (key) => (a.sousPostes?.[key] || []).map((sp) => ({ cells: [sp.label, fmt(sp.brut), fmt(sp.amort), fmt(sp.net), fmt(sp.precedentNet)], sub: true }));
    tableDef = {
      title: 'BILAN ACTIF',
      columns: [{ label: 'ACTIF', width: 4 }, { label: 'Brut', width: 1.3, align: 'right' }, { label: 'Amort./Prov.', width: 1.3, align: 'right' }, { label: 'Net', width: 1.3, align: 'right' }, { label: 'Exercice préc. Net', width: 1.5, align: 'right' }],
      rows: [
        rubrique(a.A, 'A', true, true), ...sousLignes('A'),
        rubrique(a.B, 'B'), ...sousLignes('B'),
        rubrique(a.C, 'C'), ...sousLignes('C'),
        rubrique(a.D, 'D'), ...sousLignes('D'),
        rubrique(a.E, 'E'),
        rubrique(a.totalI, 'totalI', false, true),
        rubrique(a.F, 'F'), ...sousLignes('F'),
        rubrique(a.G, 'G'), ...sousLignes('G'),
        rubrique(a.H, 'H'), rubrique(a.I, 'I'),
        rubrique(a.totalII, 'totalII', false, true),
        { cells: ['TRESORERIE ACTIF', fmt(a.tresorerieActif.brut), fmt(a.tresorerieActif.amort), fmt(a.tresorerieActif.net), fmt(a.precedent?.totalIII)], indent: true },
        ...sousLignes('tresorerieActif'),
        rubrique(a.totalIII, 'totalIII', false, true),
        rubrique(a.totalGeneral, 'totalGeneral', false, true),
      ],
    };
  } else if (tableau === 'passif') {
    const p = bilan.passif;
    const ligne = (label, montant, precedent, bold = false) => ({ cells: [label, fmt(montant), fmt(precedent)], bold });
    const sousLignes = (key) => (p.sousPostes?.[key] || []).map((sp) => ({ cells: [sp.label, fmt(sp.montant), fmt(sp.precedent)], sub: true }));
    tableDef = {
      title: 'BILAN PASSIF',
      columns: [{ label: 'PASSIF', width: 4 }, { label: 'Exercice', width: 1.5, align: 'right' }, { label: 'Exercice précédent', width: 1.5, align: 'right' }],
      rows: [
        ligne('Capitaux propres', p.capitauxPropres, p.precedent?.capitauxPropres, true), ...sousLignes('A'),
        ligne('Capitaux propres assimilés', p.capitauxPropresAssimiles, p.precedent?.capitauxPropresAssimiles), ...sousLignes('B'),
        ligne('Dettes de financement', p.dettesFinancement, p.precedent?.dettesFinancement), ...sousLignes('C'),
        ligne('Provisions durables pour risques et charges', p.provisionsDurables, p.precedent?.provisionsDurables), ...sousLignes('D'),
        ligne('Écarts de conversion passif', p.ecartsConversionPassif, p.precedent?.ecartsConversionPassif),
        ligne('TOTAL I (A+B+C+D+E)', p.totalI, p.precedent?.totalI, true),
        ligne('Dettes du passif circulant', p.dettesPassifCirculant, p.precedent?.dettesPassifCirculant), ...sousLignes('F'),
        ligne('Autres provisions pour risques et charges', p.autresProvisions, p.precedent?.autresProvisions),
        ligne('Écarts de conversion passif (éléments circulants)', p.ecartsConversionPassifCirc, p.precedent?.ecartsConversionPassifCirc),
        ligne('TOTAL II (F+G+H)', p.totalII, p.precedent?.totalII, true),
        ligne('Trésorerie passif', p.tresoreriePassif, p.precedent?.tresoreriePassif), ...sousLignes('tresoreriePassif'),
        ligne('TOTAL III', p.totalIII, p.precedent?.totalIII, true),
        ligne('TOTAL GENERAL (I+II+III)', p.totalGeneral, p.precedent?.totalGeneral, true),
      ],
    };
  } else if (tableau === 'cpc') {
    const cpc = computeCPCDetaille(companyId, exercice.date_debut, exercice.date_fin);
    const cpcPrec = precedent ? computeCPCDetaille(companyId, precedent.date_debut, precedent.date_fin) : null;
    const ligne = (label, montant, prec, bold = false) => ({ cells: [label, fmt(montant), fmt(prec)], bold });
    tableDef = {
      title: 'COMPTE DE PRODUITS ET CHARGES (hors taxes)',
      columns: [{ label: 'OPÉRATIONS', width: 4.5 }, { label: "Propre à l'exercice", width: 1.5, align: 'right' }, { label: 'Exercice précédent', width: 1.5, align: 'right' }],
      rows: [
        ligne("I. Produits d'exploitation", cpc.exploitation.totalI, cpcPrec?.exploitation.totalI, true),
        ligne("II. Charges d'exploitation", cpc.exploitation.totalII, cpcPrec?.exploitation.totalII, true),
        ligne("III. Résultat d'exploitation (I - II)", cpc.exploitation.resultatExploitation, cpcPrec?.exploitation.resultatExploitation, true),
        ligne('IV. Produits financiers', cpc.financier.totalIV, cpcPrec?.financier.totalIV),
        ligne('V. Charges financières', cpc.financier.totalV, cpcPrec?.financier.totalV),
        ligne('VI. Résultat financier (IV - V)', cpc.financier.resultatFinancier, cpcPrec?.financier.resultatFinancier, true),
        ligne('VII. Résultat courant (III + VI)', cpc.resultatCourant, cpcPrec?.resultatCourant, true),
        ligne('VIII. Produits non courants', cpc.nonCourant.totalVIII, cpcPrec?.nonCourant.totalVIII),
        ligne('IX. Charges non courantes', cpc.nonCourant.totalIX, cpcPrec?.nonCourant.totalIX),
        ligne('X. Résultat non courant (VIII - IX)', cpc.nonCourant.resultatNonCourant, cpcPrec?.nonCourant.resultatNonCourant, true),
        ligne('XI. Résultat avant impôts (VII + X)', cpc.resultatAvantImpots, cpcPrec?.resultatAvantImpots, true),
        ligne('XII. Impôts sur les résultats', cpc.impotsResultats, cpcPrec?.impotsResultats),
        ligne('XIII. RÉSULTAT NET (XI - XII)', cpc.resultatNet, cpcPrec?.resultatNet, true),
      ],
    };
  } else {
    return res.status(400).json({ error: 'tableau doit valoir actif, passif ou cpc.' });
  }

  tableDef.company = company;
  tableDef.periodeDebut = exercice.date_debut;
  tableDef.periodeFin = exercice.date_fin;

  try {
    const { buffer, contentType, ext } = await buildExport(format, tableDef);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${tableau}_${exercice.date_fin.slice(0, 4)}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
