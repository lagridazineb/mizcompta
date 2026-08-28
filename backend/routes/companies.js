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

const PCGM_IMMOBILIER = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pcgm_immobilier.json'), 'utf-8')
);

const TYPES_PC = ['ENTREPRISE', 'SECT.IMMOBILIER', 'ASSOCIATION', 'PERSONNE PHYSIQUE'];

const DEFAULT_JOURNALS = [
  { code: 'AN', libelle: 'Journal des à-nouveaux' },
  { code: 'JA', libelle: 'Journal des achats' },
  { code: 'JB', libelle: 'Journal de banque' },
  { code: 'JC', libelle: 'Journal de caisse' },
  { code: 'JP', libelle: 'Journal de paie' },
  { code: 'JV', libelle: 'Journal des ventes' },
  { code: 'OD', libelle: "Journal des opérations diverses" },
  { code: 'CN', libelle: 'Journal CNSS / AMO' },
];

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

  // La ligne "société" est créée à part, en autocommit (une seule requête,
  // jamais retentée) : avec Turso/sqld, une écriture autocommit isolée a la
  // garantie "read-your-writes" (on la revoit tout de suite, y compris pour
  // les contraintes FK des lignes enfant qui vont suivre) — voir la note
  // dans config/db.js. On ne veut surtout PAS ré-insérer cette ligne en cas
  // de nouvel essai plus bas, sous peine de créer un doublon.
  const info = insertCompany.run(
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
    typePcFinal
  );
  const companyId = info.lastInsertRowid;

  // Plan comptable initial : le secteur immobilier (promotion, lotissement…)
  // a des comptes de stocks et de charges/produits spécifiques (CNC, Plan
  // Comptable du Secteur Immobilier, juin 2022) — les 3 autres types
  // utilisent le PCGM standard, inchangé.
  const planComptable = typePcFinal === 'SECT.IMMOBILIER' ? PCGM_IMMOBILIER : PCGM_STANDARD;
  const now = new Date();
  const dateDebut = `${now.getFullYear()}-01-01`;
  const dateFin = `${now.getFullYear()}-12-31`;

  // Comptes, journaux et exercice : insérés par lots (voir db.insertMany)
  // plutôt qu'une ligne à la fois — avec ~1124 comptes dans le PCGM
  // standard, un insert par ligne représentait plus d'un millier
  // d'allers-retours réseau vers Turso à chaque création de société (d'où
  // les 2+ minutes constatées), et exposait longuement la transaction à
  // l'aléa de session décrit dans config/db.js. Le tout reste dans
  // db.runWithRetry(db.transaction(...)) par sécurité, mais ne devrait plus
  // guère en avoir besoin : quelques requêtes au lieu de plus d'un millier.
  try {
    db.runWithRetry(
      db.transaction(() => {
        const accountRows = planComptable.map((acc) => [
          companyId,
          acc.numero,
          acc.intitule,
          acc.classe,
          acc.nature,
          acc.lettrable ? 1 : 0,
        ]);
        db.insertMany(
          'INSERT OR IGNORE INTO accounts (company_id, numero, intitule, classe, nature, lettrable)',
          accountRows
        );

        const journalRows = DEFAULT_JOURNALS.map((j) => [companyId, j.code, j.libelle]);
        db.insertMany('INSERT OR IGNORE INTO journals (company_id, code, libelle)', journalRows);

        db.prepare('INSERT OR IGNORE INTO fiscal_years (company_id, date_debut, date_fin) VALUES (?, ?, ?)').run(
          companyId,
          dateDebut,
          dateFin
        );
      })
    );
  } catch (err) {
    // Toutes les tentatives ont échoué : on retire la société orpheline
    // (ON DELETE CASCADE nettoie le peu qui aurait pu être créé) plutôt que
    // de laisser un dossier client à moitié initialisé, et on explique
    // clairement qu'il s'agit d'un incident passager côté base distante.
    try {
      db.prepare('DELETE FROM companies WHERE id = ?').run(companyId);
    } catch (cleanupErr) {
      console.error('[companies] Échec du nettoyage après tentative infructueuse :', cleanupErr.message);
    }
    err.status = 503;
    err.message =
      "La base de données distante a rencontré un incident passager pendant l'initialisation du dossier " +
      '(plan comptable / journaux). Aucune société incomplète n\'a été conservée — merci de réessayer.';
    throw err;
  }

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
