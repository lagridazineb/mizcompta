const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Codes des tableaux "manuels" (l'app ne peut pas les déduire seule des
// écritures) et leurs colonnes, utilisés par le frontend pour construire la
// grille d'édition. Défini ici pour que le contrat colonnes <-> tableau_code
// soit vérifié côté serveur (on ignore les colonnes inconnues à la sauvegarde).
const TABLEAUX_MANUELS = {
  T7: ['nature', 'rubrique', 'date_contrat', 'duree_contrat_mois', 'valeur_contrat', 'redevance_exercice', 'redevance_precedent', 'redevance_restant_moins_1an', 'redevance_restant_plus_1an', 'prix_residuel', 'observation'],
  T9: ['nature', 'montant_debut', 'dotation_exploitation', 'dotation_financiere', 'dotation_non_courante', 'reprise_exploitation', 'reprise_financiere', 'reprise_non_courante', 'montant_fin'],
  T10: ['date_cession', 'compte', 'montant_brut', 'amort_cumules', 'valeur_nette', 'produit_cession', 'plus_value', 'moins_value'],
  T11: ['raison_sociale', 'secteur_activite', 'capital_social', 'participation_pct', 'prix_acquisition', 'valeur_comptable', 'date_cloture', 'situation_nette', 'resultat_net', 'produits_inscrits_cpc'],
  T13: ['nom_associe', 'if_associe', 'cin', 'adresse', 'nombre_titres_exercice_precedent', 'nombre_titres_exercice_actuel', 'part_social_pct', 'capital_souscrit', 'capital_appele', 'capital_libere'],
  T14: ['libelle', 'montant'],
  T16: ['designation', 'date_entree', 'prix_acquisition', 'valeur_comptable', 'amortissements_anterieurs', 'taux', 'duree', 'dotation_exercice', 'total_amortissements', 'observation'],
  T17: ['element', 'valeur_apport', 'valeur_nette_comptable', 'plus_value_constatee', 'plus_value_anterieure', 'plus_value_actuelle', 'cumul_plus_value_rapportee', 'solde_non_impute', 'observation'],
  T18: ['raison_sociale', 'adresse', 'cin', 'montant_pret', 'date_pret', 'duree_mois', 'taux_interet', 'charge_financiere', 'remboursement_principal', 'remboursement_interet', 'observation'],
  T19: ['nature_bien', 'lieu', 'proprietaire', 'adresse_proprietaire', 'if_proprietaire', 'date_conclusion', 'montant_annuel', 'montant_charge_exercice', 'type_contrat', 'observation'],
  T20: ['libelle', 'stock_initial_brut', 'stock_initial_provision', 'stock_initial_net', 'stock_final_brut', 'stock_final_provision', 'stock_final_net', 'variation'],
};

router.get('/companies/:companyId/etats-annexes', (req, res) => {
  const { fiscal_year_id } = req.query;
  if (!fiscal_year_id) return res.status(400).json({ error: 'fiscal_year_id est requis.' });
  const rows = db
    .prepare('SELECT tableau_code, lignes FROM etats_annexes WHERE company_id = ? AND fiscal_year_id = ?')
    .all(req.params.companyId, fiscal_year_id);
  const result = {};
  for (const code of Object.keys(TABLEAUX_MANUELS)) result[code] = [];
  for (const r of rows) {
    try {
      result[r.tableau_code] = JSON.parse(r.lignes);
    } catch {
      result[r.tableau_code] = [];
    }
  }
  res.json({ tableaux: result, colonnes: TABLEAUX_MANUELS });
});

router.put('/companies/:companyId/etats-annexes/:tableauCode', (req, res) => {
  const companyId = req.params.companyId;
  const { tableauCode } = req.params;
  const { fiscal_year_id, lignes } = req.body;
  if (!TABLEAUX_MANUELS[tableauCode]) return res.status(404).json({ error: 'Tableau inconnu.' });
  if (!fiscal_year_id || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'fiscal_year_id et lignes (tableau) sont requis.' });
  }
  // On ne garde que les colonnes déclarées pour ce tableau (défense contre des clés inattendues)
  const colonnes = TABLEAUX_MANUELS[tableauCode];
  const lignesNettoyees = lignes.map((l) => {
    const out = {};
    for (const c of colonnes) out[c] = l[c] ?? '';
    return out;
  });

  db.prepare(
    `INSERT INTO etats_annexes (company_id, fiscal_year_id, tableau_code, lignes, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(company_id, fiscal_year_id, tableau_code) DO UPDATE SET lignes = excluded.lignes, updated_at = datetime('now')`
  ).run(companyId, fiscal_year_id, tableauCode, JSON.stringify(lignesNettoyees));

  res.json({ tableau_code: tableauCode, lignes: lignesNettoyees });
});

module.exports = router;
