const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Plan des comptes d'une société
router.get('/companies/:companyId/accounts', (req, res) => {
  const accounts = db
    .prepare('SELECT * FROM accounts WHERE company_id = ? ORDER BY numero')
    .all(req.params.companyId);
  res.json(accounts);
});

router.post('/companies/:companyId/accounts', (req, res) => {
  const { numero, intitule, classe, nature, lettrable } = req.body;
  if (!numero || !intitule || !classe) {
    return res.status(400).json({ error: 'numero, intitule et classe sont requis.' });
  }
  try {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.params.companyId, numero, intitule, classe, nature || null, lettrable ? 1 : 0);
    res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: 'Ce numéro de compte existe déjà pour cette société.' });
  }
});

// Journaux d'une société
router.get('/companies/:companyId/journals', (req, res) => {
  const journals = db.prepare('SELECT * FROM journals WHERE company_id = ? ORDER BY code').all(req.params.companyId);
  res.json(journals);
});

module.exports = router;
