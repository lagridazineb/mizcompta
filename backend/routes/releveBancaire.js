const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { buildExport } = require('../services/exportService');
const { assertExerciceOuvert } = require('../services/clotureGuard');
const { classifierOperation } = require('../services/releveClassifier');
const { generateLettrageCode } = require('../services/lettrageCode');

const router = express.Router();
router.use(requireAuth);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getAccountByNumero(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}

function getOrCreateCompteAttente(companyId, sens) {
  // 3497 (débiteurs) quand on débite le compte d'attente, 4497 (créditeurs)
  // quand on le crédite — comptes "transitoires ou d'attente" du PCGM,
  // à reclasser ensuite vers le bon compte de tiers/charge lors du lettrage.
  const numero = sens === 'debit' ? '3497' : '4497';
  let account = getAccountByNumero(companyId, numero);
  if (!account) {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 1)')
      .run(
        companyId,
        numero,
        sens === 'debit' ? 'Comptes transitoires ou d\'attente - débiteurs' : 'Comptes transitoires ou d\'attente - créditeurs',
        Number(numero[0]),
        sens === 'debit' ? 'actif' : 'passif'
      );
    account = { id: info.lastInsertRowid, numero };
  }
  return account;
}

function journalForCompteTresor(numero) {
  if (numero.startsWith('516')) return 'JC';
  return 'JB';
}

function getJournal(companyId, code) {
  return db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, code);
}

function getOrCreateCompteTransitoire(companyId) {
  const numero = '5115';
  let account = getAccountByNumero(companyId, numero);
  if (!account) {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 0)')
      .run(companyId, numero, 'Virement de fonds', 5, 'actif');
    account = { id: info.lastInsertRowid, numero, intitule: 'Virement de fonds', classe: 5, nature: 'actif' };
  }
  return account;
}

function lignesAvecComptes(entryId) {
  return db
    .prepare(
      `SELECT jl.*, a.numero AS account_numero, a.intitule AS account_intitule
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       WHERE jl.entry_id = ? ORDER BY jl.id`
    )
    .all(entryId);
}

