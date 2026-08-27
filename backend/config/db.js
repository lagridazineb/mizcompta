// Connexion et initialisation de la base de données.
//
// Stockage : Turso (base libSQL gratuite "pour toujours", pas d'essai limité
// dans le temps) via une "embedded replica" — un fichier SQLite local pour
// des lectures/écritures instantanées et synchrones (aucun changement dans
// routes/*.js), répliqué automatiquement vers le cloud Turso en arrière-plan.
// Concrètement : le disque de Render reste un simple cache local ; la copie
// de référence (durable, sauvegardée) vit chez Turso. Si le disque de Render
// est perdu (redéploiement, changement de plan...), les données ne le sont
// pas : il suffit de relancer le service, la réplique se reconstruit toute
// seule depuis Turso au démarrage.
//
// Variables d'environnement à définir sur Render (tableau de bord Turso ->
// "Create Database" puis "Connect" pour les récupérer) :
//   TURSO_DATABASE_URL   ex. libsql://mizcompta-xxxx.turso.io
//   TURSO_AUTH_TOKEN     jeton généré depuis le dashboard Turso ou la CLI
// Sans ces deux variables (ex. développement local), on retombe simplement
// sur un fichier SQLite local classique, sans réplication.
const Database = require('libsql');
const path = require('path');
const fs = require('fs');

// Emplacement du fichier SQLite LOCAL (réplique). Configurable via DB_PATH
// pour pointer vers un disque persistant en production (ex. Render :
// /var/data/megacompta.db). Sans cette variable (développement local), on
// garde l'emplacement historique dans backend/data/.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'megacompta.db');
// Le dossier doit exister avant l'ouverture du fichier SQLite.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const dbExists = fs.existsSync(DB_PATH);

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

// IMPORTANT : la connexion à Turso ne doit jamais empêcher le site de
// démarrer. Si les variables d'environnement sont absentes, mal formées, ou
// si Turso est momentanément injoignable, on retombe sur un fichier SQLite
// local classique (comme avant l'ajout de Turso) plutôt que de planter tout
// le serveur. Le message d'erreur exact est affiché dans les logs Render
// (onglet "Logs" du service) pour pouvoir corriger la variable en cause.
let db;
let tursoActive = false;

// Cas particulier attendu lors de la MIGRATION vers Turso : le fichier
// DB_PATH existe déjà sur le disque, créé par un déploiement précédent qui
// n'utilisait pas encore Turso (fichier SQLite "classique", sans les
// métadonnées de réplique que libsql attend). Dans ce cas précis, libsql
// refuse de l'ouvrir avec l'erreur "db file exists but metadata file does
// not". On le détecte et on met ce fichier de côté (jamais supprimé, juste
// renommé en .pre-turso-backup) pour repartir sur une réplique neuve,
// resynchronisée depuis Turso.
function isMigrationMismatch(err) {
  return /metadata file does not|invalid local state|wal_index|delete the database( file)? and (attempt|try) again/i.test(err.message || '');
}
function quarantineLocalFile() {
  if (!fs.existsSync(DB_PATH)) return;
  const backupPath = `${DB_PATH}.pre-turso-backup-${Date.now()}`;
  fs.renameSync(DB_PATH, backupPath);
  // Fichiers auxiliaires SQLite classiques
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) fs.renameSync(DB_PATH + suffix, backupPath + suffix);
  }
  // Fichier de métadonnées libsql (.meta) : sa présence sans le .db (ou
  // inversement) est précisément ce qui provoque l'erreur "invalid local
  // state" au redémarrage suivant. On le met de côté en même temps.
  const metaPath = DB_PATH + '.meta';
  if (fs.existsSync(metaPath)) fs.renameSync(metaPath, backupPath + '.meta');
  console.error(`Turso : ancien fichier SQLite local (pré-Turso) mis de côté sans le supprimer : ${backupPath}`);
}

function openTursoReplica() {
  return new Database(DB_PATH, {
    syncUrl: TURSO_URL,
    authToken: TURSO_TOKEN,
    // Synchronise vers Turso toutes les 30 secondes en tâche de fond, en
    // plus de la synchronisation immédiate garantie après chaque écriture.
    syncPeriod: 30,
  });
}

