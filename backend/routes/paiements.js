// Saisie : Paiement Fournisseur — écran autonome de règlement d'un
// fournisseur (indépendant de la création d'une facture), reproduisant
// l'écran "Saisie : Paiement Fournisseur" du logiciel de référence :
// Fournisseur, Date, Montant, Mode de paiement, N° de facture (libre),
// Libellé, avec un panneau de lettrage des factures ouvertes de ce
// fournisseur.
const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { assertExerciceOuvert } = require('../services/clotureGuard');

const router = express.Router();
router.use(requireAuth);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function getAccountByNumero(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}
function journalForCompteTresor(numero) {
  if (numero.startsWith('516')) return 'CA';
  return 'BQ';
}
function isModeCheque(mode) {
  return /ch[eè]que/i.test(String(mode || ''));
}
function getOrCreateCompteAttenteCheque(companyId) {
  const numero = '51419';
  let account = getAccountByNumero(companyId, numero);
  if (!account) {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 1)')
      .run(companyId, numero, 'Chèques émis en circulation (non débités)', 5, 'actif');
    account = { id: info.lastInsertRowid, numero, intitule: 'Chèques émis en circulation (non débités)', classe: 5, nature: 'actif' };
  }
  return account;
}
function generateLettrageCode() {
  return 'L' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
}

