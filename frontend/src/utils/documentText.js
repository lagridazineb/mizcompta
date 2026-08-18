// Extraction de texte unifiée pour le module Scan (factures + relevé bancaire) :
// - PDF "texte" (le cas le plus fréquent pour des factures générées par
//   Word/Excel/un logiciel de facturation) : lecture directe via pdf.js, page
//   par page, en conservant la structure en lignes/cellules (comme pour le
//   Convertisseur PDF -> Excel).
// - PDF "scanné" (page sans texte sélectionnable) et images (photo/scan) :
//   reconnaissance OCR via tesseract.js, entièrement dans le navigateur.
//
// Renvoie toujours la même forme : { text, rows, pages }
//  - text : texte brut complet (toutes pages), pour les recherches par mot-clé
//  - rows : tableau de lignes, chaque ligne étant un tableau de cellules
//           (colonnes déjà séparées quand le PDF contient du texte structuré)
//  - pages : nombre de pages traitées

import { createWorker } from 'tesseract.js';
import { loadPdf, extractPdfPage } from './pdfExtract';

let sharedWorker = null;
async function getOcrWorker(onProgress) {
  if (!sharedWorker) {
    sharedWorker = await createWorker('fra', 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
      },
    });
  }
  return sharedWorker;
}

// Découpe un texte OCR brut (lignes libres) en pseudo-lignes/cellules : on
// sépare les cellules sur au moins 2 espaces consécutifs (alignement typique
// d'un tableau en sortie OCR), sinon la ligne entière est une seule cellule.
function textToRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean));
}

export async function extractDocument(file, { onStatus, onProgress } = {}) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const pdf = await loadPdf(file);
    let rows = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onStatus?.(`Lecture de la page ${pageNumber} / ${pdf.numPages}…`);
      const { rows: pageRows, needsOcr, canvas } = await extractPdfPage(pdf, pageNumber);
      if (!needsOcr) {
        rows = rows.concat(pageRows);
        continue;
      }
      onStatus?.(`Page ${pageNumber} scannée — reconnaissance OCR en cours…`);
      const worker = await getOcrWorker(onProgress);
      const { data } = await worker.recognize(canvas);
      rows = rows.concat(textToRows(data.text));
    }
    const text = rows.map((r) => r.join(' ')).join('\n');
    return { text, rows, pages: pdf.numPages };
  }

  // Image (photo/scan) : reconnaissance OCR directe
  onStatus?.('Reconnaissance OCR en cours…');
  const worker = await getOcrWorker(onProgress);
  const { data } = await worker.recognize(file);
  const rows = textToRows(data.text);
  return { text: data.text, rows, pages: 1 };
}
