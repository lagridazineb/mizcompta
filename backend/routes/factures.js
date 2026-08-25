const express = require('express');
const { db } = require('../config/db');
const { requireAuth } = require('../config/auth');
const { PLAFOND_ESPECES_JOUR } = require('../services/legalRulesService');
const { assertExerciceOuvert } = require('../services/clotureGuard');

const router = express.Router();
router.use(requireAuth);

// Comptes / journaux par défaut du Plan Comptable Marocain (PCGM)
const CONFIG = {
  vente: {
    journalCode: 'VE',
    contrepartieDefaut: '7111', // Ventes de marchandises au Maroc
    tvaRacineCharge: '4455', // Etat, TVA facturée
    tvaRacineImmo: '4455',
    tiersRacine: '3421', // Clients
    tiersDebit: true, // le client nous doit le TTC : ligne tiers au débit
    tvaNature: 'passif',
  },
  achat: {
    journalCode: 'AC',
    contrepartieDefaut: '6111', // Achats de marchandises groupe A
    tvaRacineCharge: '34552', // Etat, TVA récupérable sur charges
    tvaRacineImmo: '34551', // Etat, TVA récupérable sur immobilisations
    tiersRacine: '4411', // Fournisseurs
    tiersDebit: false, // on doit le TTC au fournisseur : ligne tiers au crédit
    tvaNature: 'actif',
  },
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function generateLettrageCode() {
  return 'L' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
}

function getAccountByNumero(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}

// Retrouve (ou crée à la volée) le sous-compte de TVA par taux, exactement comme le
// logiciel bureau : compte racine (34552 / 34551 / 4455) + taux à 2 chiffres.
// Ex: TVA récupérable sur charges à 20% -> 3455220 ; TVA facturée à 10% -> 445510.
function getOrCreateTvaAccount(companyId, racine, taux, nature, libelleBase) {
  const suffix = String(Math.round(Number(taux))).padStart(2, '0');
  const numero = `${racine}${suffix}`;
  let account = getAccountByNumero(companyId, numero);
  if (!account) {
    const classe = Number(racine[0]);
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 0)')
      .run(companyId, numero, `${libelleBase} ${taux}%`, classe, nature);
    account = { id: info.lastInsertRowid, numero, intitule: `${libelleBase} ${taux}%`, classe, nature };
  }
  return account;
}

function journalForCompteTresor(numero) {
  if (numero.startsWith('516')) return 'CA'; // Caisses, régies d'avances et accréditifs
  return 'BQ'; // Banques, Trésorerie Générale, chèques postaux
}

function isModeCheque(mode) {
  return /ch[eè]que/i.test(String(mode || ''));
}

