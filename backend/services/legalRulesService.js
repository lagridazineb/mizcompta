const { db } = require('../config/db');

// Plafonds légaux marocains pour les paiements en espèces à un même fournisseur
// (article 106-II du CGI) : au-delà de ces montants, la charge et la TVA
// correspondantes ne sont plus déductibles fiscalement si le règlement se fait
// en espèces plutôt que par un moyen de paiement traçable. Ces seuils peuvent
// évoluer d'une loi de finances à l'autre : à vérifier/ajuster si besoin.
const PLAFOND_ESPECES_JOUR = 5000;
const PLAFOND_ESPECES_MOIS = 50000;

function isCaisseNumero(numero) {
  return typeof numero === 'string' && numero.startsWith('51');
}
function isFournisseurNumero(numero) {
  return typeof numero === 'string' && numero.startsWith('4411');
}

// Solde d'un compte (débit - crédit) sur toutes les écritures existantes dont
// la date est <= dateLimite (bornes incluses), toutes sociétés confondues étant
// déjà filtrées via account_id qui est propre à une société.
function soldeCompteAvant(accountId, dateLimite) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = ? AND je.date_ecriture <= ?`
    )
    .get(accountId, dateLimite);
  return row.d - row.c;
}

// Total déjà réglé en espèces à un fournisseur (paiements passés par une écriture
// qui contient à la fois une ligne sur ce compte fournisseur ET une ligne sur un
// compte caisse) sur une période [dateDebut, dateFin].
function totalEspecesFournisseur(accountFournisseurId, dateDebut, dateFin) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit),0) AS total
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = ?
         AND je.date_ecriture BETWEEN ? AND ?
         AND EXISTS (
           SELECT 1 FROM journal_lines jl2
           JOIN accounts a2 ON a2.id = jl2.account_id
           WHERE jl2.entry_id = je.id AND a2.numero LIKE '51%'
         )`
    )
    .get(accountFournisseurId, dateDebut, dateFin);
  return row.total;
}

function startOfMonth(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}
function endOfMonth(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

// Analyse un brouillon d'écriture (avant enregistrement) et renvoie la liste des
// avertissements légaux à confirmer par l'utilisateur (solde de caisse négatif,
// dépassement du plafond de règlement en espèces d'un fournisseur).
function checkLegalWarnings(companyId, dateEcriture, lignes) {
  const warnings = [];
  if (!dateEcriture || !Array.isArray(lignes) || lignes.length === 0) return warnings;

  // Regrouper les mouvements du brouillon par compte
  const parCompte = new Map();
  for (const l of lignes) {
    if (!l.account_id) continue;
    const cur = parCompte.get(l.account_id) || { debit: 0, credit: 0 };
    cur.debit += Number(l.debit) || 0;
    cur.credit += Number(l.credit) || 0;
    parCompte.set(l.account_id, cur);
  }

  const hasCaisseLine = lignes.some((l) => {
    const acc = db.prepare('SELECT numero FROM accounts WHERE id = ?').get(l.account_id);
    return acc && isCaisseNumero(acc.numero);
  });

  for (const [accountId, mvt] of parCompte.entries()) {
    const acc = db.prepare('SELECT numero, intitule FROM accounts WHERE id = ?').get(accountId);
    if (!acc) continue;

    // 1) Solde de caisse : une sortie de caisse (crédit) ne doit pas rendre le solde négatif
    if (isCaisseNumero(acc.numero) && mvt.credit > mvt.debit) {
      const soldeAvant = soldeCompteAvant(accountId, dateEcriture);
      const soldeApres = soldeAvant + mvt.debit - mvt.credit;
      if (soldeApres < 0) {
        warnings.push({
          type: 'caisse',
          account_id: accountId,
          message: `Le solde de caisse (${acc.numero} — ${acc.intitule}) à la date du ${formatDateFr(dateEcriture)} est de ${soldeAvant.toFixed(
            2
          )} DH, ne permet pas de faire une dépense de ${mvt.credit.toFixed(2)} DH. Pensez à régulariser votre caisse !! Voulez-vous continuer quand même ?`,
        });
      }
    }

    // 2) Plafond légal de règlement en espèces par fournisseur (art. 106-II CGI)
    if (isFournisseurNumero(acc.numero) && hasCaisseLine && mvt.debit > 0) {
      const dejaJour = totalEspecesFournisseur(accountId, dateEcriture, dateEcriture);
      const dejaMois = totalEspecesFournisseur(accountId, startOfMonth(dateEcriture), endOfMonth(dateEcriture));
      const totalJour = dejaJour + mvt.debit;
      const totalMois = dejaMois + mvt.debit;
      if (totalJour > PLAFOND_ESPECES_JOUR) {
        warnings.push({
          type: 'plafond_especes_jour',
          account_id: accountId,
          message: `Attention : le règlement en espèces au fournisseur ${acc.intitule} (${acc.numero}) atteindrait ${totalJour.toFixed(
            2
          )} DH aujourd'hui, ce qui dépasse le plafond légal de ${PLAFOND_ESPECES_JOUR.toFixed(
            2
          )} DH/jour (art. 106-II du CGI). Au-delà de ce seuil, la charge et la TVA ne sont plus déductibles. Voulez-vous continuer quand même ?`,
        });
      } else if (totalMois > PLAFOND_ESPECES_MOIS) {
        warnings.push({
          type: 'plafond_especes_mois',
          account_id: accountId,
          message: `Attention : le cumul des règlements en espèces au fournisseur ${acc.intitule} (${acc.numero}) atteindrait ${totalMois.toFixed(
            2
          )} DH ce mois-ci, ce qui dépasse le plafond légal de ${PLAFOND_ESPECES_MOIS.toFixed(
            2
          )} DH/mois (art. 106-II du CGI). Au-delà de ce seuil, la charge et la TVA ne sont plus déductibles. Voulez-vous continuer quand même ?`,
        });
      }
    }
  }

  return warnings;
}

function formatDateFr(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = { checkLegalWarnings, PLAFOND_ESPECES_JOUR, PLAFOND_ESPECES_MOIS };
