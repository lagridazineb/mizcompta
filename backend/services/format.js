// Formatage des montants pour les exports (PDF/Excel/Word).
//
// IMPORTANT : on n'utilise PAS `n.toLocaleString('fr-FR', …)` ici. Cette
// méthode insère un "espace fine insécable" (U+202F) comme séparateur de
// milliers. PDFKit encode le texte avec la police standard Helvetica
// (WinAnsiEncoding) qui ne connaît pas ce caractère : il est tronqué à son
// octet bas (0x2F), ce qui affiche un "/" au milieu des nombres dans le PDF
// exporté (ex: "59 000,00" devient "59 /000,00"). On formate donc les
// milliers nous-mêmes avec une espace normale (U+0020), compatible avec
// toutes les polices utilisées par le PDF, Excel et Word.
function fmtMontant(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(num).toFixed(2).split('.');
  const intWithSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${intWithSpaces},${decPart}`;
}

module.exports = { fmtMontant };
