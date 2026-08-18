const { db } = require('../config/db');

const RACINE = { client: '3421', fournisseur: '4411' };
const NATURE = { client: 'actif', fournisseur: 'passif' };

// Crée un tiers et son sous-compte auxiliaire. Doit être appelé DANS une transaction
// (db.transaction) si utilisé pour un import en lot.
// Si `numero` est fourni (saisie manuelle du type "342101" depuis la pop-up de
// création de compte), on l'utilise tel quel (il doit commencer par la racine
// du type : 3421 pour un client, 4411 pour un fournisseur). Sinon on génère le
// prochain numéro disponible automatiquement.
function createTiersRecord(companyId, { type, nom, ice, if_fiscal, rc, telephone, email, adresse, numero }) {
  if (!type || !RACINE[type]) throw new Error("type doit être 'client' ou 'fournisseur'.");
  if (!nom) throw new Error('nom est requis.');

  const racine = RACINE[type];
  let finalNumero = numero ? String(numero).trim() : null;
  let accountIdExistant = null;

  if (finalNumero) {
    if (!finalNumero.startsWith(racine)) {
      throw new Error(`Le numéro de compte d'un ${type} doit commencer par ${racine}.`);
    }
    const existant = db.prepare('SELECT id FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, finalNumero);
    if (existant) {
      // Ce numéro existe déjà dans le plan comptable (souvent une rubrique
      // générique du PCGM, ex: 34211 "Clients - catégorie A", 4415
      // "Fournisseurs - effets à payer"…). S'il n'est pas déjà utilisé par un
      // AUTRE tiers, on le réutilise pour celui-ci plutôt que de bloquer —
      // l'utilisateur doit pouvoir choisir un numéro différent librement.
      const dejaUtilise = db.prepare('SELECT id FROM tiers WHERE account_id = ?').get(existant.id);
      if (dejaUtilise) throw new Error(`Le compte ${finalNumero} est déjà utilisé par un autre ${type}.`);
      accountIdExistant = existant.id;
    }
  }

  // On ne compte que les sous-comptes de tiers déjà attribués (même longueur que le
  // futur numéro, racine + 2 chiffres) : le PCGM complet contient d'autres comptes sous
  // la même racine (ex: 44111, 4415, 4417…) qu'il ne faut pas compter ici, sous peine de
  // numéroter les tiers 441106 au lieu de 441101 dès la première fiche créée.
  const longueurCible = racine.length + 2;
  const existingNumeros = new Set(
    db
      .prepare("SELECT numero FROM accounts WHERE company_id = ? AND numero LIKE ? AND LENGTH(numero) = ?")
      .all(companyId, `${racine}%`, longueurCible)
      .map((r) => r.numero)
  );

  let suffix = 1;
  if (!finalNumero) {
    for (;;) {
      finalNumero = `${racine}${String(suffix).padStart(2, '0')}`;
      if (!existingNumeros.has(finalNumero)) break;
      suffix += 1;
    }
  }

  const accInfo = accountIdExistant
    ? { lastInsertRowid: accountIdExistant }
    : db
        .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 1)')
        .run(companyId, finalNumero, nom, Number(racine[0]), NATURE[type]);
  if (accountIdExistant) {
    db.prepare('UPDATE accounts SET intitule = ?, lettrable = 1 WHERE id = ?').run(nom, accountIdExistant);
  }

  // Code interne du tiers (CL0001, FR0001…) : calculé indépendamment du numéro
  // de compte, car celui-ci peut avoir été saisi manuellement (ex: 4411019) —
  // s'appuyer sur le même compteur que le numéro de compte provoquait une
  // collision "UNIQUE constraint failed" dès le 2e tiers créé manuellement.
  const prefixCode = type === 'client' ? 'CL' : 'FR';
  const existingCodes = new Set(db.prepare('SELECT code FROM tiers WHERE company_id = ?').all(companyId).map((r) => r.code));
  let codeSuffix = 1;
  let code;
  for (;;) {
    code = `${prefixCode}${String(codeSuffix).padStart(4, '0')}`;
    if (!existingCodes.has(code)) break;
    codeSuffix += 1;
  }

  const tiersInfo = db
    .prepare(
      `INSERT INTO tiers (company_id, type, code, nom, ice, if_fiscal, rc, telephone, email, adresse, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      type,
      code,
      nom,
      ice || null,
      if_fiscal || null,
      rc || null,
      telephone || null,
      email || null,
      adresse || null,
      accInfo.lastInsertRowid
    );

  return tiersInfo.lastInsertRowid;
}

module.exports = { createTiersRecord };
