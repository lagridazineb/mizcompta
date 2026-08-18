// Compresse une image (File) ou un canvas (page de PDF rendue) en JPEG, en
// réduisant progressivement la résolution/qualité jusqu'à respecter une
// taille maximale — nécessaire car l'API OCR gratuite (OCR.space) limite les
// fichiers à 1 Mo.

async function drawToCanvas(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return canvas;
}

async function compressSourceToJpeg(source, sourceWidth, sourceHeight, { maxDim = 2000, maxBytes = 950 * 1024 } = {}) {
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  let width = Math.round(sourceWidth * scale);
  let height = Math.round(sourceHeight * scale);
  let canvas = await drawToCanvas(source, width, height);
  let quality = 0.85;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

  let attempts = 0;
  while (blob && blob.size > maxBytes && attempts < 8) {
    if (quality > 0.4) {
      quality -= 0.15;
    } else {
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
      canvas = await drawToCanvas(source, width, height);
    }
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    attempts += 1;
  }
  return blob;
}

// Compresse un fichier image (photo/scan chargé par l'utilisateur).
export async function compressImageFile(file, opts) {
  const bitmap = await createImageBitmap(file);
  try {
    return await compressSourceToJpeg(bitmap, bitmap.width, bitmap.height, opts);
  } finally {
    bitmap.close?.();
  }
}

// Compresse un canvas déjà généré (page de PDF rendue par pdf.js).
export async function compressCanvas(canvas, opts) {
  return compressSourceToJpeg(canvas, canvas.width, canvas.height, opts);
}
