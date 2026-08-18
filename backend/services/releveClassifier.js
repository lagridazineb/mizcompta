const { db } = require('../config/db');

function findAccountExact(companyId, numero) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? AND numero = ?').get(companyId, numero);
}
function findAccountStartingWith(companyId, prefix) {
  return db
    .prepare('SELECT * FROM accounts WHERE company_id = ? AND numero LIKE ? ORDER BY numero LIMIT 1')
    .get(companyId, `${prefix}%`);
}

function getNomsAssocies(companyId, fiscalYearId) {
  if (!fiscalYearId) return [];
  const row = db
    .prepare("SELECT lignes FROM etats_annexes WHERE company_id = ? AND fiscal_year_id = ? AND tableau_code = 'T13'")
    .get(companyId, fiscalYearId);
  if (!row) return [];
  try {
    const lignes = JSON.parse(row.lignes);
    return lignes.map((l) => (l.nom_associe || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Classifie une opération de relevé bancaire (scannée depuis un PDF/photo, ou
// saisie manuellement) à partir de son libellé — pour la router directement
// vers le bon traitement au lieu du compte d'attente générique 3497/4497 :
//   - "commission"/"agios"          -> compte 61473 (Frais Bancaires)
//   - "cnss"                        -> compte 4441 (CNSS et AMO)
//   - "impayé"/"rejeté"             -> compte 3488 (chèque impayé)
//   - "retrait"                     -> Virement de Fond, Banque -> Caisse
//   - "virement/remise/dépôt espèces" -> Virement de Fond, Caisse -> Banque
//   - nom d'un associé (Bilan T13) ou "gérant" -> compte 4463 (compte courant associé)
// Si rien ne correspond, on retombe sur le compte d'attente (comportement
// précédent) : la ligne reste "à reclasser" manuellement.
function classifierOperation(companyId, libelle, { fiscalYearId } = {}) {
  const t = (libelle || '').toLowerCase();
  if (!t.trim()) return { type: 'defaut' };

  if (/commission|agios?\b|frais de tenue/i.test(t)) {
    const compte = findAccountExact(companyId, '61473') || findAccountStartingWith(companyId, '6147');
    return { type: 'commission', compte: compte?.numero || '61473', label: 'Commission bancaire' };
  }
  if (/\bcnss\b/i.test(t)) {
    const compte = findAccountExact(companyId, '4441') || findAccountStartingWith(companyId, '444');
    return { type: 'cnss', compte: compte?.numero || '4441', label: 'Cotisation CNSS' };
  }
  if (/impay[ée]|rejet[ée]?/i.test(t)) {
    const compte = findAccountExact(companyId, '3488') || findAccountStartingWith(companyId, '3488');
    return { type: 'impaye', compte: compte?.numero || '3488', label: 'Chèque impayé' };
  }
  if (/retrait/i.test(t)) {
    return { type: 'retrait_especes', label: 'Retrait (chèque/espèces/GAB)' };
  }
  if (/vir(ement)?\s*esp|remise\s*esp|d[ée]p[oô]t\s*esp|versement\s*esp/i.test(t)) {
    return { type: 'versement_especes', label: 'Versement espèces' };
  }
  const noms = getNomsAssocies(companyId, fiscalYearId);
  const associe = noms.find((n) => n && t.includes(n.toLowerCase()));
  if (associe || /g[ée]rant/i.test(t)) {
    const compte = findAccountExact(companyId, '4463') || findAccountStartingWith(companyId, '4463');
    return { type: 'gerant', compte: compte?.numero || '4463', label: `Virement du gérant${associe ? ' (' + associe + ')' : ''}` };
  }
  return { type: 'defaut' };
}

module.exports = { classifierOperation, getNomsAssocies };
