
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Nombre minimum d'éléments de texte pour considérer qu'une page contient du
// texte exploitable plutôt qu'un simple filigrane/numérotation.
const MIN_TEXT_ITEMS = 5;

export async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  return loadingTask.promise;
}

// Reconstitue les lignes d'une page à partir des positions (x, y) de chaque
// fragment de texte renvoyé par pdf.js : les fragments dont le y est proche
// sont regroupés sur la même ligne, puis triés par x pour respecter l'ordre
// des colonnes.
function reconstructRowsFromTextContent(textContent) {
  const items = textContent.items
    .map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
    }))
    .filter((it) => it.text && it.text.trim().length > 0);

  if (items.length === 0) return [];

  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  const Y_TOLERANCE = 4; // points PDF
  for (const item of items) {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= Y_TOLERANCE);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    // Regroupe les mots proches (même colonne) et sépare les colonnes par un
    // grand espacement horizontal.
    const cells = [];
    let current = '';
    let lastX = null;
    const COLUMN_GAP = 12; // points PDF : au-delà, on considère une nouvelle colonne
    for (const it of line.items) {
      if (lastX !== null && it.x - lastX > COLUMN_GAP) {
        cells.push(current.trim());
        current = '';
      }
      current += (current ? ' ' : '') + it.text;
      lastX = it.x + it.text.length * 4; // estimation grossière de la largeur
    }
    if (current) cells.push(current.trim());
    return cells;
  });
}

// Variante de reconstructRowsFromTextContent qui conserve la position x de
// chaque cellule (utile pour distinguer deux colonnes proches, ex: DEBIT vs
// CREDIT sur un relevé bancaire, où une seule des deux contient un montant
// par ligne).
function reconstructRowsWithPositions(textContent) {
  const items = textContent.items
    .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] }))
    .filter((it) => it.text && it.text.trim().length > 0);

  if (items.length === 0) return [];

  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  const Y_TOLERANCE = 4;
  for (const item of items) {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= Y_TOLERANCE);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    const cells = [];
    let current = '';
    let startX = null;
    let lastX = null;
    const COLUMN_GAP = 12;
    for (const it of line.items) {
      if (lastX !== null && it.x - lastX > COLUMN_GAP) {
        cells.push({ text: current.trim(), x: startX });
        current = '';
        startX = null;
      }
      if (startX === null) startX = it.x;
      current += (current ? ' ' : '') + it.text;
      lastX = it.x + it.text.length * 4;
    }
    if (current) cells.push({ text: current.trim(), x: startX });
    return cells;
  });
}

// Extrait toutes les pages d'un PDF sous forme de lignes { text, x } par
// cellule (texte natif uniquement — bascule sur needsOcr si la page ne
// contient pas de texte exploitable, ex : page scannée avec seulement
// quelques items de texte parasites — filigrane, numéro de page — repris du
// même seuil MIN_TEXT_ITEMS que extractPdfPage pour rester cohérent).
export async function extractPdfPagePositioned(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  if (textContent.items.length < MIN_TEXT_ITEMS) return { rows: [], needsOcr: true };
  return { rows: reconstructRowsWithPositions(textContent), needsOcr: false };
}

export async function renderPageToCanvas(page, scale = 4) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Charge un fichier image (photo/scan) dans un canvas, pour pouvoir lui
// appliquer le même prétraitement qu'une page de PDF rendue (voir
// preprocessCanvasForOcr) avant de le passer à l'OCR.
export async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Agrandit un canvas si sa résolution est trop faible pour l'OCR : les PDF
// scannés sont rendus depuis un vecteur à scale=4 (voir renderPageToCanvas),
// donc toujours nets, mais une PHOTO/image importée directement (appareil
// photo, scan à basse résolution) peut arriver bien plus petite — et une
// police fine ou cursive devient alors illisible pour Tesseract. On agrandit
// donc jusqu'à atteindre une largeur cible raisonnable, sans jamais réduire
// une image déjà grande.
export function upscaleCanvasIfSmall(canvas, targetWidth = 2200, maxScale = 3) {
  const { width, height } = canvas;
  if (!width || !height || width >= targetWidth) return canvas;
  const scale = Math.min(maxScale, targetWidth / width);
  const scaled = document.createElement('canvas');
  scaled.width = Math.round(width * scale);
  scaled.height = Math.round(height * scale);
  const ctx = scaled.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

// Binarisation (noir/blanc) par seuillage d'Otsu : améliore nettement la
// lecture OCR des relevés scannés à faible contraste. Le rendu d'une page
// PDF sur un <canvas> (que ce soit dans le navigateur ou via un moteur
// compatible) peut produire un franges colorées (rouge/cyan) autour de
// chaque caractère, dues à l'anticrénelage — invisibles à l'oeil à
// l'échelle normale, mais qui perturbent fortement l'OCR une fois
// converties en niveaux de gris par simple luminance (une frange orange
// vif reste "claire" en luminance alors qu'elle fait partie du trait).  On
// utilise donc le canal le plus SOMBRE des trois (R, G, B) pour chaque
// pixel plutôt qu'une moyenne pondérée : un pixel de texte reste sombre
// dans au moins un canal même frangé de couleur, alors qu'un pixel de fond
// blanc reste clair dans les trois — ce qui élimine ces franges avant
// même le seuillage.
export function preprocessCanvasForOcr(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!width || !height) return canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const total = width * height;
  const gray = new Uint8ClampedArray(total);
  const histogram = new Array(256).fill(0);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const g = Math.min(data[i], data[i + 1], data[i + 2]);
    gray[j] = g;
    histogram[g] += 1;
  }

  // Seuil optimal d'Otsu : maximise la variance inter-classes entre les
  // pixels "fond" (clairs) et "texte" (foncés).
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * histogram[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }

  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const v = gray[j] > threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Extrait le contenu d'une page : { rows, needsOcr, canvas }
// - rows : lignes/cellules déjà reconstituées si le PDF contient du texte
// - needsOcr + canvas : si la page semble scannée, un canvas prêt à être
//   passé à tesseract.js pour l'OCR
export async function extractPdfPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();

  if (textContent.items.length >= MIN_TEXT_ITEMS) {
    return { rows: reconstructRowsFromTextContent(textContent), needsOcr: false };
  }

  const canvas = await renderPageToCanvas(page);
  return { rows: [], needsOcr: true, canvas };
}