if (TURSO_URL) {
  try {
    db = openTursoReplica();
    tursoActive = true;
  } catch (err) {
    if (isMigrationMismatch(err)) {
      console.error('Turso : ancien fichier local incompatible détecté, nouvelle tentative après mise de côté du fichier. Détail :', err.message);
      try {
        quarantineLocalFile();
        db = openTursoReplica();
        tursoActive = true;
      } catch (err2) {
        console.error('Turso : toujours impossible après mise de côté du fichier, bascule sur SQLite local uniquement. Détail :', err2.message);
        db = new Database(DB_PATH);
      }
    } else {
      console.error('Turso : connexion impossible au démarrage, bascule sur SQLite local uniquement (les données ne seront pas répliquées). Détail :', err.message);
      db = new Database(DB_PATH);
    }
  }
} else {
  db = new Database(DB_PATH);
}

// Au démarrage, on tire d'abord la dernière version connue de Turso avant
// toute lecture/écriture (utile si le disque local de Render vient d'être
// recréé et est donc vide ou périmé).
if (tursoActive) {
  try {
    db.sync();
  } catch (err) {
    console.error('Turso : échec de la synchronisation initiale (on continue avec la réplique locale) :', err.message);
  }
}

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// defer_foreign_keys au niveau SESSION : la contrainte FK n'est vérifiée
// qu'au COMMIT (et non instruction par instruction), ce qui évite l'erreur
// "FOREIGN KEY constraint failed" avec Turso/Hrana quand des lignes enfant
// sont insérées juste après leur parent dans la même transaction. SQLite
// remet automatiquement ce pragma à OFF après chaque COMMIT/ROLLBACK, donc
// il est sans effet hors transaction et ne présente aucun risque.
db.exec('PRAGMA defer_foreign_keys = ON');

// Compatibilité : le reste du code (routes/*.js) a été écrit pour l'API
// synchrone façon better-sqlite3 (db.pragma, db.transaction). Le paquet
// "libsql" reproduit déjà db.prepare().get()/.all()/.run() et db.exec() à
// l'identique ; il ne fournit en revanche pas .pragma()/.transaction(), donc
// on les recrée ici pour ne rien changer dans le reste du code.
//
// Il ajoute par ailleurs un champ interne `_metadata` sur les lignes
// renvoyées par .get() (absent avec node:sqlite) : sans ce correctif, ce
// champ technique se serait retrouvé exposé tel quel dans les réponses JSON
// de l'API (ex. res.json(row)). On l'enlève systématiquement pour que .get()
// se comporte exactement comme avant.
const nativePrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = nativePrepare(sql);
  const nativeGet = stmt.get.bind(stmt);
  stmt.get = (...args) => {
    const row = nativeGet(...args);
    if (row && Object.prototype.hasOwnProperty.call(row, '_metadata')) delete row._metadata;
    return row;
  };

  // Diagnostic : les erreurs Hrana/libsql (ex. "FOREIGN KEY constraint
  // failed") n'indiquent ni la requête ni les valeurs en cause. On les
  // rattrape ici pour logger le SQL exact + les paramètres avant de
  // relancer l'erreur d'origine (le comportement de l'appelant ne change
  // pas), afin de pouvoir identifier immédiatement quelle ligne/quel id est
  // en cause dans les logs Render.
  const nativeRun = stmt.run.bind(stmt);
  stmt.run = (...args) => {
    try {
      return nativeRun(...args);
    } catch (err) {
      console.error(
        `[SQL] Échec de "${sql}" avec les paramètres ${JSON.stringify(args)} :`,
        err.message
      );
      throw err;
    }
  };

  return stmt;
};
db.pragma = (sql) => db.exec(`PRAGMA ${sql}`);
db.transaction = (fn) => {
  return (...args) => {
    db.exec('BEGIN');
    // defer_foreign_keys est déjà activé au niveau SESSION (voir plus haut).
    // SQLite le remet à OFF automatiquement après chaque COMMIT/ROLLBACK,
    // donc on le réactive à chaque BEGIN pour être sûr qu'il s'applique
    // même si un ROLLBACK précédent l'a désactivé.
    db.exec('PRAGMA defer_foreign_keys = ON');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      // Après un COMMIT réussi, on rafraîchit immédiatement la réplique
      // locale : la plupart des routes font un SELECT juste après avoir
      // appelé une transaction (pour renvoyer la ligne créée/modifiée), et
      // ce SELECT doit voir ce qui vient d'être écrit. On avale toute
      // erreur de sync ici : elle ne doit jamais faire échouer une
      // opération qui a déjà réussi côté base de données.
      if (tursoActive) {
        try {
          db.sync();
        } catch (syncErr) {
          console.error('[transaction] sync post-COMMIT échouée (ignorée) :', syncErr.message);
        }
      }
      return result;
    } catch (err) {
      // Avec Turso/Hrana, quand une instruction échoue en cours de
      // transaction, le serveur distant annule déjà la transaction de son
      // côté. Le ROLLBACK qu'on tente ensuite échoue alors avec sa propre
      // erreur ("cannot rollback - no transaction is active" / Hrana Api
      // error) — une erreur sans intérêt qui, si on la laissait remonter,
      // remplacerait et cacherait la VRAIE cause (err) de l'échec initial.
      // On l'avale simplement (juste tracée pour le diagnostic) et on
      // relance systématiquement l'erreur d'origine.
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error(
          '[transaction] ROLLBACK impossible (transaction déjà annulée côté serveur) — erreur ignorée, on relance la cause réelle :',
          rollbackErr.message
        );
      }
      throw err;
    }
  };
};