// Liste des chèques encore "en attente" (reçus de clients ou émis à des fournisseurs,
// selon `type`), c'est-à-dire non encore retrouvés sur un relevé bancaire — utilisée
// par l'écran "Saisie Relevé Bancaire" pour proposer le rapprochement.
router.get('/companies/:companyId/releve-bancaire/cheques-en-attente', (req, res) => {
  const companyId = req.params.companyId;
  const { type } = req.query; // 'vente' | 'achat' (optionnel, sinon les deux)
  const numeros = type === 'vente' ? ['5111'] : type === 'achat' ? ['51419'] : ['5111', '51419'];
  const placeholders = numeros.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT jl.id AS ligne_id, jl.entry_id, jl.debit, jl.credit, jl.piece_reglement, jl.compte_cible_numero, jl.tiers,
              je.date_ecriture, je.libelle, je.numero_piece, je.facture_id, a.numero AS account_numero
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.company_id = ? AND a.numero IN (${placeholders}) AND jl.lettrage IS NULL
       ORDER BY je.date_ecriture, je.id`
    )
    .all(companyId, ...numeros);
  res.json(rows);
});

// Lignes du compte de trésorerie choisi sur une période (mois/année ou dates), pour
// l'écran "Saisie Relevé Bancaire" (grille du bas) et son impression façon Grand Livre.
function getReleveLignesData(companyId, compte_numero, mois, annee, fiscal_year_id) {
  const compte = getAccountByNumero(companyId, compte_numero);
  if (!compte) return { compte: null, lignes: [], solde_depart: 0, solde_fin: 0 };

  let dateDebut = null;
  let dateFin = null;
  if (mois && annee) {
    const m = String(mois).padStart(2, '0');
    dateDebut = `${annee}-${m}-01`;
    const dFin = new Date(Number(annee), Number(mois), 0);
    dateFin = dFin.toISOString().slice(0, 10);
  }

  let soldeDepart = 0;
  if (dateDebut) {
    const avant = db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE je.company_id = ? AND jl.account_id = ? AND je.date_ecriture < ?`
      )
      .get(companyId, compte.id, dateDebut);
    soldeDepart = round2((avant.d || 0) - (avant.c || 0));
  }

  let query = `
    SELECT jl.id AS ligne_id, jl.entry_id, jl.debit, jl.credit, jl.libelle, jl.remise_numero, jl.libelle_banque,
           jl.piece_reglement, jl.numero_facture_ref, jl.lettrage, jl.mode_paiement,
           je.date_ecriture, je.libelle AS libelle_ecriture, je.numero_piece, je.type_piece,
           jr.code AS journal_code,
           (SELECT a2.numero FROM journal_lines jl2 JOIN accounts a2 ON a2.id = jl2.account_id
            WHERE jl2.entry_id = jl.entry_id AND jl2.id != jl.id LIMIT 1) AS compte_contrepartie_numero
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN journals jr ON jr.id = je.journal_id
    WHERE je.company_id = ? AND jl.account_id = ?
  `;
  const params = [companyId, compte.id];
  if (dateDebut && dateFin) {
    query += ' AND je.date_ecriture BETWEEN ? AND ?';
    params.push(dateDebut, dateFin);
  }
  if (fiscal_year_id) {
    query += ' AND je.fiscal_year_id = ?';
    params.push(fiscal_year_id);
  }
  query += ' ORDER BY je.date_ecriture, je.id';

  const rows = db.prepare(query).all(...params);
  let solde = soldeDepart;
  const lignes = rows.map((r) => {
    solde = round2(solde + (r.debit || 0) - (r.credit || 0));
    return { ...r, solde_cumule: solde };
  });

  return { compte, lignes, solde_depart: soldeDepart, solde_fin: solde, dateDebut, dateFin };
}

router.get('/companies/:companyId/releve-bancaire/lignes', (req, res) => {
  const companyId = req.params.companyId;
  const { compte_numero, mois, annee, fiscal_year_id } = req.query;
  if (!compte_numero) return res.status(400).json({ error: 'compte_numero est requis.' });
  const result = getReleveLignesData(companyId, compte_numero, mois, annee, fiscal_year_id);
  res.json(result);
});

