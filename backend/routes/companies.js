const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

const PCGM_STANDARD = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pcgm_standard.json'), 'utf-8')
);
// Plan comptable spécifique au secteur immobilier (promotion immobilière,
// lotissement…), extrait du "Plan Comptable du Secteur Immobilier" (CNC,
// juin 2022) — comptes de stocks (terrains, programmes en cours…) et de
// charges/produits propres au métier, absents du PCGM standard.
const PCGM_IMMOBILIER = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pcgm_immobilier.json'), 'utf-8')
);
// Types de plan comptable proposés à la création d'une société — seul
// SECT.IMMOBILIER change le plan de comptes initial pour l'instant ; les
// autres types utilisent le PCGM standard (comme avant).
const TYPES_PC = ['ENTREPRISE', 'SECT.IMMOBILIER', 'ASSOCIATION', 'PERSONNE PHYSIQUE'];

const DEFAULT_JOURNALS = [
  { code: 'AC', libelle: 'Journal des achats' },
  { code: 'VE', libelle: 'Journal des ventes' },
  { code: 'BQ', libelle: 'Journal de banque' },
  { code: 'CA', libelle: 'Journal de caisse' },
  { code: 'OD', libelle: "Journal des opérations diverses" },
  { code: 'JB', libelle: 'Journal CNSS / AMO' },
];

// Liste des sociétés (avec recherche optionnelle : ?q=texte)
// La recherche porte sur la raison sociale, l'ICE, l'IF, le RC, la patente,
// la ville et l'activité.
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    const companies = db.prepare('SELECT * FROM companies ORDER BY raison_sociale').all();
    return res.json(companies);
  }
  const like = `%${q}%`;
  const companies = db
    .prepare(
      `SELECT * FROM companies
       WHERE raison_sociale LIKE ? OR ice LIKE ? OR if_fiscal LIKE ? OR rc LIKE ?
          OR patente LIKE ? OR ville LIKE ? OR activite LIKE ?
       ORDER BY raison_sociale`
    )
    .all(like, like, like, like, like, like, like);
  res.json(companies);
});

