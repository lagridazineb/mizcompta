const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Limite alignée sur le plan gratuit d'OCR.space (1 Mo par fichier). On laisse
// un peu de marge côté Multer et on renvoie une erreur claire si dépassé.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

// Reconnaissance de tableau via l'API gratuite OCR.space (isTable=true) :
// chaque ligne du texte reconnu conserve les colonnes séparées par des
// tabulations, ce qui permet ensuite de reconstruire un vrai tableau côté
// frontend. Nécessite une clé gratuite sur https://ocr.space/ocrapi/freekey
// placée dans OCR_SPACE_API_KEY (backend/.env) — sans clé, la clé de
// démonstration partagée "helloworld" est utilisée mais très limitée en
// nombre de requêtes.
router.post('/table', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const apiKey = process.env.OCR_SPACE_API_KEY || 'helloworld';

  try {
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('isTable', 'true');
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('detectOrientation', 'true');
    form.append('language', 'fre');
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

    const ocrRes = await fetch(OCR_SPACE_URL, { method: 'POST', body: form });
    const data = await ocrRes.json();

    if (data.IsErroredOnProcessing) {
      const message = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : data.ErrorMessage || 'Échec de la reconnaissance OCR.';
      return res.status(422).json({ error: message });
    }

    const pages = (data.ParsedResults || []).map((r) => r.ParsedText || '');
    res.json({ pages });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Impossible de contacter le service OCR (OCR.space). Vérifiez la connexion internet du serveur." });
  }
});

module.exports = router;
