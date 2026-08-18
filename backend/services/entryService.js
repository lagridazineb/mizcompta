// Règle fondamentale de la comptabilité en partie double :
// pour chaque écriture, la somme des débits doit être strictement égale à la somme des crédits.

function validateBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, error: "Une écriture doit comporter au moins deux lignes (débit et crédit)." };
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit < 0 || credit < 0) {
      return { ok: false, error: "Les montants ne peuvent pas être négatifs." };
    }
    if (debit > 0 && credit > 0) {
      return { ok: false, error: "Une ligne ne peut pas être débitrice et créditrice à la fois." };
    }
    if (!line.account_id) {
      return { ok: false, error: "Chaque ligne doit référencer un compte du plan comptable." };
    }
    totalDebit += debit;
    totalCredit += credit;
  }
  // Tolérance d'arrondi à 2 décimales
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
  if (diff !== 0) {
    return {
      ok: false,
      error: `Écriture déséquilibrée : Débit = ${totalDebit.toFixed(2)} DH, Crédit = ${totalCredit.toFixed(2)} DH.`,
    };
  }
  return { ok: true, totalDebit, totalCredit };
}

module.exports = { validateBalanced };