// Créer une société : initialise automatiquement le PCGM standard + journaux + exercice en cours
router.post('/', (req, res) => {
  const {
    raison_sociale,
    ice,
    if_fiscal,
    rc,
    patente,
    cnss,
    forme_juridique,
    activite,
    ville,
    telephone,
    email,
    mode_declaration,
    adresse,
    regime_tva,
    taux_tva_defaut,
    type_pc,
  } = req.body;
  if (!raison_sociale) return res.status(400).json({ error: 'raison_sociale est requis.' });
  const typePcFinal = TYPES_PC.includes(type_pc) ? type_pc : 'ENTREPRISE';

  const insertCompany = db.prepare(`
    INSERT INTO companies (
      raison_sociale, ice, if_fiscal, rc, patente, cnss, forme_juridique,
      activite, ville, telephone, email, mode_declaration, adresse, regime_tva, taux_tva_defaut, type_pc
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((payload) => {
    const info = insertCompany.run(
      payload.raison_sociale,
      payload.ice || null,
      payload.if_fiscal || null,
      payload.rc || null,
      payload.patente || null,
      payload.cnss || null,
      payload.forme_juridique || null,
      payload.activite || null,
      payload.ville || null,
      payload.telephone || null,
      payload.email || null,
      payload.mode_declaration || 'mensuel',
      payload.adresse || null,
      payload.regime_tva || 'encaissement',
      payload.taux_tva_defaut || 20,
      typePcFinal
    );
    const companyId = info.lastInsertRowid;

    // Plan comptable initial : le secteur immobilier (promotion, lotissement…)
    // a des comptes de stocks et de charges/produits spécifiques (CNC, Plan
    // Comptable du Secteur Immobilier, juin 2022) — les 3 autres types
    // utilisent le PCGM standard, inchangé.
    const planComptable = typePcFinal === 'SECT.IMMOBILIER' ? PCGM_IMMOBILIER : PCGM_STANDARD;
    // INSERT OR IGNORE : si des comptes existent déjà pour cette société
    // (données orphelines d'une tentative précédente avortée), on les saute
    // silencieusement plutôt que de planter avec UNIQUE constraint failed.
    const insertAccount = db.prepare(
      'INSERT OR IGNORE INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const acc of planComptable) {
      insertAccount.run(companyId, acc.numero, acc.intitule, acc.classe, acc.nature, acc.lettrable ? 1 : 0);
    }

    const insertJournal = db.prepare('INSERT OR IGNORE INTO journals (company_id, code, libelle) VALUES (?, ?, ?)');
    for (const j of DEFAULT_JOURNALS) {
      insertJournal.run(companyId, j.code, j.libelle);
    }

    const now = new Date();
    const dateDebut = `${now.getFullYear()}-01-01`;
    const dateFin = `${now.getFullYear()}-12-31`;
    db.prepare('INSERT OR IGNORE INTO fiscal_years (company_id, date_debut, date_fin) VALUES (?, ?, ?)').run(
      companyId,
      dateDebut,
      dateFin
    );

    return companyId;
  });

  const companyId = tx(req.body);
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  res.status(201).json(company);
});

router.get('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Société introuvable.' });
  res.json(company);
});

// Modification d'une société : tous les champs peuvent être corrigés après coup
// (en cas d'erreur de saisie lors de la création par exemple).
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Société introuvable.' });

  const {
    raison_sociale,
    ice,
    if_fiscal,
    rc,
    patente,
    cnss,
    forme_juridique,
    activite,
    ville,
    telephone,
    email,
    mode_declaration,
    adresse,
    regime_tva,
    taux_tva_defaut,
  } = req.body;
  if (!raison_sociale) return res.status(400).json({ error: 'raison_sociale est requis.' });

  db.prepare(
    `UPDATE companies SET
      raison_sociale = ?,
      ice = ?,
      if_fiscal = ?,
      rc = ?,
      patente = ?,
      cnss = ?,
      forme_juridique = ?,
      activite = ?,
      ville = ?,
      telephone = ?,
      email = ?,
      mode_declaration = ?,
      adresse = ?,
      regime_tva = ?,
      taux_tva_defaut = ?
    WHERE id = ?`
  ).run(
    raison_sociale,
    ice || null,
    if_fiscal || null,
    rc || null,
    patente || null,
    cnss || null,
    forme_juridique || null,
    activite || null,
    ville || null,
    telephone || null,
    email || null,
    mode_declaration || 'mensuel',
    adresse || null,
    regime_tva || 'encaissement',
    taux_tva_defaut || 20,
    req.params.id
  );

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  res.json(company);
});

// Suppression d'une société : opération destructive et irréversible (toutes
// les écritures, comptes, tiers, immobilisations… de la société partent avec,
// via les contraintes ON DELETE CASCADE de la base). Par sécurité, on exige
// que la personne retape la raison sociale exacte dans le corps de la requête
// — comme sur GitHub pour la suppression d'un dépôt — pour éviter un clic
// malheureux sur un dossier client réel.
router.delete('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Société introuvable.' });

  const { confirmation } = req.body || {};
  if (confirmation !== company.raison_sociale) {
    return res.status(400).json({
      error: 'Confirmation invalide : retapez exactement la raison sociale de la société pour confirmer la suppression.',
    });
  }

  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

router.get('/:id/fiscal-years', (req, res) => {
  const years = db.prepare('SELECT * FROM fiscal_years WHERE company_id = ? ORDER BY date_debut DESC').all(req.params.id);
  res.json(years);
});

// --- Clôture d'exercice / de dossier ----------------------------------
// Bascule le champ `cloture` d'un exercice comptable : une fois clôturé,
// toutes les routes qui créent/modifient/suppriment des écritures pour cet
// exercice sont bloquées (voir services/clotureGuard.js). Réversible (on
// peut rouvrir un exercice clôturé par erreur).
router.patch('/:id/fiscal-years/:yearId', (req, res) => {
  const companyId = req.params.id;
  const yearId = req.params.yearId;
  const { cloture } = req.body;
  const fy = db.prepare('SELECT * FROM fiscal_years WHERE id = ? AND company_id = ?').get(yearId, companyId);
  if (!fy) return res.status(404).json({ error: 'Exercice comptable introuvable.' });
  db.prepare('UPDATE fiscal_years SET cloture = ? WHERE id = ?').run(cloture ? 1 : 0, yearId);
  const updated = db.prepare('SELECT * FROM fiscal_years WHERE id = ?').get(yearId);
  res.json(updated);
});

// Ouvre le prochain exercice comptable (année suivante), utile juste après
// avoir clôturé le dernier en date — reproduit le geste "Nouveau dossier /
// nouvel exercice" du logiciel de bureau, sans quitter l'écran Paramètres.
router.post('/:id/fiscal-years', (req, res) => {
  const companyId = req.params.id;
  const { date_debut, date_fin } = req.body;
  if (!date_debut || !date_fin) return res.status(400).json({ error: 'date_debut et date_fin sont requis.' });
  const info = db.prepare('INSERT INTO fiscal_years (company_id, date_debut, date_fin) VALUES (?, ?, ?)').run(companyId, date_debut, date_fin);
  const created = db.prepare('SELECT * FROM fiscal_years WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

module.exports = router;