function init() {
  db.exec(`
    -- Utilisateurs du cabinet
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'comptable', -- admin | comptable | consultation
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Sociétés / dossiers clients gérés par le cabinet (multi-société)
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raison_sociale TEXT NOT NULL,
      ice TEXT,                 -- Identifiant Commun de l'Entreprise
      if_fiscal TEXT,           -- Identifiant Fiscal
      rc TEXT,                  -- Registre de Commerce
      patente TEXT,
      cnss TEXT,
      forme_juridique TEXT,
      activite TEXT,             -- activité / secteur de la société
      ville TEXT,
      telephone TEXT,
      email TEXT,
      mode_declaration TEXT DEFAULT 'mensuel', -- mensuel | trimestriel (déclaration TVA)
      regime_tva TEXT DEFAULT 'encaissement', -- encaissement | debit
      taux_tva_defaut REAL DEFAULT 20,
      adresse TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Exercices comptables par société
    CREATE TABLE IF NOT EXISTS fiscal_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      date_debut TEXT NOT NULL,
      date_fin TEXT NOT NULL,
      cloture INTEGER DEFAULT 0,
      UNIQUE(company_id, date_debut, date_fin)
    );

    -- Plan Comptable Marocain (PCGM) - comptes par société (initialisé depuis le modèle standard)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      numero TEXT NOT NULL,       -- ex: 6111
      intitule TEXT NOT NULL,     -- ex: Achats de marchandises
      classe INTEGER NOT NULL,    -- 1 à 8
      nature TEXT,                -- actif | passif | charge | produit
      lettrable INTEGER DEFAULT 0,
      UNIQUE(company_id, numero)
    );

    -- Journaux comptables (achats, ventes, banque, caisse, OD...)
    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL,      -- AC, VE, BQ, CA, OD...
      libelle TEXT NOT NULL,
      UNIQUE(company_id, code)
    );

    -- Écritures comptables (en-tête)
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      journal_id INTEGER NOT NULL REFERENCES journals(id),
      fiscal_year_id INTEGER NOT NULL REFERENCES fiscal_years(id),
      numero_piece TEXT,
      date_ecriture TEXT NOT NULL,
      libelle TEXT NOT NULL,
      reference TEXT,
      valide INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Lignes d'écriture (débit/crédit)
    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      libelle TEXT,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      lettrage TEXT,
      taux_tva REAL,          -- si la ligne porte de la TVA
      tiers TEXT               -- nom du client/fournisseur pour les auxiliaires
    );

    CREATE INDEX IF NOT EXISTS idx_lines_entry ON journal_lines(entry_id);
    CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
    CREATE INDEX IF NOT EXISTS idx_entries_company_fy ON journal_entries(company_id, fiscal_year_id);

    -- Fiches Tiers (clients / fournisseurs), chacune liée à un sous-compte auxiliaire
    -- créé automatiquement sous 3421 (Clients) ou 4411 (Fournisseurs).
    CREATE TABLE IF NOT EXISTS tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- client | fournisseur
      code TEXT NOT NULL,
      nom TEXT NOT NULL,
      ice TEXT,
      if_fiscal TEXT,
      rc TEXT,
      telephone TEXT,
      email TEXT,
      adresse TEXT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(company_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_tiers_company ON tiers(company_id, type);

    -- Paramètres > Banque : les comptes bancaires réels de la société
    -- (Nom Banque, agence, RIB, ICE, mode de saisie…), rattachés chacun à un
    -- compte du plan comptable (5141 + un suffixe par banque, comme sur le
    -- logiciel bureau : 51410001, 51410002…).
    CREATE TABLE IF NOT EXISTS banques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      compte_numero TEXT NOT NULL,
      banque_nom TEXT NOT NULL,
      adresse_agence TEXT,
      rib TEXT,
      ice TEXT,
      mode_saisie TEXT DEFAULT 'TTC', -- TTC | HT | LIBRE
      par_defaut INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(company_id, compte_numero)
    );
    CREATE INDEX IF NOT EXISTS idx_banques_company ON banques(company_id);

    -- Tableaux annexes de la liasse fiscale que l'application ne peut pas
    -- déduire seule des écritures (crédit-bail, titres de participation,
    -- emprunts auprès des associés, répartition du capital, affectation des
    -- résultats, etc.) : stockés en JSON libre par tableau et par exercice,
    -- pour que l'utilisateur puisse les renseigner lui-même ("la place où je
    -- peux lier ces infos"). Vide => tableau imprimé "NEANT".
    CREATE TABLE IF NOT EXISTS etats_annexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      fiscal_year_id INTEGER NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
      tableau_code TEXT NOT NULL, -- T7, T9, T10, T11, T13, T14, T17, T18, T19, T20
      lignes TEXT NOT NULL DEFAULT '[]', -- JSON : tableau de lignes libres
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(company_id, fiscal_year_id, tableau_code)
    );

    -- Immobilisations (facture d'achat cochée "Immobilisation") et leur plan
    -- d'amortissement linéaire : alimente le Tableau des amortissements (état
    -- annexe) une fois les écritures de dotation générées.
    CREATE TABLE IF NOT EXISTS immobilisations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      facture_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
      nature TEXT,
      objet TEXT,
      compte_immo_numero TEXT NOT NULL,
      compte_amort_numero TEXT NOT NULL,
      compte_dotation_numero TEXT NOT NULL,
      date_acquisition TEXT NOT NULL,
      valeur_origine REAL NOT NULL,
      duree_annees REAL NOT NULL,
      taux REAL NOT NULL,
      date_debut_amortissement TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'lineaire',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_immobilisations_company ON immobilisations(company_id);

    CREATE TABLE IF NOT EXISTS amortissement_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      immobilisation_id INTEGER NOT NULL REFERENCES immobilisations(id) ON DELETE CASCADE,
      annee INTEGER NOT NULL,
      base_amortissable REAL NOT NULL,
      taux REAL NOT NULL,
      prorata REAL NOT NULL DEFAULT 1,
      dotation REAL NOT NULL,
      cumul REAL NOT NULL,
      vnc REAL NOT NULL,
      journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
      UNIQUE(immobilisation_id, annee)
    );
    CREATE INDEX IF NOT EXISTS idx_amort_lignes_immo ON amortissement_lignes(immobilisation_id);
  `);

  migrateCompaniesTable();
}

