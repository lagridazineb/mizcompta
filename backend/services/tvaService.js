const { db } = require('../config/db');

// Comptes de TVA du PCGM, tels que générés par le module Factures (racine + taux à 2
// chiffres, ex: 3455220 = TVA récupérable sur charges à 20%, 445510 = TVA facturée à 10%).
const RACINE_VENTE = '4455'; // Etat, TVA facturée
const RACINE_ACHAT_CHARGES = '34552'; // Etat, TVA récupérable sur charges
const RACINE_ACHAT_IMMO = '34551'; // Etat, TVA récupérable sur immobilisations

const TAUX_TVA = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

// Somme (débit - crédit) ou (crédit - débit) des lignes de TVA dont le compte
// commence par `racine`, sur la période, éventuellement groupée par taux.
function sommeParRacine(companyId, racine, dateDebut, dateFin, sens) {
  const rows = db
    .prepare(
      `
    SELECT COALESCE(jl.taux_tva, 0) AS taux, jl.debit AS debit, jl.credit AS credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ? AND a.numero LIKE ?
      AND je.date_ecriture BETWEEN ? AND ?
  `
    )
    .all(companyId, `${racine}%`, dateDebut, dateFin);

  const parTaux = {};
  let total = 0;
  for (const r of rows) {
    const montant = sens === 'credit' ? r.credit - r.debit : r.debit - r.credit;
    total += montant;
    parTaux[r.taux] = (parTaux[r.taux] || 0) + montant;
  }
  return { total, parTaux };
}

// Calcule la TVA due sur une période, avec le détail par taux (7% à 20%) pour les
// colonnes "Achats / Achats Immo / Ventes" de l'écran Télédéclaration TVA.
// NB : le régime (encaissement vs débit) influence la date de fait générateur retenue ;
// ce calcul utilise par défaut la date de l'écriture comptable (à adapter selon le régime
// réel de la société et validé par l'expert-comptable).
function calculateTVA(companyId, dateDebut, dateFin) {
  const ventes = sommeParRacine(companyId, RACINE_VENTE, dateDebut, dateFin, 'credit');
  const achats = sommeParRacine(companyId, RACINE_ACHAT_CHARGES, dateDebut, dateFin, 'debit');
  const achatsImmo = sommeParRacine(companyId, RACINE_ACHAT_IMMO, dateDebut, dateFin, 'debit');

  const tvaCollectee = ventes.total;
  const tvaDeductible = achats.total + achatsImmo.total;
  const tvaDue = tvaCollectee - tvaDeductible;

  const parTaux = TAUX_TVA.map((taux) => ({
    taux,
    achats: round2(achats.parTaux[taux] || 0),
    achats_immo: round2(achatsImmo.parTaux[taux] || 0),
    ventes: round2(ventes.parTaux[taux] || 0),
    ajios: 0, // agios bancaires — non modélisés séparément pour l'instant
  }));

  return {
    periode: { date_debut: dateDebut, date_fin: dateFin },
    tva_collectee: round2(tvaCollectee),
    tva_deductible_charges: round2(achats.total),
    tva_deductible_immobilisations: round2(achatsImmo.total),
    tva_deductible_totale: round2(tvaDeductible),
    // positif = TVA à payer, négatif = crédit de TVA reportable
    tva_due_ou_credit: round2(tvaDue),
    par_taux: parTaux,
  };
}

module.exports = { calculateTVA, TAUX_TVA };
