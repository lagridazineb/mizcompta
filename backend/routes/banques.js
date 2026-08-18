const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Liste des banques du Maroc proposées dans le dropdown "Nom Banque", comme
// sur l'écran "Édition des comptes" du logiciel bureau.
const BANQUES_MAROC = ['BP', 'ATW', 'ASSAFA', 'SGMB', 'CIH', 'BMCI', 'BMCE', 'CM', 'CA', 'UMB', 'CFG', 'UMNIA'];

function getAccountByNumero(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}

// Prochain numéro de compte disponible sous 5141 (5141 0001, 5141 0002…) —
// une sous-fiche par banque, exactement comme le montre la capture d'écran.
router.get('/companies/:companyId/banques/prochain-compte', (req, res) => {
  const companyId = req.params.companyId;
  const existants = db
    .prepare("SELECT compte_numero FROM banques WHERE company_id = ? AND compte_numero LIKE '5141%' ORDER BY compte_numero DESC LIMIT 1")
    .get(companyId);
  let suffixe = 1;
  if (existants) {
    const m = existants.compte_numero.match(/^5141(\d{4})$/);
    if (m) suffixe = Number(m[1]) + 1;
  }
  res.json({ compte_numero: `5141${String(suffixe).padStart(4, '0')}` });
});

router.get('/companies/:companyId/banques', (req, res) => {
  const rows = db.prepare('SELECT * FROM banques WHERE company_id = ? ORDER BY compte_numero').all(req.params.companyId);
  res.json({ banques: rows, banques_disponibles: BANQUES_MAROC });
});

router.post('/companies/:companyId/banques', (req, res) => {
  const companyId = req.params.companyId;
  const { compte_numero, banque_nom, adresse_agence, rib, ice, mode_saisie, par_defaut } = req.body;
  if (!compte_numero || !banque_nom) {
    return res.status(400).json({ error: 'compte_numero et banque_nom sont requis.' });
  }

  const tx = db.transaction(() => {
    // Le compte comptable (5141xxxx) est créé à la volée s'il n'existe pas encore.
    let account = getAccountByNumero(companyId, compte_numero);
    if (!account) {
      const info = db
        .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, 5, ?, 1)')
        .run(companyId, compte_numero, `Banque ${banque_nom}`, 'actif');
      account = { id: info.lastInsertRowid };
    }

    if (par_defaut) {
      db.prepare('UPDATE banques SET par_defaut = 0 WHERE company_id = ?').run(companyId);
    }

    db.prepare(
      `INSERT INTO banques (company_id, compte_numero, banque_nom, adresse_agence, rib, ice, mode_saisie, par_defaut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, compte_numero) DO UPDATE SET
         banque_nom = excluded.banque_nom, adresse_agence = excluded.adresse_agence, rib = excluded.rib,
         ice = excluded.ice, mode_saisie = excluded.mode_saisie, par_defaut = excluded.par_defaut`
    ).run(companyId, compte_numero, banque_nom, adresse_agence || null, rib || null, ice || null, mode_saisie || 'TTC', par_defaut ? 1 : 0);
  });

  try {
    tx();
    const row = db.prepare('SELECT * FROM banques WHERE company_id = ? AND compte_numero = ?').get(companyId, compte_numero);
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: "Impossible d'enregistrer ce compte bancaire." });
  }
});

router.delete('/companies/:companyId/banques/:id', (req, res) => {
  db.prepare('DELETE FROM banques WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.status(204).send();
});

module.exports = router;
