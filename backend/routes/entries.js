const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { validateBalanced } = require('../services/entryService');
const { checkLegalWarnings } = require('../services/legalRulesService');
const { assertExerciceOuvert } = require('../services/clotureGuard');

const router = express.Router();
router.use(requireAuth);

// Vérifie une écriture AVANT enregistrement et renvoie les avertissements légaux
// (solde de caisse insuffisant, plafond de règlement en espèces d'un fournisseur
// dépassé...) que l'utilisateur doit confirmer pour continuer. N'écrit rien en base.
router.post('/companies/:companyId/entries/precheck', (req, res) => {
  const { date_ecriture, lignes } = req.body;
  const warnings = checkLegalWarnings(req.params.companyId, date_ecriture, lignes || []);
  res.json({ warnings });
});

// Liste des écritures d'une société (avec filtre optionnel par journal / exercice / période)
router.get('/companies/:companyId/entries', (req, res) => {
  const { journal_id, journal_ids, journal_codes, fiscal_year_id, date_debut, date_fin } = req.query;
  let query = 'SELECT * FROM journal_entries WHERE company_id = ?';
  const params = [req.params.companyId];
  if (journal_id) {
    query += ' AND journal_id = ?';
    params.push(journal_id);
  }
  // Plusieurs journaux à la fois (écran "Journaux" : cases à cocher AN, JA,
  // JB, JC, JP, JV, OD…) : soit par id (journal_ids=1,2,3), soit par code
  // (journal_codes=JA,JB — plus pratique depuis le formulaire).
  if (journal_ids) {
    const ids = journal_ids.split(',').map((v) => v.trim()).filter(Boolean);
    if (ids.length) {
      query += ` AND journal_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }
  if (journal_codes) {
    const codes = journal_codes.split(',').map((v) => v.trim()).filter(Boolean);
    if (codes.length) {
      const journalIdsFromCodes = db
        .prepare(`SELECT id FROM journals WHERE company_id = ? AND code IN (${codes.map(() => '?').join(',')})`)
        .all(req.params.companyId, ...codes)
        .map((j) => j.id);
      if (journalIdsFromCodes.length) {
        query += ` AND journal_id IN (${journalIdsFromCodes.map(() => '?').join(',')})`;
        params.push(...journalIdsFromCodes);
      } else {
        query += ' AND 1=0';
      }
    }
  }
  if (fiscal_year_id) {
    query += ' AND fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  if (date_debut) {
    query += ' AND date_ecriture >= ?';
    params.push(date_debut);
  }
  if (date_fin) {
    query += ' AND date_ecriture <= ?';
    params.push(date_fin);
  }
  query += ' ORDER BY date_ecriture DESC, id DESC';
  const entries = db.prepare(query).all(...params);

  const lineStmt = db.prepare(`
    SELECT jl.*, a.numero AS account_numero, a.intitule AS account_intitule
    FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = ?
  `);
  for (const entry of entries) {
    entry.lignes = lineStmt.all(entry.id);
  }
  res.json(entries);
});

// Créer une écriture comptable (en-tête + lignes), avec contrôle de la partie double
router.post('/companies/:companyId/entries', (req, res) => {
  const companyId = req.params.companyId;
  const { journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, reference, lignes } = req.body;

  if (!journal_id || !fiscal_year_id || !date_ecriture || !libelle) {
    return res.status(400).json({ error: 'journal_id, fiscal_year_id, date_ecriture et libelle sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);

  const validation = validateBalanced(lignes);
  if (!validation.ok) {
    return res.status(422).json({ error: validation.error });
  }

  const tx = db.transaction(() => {
    const info = db
      .prepare(`
        INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, reference, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(companyId, journal_id, fiscal_year_id, numero_piece || null, date_ecriture, libelle, reference || null, req.user.id);

    const entryId = info.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit, taux_tva, tiers)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lignes) {
      insertLine.run(
        entryId,
        line.account_id,
        line.libelle || null,
        Number(line.debit) || 0,
        Number(line.credit) || 0,
        line.taux_tva ?? null,
        line.tiers || null
      );
    }
    return entryId;
  });

  const entryId = tx();
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  entry.lignes = db
    .prepare(
      `SELECT jl.*, a.numero AS account_numero, a.intitule AS account_intitule
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ?`
    )
    .all(entryId);
  res.status(201).json(entry);
});

// Supprimer une écriture (uniquement si non validée définitivement)
router.delete('/entries/:entryId', (req, res) => {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Écriture introuvable.' });
  if (entry.valide) return res.status(409).json({ error: 'Impossible de supprimer une écriture validée.' });
  assertExerciceOuvert(entry.company_id, entry.fiscal_year_id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.entryId);
  res.status(204).send();
});

// --- Réimputer / Valider / Supprimer en masse ---------------------------
// Reproduit le clic droit > Réimputer du logiciel de bureau : au lieu de
// corriger ligne par ligne, on change le compte, le journal ou la date de
// TOUTES les lignes/écritures actuellement affichées (filtrées) dans
// Consultation des écritures en une seule action.

