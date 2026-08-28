import { createWorker, PSM } from 'tesseract.js';
import { loadPdf, extractPdfPage, fileToCanvas, preprocessCanvasForOcr, upscaleCanvasIfSmall } from './pdfExtract';

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

// Par défaut, Tesseract analyse la page en mode "entièrement automatique"
// (PSM.AUTO) — livré tel quel, ce mode s'avère très inégal sur un document
// structuré en plusieurs blocs encadrés (cartouches FACTURE/société,
// tableau des lignes, pavé de totaux HT/TVA/TTC) : des blocs entiers de
// texte peuvent être purement et simplement ignorés par l'analyse de mise
// en page, notamment le pavé de totaux, plutôt que mal lus — vérifié en
// comparant le texte brut obtenu avec/sans mode de segmentation explicite
// sur un exemple de facture avec pavé de totaux encadré : la date, l'ICE et
// tout le tableau des lignes n'apparaissaient dans AUCUNE sortie sans ce
// réglage. PSM.SINGLE_BLOCK ("bloc de texte uniforme") récupère nettement
// plus de contenu sur ce type de document. On fait aussi un second passage
// en PSM.SPARSE_TEXT ("texte épars"), meilleur pour retrouver un pavé de
// totaux isolé que le premier passage aurait manqué, et on fusionne les
// lignes des deux passages plutôt que de choisir arbitrairement — les
// lignes en trop ne gênent pas l'extraction (extractFactureFields ne
// prélève que ce qui correspond à ses motifs, où qu'il apparaisse), alors
// qu'une ligne manquante empêche toute détection.
const PSM_MULTI_PASS = [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT];

async function recognizeMultiPass(worker, canvas, psmList) {
  let combinedText = '';
  for (const psm of psmList) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    combinedText += (combinedText ? '\n' : '') + data.text;
  }
  // Remet le mode par défaut pour ne pas affecter un appel ultérieur
  // (extractDocument, utilisé ailleurs pour d'autres types de documents,
  // par exemple les relevés bancaires) qui n'a pas demandé ce réglage.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return combinedText;
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
      const { data } = await worker.recognize(preprocessCanvasForOcr(canvas));
      rows = rows.concat(textToRows(data.text));
    }
    const text = rows.map((r) => r.join(' ')).join('\n');
    return { text, rows, pages: pdf.numPages };
  }

  // Image (photo/scan) : même prétraitement (binarisation Otsu) que pour une
  // page PDF scannée avant de la passer à l'OCR — voir preprocessCanvasForOcr.
  onStatus?.('Reconnaissance OCR en cours…');
  const worker = await getOcrWorker(onProgress);
  const imageCanvas = preprocessCanvasForOcr(upscaleCanvasIfSmall(await fileToCanvas(file)));
  const { data } = await worker.recognize(imageCanvas);
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
        const text = await recognizeMultiPass(worker, preprocessCanvasForOcr(canvas), PSM_MULTI_PASS);
        rows = textToRows(text);
      }
      const text = rows.map((r) => r.join(' ')).join('\n');
      pages.push({ text, rows });
    }
    return pages;
  }

  // Image (photo/scan) : une seule page — même prétraitement (binarisation
  // Otsu) que pour une page PDF scannée avant de la passer à l'OCR.
  onStatus?.('Reconnaissance OCR en cours…');
  const worker = await getOcrWorker(onProgress);
  const imageCanvas = preprocessCanvasForOcr(upscaleCanvasIfSmall(await fileToCanvas(file)));
  const text = await recognizeMultiPass(worker, imageCanvas, PSM_MULTI_PASS);
  const rows = textToRows(text);
  return [{ text, rows }];
}