// Tant qu'un chèque n'apparaît pas sur le relevé bancaire, il ne doit pas
// être traité comme si l'argent avait déjà bougé sur le compte bancaire :
// on le fait transiter par un compte d'attente (5111 pour un chèque reçu
// d'un client, 51419 pour un chèque émis à un fournisseur), reclassé vers
// le vrai compte de trésorerie uniquement lors du rapprochement (écran
// "Saisie Relevé Bancaire").
function getOrCreateCompteAttenteCheque(companyId, type) {
  const numero = type === 'vente' ? '5111' : '51419';
  const intitule = type === 'vente' ? "Chèques à l'encaissement" : 'Chèques émis en circulation (non débités)';
  let account = getAccountByNumero(companyId, numero);
  if (!account) {
    const info = db
      .prepare('INSERT INTO accounts (company_id, numero, intitule, classe, nature, lettrable) VALUES (?, ?, ?, ?, ?, 1)')
      .run(companyId, numero, intitule, 5, 'actif');
    account = { id: info.lastInsertRowid, numero, intitule, classe: 5, nature: 'actif' };
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

// Liste des factures (écritures des journaux VE/AC), avec le tiers et le paiement lié
router.get('/companies/:companyId/factures', (req, res) => {
  const { type } = req.query;
  const companyId = req.params.companyId;
  if (!type || !CONFIG[type]) return res.status(400).json({ error: "type doit être 'vente' ou 'achat'." });
  res.json(getFacturesAvecDetails(companyId, type));
});

function getFacturesAvecDetails(companyId, type) {
  const journal = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, CONFIG[type].journalCode);
  if (!journal) return [];

  const journalCode = db.prepare('SELECT code FROM journals WHERE company_id = ? AND id = ?').get(companyId, journal.id)?.code;

  const entries = db
    .prepare("SELECT * FROM journal_entries WHERE company_id = ? AND journal_id = ? AND type_piece = 'facture' ORDER BY date_ecriture DESC, id DESC")
    .all(companyId, journal.id);

  for (const entry of entries) {
    entry.journal_code = journalCode;
    entry.lignes = lignesAvecComptes(entry.id);
    entry.montant_regle = 0;
    entry.reglements = [];
    entry.cheque_en_attente = false;
    try {
      const tiersLigne = entry.lignes.find((l) => l.tiers);

      // Montant réellement soldé : uniquement les lignes du compte tiers
      // lettrées avec la ligne tiers de la facture (paiement définitif —
      // un chèque non encore rapproché ne compte donc pas ici).
      if (tiersLigne && tiersLigne.lettrage) {
        const autres = db
          .prepare(`SELECT jl.* FROM journal_lines jl WHERE jl.lettrage = ? AND jl.id != ? AND jl.account_id = ?`)
          .all(tiersLigne.lettrage, tiersLigne.id, tiersLigne.account_id);
        entry.montant_regle = round2(autres.reduce((s, l) => s + l.debit + l.credit, 0));
      }

      // Toutes les écritures liées à cette facture (règlement(s), et — une fois
      // rapprochée — la ligne du relevé bancaire), retrouvées via facture_id :
      // affichées même si le chèque n'est pas encore soldé, exactement comme
      // le logiciel bureau affiche le détail complet.
      const liees = db
        .prepare("SELECT id FROM journal_entries WHERE facture_id = ? ORDER BY date_ecriture, id")
        .all(entry.id);
      for (const { id: reglementId } of liees) {
        const reglementEntry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(reglementId);
        if (!reglementEntry) continue;
        reglementEntry.journal_code = db.prepare('SELECT code FROM journals WHERE id = ?').get(reglementEntry.journal_id)?.code;
        reglementEntry.lignes = lignesAvecComptes(reglementId);
        const ligneTresorReglement = reglementEntry.lignes.find((l) => l.mode_paiement && isModeCheque(l.mode_paiement) && !l.lettrage);
        if (ligneTresorReglement) entry.cheque_en_attente = true;
        entry.reglements.push(reglementEntry);
      }
    } catch (err) {
      // Une facture au format inattendu (ancienne donnée, etc.) ne doit pas
      // empêcher l'affichage de toutes les autres.
      console.error(`[factures] échec du calcul du règlement pour l'écriture ${entry.id}:`, err);
    }
  }
  return entries;
}

// Téléchargement de la liste des factures (PDF/Excel/Word), même contenu que
// l'écran (toutes les lignes comptables, règlements compris).
router.get('/companies/:companyId/factures/export', async (req, res) => {
  const { buildExport } = require('../services/exportService');
  const companyId = req.params.companyId;
  const { type, format } = req.query;
  if (!type || !CONFIG[type] || !format) return res.status(400).json({ error: "type (vente|achat) et format (pdf|xlsx|docx) sont requis." });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const factures = getFacturesAvecDetails(companyId, type);
  const { fmtMontant } = require('../services/format');
  const fmt = fmtMontant;

  const rows = [];
  for (const f of factures) {
    const groupes = [f, ...f.reglements];
    groupes.forEach((g, gi) => {
      g.lignes.forEach((l, li) => {
        rows.push({
          cells: [
            gi === 0 && li === 0 ? `${g.journal_code}${String(g.id).padStart(6, '0')}` : '',
            gi === 0 && li === 0 ? g.date_ecriture : '',
            gi === 0 && li === 0 ? g.journal_code : '',
            gi === 0 && li === 0 ? f.numero_piece || '' : '',
            l.libelle || g.libelle,
            l.account_numero,
            l.account_intitule,
            fmt(l.debit),
            fmt(l.credit),
          ],
        });
      });
    });
  }

  try {
    const { buffer, contentType, ext } = await buildExport(format, {
      company,
      title: `FACTURES ${type === 'vente' ? 'DE VENTES' : "D'ACHATS"}`,
      landscape: true,
      columns: [
        { label: 'N° Écri.', width: 1 }, { label: 'Date', width: 0.9 }, { label: 'Jrn', width: 0.5 }, { label: 'Pièce', width: 1 },
        { label: 'Libellé', width: 2.6 }, { label: 'Compte', width: 0.9 }, { label: 'Intitulé', width: 2.2 },
        { label: 'Débit', width: 1, align: 'right' }, { label: 'Crédit', width: 1, align: 'right' },
      ],
      rows,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="factures_${type}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Créer une facture d'achat ou de vente : reproduit l'écran "Saisie : Factures d'achat/vente"
// du logiciel bureau — compte de charge/produit choisi librement, taux de TVA (0 à 20%),
// case Immo. (bascule vers le compte d'immobilisation + TVA récupérable/immo), case TTC
// (le montant saisi est-il HT ou TTC ?), fiche fournisseur/client avec délai de règlement
// (Jours -> échéance), et bloc paiement optionnel qui génère l'écriture de règlement liée.
//
// Extrait en fonction réutilisable (createFactureRecord) pour être appelée à
// la fois par la route HTTP ci-dessous et par l'import en masse de factures
// (voir /import/factures) — la logique métier (TVA, échéance, chèque en
// attente, plafond espèces, lettrage) ne doit exister qu'à un seul endroit.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function createFactureRecord(companyId, userId, payload) {
  const {
    type, tiers_id, fiscal_year_id, date_facture, numero_piece, libelle,
    compte_numero, montant, montant_mode, appliquer_tva, taux_tva, immo,
    jours, echeance, paiement,
  } = payload;

  if (!type || !CONFIG[type]) throw httpError(400, "type doit être 'vente' ou 'achat'.");
  if (!tiers_id || !fiscal_year_id || !date_facture || !libelle || montant == null || montant === '') {
    throw httpError(400, 'tiers_id, fiscal_year_id, date_facture, libelle et montant sont requis.');
  }
  assertExerciceOuvert(companyId, fiscal_year_id);

  const cfg = CONFIG[type];
  const tiersRow = db.prepare('SELECT * FROM tiers WHERE id = ? AND company_id = ?').get(tiers_id, companyId);
  if (!tiersRow) throw httpError(404, 'Tiers introuvable.');

  const journal = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, cfg.journalCode);
  if (!journal) throw httpError(500, `Journal ${cfg.journalCode} introuvable pour cette société.`);

  // Compte de charge/produit (ou d'immobilisation si "Immo." coché) : choisi librement dans le plan comptable
  const numeroCompte = (compte_numero || '').trim() || cfg.contrepartieDefaut;
  const contrepartie = getAccountByNumero(companyId, numeroCompte);
  if (!contrepartie) {
    throw httpError(422, `Le compte ${numeroCompte} n'existe pas dans le plan comptable de cette société. Créez-le d'abord (bouton "+ Compte").`);
  }
  if (immo && contrepartie.classe !== 2) {
    throw httpError(422, 'Pour une facture immobilisée, le compte choisi doit être un compte de classe 2 (immobilisation).');
  }
  // Une immobilisation s'acquiert par une facture d'achat, jamais par une
  // facture de vente : on le refuse aussi côté serveur, pas seulement en
  // masquant la case dans l'interface.
  if (immo && type !== 'achat') {
    throw httpError(422, "La case Immo. (compte d'immobilisation) n'est valable que pour une facture d'achat.");
  }

  const montantSaisi = round2(montant);
  const tauxTva = appliquer_tva ? Number(taux_tva) || 0 : 0;
  let ht;
  let tva;
  let ttc;
  if (montant_mode === 'ttc') {
    ttc = montantSaisi;
    ht = round2(ttc / (1 + tauxTva / 100));
    tva = round2(ttc - ht);
  } else {
    ht = montantSaisi;
    tva = round2((ht * tauxTva) / 100);
    ttc = round2(ht + tva);
  }

  // Plafond légal de règlement en espèces (art. 106-II du CGI) : une facture
  // d'achat réglée comptant (espèces) ne peut pas dépasser 5 000 DH TTC — au
  // delà, on bloque entièrement la facture. Ce contrôle ne s'applique QUE
  // lorsqu'un mode de règlement "espèces" a été explicitement choisi ; tant
  // qu'aucun mode de paiement n'est sélectionné (ou qu'il s'agit d'un autre
  // mode : chèque, virement…), le montant TTC n'est pas plafonné.
  if (type === 'achat' && paiement && /esp[eè]ce/i.test(String(paiement.mode || '')) && ttc > PLAFOND_ESPECES_JOUR) {
    throw httpError(422, `Le règlement en espèces d'une facture d'achat ne peut pas dépasser ${PLAFOND_ESPECES_JOUR.toFixed(2)} DH TTC (art. 106-II du CGI) — cette facture est de ${ttc.toFixed(2)} DH. Choisissez un autre mode de paiement (chèque, virement…) ou scindez le règlement.`);
  }

  let tvaAccount = null;
  if (tva > 0) {
    const racine = immo ? cfg.tvaRacineImmo : cfg.tvaRacineCharge;
    const libelleBase = type === 'achat' ? (immo ? 'Etat TVA récupérable sur immobilisations' : 'Etat TVA récupérable sur charges') : 'Etat TVA facturée';
    tvaAccount = getOrCreateTvaAccount(companyId, racine, tauxTva, cfg.tvaNature, libelleBase);
  }

  // Échéance : date explicite fournie, sinon date_facture + jours (30 par défaut)
  const joursDelai = jours != null && jours !== '' ? Number(jours) : 60;
  let echeanceFinale = echeance || null;
  if (!echeanceFinale) {
    const d = new Date(date_facture);
    d.setDate(d.getDate() + joursDelai);
    echeanceFinale = d.toISOString().slice(0, 10);
  }

  // Bloc paiement optionnel : on résout le compte de trésorerie choisi avant la transaction.
  // Le chèque saisi en même temps que la facture se comporte comme l'espèce/le virement :
  // le compte bancaire choisi est mouvementé directement et la facture est lettrée tout de
  // suite (choix confirmé par la société — pas de compte d'attente 51419 dans ce cas).
  let compteTresor = null;
  let journalPaiement = null;
  let compteTresorReel = null;
  if (paiement && paiement.compte_tresor_numero && Number(paiement.montant_paye) > 0) {
    compteTresorReel = getAccountByNumero(companyId, paiement.compte_tresor_numero);
    if (!compteTresorReel) {
      throw httpError(422, `Le compte de trésorerie ${paiement.compte_tresor_numero} n'existe pas.`);
    }
    compteTresor = compteTresorReel;
    const codeJournalPaiement = journalForCompteTresor(paiement.compte_tresor_numero);
    journalPaiement = db.prepare('SELECT id FROM journals WHERE company_id = ? AND code = ?').get(companyId, codeJournalPaiement);
    if (!journalPaiement) {
      throw httpError(500, `Journal ${codeJournalPaiement} introuvable pour cette société.`);
    }
  }

  const tx = db.transaction(() => {
    // --- 1) Écriture de la facture (journal AC ou VE) ---
    const infoFacture = db
      .prepare(
        `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, echeance, type_piece, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'facture', ?)`
      )
      .run(companyId, journal.id, fiscal_year_id, numero_piece || null, date_facture, libelle, echeanceFinale, userId);

    const entryId = infoFacture.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, libelle, debit, credit, taux_tva, tiers)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Ligne tiers : débit pour une vente (le client doit le TTC), crédit pour un achat
    const ligneTiersInfo = insertLine.run(
      entryId,
      tiersRow.account_id,
      libelle,
      cfg.tiersDebit ? ttc : 0,
      cfg.tiersDebit ? 0 : ttc,
      null,
      tiersRow.nom
    );
    // Ligne TVA (même sens que la ligne charge/produit) — insérée avant la
    // ligne de charge/produit pour reproduire l'ordre d'affichage du logiciel
    // bureau (Fournisseur / TVA / Achat).
    if (tva > 0) {
      insertLine.run(entryId, tvaAccount.id, `TVA ${tauxTva}%`, cfg.tiersDebit ? 0 : tva, cfg.tiersDebit ? tva : 0, tauxTva, tiersRow.nom);
    }
    // Ligne charge/produit ou immobilisation, en HT (sens inverse de la ligne tiers)
    insertLine.run(entryId, contrepartie.id, libelle, cfg.tiersDebit ? 0 : ht, cfg.tiersDebit ? ht : 0, null, null);

    let paiementEntryId = null;
    // --- 2) Écriture de règlement liée (journal BQ/CA), si "Saisir le paiement" est coché ---
    if (compteTresor && journalPaiement) {
      const montantPaye = round2(paiement.montant_paye);
      const libellePaiement = `Règlement ${type === 'achat' ? tiersRow.nom : tiersRow.nom} - FA N°${numero_piece || ''}`.trim();
      const infoPaiement = db
        .prepare(
          `INSERT INTO journal_entries (company_id, journal_id, fiscal_year_id, numero_piece, date_ecriture, libelle, type_piece, created_by, facture_id)
           VALUES (?, ?, ?, ?, ?, ?, 'reglement', ?, ?)`
        )
        .run(
          companyId,
          journalPaiement.id,
          fiscal_year_id,
          numero_piece || null,
          paiement.date_paiement || date_facture,
          libellePaiement,
          userId,
          entryId
        );
      paiementEntryId = infoPaiement.lastInsertRowid;

      const ligneTiersPaiementInfo = insertLine.run(
        paiementEntryId,
        tiersRow.account_id,
        libelle,
        cfg.tiersDebit ? 0 : montantPaye, // achat : le paiement débite le fournisseur (diminue la dette)
        cfg.tiersDebit ? montantPaye : 0, // vente : le paiement crédite le client (diminue la créance)
        null,
        tiersRow.nom
      );
      db.prepare('UPDATE journal_lines SET mode_paiement = ?, piece_reglement = ? WHERE id = ?').run(
        paiement.mode || null,
        paiement.piece || null,
        ligneTiersPaiementInfo.lastInsertRowid
      );

      const ligneTresorInfo = insertLine.run(
        paiementEntryId,
        compteTresor.id,
        libelle,
        cfg.tiersDebit ? montantPaye : 0,
        cfg.tiersDebit ? 0 : montantPaye,
        null,
        null
      );
      db.prepare('UPDATE journal_lines SET mode_paiement = ?, piece_reglement = ? WHERE id = ?').run(
        paiement.mode || null,
        paiement.piece || null,
        ligneTresorInfo.lastInsertRowid
      );

      // Lettrage automatique si le règlement solde exactement la facture (paiement intégral),
      // quel que soit le mode de règlement (espèce, chèque, virement…).
      if (Math.abs(montantPaye - ttc) < 0.01) {
        const code = generateLettrageCode();
        db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(code, ligneTiersInfo.lastInsertRowid);
        db.prepare('UPDATE journal_lines SET lettrage = ? WHERE id = ?').run(code, ligneTiersPaiementInfo.lastInsertRowid);
      }
    }

    return { entryId, paiementEntryId };
  });

  const { entryId } = tx();
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  entry.lignes = lignesAvecComptes(entryId);
  return entry;
}

// (Jours -> échéance), et bloc paiement optionnel qui génère l'écriture de règlement liée.
router.post('/companies/:companyId/factures', (req, res) => {
  try {
    const entry = createFactureRecord(req.params.companyId, req.user.id, req.body);
    res.status(201).json(entry);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Import en masse de factures (Date, Facture N°, Client, ICE, Montant, Taux
// TVA, Mode) — une ligne = une facture, créée avec la même logique que la
// saisie manuelle (TVA, échéance, règlement immédiat si un mode de paiement
// est renseigné). Le client/fournisseur est retrouvé par nom (ou créé s'il
// n'existe pas). Chaque ligne en erreur est signalée sans bloquer les autres,
// comme les autres imports — pas de limite de lignes.
router.post('/companies/:companyId/import/factures', require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single('file'), (req, res) => {
  const companyId = req.params.companyId;
  const { type, fiscal_year_id, compte_numero } = req.body; // type: 'vente' | 'achat'
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  if (!type || !CONFIG[type]) return res.status(400).json({ error: "type doit être 'vente' ou 'achat'." });
  if (!fiscal_year_id) return res.status(400).json({ error: 'fiscal_year_id est requis.' });

  const XLSX = require('xlsx');
  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  } catch (e) {
    return res.status(400).json({ error: 'Fichier illisible. Utilisez un .xlsx, .xls ou .csv valide.' });
  }

  function pick(row, ...keys) {
    const normalized = {};
    for (const k of Object.keys(row)) normalized[k.trim().toLowerCase()] = row[k];
    for (const key of keys) {
      const v = normalized[key.toLowerCase()];
      if (v !== undefined && v !== '') return String(v).trim();
    }
    return '';
  }
  function excelDateToISO(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // JJ/MM/AAAA, JJ-MM-AAAA, ou format Excel anglo-saxon MM/JJ/AA (ex:
    // "1/13/26" ne peut être que mois=1/jour=13, le mois ne dépassant
    // jamais 12) — on détecte automatiquement lequel des deux nombres est
    // le jour en repérant celui qui dépasse 12, sinon on suppose MM/JJ/AA
    // (format par défaut d'Excel en anglais, celui de ce fichier).
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
    if (m) {
      const n1 = Number(m[1]);
      const n2 = Number(m[2]);
      let day, month;
      if (n1 > 12) { day = n1; month = n2; } // JJ/MM
      else if (n2 > 12) { day = n2; month = n1; } // MM/JJ
      else { month = n1; day = n2; } // ambigu (les deux <= 12) : MM/JJ par défaut (format Excel EN)
      let year = m[3];
      if (year.length === 2) year = (Number(year) >= 70 ? '19' : '20') + year;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    if (/^\d+(\.\d+)?$/.test(s)) {
      const parsed = XLSX.SSF.parse_date_code(Number(s));
      if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    return s;
  }
  function parseMontantImport(s) {
    let str = String(s).trim();
    // Format "2,000.00" (virgule = séparateur de milliers, point = décimal) —
    // c'est le format généré par Excel en local anglo-saxon, comme dans le
    // fichier ayant révélé ce bug.
    if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(str)) {
      str = str.replace(/,/g, '');
    } else {
      // Format "2 000,00" ou "2000,00" (virgule = décimal, espace = milliers)
      str = str.replace(/\s/g, '').replace(',', '.');
    }
    return Number(str);
  }
  const MODE_LABELS = { CHQ: 'Chèque', ESP: 'Espèce', VRT: 'Virement', EFF: 'Effet', CB: 'Carte Bancaire' };
  // Le fichier importé écrit parfois le mode en toutes lettres ("ESPECE",
  // "ESPECES", "VIREMENT"...) plutôt qu'en code à 3 lettres (ESP, VRT...) —
  // les deux graphies doivent être reconnues, sans quoi le paiement était
  // ignoré silencieusement dès que la colonne ne contenait pas exactement
  // un des 5 codes.
  const MODE_LABELS_LONGS = {
    ESPECE: 'Espèce', ESPECES: 'Espèce', 'ESPÈCE': 'Espèce', 'ESPÈCES': 'Espèce',
    CHEQUE: 'Chèque', 'CHÈQUE': 'Chèque',
    VIREMENT: 'Virement',
    EFFET: 'Effet',
    CARTE: 'Carte Bancaire', 'CARTE BANCAIRE': 'Carte Bancaire',
  };
  function resoudreMode(modeStr) {
    if (!modeStr) return null;
    return MODE_LABELS[modeStr] || MODE_LABELS_LONGS[modeStr] || modeStr;
  }
  // Compte de trésorerie par défaut pour le mode détecté : 5161 (Caisse)
  // précisément pour un règlement en espèces, sinon le premier compte
  // bancaire (514x) du plan comptable — même règle que la saisie manuelle
  // (Factures.jsx / SaisiePaiementFournisseur.jsx). Sans cette résolution,
  // le paiement importé n'avait jamais de compte de trésorerie associé et
  // était donc TOUJOURS ignoré par createFactureRecord (voir plus bas :
  // "paiement.compte_tresor_numero" est requis), quel que soit le mode.
  const accountsCache = db.prepare('SELECT numero FROM accounts WHERE company_id = ?').all(companyId).map((a) => a.numero);
  function compteTresorPourMode(modeLabel) {
    if (!modeLabel) return null;
    if (/esp[eè]ce/i.test(modeLabel)) {
      return accountsCache.find((n) => n === '5161') || accountsCache.find((n) => n.startsWith('516')) || null;
    }
    return accountsCache.find((n) => n.startsWith('514')) || null;
  }

  const tiersCache = new Map(); // nom (lowercase) -> tiers row, créé à la volée si absent

  function findOrCreateTiers(nom, ice) {
    const key = nom.toLowerCase();
    if (tiersCache.has(key)) return tiersCache.get(key);
    let tiersRow = db.prepare('SELECT * FROM tiers WHERE company_id = ? AND type = ? AND LOWER(nom) = ?').get(companyId, type === 'vente' ? 'client' : 'fournisseur', key);
    if (!tiersRow) {
      const { createTiersRecord } = require('../services/tiersService');
      const tx = db.transaction(() => createTiersRecord(companyId, { type: type === 'vente' ? 'client' : 'fournisseur', nom, ice: ice || '' }));
      const newId = tx(); // createTiersRecord ne renvoie que l'id créé, pas la fiche complète
      tiersRow = db.prepare('SELECT * FROM tiers WHERE id = ?').get(newId);
    }
    tiersCache.set(key, tiersRow);
    return tiersRow;
  }

  const results = { factures_creees: 0, erreurs: [] };
  rows.forEach((row, idx) => {
    const dateStr = excelDateToISO(pick(row, 'date'));
    const facture_numero = pick(row, 'facture n°', 'facture n', 'facture', 'numero_piece', 'numero');
    const clientNom = pick(row, 'client', 'fournisseur', 'nom');
    const ice = pick(row, 'ice');
    const montantStr = pick(row, 'montant');
    const tauxTvaStr = pick(row, 'taux tva', 'taux_tva', 'tva');
    const modeStr = pick(row, 'mode', 'mode paiement', 'mode_paiement').toUpperCase();

    if (!dateStr || !clientNom || !montantStr) {
      results.erreurs.push({ ligne: idx + 2, erreur: 'Date, Client et Montant sont requis — ligne ignorée.' });
      return;
    }
    const montant = parseMontantImport(montantStr);
    if (!montant || Number.isNaN(montant)) {
      results.erreurs.push({ ligne: idx + 2, erreur: `Montant "${montantStr}" invalide — ligne ignorée.` });
      return;
    }
    // Le taux TVA peut être écrit en fraction (0.1 = 10%), en pourcentage
    // déjà en base 100 (10), ou formaté avec un signe pourcentage ("10%")
    // selon la mise en forme de la cellule Excel d'origine.
    let tauxTva = 0;
    if (tauxTvaStr) {
      const hadPercentSign = /%/.test(tauxTvaStr);
      const t = Number(String(tauxTvaStr).replace('%', '').replace(',', '.'));
      tauxTva = hadPercentSign || t > 1 ? round2(t) : round2(t * 100);
    }
    const modePaiement = resoudreMode(modeStr);
    const compteTresorNumero = compteTresorPourMode(modePaiement);

    try {
      const tiersRow = findOrCreateTiers(clientNom, ice);
      const payload = {
        type, tiers_id: tiersRow.id, fiscal_year_id, date_facture: dateStr,
        numero_piece: facture_numero || undefined,
        libelle: `FA N°: ${facture_numero || '—'} - ${clientNom}`,
        compte_numero: compte_numero || undefined,
        montant, montant_mode: 'ttc',
        appliquer_tva: tauxTva > 0, taux_tva: tauxTva,
      };
      if (modePaiement) {
        if (!compteTresorNumero) {
          results.erreurs.push({
            ligne: idx + 2,
            erreur: `Mode de paiement "${modeStr}" détecté mais aucun compte de trésorerie (${/esp[eè]ce/i.test(modePaiement) ? 'caisse 516x' : 'banque 514x'}) n'existe dans le plan comptable — la facture est créée mais SANS le règlement. Créez le compte puis saisissez le paiement manuellement.`,
          });
        } else {
          payload.paiement = { date_paiement: dateStr, montant_paye: montant, mode: modePaiement, compte_tresor_numero: compteTresorNumero };
        }
      }
      createFactureRecord(companyId, req.user.id, payload);
      results.factures_creees += 1;
    } catch (e) {
      results.erreurs.push({ ligne: idx + 2, erreur: e.message });
    }
  });

  res.json(results);
});

// Supprime une facture (et l'écriture de règlement liée si elle existe,
// retrouvée via le code de lettrage partagé) — utilisé par le bouton
// Modifier/Supprimer de l'écran de saisie des factures.
router.delete('/companies/:companyId/factures/:entryId', (req, res) => {
  const companyId = req.params.companyId;
  const entryId = req.params.entryId;

  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?').get(entryId, companyId);
  if (!entry) return res.status(404).json({ error: 'Facture introuvable.' });
  assertExerciceOuvert(companyId, entry.fiscal_year_id);

  const lignes = lignesAvecComptes(entryId);
  const tiersLigne = lignes.find((l) => l.tiers && l.taux_tva == null);

  const tx = db.transaction(() => {
    if (tiersLigne && tiersLigne.lettrage) {
      const autres = db
        .prepare('SELECT DISTINCT entry_id FROM journal_lines WHERE lettrage = ? AND entry_id != ?')
        .all(tiersLigne.lettrage, entryId);
      for (const row of autres) {
        db.prepare('DELETE FROM journal_entries WHERE id = ? AND company_id = ?').run(row.entry_id, companyId);
      }
    }
    // Écriture(s) liée(s) via facture_id (règlement par chèque en attente, non
    // lettré donc non trouvé ci-dessus).
    const liees = db.prepare('SELECT id FROM journal_entries WHERE facture_id = ? AND company_id = ?').all(entryId, companyId);
    for (const row of liees) {
      db.prepare('DELETE FROM journal_entries WHERE id = ? AND company_id = ?').run(row.id, companyId);
    }
    db.prepare('DELETE FROM journal_entries WHERE id = ? AND company_id = ?').run(entryId, companyId);
  });
  tx();

  res.json({ deleted: true });
});

module.exports = router;
module.exports.createFactureRecord = createFactureRecord;