// Ajoute les colonnes manquantes sur la table companies pour les bases de données
// créées avant l'ajout des nouveaux champs (activité, ville, téléphone, email,
// mode de déclaration). SQLite ne supporte pas "ADD COLUMN IF NOT EXISTS" de façon
// portable ici, donc on vérifie nous-mêmes les colonnes existantes.
function migrateCompaniesTable() {
  const existing = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  const wanted = [
    { name: 'activite', ddl: 'ALTER TABLE companies ADD COLUMN activite TEXT' },
    { name: 'ville', ddl: 'ALTER TABLE companies ADD COLUMN ville TEXT' },
    { name: 'telephone', ddl: 'ALTER TABLE companies ADD COLUMN telephone TEXT' },
    { name: 'email', ddl: 'ALTER TABLE companies ADD COLUMN email TEXT' },
    { name: 'mode_declaration', ddl: "ALTER TABLE companies ADD COLUMN mode_declaration TEXT DEFAULT 'mensuel'" },
    { name: 'type_pc', ddl: "ALTER TABLE companies ADD COLUMN type_pc TEXT DEFAULT 'ENTREPRISE'" },
  ];
  for (const col of wanted) {
    if (!existing.includes(col.name)) {
      db.exec(col.ddl);
    }
  }

  const existingTiers = db.prepare('PRAGMA table_info(tiers)').all().map((c) => c.name);
  const wantedTiers = [
    { name: 'if_fiscal', ddl: 'ALTER TABLE tiers ADD COLUMN if_fiscal TEXT' },
    { name: 'rc', ddl: 'ALTER TABLE tiers ADD COLUMN rc TEXT' },
  ];
  for (const col of wantedTiers) {
    if (!existingTiers.includes(col.name)) {
      db.exec(col.ddl);
    }
  }

  // Écritures : échéance de règlement (factures) + type de pièce (facture / règlement / OD…)
  const existingEntries = db.prepare('PRAGMA table_info(journal_entries)').all().map((c) => c.name);
  const wantedEntries = [
    { name: 'echeance', ddl: 'ALTER TABLE journal_entries ADD COLUMN echeance TEXT' },
    { name: 'type_piece', ddl: "ALTER TABLE journal_entries ADD COLUMN type_piece TEXT DEFAULT 'od'" },
  ];
  for (const col of wantedEntries) {
    if (!existingEntries.includes(col.name)) {
      db.exec(col.ddl);
    }
  }

  // Lignes : mode et référence de règlement (chèque n°, effet n°…) pour les lignes de paiement
  // + colonnes spécifiques à la saisie manuelle du relevé bancaire (Remise N°, Libellé Banque,
  // N° de Facture rapproché) et au compte de trésorerie réellement visé par un chèque encore
  // "en attente" (tant qu'il n'apparaît pas sur le relevé, il transite par un compte d'attente).
  const existingLines = db.prepare('PRAGMA table_info(journal_lines)').all().map((c) => c.name);
  const wantedLines = [
    { name: 'mode_paiement', ddl: 'ALTER TABLE journal_lines ADD COLUMN mode_paiement TEXT' },
    { name: 'piece_reglement', ddl: 'ALTER TABLE journal_lines ADD COLUMN piece_reglement TEXT' },
    { name: 'compte_cible_numero', ddl: 'ALTER TABLE journal_lines ADD COLUMN compte_cible_numero TEXT' },
    { name: 'remise_numero', ddl: 'ALTER TABLE journal_lines ADD COLUMN remise_numero TEXT' },
    { name: 'libelle_banque', ddl: 'ALTER TABLE journal_lines ADD COLUMN libelle_banque TEXT' },
    { name: 'numero_facture_ref', ddl: 'ALTER TABLE journal_lines ADD COLUMN numero_facture_ref TEXT' },
  ];
  for (const col of wantedLines) {
    if (!existingLines.includes(col.name)) {
      db.exec(col.ddl);
    }
  }

  // Écritures : lien explicite règlement/rapprochement -> facture d'origine, pour retrouver
  // le "fil" complet (facture, chèque en attente, ligne du relevé bancaire) sans dépendre
  // uniquement du lettrage — utile tant que le chèque n'est pas encore soldé.
  const existingEntries2 = db.prepare('PRAGMA table_info(journal_entries)').all().map((c) => c.name);
  const wantedEntries2 = [{ name: 'facture_id', ddl: 'ALTER TABLE journal_entries ADD COLUMN facture_id INTEGER' }];
  for (const col of wantedEntries2) {
    if (!existingEntries2.includes(col.name)) {
      db.exec(col.ddl);
    }
  }

  // Accès unique : MizCompta n'a pas de création de compte (voir
  // routes/auth.js) — un seul identifiant existe, fourni par la société
  // ("admin" / "1234"). On s'assure qu'il existe et que c'est le SEUL
  // compte de la base, pour qu'aucun ancien compte de test ne traîne.
  const bcrypt = require('bcryptjs');
  const IDENTIFIANT_ADMIN = 'admin';
  const MOT_DE_PASSE_ADMIN = '1234';
  const autresComptes = db.prepare('SELECT id FROM users WHERE email != ?').all(IDENTIFIANT_ADMIN);
  for (const u of autresComptes) {
    db.exec(`UPDATE journal_entries SET created_by = NULL WHERE created_by = ${u.id}`);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  }
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(IDENTIFIANT_ADMIN);
  if (!admin) {
    db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run(
      IDENTIFIANT_ADMIN,
      bcrypt.hashSync(MOT_DE_PASSE_ADMIN, 10),
      'Administrateur',
      'admin'
    );
  }
}

init();

module.exports = { db, isNewDatabase: !dbExists };
