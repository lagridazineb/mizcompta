const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { calculerTableauAmortissementLineaire } = require('../services/amortissementService');
const { assertExerciceOuvert } = require('../services/clotureGuard');

const router = express.Router();
router.use(requireAuth);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function findAccount(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}

function findFiscalYearForDate(companyId, date) {
  return db
    .prepare('SELECT * FROM fiscal_years WHERE company_id = ? AND date_debut <= ? AND date_fin >= ?')
    .get(companyId, date, date);
}

function withSchedule(immo) {
  const lignes = db
    .prepare('SELECT * FROM amortissement_lignes WHERE immobilisation_id = ? ORDER BY annee')
    .all(immo.id);
  return { ...immo, lignes };
}

// ---------------------------------------------------------------------------
// Liste des immobilisations (alimente aussi le Tableau des immobilisations
// une fois les écritures liées générées — voir syntheseService.js).
// ---------------------------------------------------------------------------
router.get('/companies/:companyId/immobilisations', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM immobilisations WHERE company_id = ? ORDER BY date_acquisition DESC, id DESC')
    .all(req.params.companyId);
  res.json(rows.map(withSchedule));
});

router.get('/companies/:companyId/immobilisations/:id', (req, res) => {
  const immo = db
    .prepare('SELECT * FROM immobilisations WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.params.companyId);
  if (!immo) return res.status(404).json({ error: 'Immobilisation introuvable.' });
  res.json(withSchedule(immo));
});

// ---------------------------------------------------------------------------
// Création d'une immobilisation + calcul automatique du plan d'amortissement
// linéaire (avec prorata temporis sur l'exercice de mise en service).
// Les comptes (immo, amortissement classe 28, dotation classe 619/68) sont
// choisis par l'utilisateur parmi le plan comptable existant de la société
// (pas de valeur codée en dur), comme dans le logiciel bureau.
// ---------------------------------------------------------------------------
router.post('/companies/:companyId/immobilisations', (req, res) => {
  const companyId = req.params.companyId;
  const {
    facture_entry_id, nature, objet, compte_immo_numero, compte_amort_numero,
    compte_dotation_numero, date_acquisition, valeur_origine, duree_annees,
    date_debut_amortissement,
  } = req.body;

  try {
    if (!compte_immo_numero || !compte_amort_numero || !compte_dotation_numero) {
      throw httpError(400, "Le compte d'immobilisation, le compte d'amortissement et le compte de dotation sont requis.");
    }
    if (!date_acquisition || !date_debut_amortissement) {
      throw httpError(400, "La date d'acquisition et la date de début d'amortissement sont requises.");
    }
    if (!(Number(valeur_origine) > 0)) throw httpError(400, "La valeur d'origine doit être positive.");
    if (!(Number(duree_annees) > 0)) throw httpError(400, "La durée d'amortissement doit être positive.");

    const compteAmort = findAccount(companyId, compte_amort_numero);
    if (!compteAmort) throw httpError(400, `Compte d'amortissement "${compte_amort_numero}" introuvable dans le plan comptable.`);
    const compteDotation = findAccount(companyId, compte_dotation_numero);
    if (!compteDotation) throw httpError(400, `Compte de dotation "${compte_dotation_numero}" introuvable dans le plan comptable.`);

    const { taux, lignes } = calculerTableauAmortissementLineaire({
      valeurOrigine: valeur_origine,
      dureeAnnees: duree_annees,
      dateDebutAmortissement: date_debut_amortissement,
    });

    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO immobilisations
           (company_id, facture_entry_id, nature, objet, compte_immo_numero, compte_amort_numero,
            compte_dotation_numero, date_acquisition, valeur_origine, duree_annees, taux,
            date_debut_amortissement, mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lineaire')`
        )
        .run(
          companyId, facture_entry_id || null, nature || null, objet || null, compte_immo_numero,
          compte_amort_numero, compte_dotation_numero, date_acquisition, Number(valeur_origine),
          Number(duree_annees), taux, date_debut_amortissement
        );
      const immoId = info.lastInsertRowid;
      const insertLigne = db.prepare(
        `INSERT INTO amortissement_lignes (immobilisation_id, annee, base_amortissable, taux, prorata, dotation, cumul, vnc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of lignes) {
        insertLigne.run(immoId, l.annee, l.base_amortissable, l.taux, l.prorata, l.dotation, l.cumul, l.vnc);
      }
      return immoId;
    });

    const immoId = tx();
    const immo = db.prepare('SELECT * FROM immobilisations WHERE id = ?').get(immoId);
    res.status(201).json(withSchedule(immo));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Génère l'écriture comptable de dotation aux amortissements pour une année
// donnée du plan (Débit classe 6 Dotation / Crédit classe 3(28) Amortissement),
// dans le journal des Opérations diverses (OD). Ne génère jamais deux fois la
// même année (idempotent — évite les doublons d'écriture).
// ---------------------------------------------------------------------------
router.post('/companies/:companyId/immobilisations/:id/generer-ecriture', (req, res) => {
  const companyId = req.params.companyId;
  const { annee, fiscal_year_id } = req.body;
  try {
    const immo = db.prepare('SELECT * FROM immobilisations WHERE id = ? AND company_id = ?').get(req.params.id, companyId);
    if (!immo) throw httpError(404, 'Immobilisation introuvable.');
    const ligne = db
      .prepare('SELECT * FROM amortissement_lignes WHERE immobilisation_id = ? AND annee = ?')
      .get(immo.id, annee);
    if (!ligne) throw httpError(404, `Aucune ligne d'amortissement pour l'année ${annee}.`);
    if (ligne.journal_entry_id) throw httpError(409, `L'écriture de dotation ${annee} a déjà été générée.`);

    const compteDotation = findAccount(companyId, immo.compte_dotation_numero);
    const compteAmort = findAccount(companyId, immo.compte_amort_numero);
    if (!compteDotation || !compteAmort) throw httpError(400, 'Compte de dotation ou d\'amortissement introuvable dans le plan comptable.');

    const journal = db.prepare('SELECT * FROM journals WHERE company_id = ? AND code = ?').get(companyId, 'OD');
    if (!journal) throw httpError(400, 'Journal des Opérations Diverses (OD) introuvable pour cette société.');

    // Date d'écriture : 31/12 de l'année de dotation (ou date de clôture de
    // l'exercice fourni), toujours à l'intérieur de l'exercice comptable.
    const dateEcriture = `${annee}-12-31`;
    const fiscalYear = fiscal_year_id
      ? db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscal_year_id, companyId)
      : findFiscalYearForDate(companyId, dateEcriture);
    if (!fiscalYear) throw httpError(400, `Aucun exercice comptable ne couvre le ${dateEcriture}. Précisez fiscal_year_id.`);
    assertExerciceOuvert(companyId, fiscalYear.id);

    const libelle = `Dotation amortissement ${immo.objet || immo.nature || ''} - ${annee}`.trim();

    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(companyId, journal.id, fiscalYear.id, `AMORT-${immo.id}-${annee}`, dateEcriture, libelle, req.user.id);
      const entryId = info.lastInsertRowid;
      const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)');
      insertLine.run(entryId, compteDotation.id, ligne.dotation, 0);
      insertLine.run(entryId, compteAmort.id, 0, ligne.dotation);
      db.prepare('UPDATE amortissement_lignes SET journal_entry_id = ? WHERE id = ?').run(entryId, ligne.id);
      return entryId;
    });

    const entryId = tx();
    const immoUpdated = db.prepare('SELECT * FROM immobilisations WHERE id = ?').get(immo.id);
    res.status(201).json({ entry_id: entryId, immobilisation: withSchedule(immoUpdated) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
