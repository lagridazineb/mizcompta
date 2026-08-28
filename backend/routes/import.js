const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { createTiersRecord } = require('../services/tiersService');

const router = express.Router();
router.use(requireAuth);

// Limite relevée à 25 Mo (au lieu de 5 Mo) : un fichier .xlsx de plusieurs
// milliers de lignes avec mise en forme dépasse facilement 5 Mo et était
// rejeté avant même d'être traité.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function parseWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

// Récupère une valeur de ligne en tolérant plusieurs variantes de nom de colonne (accents, casse)
function pick(row, ...keys) {
  const normalized = {};
  for (const k of Object.keys(row)) {
    normalized[k.trim().toLowerCase()] = row[k];
  }
  for (const key of keys) {
    const v = normalized[key.toLowerCase()];
    if (v !== undefined && v !== '') return String(v).trim();
  }
  return '';
}

function excelDateToISO(value) {
  if (!value) return '';
  const s = String(value).trim();
  // Déjà au format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Format JJ/MM/AAAA ou JJ-MM-AAAA
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Numéro de série Excel (date stockée comme nombre)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const parsed = XLSX.SSF.parse_date_code(Number(s));
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Modèles de fichiers téléchargeables
// ---------------------------------------------------------------------------
router.get('/companies/:companyId/import/modele/tiers', (req, res) => {
  const rows = [
    { Type: 'client', Nom: 'Client Exemple SARL', ICE: '001234567000012', Telephone: '0522000000', Email: 'contact@exemple.ma', Adresse: 'Casablanca' },
    { Type: 'fournisseur', Nom: 'Fournisseur Exemple SARL', ICE: '', Telephone: '', Email: '', Adresse: '' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tiers');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modele_tiers.xlsx"');
  res.send(buf);
});

router.get('/companies/:companyId/import/modele/ecritures', (req, res) => {
  const rows = [
    { Journal: 'JV', Date: '2026-01-15', Piece: 'F001', Libelle: 'Vente marchandises', Compte: '7111', Debit: '', Credit: '1000', Tiers: '' },
    { Journal: 'JV', Date: '2026-01-15', Piece: 'F001', Libelle: 'Vente marchandises', Compte: '342101', Debit: '1200', Credit: '', Tiers: 'Client Exemple' },
    { Journal: 'JV', Date: '2026-01-15', Piece: 'F001', Libelle: 'Vente marchandises', Compte: '4455', Debit: '', Credit: '200', Tiers: '' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modele_ecritures.xlsx"');
  res.send(buf);
});

// ---------------------------------------------------------------------------
// Import des tiers
// ---------------------------------------------------------------------------
router.post('/companies/:companyId/import/tiers', upload.single('file'), (req, res) => {
  const companyId = req.params.companyId;
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  let rows;
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: 'Fichier illisible. Utilisez un .xlsx, .xls ou .csv valide.' });
  }

  const results = { crees: 0, erreurs: [] };

  // IMPORTANT (performance) : une seule transaction pour tout le fichier, au lieu
  // d'une transaction par ligne. Sur un import de plusieurs milliers de lignes,
  // committer une transaction SQLite par ligne est de loin le principal facteur de
  // lenteur (chaque COMMIT force une écriture disque synchrone) — regrouper tout
  // l'import dans une seule transaction ramène un import de 5000 lignes de
  // plusieurs minutes à moins d'une seconde, sans changer le résultat : si une
  // ligne échoue elle est simplement ignorée (comme avant), les autres continuent.
  const runImport = db.transaction(() => {
    rows.forEach((row, idx) => {
      const type = pick(row, 'type').toLowerCase();
      const nom = pick(row, 'nom', 'raison sociale', 'raison_sociale');
      const ice = pick(row, 'ice');
      const telephone = pick(row, 'telephone', 'téléphone', 'tel');
      const email = pick(row, 'email', 'e-mail', 'mail');
      const adresse = pick(row, 'adresse');

      if (!nom) {
        results.erreurs.push({ ligne: idx + 2, erreur: 'Nom manquant — ligne ignorée.' });
        return;
      }
      if (!['client', 'fournisseur'].includes(type)) {
        results.erreurs.push({ ligne: idx + 2, erreur: `Type "${type}" invalide (attendu: client ou fournisseur) — ligne ignorée.` });
        return;
      }
      try {
        createTiersRecord(companyId, { type, nom, ice, telephone, email, adresse });
        results.crees += 1;
      } catch (e) {
        results.erreurs.push({ ligne: idx + 2, erreur: e.message });
      }
    });
  });
  runImport();

  res.json(results);
});

// ---------------------------------------------------------------------------
// Import des écritures : chaque ligne du fichier = une ligne d'écriture.
// Les lignes partageant Journal + Date + Pièce + Libellé sont regroupées en une
// seule écriture comptable, qui doit être équilibrée (débit total = crédit total).
// ---------------------------------------------------------------------------
router.post('/companies/:companyId/import/ecritures', upload.single('file'), (req, res) => {
  const companyId = req.params.companyId;
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  let rows;
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: 'Fichier illisible. Utilisez un .xlsx, .xls ou .csv valide.' });
  }

  const fiscalYears = db.prepare('SELECT * FROM fiscal_years WHERE company_id = ?').all(companyId);
  const journalsCache = new Map();
  const accountsCache = new Map();

  function findJournal(code) {
    if (!journalsCache.has(code)) {
      journalsCache.set(code, db.prepare('SELECT * FROM journals WHERE company_id = ? AND code = ?').get(companyId, code));
    }
    return journalsCache.get(code);
  }
  function findAccount(numero) {
    if (!accountsCache.has(numero)) {
      accountsCache.set(numero, db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero));
    }
    return accountsCache.get(numero);
  }
  function findFiscalYear(date) {
    return fiscalYears.find((fy) => date >= fy.date_debut && date <= fy.date_fin);
  }

  // Regroupement des lignes en écritures
  const groups = new Map();
  const rowErrors = [];
  rows.forEach((row, idx) => {
    const journalCode = pick(row, 'journal').toUpperCase();
    const date = excelDateToISO(pick(row, 'date'));
    const piece = pick(row, 'piece', 'pièce', 'numero_piece');
    const libelle = pick(row, 'libelle', 'libellé');
    const compteNumero = pick(row, 'compte', 'compte_numero', 'numero_compte');
    const debit = Number(pick(row, 'debit', 'débit') || 0);
    const credit = Number(pick(row, 'credit', 'crédit') || 0);
    const tiersLabel = pick(row, 'tiers');

    if (!journalCode || !date || !libelle || !compteNumero) {
      rowErrors.push({ ligne: idx + 2, erreur: 'Journal, Date, Libelle et Compte sont requis — ligne ignorée.' });
      return;
    }
    const key = `${journalCode}|${date}|${piece}|${libelle}`;
    if (!groups.has(key)) groups.set(key, { journalCode, date, piece, libelle, lignes: [], ligneIdx: [] });
    groups.get(key).lignes.push({ compteNumero, debit, credit, tiers: tiersLabel || null });
    groups.get(key).ligneIdx.push(idx + 2);
  });

  const results = { ecritures_creees: 0, lignes_ignorees: rowErrors, erreurs: [...rowErrors] };

  // IMPORTANT (performance) : statements préparés une seule fois (au lieu d'être
  // recréés à chaque écriture) et UNE seule transaction pour tout le fichier
  // (au lieu d'un commit par écriture). Sur un fichier de plusieurs milliers de
  // lignes/écritures, c'était le vrai goulot d'étranglement : chaque commit
  // SQLite force une écriture disque, donc 2000 écritures = 2000 écritures
  // disque synchrones. Tout regrouper en une transaction fait passer un import
  // de 5000 lignes de plusieurs minutes à moins d'une seconde.
  const insertEntry = db.prepare(
    `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLine = db.prepare(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, tiers) VALUES (?, ?, ?, ?, ?)`
  );

  const runImport = db.transaction(() => {
    for (const group of groups.values()) {
      const journal = findJournal(group.journalCode);
      if (!journal) {
        results.erreurs.push({ ligne: group.ligneIdx.join(','), erreur: `Journal "${group.journalCode}" introuvable pour cette société.` });
        continue;
      }
      const fiscalYear = findFiscalYear(group.date);
      if (!fiscalYear) {
        results.erreurs.push({ ligne: group.ligneIdx.join(','), erreur: `Aucun exercice comptable ne couvre la date ${group.date}.` });
        continue;
      }
      if (fiscalYear.cloture) {
        results.erreurs.push({ ligne: group.ligneIdx.join(','), erreur: `L'exercice couvrant le ${group.date} est clôturé — cette écriture ne peut pas être importée.` });
        continue;
      }

      const resolvedLines = [];
      let missingAccount = null;
      for (const l of group.lignes) {
        const account = findAccount(l.compteNumero);
        if (!account) {
          missingAccount = l.compteNumero;
          break;
        }
        resolvedLines.push({ account_id: account.id, debit: l.debit, credit: l.credit, tiers: l.tiers });
      }
      if (missingAccount) {
        results.erreurs.push({ ligne: group.ligneIdx.join(','), erreur: `Compte "${missingAccount}" introuvable dans le plan comptable.` });
        continue;
      }

      const totalDebit = resolvedLines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = resolvedLines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.005 || totalDebit === 0) {
        results.erreurs.push({
          ligne: group.ligneIdx.join(','),
          erreur: `Écriture "${group.libelle}" non équilibrée (débit ${totalDebit.toFixed(2)} / crédit ${totalCredit.toFixed(2)}).`,
        });
        continue;
      }

      const info = insertEntry.run(companyId, journal.id, fiscalYear.id, group.piece || null, group.date, group.libelle, req.user.id);
      const entryId = info.lastInsertRowid;
      for (const l of resolvedLines) insertLine.run(entryId, l.account_id, l.debit, l.credit, l.tiers);
      results.ecritures_creees += 1;
    }
  });
  runImport();

  res.json(results);
});

module.exports = router;
