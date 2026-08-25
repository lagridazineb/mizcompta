
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

// Variante "par page" utilisée pour le Scan de factures : quand un même PDF
// contient PLUSIEURS factures (une par page — cas très courant d'un lot de
// factures scanné en une fois), on a besoin du texte de CHAQUE page
// séparément pour en extraire autant de factures, au lieu de tout
// concaténer en un seul document (ce qui ne permettait jamais de détecter
// plus d'une facture, même sur un PDF de 40 pages).
// Renvoie un tableau [{ text, rows }, ...], un élément par page (1 seul
// élément pour une image).
export async function extractDocumentPages(file, { onStatus, onProgress } = {}) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const pdf = await loadPdf(file);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onStatus?.(`Lecture de la page ${pageNumber} / ${pdf.numPages}…`);
      const { rows: pageRows, needsOcr, canvas } = await extractPdfPage(pdf, pageNumber);
      let rows = pageRows;
      if (needsOcr) {
        onStatus?.(`Page ${pageNumber} / ${pdf.numPages} scannée — reconnaissance OCR en cours…`);
        const worker = await getOcrWorker((p) => onProgress?.(Math.round(((pageNumber - 1 + p / 100) / pdf.numPages) * 100)));
        const { data } = await worker.recognize(canvas);
        rows = textToRows(data.text);
      }
      const text = rows.map((r) => r.join(' ')).join('\n');
      pages.push({ text, rows });
    }
    return pages;
  }

  // Image (photo/scan) : une seule page
  onStatus?.('Reconnaissance OCR en cours…');
  const worker = await getOcrWorker(onProgress);
  const { data } = await worker.recognize(file);
  const rows = textToRows(data.text);
  return [{ text: data.text, rows }];
}