// Enregistre le paiement et, si des lignes de factures ouvertes sont
// sélectionnées (line_ids), lettre automatiquement la nouvelle ligne
// fournisseur avec elles (même mécanisme que /lettrage).
router.post('/companies/:companyId/paiements/fournisseur', (req, res) => {
  const companyId = req.params.companyId;
  const { tiers_id, fiscal_year_id, date_paiement, montant, mode_paiement, compte_tresor_numero, facture_numero, libelle, line_ids } = req.body;

  if (!tiers_id || !fiscal_year_id || !date_paiement || !montant || !compte_tresor_numero) {
    return res.status(400).json({ error: 'tiers_id, fiscal_year_id, date_paiement, montant et compte_tresor_numero sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);
  const tiersRow = db.prepare("SELECT * FROM tiers WHERE id = ? AND company_id = ? AND type = 'fournisseur'").get(tiers_id, companyId);
  if (!tiersRow) return res.status(404).json({ error: 'Fournisseur introuvable.' });

  const compteTresorReel = getAccountByNumero(companyId, compte_tresor_numero);
  if (!compteTresorReel) return res.status(422).json({ error: `Le compte de trésorerie ${compte_tresor_numero} n'existe pas.` });

  // Le chèque se comporte comme les autres modes de règlement (espèce,
  // virement…) : le compte bancaire choisi est mouvementé directement, sans
  // compte d'attente (choix confirmé par la société).
  const codeJournal = journalForCompteTresor(compte_tresor_numero);
  const journal = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, codeJournal);
  if (!journal) return res.status(500).json({ error: `Journal ${codeJournal} introuvable pour cette société.` });

  const montantPaye = round2(montant);
  const libelleFinal = libelle || `Règlement ${tiersRow.nom}${facture_numero ? ' - FA N°' + facture_numero : ''}`;

  const tx = db.transaction(() => {
    const infoEntry = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'reglement', ?)`
      )
      .run(companyId, journal.id, fiscal_year_id, facture_numero || null, date_paiement, libelleFinal, req.user.id);
    const entryId = infoEntry.lastInsertRowid;

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit, tiers, mode_paiement, piece_reglement, compte_cible_numero)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Le paiement débite le fournisseur (diminue la dette) et crédite la trésorerie.
    const ligneFournisseur = insertLine.run(
      entryId, tiersRow.account_id, libelleFinal, montantPaye, 0, tiersRow.nom, mode_paiement || null, facture_numero || null, null
    );
    insertLine.run(entryId, compteTresorReel.id, libelleFinal, 0, montantPaye, null, mode_paiement || null, facture_numero || null, null);

    // Lettrage automatique avec les factures ouvertes sélectionnées, si le
    // total sélectionné + ce paiement s'équilibrent exactement (comme
    // l'écran "Lettrer" du logiciel de référence).
    let lettrageCode = null;
    if (Array.isArray(line_ids) && line_ids.length > 0) {
      const placeholders = line_ids.map(() => '?').join(',');
      const lignesOuvertes = db
        .prepare(`SELECT jl.* FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.id IN (${placeholders}) AND je.company_id = ?`)
        .all(...line_ids, companyId);
      const memeCompte = lignesOuvertes.length === line_ids.length && lignesOuvertes.every((l) => l.account_id === tiersRow.account_id);
      const totalCredit = lignesOuvertes.reduce((s, l) => s + l.credit, 0);
      if (memeCompte && Math.abs(totalCredit - montantPaye) < 0.005) {
        lettrageCode = generateLettrageCode();
        const update = db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?');
        for (const id of line_ids) update.run(lettrageCode, id);
        update.run(lettrageCode, ligneFournisseur.lastInsertRowid);
      }
    }

    return { entryId, lettrageCode };
  });

  let result;
  try {
    result = tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(201).json({ entry_id: result.entryId, lettrage: result.lettrageCode });
});

// Règlements CNSS/AMO déjà enregistrés pour une période donnée (recherche
// libre sur le libellé, ex: "juin 2026") — utilisé pour afficher "déjà réglé"
// avant de solder à nouveau, et pour la vérification anti-doublon ci-dessous.
function reglementsCnssPourPeriode(companyId, fiscalYearId, periode) {
  if (!periode) return [];
  const like = `%${periode.trim()}%`;
  return db
    .prepare(
      `SELECT je.id AS entry_id, je.date_ecriture, je.libelle, je.numero_piece,
              COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl
                        JOIN accounts a ON a.id = jl.account_id
                        WHERE jl.entry_id = je.id AND a.numero = '4441'), 0) AS montant
       FROM journal_entries je
       JOIN journals jr ON jr.id = je.journal_id
       WHERE je.company_id = ? AND je.fiscal_year_id = ? AND jr.code = 'CN'
         AND je.type_piece = 'reglement' AND je.libelle LIKE ?
       ORDER BY je.date_ecriture`
    )
    .all(companyId, fiscalYearId, like);
}

// Historique des règlements CNSS/AMO déjà passés pour une période — permet
// au formulaire d'afficher "déjà réglé : X DH" avant de solder à nouveau.
router.get('/companies/:companyId/paiements/cnss/historique', (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id, periode } = req.query;
  if (!fiscal_year_id || !periode) return res.json({ reglements: [], total: 0 });
  const reglements = reglementsCnssPourPeriode(companyId, fiscal_year_id, periode);
  res.json({ reglements, total: round2(reglements.reduce((s, r) => s + r.montant, 0)) });
});

// ---------------------------------------------------------------------------
// CNSS / AMO — enregistre le règlement d'un bordereau de cotisations (Régime
// Général ou AMO) déjà déclaré : Débit 4441 (Caisse Nationale de Sécurité
// Sociale) pour le montant global du versement, Crédit banque/caisse.
// On ne repasse pas la charge (61741) : elle est normalement déjà constatée
// lors de l'écriture de paie ; ceci solde uniquement la dette envers la CNSS.
router.post('/companies/:companyId/paiements/cnss', (req, res) => {
  const companyId = req.params.companyId;
  const { fiscal_year_id, date_paiement, montant, libelle, compte_tresor_numero, reference, periode, force } = req.body;
  if (!fiscal_year_id || !date_paiement || !montant || !compte_tresor_numero) {
    return res.status(400).json({ error: 'fiscal_year_id, date_paiement, montant et compte_tresor_numero sont requis.' });
  }
  assertExerciceOuvert(companyId, fiscal_year_id);

  // Anti-doublon : la CNSS ne doit pas être soldée deux fois pour la même
  // période. Si des règlements existent déjà pour cette période, on bloque
  // (le front doit avertir puis, seulement si l'utilisateur confirme
  // explicitement un complément volontaire, renvoyer force=true).
  if (periode) {
    const existants = reglementsCnssPourPeriode(companyId, fiscal_year_id, periode);
    const dejaRegle = round2(existants.reduce((s, r) => s + r.montant, 0));
    if (dejaRegle > 0 && !force) {
      return res.status(409).json({
        error: `La CNSS/AMO pour la période "${periode}" a déjà été réglée pour ${dejaRegle.toFixed(2)} DH (le ${existants[0].date_ecriture}). Pour éviter un double solde, ce paiement n'a pas été enregistré.`,
        deja_regle: dejaRegle,
        reglements: existants,
      });
    }
  }
  const compteTresor = getAccountByNumero(companyId, compte_tresor_numero);
  if (!compteTresor) return res.status(422).json({ error: `Le compte de trésorerie ${compte_tresor_numero} n'existe pas.` });

  let compteCnss = getAccountByNumero(companyId, '4441');
  if (!compteCnss) {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 1)')
      .run(companyId, '4441', 'Caisse Nationale de la Sécurité Sociale', 4, 'passif');
    compteCnss = { id: info.lastInsertRowid, numero: '4441' };
  }

  const codeJournal = 'CN';
  let journal = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, codeJournal);
  if (!journal) {
    // Sociétés créées avant l'ajout du journal CNSS/AMO dédié : on le crée à
    // la volée plutôt que de réutiliser JB/JC, pour que les paiements CNSS
    // restent toujours à part du relevé bancaire dans les écritures.
    const info = db.prepare('INSERT INTO journals (company_id, code, libelle) VALUES (?, ?, ?)').run(companyId, codeJournal, 'Journal CNSS / AMO');
    journal = { id: info.lastInsertRowid };
  }

  const montantPaye = round2(montant);
  // La période est toujours ajoutée nous-mêmes à la fin du libellé (qu'un
  // libellé personnalisé ait été fourni ou non) : la détection de doublon
  // ci-dessus recherche ce texte, donc on doit garantir qu'il y figure belle
  // et bien plutôt que de dépendre de ce que le front a effectivement envoyé.
  const libelleBase = libelle || `Règlement CNSS${reference ? ' - ' + reference : ''}`;
  const libelleFinal = periode && !libelleBase.includes(periode) ? `${libelleBase} - ${periode}` : libelleBase;

  const tx = db.transaction(() => {
    const infoEntry = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'reglement', ?)`
      )
      .run(companyId, journal.id, fiscal_year_id, reference || null, date_paiement, libelleFinal, req.user.id);
    const entryId = infoEntry.lastInsertRowid;
    const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit) VALUES (?, ?, ?, ?, ?)');
    insertLine.run(entryId, compteCnss.id, libelleFinal, montantPaye, 0);
    insertLine.run(entryId, compteTresor.id, libelleFinal, 0, montantPaye);
    return entryId;
  });

  let entryId;
  try {
    entryId = tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(201).json({ entry_id: entryId });
});

module.exports = router;
