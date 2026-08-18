const { db } = require('../config/db');

// Bloque toute nouvelle écriture (facture, paiement, relevé bancaire,
// amortissement, import…) sur un exercice comptable marqué "clôturé" —
// utilisé par toutes les routes qui créent des journal_entries, pour que la
// clôture (Paramètres > Clôture) protège réellement le dossier une fois
// fermé, et pas seulement visuellement dans la barre de titre.
function assertExerciceOuvert(companyId, fiscalYearId) {
  if (!fiscalYearId) return;
  const fy = db.prepare('SELECT id, cloture FROM fiscal_years WHERE id = ? AND company_id = ?').get(fiscalYearId, companyId);
  if (fy && fy.cloture) {
    const err = new Error(
      "Cet exercice comptable est clôturé : aucune nouvelle écriture ne peut y être enregistrée. " +
      "Rouvrez l'exercice depuis Paramètres > Clôture si nécessaire."
    );
    err.status = 423; // Locked
    throw err;
  }
}

module.exports = { assertExerciceOuvert };