// Téléchargement du relevé (PDF/Excel/Word), même contenu que l'écran de saisie.
router.get('/companies/:companyId/releve-bancaire/export', async (req, res) => {
  const companyId = req.params.companyId;
  const { compte_numero, mois, annee, fiscal_year_id, format } = req.query;
  if (!compte_numero || !format) return res.status(400).json({ error: 'compte_numero et format (pdf|xlsx|docx) sont requis.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const { compte, lignes, solde_depart, solde_fin, dateDebut, dateFin } = getReleveLignesData(companyId, compte_numero, mois, annee, fiscal_year_id);
  const fmt = (n) => (n == null ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const rows = [
    { cells: [`Solde départ au ${dateDebut || ''}`, '', '', '', '', '', '', '', fmt(solde_depart)], bold: true },
    ...lignes.map((l) => ({
      cells: [
        l.journal_code, l.date_ecriture, l.libelle || l.libelle_ecriture, l.remise_numero || '', l.libelle_banque || '',
        fmt(l.debit), fmt(l.credit), l.piece_reglement || '', l.numero_facture_ref || '', `${fmt(l.solde_cumule)}${l.solde_cumule >= 0 ? 'D' : 'C'}`,
      ],
    })),
    { cells: ['TOTAL', '', '', '', '', fmt(lignes.reduce((s, l) => s + (l.debit || 0), 0)), fmt(lignes.reduce((s, l) => s + (l.credit || 0), 0)), '', '', `${fmt(solde_fin)}${solde_fin >= 0 ? 'D' : 'C'}`], bold: true },
  ];

  try {
    const { buffer, contentType, ext } = await buildExport(format, {
      company,
      title: 'RELEVÉ BANCAIRE — SAISIE',
      periodeDebut: dateDebut,
      periodeFin: dateFin,
      compte: compte ? `${compte.numero}   ${compte.intitule}` : compte_numero,
      columns: [
        { label: 'JR', width: 0.7 }, { label: 'Date', width: 1 }, { label: 'Libellé', width: 3 }, { label: 'Remise N°', width: 1 },
        { label: 'Libellé Banque', width: 1.6 }, { label: 'Débit', width: 1, align: 'right' }, { label: 'Crédit', width: 1, align: 'right' },
        { label: 'Pièce N°', width: 1 }, { label: 'N° Facture', width: 1 }, { label: 'Solde', width: 1.2, align: 'right' },
      ],
      rows,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="releve_${compte_numero}_${annee || ''}${mois || ''}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Frais Bancaires" (case à cocher de l'écran Saisie Relevé Bancaire) : une écriture
// simple, Journal Banque, débit du compte de charge choisi (tout le plan comptable),
// crédit du compte bancaire.
router.post('/companies/:companyId/releve-bancaire/frais', (req, res) => {
  const companyId = req.params.companyId;
  const { compte_tresor_numero, compte_charge_numero, montant, libelle, date_ecriture, fiscal_year_id } = req.body;
  if (!compte_tresor_numero || !compte_charge_numero || !montant || !date_ecriture || !fiscal_year_id) {
    return res.status(400).json({ error: 'compte_tresor_numero, compte_charge_numero, montant, date_ecriture et fiscal_year_id sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);
  const compteTresor = getAccountByNumero(companyId, compte_tresor_numero);
  if (!compteTresor) return res.status(422).json({ error: `Le compte ${compte_tresor_numero} n'existe pas.` });
  const compteCharge = getAccountByNumero(companyId, compte_charge_numero);
  if (!compteCharge) return res.status(422).json({ error: `Le compte ${compte_charge_numero} n'existe pas.` });

  const journal = getJournal(companyId, journalForCompteTresor(compte_tresor_numero));
  if (!journal) return res.status(500).json({ error: 'Journal introuvable pour cette société.' });

  const mnt = round2(montant);
  const lib = libelle || 'Frais et commissions sur services bancaires';

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, date_ecriture, libelle, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, 'frais_bancaire', ?)`
      )
      .run(companyId, journal.id, fiscal_year_id, date_ecriture, lib, req.user.id);
    const entryId = info.lastInsertRowid;
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, 0)').run(entryId, compteCharge.id, lib, mnt);
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, 0, ?)').run(entryId, compteTresor.id, lib, mnt);
    return entryId;
  });

  const entryId = tx();
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  entry.lignes = lignesAvecComptes(entryId);
  res.status(201).json(entry);
});

// "Virement de Fond" (case à cocher) : transfert Caisse <-> Banque, saisi comme deux
// écritures distinctes (une par journal concerné) qui se compensent sur le compte
// transitoire 5115 — exactement le montage du logiciel bureau (voir capture d'écran).
router.post('/companies/:companyId/releve-bancaire/virement', (req, res) => {
  const companyId = req.params.companyId;
  const { compte_source_numero, compte_destinataire_numero, montant, date_ecriture, fiscal_year_id } = req.body;
  if (!compte_source_numero || !compte_destinataire_numero || !montant || !date_ecriture || !fiscal_year_id) {
    return res.status(400).json({ error: 'compte_source_numero, compte_destinataire_numero, montant, date_ecriture et fiscal_year_id sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);
  const compteSource = getAccountByNumero(companyId, compte_source_numero);
  if (!compteSource) return res.status(422).json({ error: `Le compte ${compte_source_numero} n'existe pas.` });
  const compteDest = getAccountByNumero(companyId, compte_destinataire_numero);
  if (!compteDest) return res.status(422).json({ error: `Le compte ${compte_destinataire_numero} n'existe pas.` });

  const journalSource = getJournal(companyId, journalForCompteTresor(compte_source_numero));
  const journalDest = getJournal(companyId, journalForCompteTresor(compte_destinataire_numero));
  if (!journalSource || !journalDest) return res.status(500).json({ error: 'Journal introuvable pour cette société.' });

  const transitoire = getOrCreateCompteTransitoire(companyId);
  const mnt = round2(montant);
  const lib = `Virement de ${compteSource.intitule} à ${compteDest.intitule} d'un montant de ${mnt.toFixed(2)} Dhs.`;

  const tx = db.transaction(() => {
    // Écriture 1 (journal de la source) : sortie du compte source, entrée sur le compte transitoire
    const infoSource = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, date_ecriture, libelle, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, 'virement_fond', ?)`
      )
      .run(companyId, journalSource.id, fiscal_year_id, date_ecriture, lib, req.user.id);
    const entrySourceId = infoSource.lastInsertRowid;
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, 0)').run(entrySourceId, transitoire.id, lib, mnt);
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, 0, ?)').run(entrySourceId, compteSource.id, lib, mnt);

    // Écriture 2 (journal de la destination) : sortie du compte transitoire, entrée sur le compte destinataire
    const infoDest = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, date_ecriture, libelle, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, 'virement_fond', ?)`
      )
      .run(companyId, journalDest.id, fiscal_year_id, date_ecriture, lib, req.user.id);
    const entryDestId = infoDest.lastInsertRowid;
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, 0)').run(entryDestId, compteDest.id, lib, mnt);
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, 0, ?)').run(entryDestId, transitoire.id, lib, mnt);

    return { entrySourceId, entryDestId };
  });

  const { entrySourceId, entryDestId } = tx();
  const entrySource = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entrySourceId);
  entrySource.lignes = lignesAvecComptes(entrySourceId);
  const entryDest = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryDestId);
  entryDest.lignes = lignesAvecComptes(entryDestId);
  res.status(201).json({ entrySource, entryDest });
});

// Saisie manuelle d'une ligne du relevé bancaire (grille du bas de l'écran) : un
// mouvement du compte bancaire, avec Remise N°, Libellé Banque, Pièce N° (Chèque) et
// N° de Facture. Si un Pièce N° (Chèque) est fourni et correspond à un chèque encore
// "en attente" (voir /cheques-en-attente), il est automatiquement rapproché : la
// facture d'origine passe alors "soldée" — ce sont les trois lignes réclamées
// (facture <-> tiers, chèque en attente, ligne du relevé) qui apparaissent enfin liées.
router.post('/companies/:companyId/releve-bancaire/ligne', (req, res) => {
  const companyId = req.params.companyId;
  const {
    compte_tresor_numero,
    compte_numero, // compte de contrepartie (n'importe quelle classe 1 à 8) choisi par l'utilisateur
    date_ecriture,
    libelle,
    remise_numero,
    libelle_banque,
    debit,
    credit,
    piece_cheque,
    numero_facture,
    fiscal_year_id,
  } = req.body;

  if (!compte_tresor_numero || !date_ecriture || !fiscal_year_id || (!debit && !credit)) {
    return res.status(400).json({ error: 'compte_tresor_numero, date_ecriture, fiscal_year_id et un montant (débit ou crédit) sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);
  const compteTresor = getAccountByNumero(companyId, compte_tresor_numero);
  if (!compteTresor) return res.status(422).json({ error: `Le compte ${compte_tresor_numero} n'existe pas.` });
  const journal = getJournal(companyId, journalForCompteTresor(compte_tresor_numero));
  if (!journal) return res.status(500).json({ error: 'Journal introuvable pour cette société.' });

  let compteContrepartieChoisi = null;
  if (compte_numero) {
    compteContrepartieChoisi = getAccountByNumero(companyId, compte_numero);
    if (!compteContrepartieChoisi) return res.status(422).json({ error: `Le compte ${compte_numero} n'existe pas.` });
  }

  const d = round2(debit || 0);
  const c = round2(credit || 0);
  const lib = libelle || libelle_banque || 'Opération bancaire';

  // Chèque en attente correspondant (même pièce, et si fourni, même compte cible) —
  // le montant doit correspondre au sens inverse (le chèque en attente est débité ou
  // crédité en miroir de ce qui apparaît maintenant sur le relevé).
  let ligneAttente = null;
  if (piece_cheque) {
    ligneAttente = db
      .prepare(
        `SELECT jl.*, a.numero AS account_numero, je.facture_id
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.company_id = ? AND a.numero IN ('5111','51419') AND jl.lettrage IS NULL AND jl.piece_reglement = ?
         ORDER BY je.date_ecriture LIMIT 1`
      )
      .get(companyId, piece_cheque);
  }

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, date_ecriture, libelle, type_piece, created_by, facture_id)
         VALUES (?, ?, ?, ?, ?, 'releve_bancaire', ?, ?)`
      )
      .run(companyId, journal.id, fiscal_year_id, date_ecriture, lib, req.user.id, ligneAttente ? ligneAttente.facture_id : null);
    const entryId = info.lastInsertRowid;

    const infoLigneBanque = db
      .prepare(
        `INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit, remise_numero, libelle_banque, piece_reglement, numero_facture_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(entryId, compteTresor.id, lib, d, c, remise_numero || null, libelle_banque || null, piece_cheque || null, numero_facture || null);

    let rapproche = false;
    if (ligneAttente) {
      // La ligne "chèque en attente" est soldée par la contrepartie de la ligne banque
      const info2 = db
        .prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, ?)')
        .run(entryId, ligneAttente.account_id, lib, c, d);
      const code = generateLettrageCode();
      db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(code, ligneAttente.id);
      db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(code, info2.lastInsertRowid);

      // On solde aussi la facture d'origine : lettrage entre la ligne tiers de la
      // facture et la ligne tiers du règlement (même compte, même code lettrage).
      if (ligneAttente.facture_id) {
        const factureLignes = lignesAvecComptes(ligneAttente.facture_id);
        const factureTiersLigne = factureLignes.find((l) => l.tiers);
        const reglementEntryId = db
          .prepare('SELECT entry_id FROM journal_lines WHERE id = ?')
          .get(ligneAttente.id).entry_id;
        const reglementLignes = lignesAvecComptes(reglementEntryId);
        const reglementTiersLigne = reglementLignes.find((l) => l.tiers);
        if (factureTiersLigne && reglementTiersLigne && !factureTiersLigne.lettrage) {
          const codeFacture = generateLettrageCode();
          db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(codeFacture, factureTiersLigne.id);
          db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(codeFacture, reglementTiersLigne.id);
        }
      }
      rapproche = true;
    } else {
      // Pas de chèque en attente à rapprocher : la contrepartie est le compte
      // choisi par l'utilisateur (n'importe quelle classe 1 à 8) — ou, à
      // défaut, un compte transitoire/d'attente à reclasser plus tard. Sans
      // cette ligne, l'écriture ne comportait qu'un seul côté et restait
      // déséquilibrée.
      const compteContrepartie = compteContrepartieChoisi || getOrCreateCompteAttente(companyId, d > 0 ? 'credit' : 'debit');
      db
        .prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, ?)')
        .run(entryId, compteContrepartie.id, lib, c, d);
    }

    return { entryId, rapproche };
  });

  const { entryId, rapproche } = tx();
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  entry.lignes = lignesAvecComptes(entryId);
  entry.rapproche = rapproche;
  res.status(201).json(entry);
});

// Modification d'une ligne de relevé déjà enregistrée (écran "Relevé bancaire →
// Par pièce") : on met à jour l'écriture EXISTANTE (mêmes 2 lignes : compte
// trésor + contrepartie), on n'en recrée jamais une nouvelle — sinon on
// obtiendrait un doublon dans les écritures comptables. Si la ligne est déjà
// rapprochée à un chèque (lettrage posé), le montant et les comptes ne sont
// plus modifiables ici : seuls le libellé, la date, la remise, le libellé
// banque et le n° de facture le restent, pour ne pas fausser un rapprochement
// déjà fait.
// Détail d'une ligne de relevé (les 2 lignes d'écriture) — utilisé par le
// bouton "Modifier" pour précharger le formulaire, notamment le compte de
// contrepartie qui n'apparaît pas dans /lignes (filtré sur le compte trésor).
router.get('/companies/:companyId/releve-bancaire/ligne/:entryId', (req, res) => {
  const companyId = req.params.companyId;
  const entry = db.prepare("SELECT * FROM journal_entries WHERE id = ? AND company_id = ? AND type_piece = 'releve_bancaire'").get(req.params.entryId, companyId);
  if (!entry) return res.status(404).json({ error: 'Ligne de relevé introuvable.' });
  entry.lignes = lignesAvecComptes(entry.id);
  res.json(entry);
});

router.put('/companies/:companyId/releve-bancaire/ligne/:entryId', (req, res) => {
  const companyId = req.params.companyId;
  const entryId = req.params.entryId;
  const {
    compte_tresor_numero,
    compte_numero,
    date_ecriture,
    libelle,
    remise_numero,
    libelle_banque,
    debit,
    credit,
    numero_facture,
  } = req.body;

  const entry = db.prepare("SELECT * FROM journal_entries WHERE id = ? AND company_id = ? AND type_piece = 'releve_bancaire'").get(entryId, companyId);
  if (!entry) return res.status(404).json({ error: 'Ligne de relevé introuvable.' });
  assertExerciceOuvert(companyId, entry.fiscal_year_id);

  const lignes = lignesAvecComptes(entryId);
  if (lignes.length !== 2) {
    return res.status(422).json({ error: "Cette écriture ne correspond pas au format attendu d'une ligne de relevé (2 lignes) et ne peut pas être modifiée depuis cet écran." });
  }
  const ligneTresor = lignes[0];
  const ligneContrepartie = lignes[1];
  const estRapprochee = !!(ligneTresor.lettrage || ligneContrepartie.lettrage);

  if (!date_ecriture) return res.status(400).json({ error: 'date_ecriture est requis.' });

  const tx = db.transaction(() => {
    if (estRapprochee) {
      // Rapprochée à un chèque : on ne touche ni aux montants ni aux comptes,
      // seulement aux champs descriptifs.
      db.prepare('UPDATE journal_entries SET date_ecriture = ?, libelle = ? WHERE id = ?')
        .run(date_ecriture, libelle || entry.libelle, entryId);
      db.prepare(
        'UPDATE journal_lines SET libelle = ?, remise_numero = ?, libelle_banque = ?, numero_facture_ref = ? WHERE id = ?'
      ).run(libelle || ligneTresor.libelle, remise_numero ?? ligneTresor.remise_numero, libelle_banque ?? ligneTresor.libelle_banque, numero_facture ?? ligneTresor.numero_facture_ref, ligneTresor.id);
      return;
    }

    const compteTresor = compte_tresor_numero ? getAccountByNumero(companyId, compte_tresor_numero) : null;
    if (compte_tresor_numero && !compteTresor) throw Object.assign(new Error(`Le compte ${compte_tresor_numero} n'existe pas.`), { status: 422 });
    const compteContrepartie = compte_numero ? getAccountByNumero(companyId, compte_numero) : null;
    if (compte_numero && !compteContrepartie) throw Object.assign(new Error(`Le compte ${compte_numero} n'existe pas.`), { status: 422 });

    const d = round2(debit || 0);
    const c = round2(credit || 0);
    if (!d && !c) throw Object.assign(new Error('Indiquez un montant au débit ou au crédit.'), { status: 400 });
    const lib = libelle || libelle_banque || entry.libelle;

    let journalId = entry.journal_id;
    if (compteTresor) {
      const journal = getJournal(companyId, journalForCompteTresor(compteTresor.numero));
      if (!journal) throw Object.assign(new Error('Journal introuvable pour cette société.'), { status: 500 });
      journalId = journal.id;
    }

    db.prepare('UPDATE journal_entries SET journal_id = ?, date_ecriture = ?, libelle = ? WHERE id = ?')
      .run(journalId, date_ecriture, lib, entryId);

    db.prepare(
      `UPDATE journal_lines SET account_id = ?, libelle = ?, debit = ?, credit = ?, remise_numero = ?, libelle_banque = ?, numero_facture_ref = ?
       WHERE id = ?`
    ).run(
      compteTresor ? compteTresor.id : ligneTresor.account_id,
      lib, d, c,
      remise_numero ?? ligneTresor.remise_numero,
      libelle_banque ?? ligneTresor.libelle_banque,
      numero_facture ?? ligneTresor.numero_facture_ref,
      ligneTresor.id
    );
    db.prepare('UPDATE journal_lines SET account_id = ?, libelle = ?, debit = ?, credit = ? WHERE id = ?')
      .run(compteContrepartie ? compteContrepartie.id : ligneContrepartie.account_id, lib, c, d, ligneContrepartie.id);
  });

  try {
    tx();
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const updated = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  updated.lignes = lignesAvecComptes(entryId);
  updated.rapprochee = estRapprochee;
  res.json(updated);
});

// Importe un lot d'opérations détectées sur un relevé bancaire (scan/PDF) :
// une écriture par opération, dans le journal banque/caisse correspondant au
// compte de trésorerie choisi. Chaque libellé est d'abord passé au
// classifieur automatique (commission, CNSS, virement/retrait espèces,
// chèque impayé, virement du gérant — voir services/releveClassifier.js) :
// s'il reconnaît le mouvement, la ligne est enregistrée directement dans la
// bonne section/le bon compte au lieu du compte d'attente générique
// (3497/4497), qui ne sert plus que pour les opérations non reconnues, à
// reclasser manuellement via les Écritures ou le Lettrage.
router.post('/companies/:companyId/releve-bancaire/import', (req, res) => {
  const companyId = req.params.companyId;
  const { compte_tresor_numero, fiscal_year_id, operations } = req.body;

  if (!compte_tresor_numero || !fiscal_year_id || !Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({ error: 'compte_tresor_numero, fiscal_year_id et au moins une opération sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);

  const compteTresor = getAccountByNumero(companyId, compte_tresor_numero);
  if (!compteTresor) return res.status(422).json({ error: `Le compte de trésorerie ${compte_tresor_numero} n'existe pas.` });

  const codeJournal = journalForCompteTresor(compte_tresor_numero);
  const journal = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, codeJournal);
  if (!journal) return res.status(500).json({ error: `Journal ${codeJournal} introuvable pour cette société.` });

  const compteAttenteDebit = getOrCreateCompteAttente(companyId, 'debit');
  const compteAttenteCredit = getOrCreateCompteAttente(companyId, 'credit');
  // Compte caisse (516…) utilisé comme second pied des mouvements "virement
  // de fonds" reconnus automatiquement (versement/retrait espèces) — le
  // compte 5161 "Caisses" en priorité (comme dans l'écran Relevé Bancaire),
  // sinon le premier compte caisse "feuille" (on exclut 516 lui-même, qui
  // n'est qu'un intitulé de regroupement, pas un compte où l'on peut poster).
  const compteCaisse =
    getAccountByNumero(companyId, '5161') ||
    db
      .prepare("SELECT * FROM accounts WHERE company_id = ? AND numero LIKE '516%' AND numero != '516' ORDER BY numero LIMIT 1")
      .get(companyId);

  const insertEntry = db.prepare(
    `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, type_piece, created_by)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
  );
  const insertLine = db.prepare(`
    INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const createdIds = [];
    const classification = { commission: 0, cnss: 0, impaye: 0, gerant: 0, especes: 0, aReclasser: 0 };
    for (const op of operations) {
      const debit = round2(op.debit); // sortie d'argent (colonne Débit du relevé)
      const credit = round2(op.credit); // entrée d'argent (colonne Crédit du relevé)
      if (!op.date || !op.libelle || (debit <= 0 && credit <= 0)) continue;

      const classe = classifierOperation(companyId, op.libelle, { fiscalYearId: fiscal_year_id });

      if ((classe.type === 'retrait_especes' || classe.type === 'versement_especes') && compteCaisse) {
        // Virement de fonds Caisse <-> Banque : deux écritures compensées par
        // le compte transitoire 5115, exactement comme le bouton "Virement de
        // Fond" de l'écran de saisie manuelle.
        const montant = debit > 0 ? debit : credit;
        const sourceEstBanque = classe.type === 'retrait_especes';
        const compteSource = sourceEstBanque ? compteTresor : compteCaisse;
        const compteDest = sourceEstBanque ? compteCaisse : compteTresor;
        const journalSource = sourceEstBanque ? journal : getJournal(companyId, journalForCompteTresor(compteCaisse.numero));
        const journalDest = sourceEstBanque ? getJournal(companyId, journalForCompteTresor(compteCaisse.numero)) : journal;
        const transitoire = getOrCreateCompteTransitoire(companyId);
        const lib = `${classe.label} — ${op.libelle}`;

        const infoSource = insertEntry.run(companyId, journalSource.id, fiscal_year_id, op.date, lib, 'virement_fond', req.user.id);
        insertLine.run(infoSource.lastInsertRowid, transitoire.id, lib, montant, 0);
        insertLine.run(infoSource.lastInsertRowid, compteSource.id, lib, 0, montant);

        const infoDest = insertEntry.run(companyId, journalDest.id, fiscal_year_id, op.date, lib, 'virement_fond', req.user.id);
        insertLine.run(infoDest.lastInsertRowid, compteDest.id, lib, montant, 0);
        insertLine.run(infoDest.lastInsertRowid, transitoire.id, lib, 0, montant);

        // Seule l'écriture côté banque scannée doit apparaître dans CE relevé.
        createdIds.push(sourceEstBanque ? infoSource.lastInsertRowid : infoDest.lastInsertRowid);
        classification.especes += 1;
        continue;
      }

      const info = insertEntry.run(companyId, journal.id, fiscal_year_id, op.date, op.libelle, 'releve_bancaire', req.user.id);
      const entryId = info.lastInsertRowid;
      // Compte de trésorerie : débit = entrée d'argent (colonne CREDIT du relevé), crédit = sortie (colonne DEBIT du relevé)
      insertLine.run(entryId, compteTresor.id, op.libelle, credit, debit);

      let contrepartie;
      if (classe.type === 'commission' || classe.type === 'cnss' || classe.type === 'impaye' || classe.type === 'gerant') {
        contrepartie = getAccountByNumero(companyId, classe.compte) || getOrCreateCompteAttente(companyId, debit > 0 ? 'debit' : 'credit');
        if (classe.type === 'commission') classification.commission += 1;
        else if (classe.type === 'cnss') classification.cnss += 1;
        else if (classe.type === 'impaye') classification.impaye += 1;
        else classification.gerant += 1;
      } else {
        contrepartie = debit > 0 ? compteAttenteDebit : compteAttenteCredit;
        classification.aReclasser += 1;
      }
      insertLine.run(entryId, contrepartie.id, op.libelle, debit > 0 ? debit : 0, credit > 0 ? credit : 0);

      createdIds.push(entryId);
    }
    return { createdIds, classification };
  });

  const { createdIds, classification } = tx();
  res.status(201).json({ imported: createdIds.length, entry_ids: createdIds, classification });
});

module.exports = router;
