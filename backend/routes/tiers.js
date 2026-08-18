const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { createTiersRecord } = require('../services/tiersService');

const router = express.Router();
router.use(requireAuth);

const RACINE = { client: '3421', fournisseur: '4411' };

// Liste des tiers d'une société (filtre optionnel par type)
router.get('/companies/:companyId/tiers', (req, res) => {
  const { type } = req.query;
  let query = `
    SELECT t.*, a.numero AS account_numero
    FROM tiers t JOIN accounts a ON a.id = t.account_id
    WHERE t.company_id = ?
  `;
  const params = [req.params.companyId];
  if (type) {
    query += ' AND t.type = ?';
    params.push(type);
  }
  query += ' ORDER BY t.nom';
  res.json(db.prepare(query).all(...params));
});

// Créer un tiers : crée automatiquement son sous-compte auxiliaire (3421xx / 4411xx),
// ou utilise le numéro fourni explicitement (ex: saisi depuis la pop-up "Création du
// Compte" pendant une écriture).
router.post('/companies/:companyId/tiers', (req, res) => {
  const companyId = req.params.companyId;
  const { type, nom, ice, if_fiscal, rc, telephone, email, adresse, numero } = req.body;

  if (!type || !RACINE[type]) return res.status(400).json({ error: "type doit être 'client' ou 'fournisseur'." });
  if (!nom) return res.status(400).json({ error: 'nom est requis.' });

  const tx = db.transaction(() =>
    createTiersRecord(companyId, { type, nom, ice, if_fiscal, rc, telephone, email, adresse, numero })
  );

  let id;
  try {
    id = tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const tiersRow = db
    .prepare(`SELECT t.*, a.numero AS account_numero FROM tiers t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`)
    .get(id);
  res.status(201).json(tiersRow);
});

// Modifier les coordonnées d'un tiers (le compte auxiliaire ne change pas)
router.put('/companies/:companyId/tiers/:id', (req, res) => {
  const { nom, ice, if_fiscal, rc, telephone, email, adresse } = req.body;
  const existing = db.prepare('SELECT * FROM tiers WHERE id = ? AND company_id = ?').get(req.params.id, req.params.companyId);
  if (!existing) return res.status(404).json({ error: 'Tiers introuvable.' });

  db.prepare(
    `UPDATE tiers SET nom = ?, ice = ?, if_fiscal = ?, rc = ?, telephone = ?, email = ?, adresse = ? WHERE id = ?`
  ).run(
    nom ?? existing.nom,
    ice ?? existing.ice,
    if_fiscal ?? existing.if_fiscal,
    rc ?? existing.rc,
    telephone ?? existing.telephone,
    email ?? existing.email,
    adresse ?? existing.adresse,
    req.params.id
  );

  if (nom && nom !== existing.nom) {
    db.prepare('UPDATE accounts SET intitule = ? WHERE id = ?').run(nom, existing.account_id);
  }

  res.json(db.prepare(`SELECT t.*, a.numero AS account_numero FROM tiers t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`).get(req.params.id));
});

// Solde courant d'un tiers (débit - crédit cumulés sur son sous-compte)
router.get('/companies/:companyId/tiers/:id/solde', (req, res) => {
  const tiersRow = db.prepare('SELECT * FROM tiers WHERE id = ? AND company_id = ?').get(req.params.id, req.params.companyId);
  if (!tiersRow) return res.status(404).json({ error: 'Tiers introuvable.' });

  const totals = db
    .prepare('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM journal_lines WHERE account_id = ?')
    .get(tiersRow.account_id);

  res.json({ total_debit: totals.d, total_credit: totals.c, solde: totals.d - totals.c });
});

module.exports = router;
