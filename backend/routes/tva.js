const express = require('express');
const XLSX = require('xlsx');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { calculateTVA } = require('../services/tvaService');
const { buildTvaDeclarationXML } = require('../services/xmlExportService');

const router = express.Router();
router.use(requireAuth);

router.get('/companies/:companyId/tva/calcul', (req, res) => {
  const { date_debut, date_fin } = req.query;
  if (!date_debut || !date_fin) {
    return res.status(400).json({ error: 'date_debut et date_fin sont requis (format YYYY-MM-DD).' });
  }
  const result = calculateTVA(req.params.companyId, date_debut, date_fin);
  res.json(result);
});

router.get('/companies/:companyId/tva/export-xml', (req, res) => {
  const { date_debut, date_fin } = req.query;
  if (!date_debut || !date_fin) {
    return res.status(400).json({ error: 'date_debut et date_fin sont requis (format YYYY-MM-DD).' });
  }
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Société introuvable.' });

  const tvaData = calculateTVA(req.params.companyId, date_debut, date_fin);
  const xml = buildTvaDeclarationXML(company, tvaData);

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="tva_${company.ice || company.id}_${date_debut}_${date_fin}.xml"`);
  res.send(xml);
});

// Relevé de déductions : liste des factures d'achats/charges portant de la TVA récupérable
// sur la période. C'est le tableau qui doit accompagner (ou alimenter) la télédéclaration TVA,
// quel que soit le format d'échange retenu avec la DGI.
router.get('/companies/:companyId/tva/releve-deductions', (req, res) => {
  const { date_debut, date_fin } = req.query;
  if (!date_debut || !date_fin) {
    return res.status(400).json({ error: 'date_debut et date_fin sont requis (format YYYY-MM-DD).' });
  }
  const companyId = req.params.companyId;
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) return res.status(404).json({ error: 'Société introuvable.' });

  const lignes = db
    .prepare(
      `
    SELECT
      je.date_ecriture AS date_facture,
      je.numero_piece,
      je.libelle,
      jl.tiers,
      jl.taux_tva,
      jl.debit AS montant_tva
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ? AND (a.numero LIKE '34552%' OR a.numero LIKE '34551%')
      AND je.date_ecriture BETWEEN ? AND ?
      AND jl.debit > 0
    ORDER BY je.date_ecriture
  `
    )
    .all(companyId, date_debut, date_fin);

  // Récupère l'ICE du fournisseur quand le tiers correspond à une fiche connue
  const tiersByNom = new Map(
    db.prepare('SELECT nom, ice FROM tiers WHERE company_id = ? AND type = ?').all(companyId, 'fournisseur').map((t) => [t.nom, t.ice])
  );

  const rows = lignes.map((l) => {
    const taux = l.taux_tva || 0;
    const montantHt = taux > 0 ? Math.round((l.montant_tva / (taux / 100)) * 100) / 100 : '';
    return {
      'N° Facture': l.numero_piece || '',
      Date: l.date_facture,
      Fournisseur: l.tiers || '',
      ICE: tiersByNom.get(l.tiers) || '',
      Libellé: l.libelle,
      'Montant HT': montantHt,
      'Taux TVA (%)': taux,
      'Montant TVA': Math.round(l.montant_tva * 100) / 100,
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Releve deductions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="releve_deductions_${date_debut}_${date_fin}.xlsx"`);
  res.send(buf);
});

module.exports = router;