// Réimpute le compte de plusieurs lignes d'écriture (jl.id) vers un autre
// compte (recherché par numéro, créé implicitement si besoin n'est PAS géré
// ici — le compte cible doit déjà exister, comme dans le logiciel de
// bureau où on choisit un compte via "Sélection").
router.patch('/companies/:companyId/journal-lines/reimputer-compte', (req, res) => {
  const companyId = req.params.companyId;
  const { line_ids, compte_numero } = req.body;
  if (!Array.isArray(line_ids) || line_ids.length === 0 || !compte_numero) {
    return res.status(400).json({ error: 'line_ids (tableau non vide) et compte_numero sont requis.' });
  }
  const compte = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, compte_numero);
  if (!compte) return res.status(422).json({ error: `Le compte ${compte_numero} n'existe pas dans le plan comptable de cette société.` });

  const tx = db.transaction(() => {
    let count = 0;
    const getLine = db.prepare(`
      SELECT jl.id, je.company_id, je.fiscal_year_id
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.id = ?
    `);
    const updateLine = db.prepare('UPDATE journal_lines SET account_id = ? WHERE id = ?');
    for (const id of line_ids) {
      const line = getLine.get(id);
      if (!line || String(line.company_id) !== String(companyId)) continue;
      assertExerciceOuvert(line.company_id, line.fiscal_year_id);
      updateLine.run(compte.id, id);
      count += 1;
    }
    return count;
  });

  const count = tx();
  res.json({ updated: count, compte: { numero: compte.numero, intitule: compte.intitule } });
});

// Réimpute le journal de plusieurs écritures (je.id) vers un autre journal
// (recherché par code, ex : "JB", "JA"…).
router.patch('/companies/:companyId/entries/reimputer-journal', (req, res) => {
  const companyId = req.params.companyId;
  const { entry_ids, journal_code } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0 || !journal_code) {
    return res.status(400).json({ error: 'entry_ids (tableau non vide) et journal_code sont requis.' });
  }
  const journal = db.prepare('SELECT * FROM journals WHERE company_id = ? AND code = ?').get(companyId, journal_code);
  if (!journal) return res.status(422).json({ error: `Le journal ${journal_code} n'existe pas pour cette société.` });

  const tx = db.transaction(() => {
    let count = 0;
    const getEntry = db.prepare('SELECT id, company_id, fiscal_year_id FROM journal_entries WHERE id = ?');
    const updateEntry = db.prepare('UPDATE journal_entries SET journal_id = ? WHERE id = ?');
    for (const id of entry_ids) {
      const entry = getEntry.get(id);
      if (!entry || String(entry.company_id) !== String(companyId)) continue;
      assertExerciceOuvert(entry.company_id, entry.fiscal_year_id);
      updateEntry.run(journal.id, id);
      count += 1;
    }
    return count;
  });

  const count = tx();
  res.json({ updated: count, journal: { code: journal.code, libelle: journal.libelle } });
});

// Réimpute la date de plusieurs écritures (je.id) vers une autre date.
router.patch('/companies/:companyId/entries/reimputer-date', (req, res) => {
  const companyId = req.params.companyId;
  const { entry_ids, date_ecriture } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0 || !date_ecriture) {
    return res.status(400).json({ error: 'entry_ids (tableau non vide) et date_ecriture sont requis.' });
  }

  const tx = db.transaction(() => {
    let count = 0;
    const getEntry = db.prepare('SELECT id, company_id, fiscal_year_id FROM journal_entries WHERE id = ?');
    const updateEntry = db.prepare('UPDATE journal_entries SET date_ecriture = ? WHERE id = ?');
    for (const id of entry_ids) {
      const entry = getEntry.get(id);
      if (!entry || String(entry.company_id) !== String(companyId)) continue;
      assertExerciceOuvert(entry.company_id, entry.fiscal_year_id);
      updateEntry.run(date_ecriture, id);
      count += 1;
    }
    return count;
  });

  const count = tx();
  res.json({ updated: count });
});

// Valide en masse plusieurs écritures (verrouillage : une écriture validée
// ne peut plus être supprimée ni réimputée sans être d'abord invalidée).
router.patch('/companies/:companyId/entries/valider', (req, res) => {
  const companyId = req.params.companyId;
  const { entry_ids, valide } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ error: 'entry_ids (tableau non vide) est requis.' });
  }
  const tx = db.transaction(() => {
    let count = 0;
    const getEntry = db.prepare('SELECT id, company_id FROM journal_entries WHERE id = ?');
    const updateEntry = db.prepare('UPDATE journal_entries SET valide = ? WHERE id = ?');
    for (const id of entry_ids) {
      const entry = getEntry.get(id);
      if (!entry || String(entry.company_id) !== String(companyId)) continue;
      updateEntry.run(valide ? 1 : 0, id);
      count += 1;
    }
    return count;
  });
  const count = tx();
  res.json({ updated: count });
});

// Supprime en masse plusieurs écritures (non validées uniquement — mêmes
// règles que la suppression unitaire ci-dessus).
router.post('/companies/:companyId/entries/supprimer-masse', (req, res) => {
  const companyId = req.params.companyId;
  const { entry_ids } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ error: 'entry_ids (tableau non vide) est requis.' });
  }
  const tx = db.transaction(() => {
    let count = 0;
    let ignorees = 0;
    const getEntry = db.prepare('SELECT * FROM journal_entries WHERE id = ?');
    const deleteEntry = db.prepare('DELETE FROM journal_entries WHERE id = ?');
    for (const id of entry_ids) {
      const entry = getEntry.get(id);
      if (!entry || String(entry.company_id) !== String(companyId)) continue;
      if (entry.valide) { ignorees += 1; continue; }
      assertExerciceOuvert(entry.company_id, entry.fiscal_year_id);
      deleteEntry.run(id);
      count += 1;
    }
    return { count, ignorees };
  });
  const { count, ignorees } = tx();
  res.json({ deleted: count, ignorees });
});

module.exports = router;
