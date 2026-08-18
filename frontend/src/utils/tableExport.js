// Utilitaires pour transformer du texte brut (OCR ou PDF) en tableau de
// cellules éditable, puis exporter ce tableau en CSV ou en Excel (.xlsx).
// Tout se passe dans le navigateur : aucun fichier n'est envoyé à un serveur.

import * as XLSX from 'xlsx';

// Découpe une ligne de texte en cellules. On considère qu'une "colonne" est
// séparée par une tabulation ou par au moins deux espaces consécutifs — ce qui
// correspond à la façon dont l'OCR et l'extraction PDF reconstituent les
// espacements d'un tableau.
export function splitLineToCells(line) {
  return line
    .split(/\t|\s{2,}/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// Transforme un bloc de texte brut en tableau de lignes/cellules.
export function textToRows(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(splitLineToCells)
    .filter((row) => row.length > 0);
}

// Uniformise le nombre de colonnes : complète les lignes trop courtes avec
// des cellules vides pour obtenir un vrai rectangle (nécessaire pour un
// tableau éditable et pour l'export Excel/CSV).
export function normalizeRows(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const copy = row.slice(0, width);
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",;\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(rows, filename = 'tableau.csv') {
  const csv = rowsToCsv(rows);
  // Le BOM UTF-8 assure que les accents s'affichent correctement dans Excel.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function downloadXlsx(rows, filename = 'tableau.xlsx', sheetName = 'Feuille1') {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
