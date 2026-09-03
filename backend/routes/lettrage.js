const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { generateLettrageCode: generateCode } = require('../services/lettrageCode');

const router = express.Router();
router.use(requireAuth);

// Mouvements non lettrés d'un compte (candidats au lettrage)
router.get('/companies/:companyId/lettrage/compte/:accountId', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ?').get(req.params.accountId, req.params.companyId);
  if (!account) return res.status(404).json({ error: 'Compte introuvable.' });

  const lignes = db
    .prepare(
      `SELECT jl.*, je.date_ecriture, je.libelle AS libelle_ecriture, je.numero_piece
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = ? AND (jl.lettrage IS NULL OR jl.lettrage = '')
       ORDER BY je.date_ecriture, je.id`
    )
    .all(req.params.accountId);

  res.json({ account, lignes });
});

// Lettrer un ensemble de lignes : elles doivent appartenir au même compte et s'équilibrer (débit = crédit)
router.post('/companies/:companyId/lettrage', (req, res) => {
  const { line_ids } = req.body;
  if (!Array.isArray(line_ids) || line_ids.length < 2) {
    return res.status(400).json({ error: 'Sélectionnez au moins deux lignes à lettrer.' });
  }

  const placeholders = line_ids.map(() => '?').join(',');
  const lignes = db
    .prepare(
      `SELECT jl.* FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.id IN (${placeholders}) AND je.company_id = ?`
    )
    .all(...line_ids, req.params.companyId);

  if (lignes.length !== line_ids.length) return res.status(404).json({ error: 'Certaines lignes sont introuvables.' });

  const accountIds = new Set(lignes.map((l) => l.account_id));
  if (accountIds.size !== 1) return res.status(422).json({ error: 'Toutes les lignes doivent appartenir au même compte.' });

  const totalDebit = lignes.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lignes.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return res.status(422).json({ error: `Le débit (${totalDebit.toFixed(2)}) et le crédit (${totalCredit.toFixed(2)}) sélectionnés ne s'équilibrent pas.` });
  }

  const code = generateCode();
  const tx = db.transaction(() => {
    const update = db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?');
    for (const id of line_ids) update.run(code, id);
  });
  tx();

  res.status(201).json({ lettrage: code, line_ids });
});

// Délettrer (annuler un rapprochement)
router.delete('/companies/:companyId/lettrage/:code', (req, res) => {
  const info = db
    .prepare(
      `UPDATE journal_lines SET lettrage = NULL WHERE lettrage = ? AND entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)`
    )
    .run(req.params.code, req.params.companyId);
  if (info.changes === 0) return res.status(404).json({ error: 'Lettrage introuvable.' });
  res.status(204).send();
});

module.exports = router;
