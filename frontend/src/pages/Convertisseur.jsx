import React, { useState } from 'react';
import { api } from '../api/client';
import EditableTable from '../components/EditableTable';
import { loadPdf, extractPdfPage } from '../utils/pdfExtract';
import { compressImageFile, compressCanvas } from '../utils/imageCompress';
import { textToRows, normalizeRows, downloadCsv, downloadXlsx } from '../utils/tableExport';

const STEPS = {
  IDLE: 'idle',
  WORKING: 'working',
  DONE: 'done',
};

export default function Convertisseur() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(STEPS.IDLE);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [fileBaseName, setFileBaseName] = useState('tableau');

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError('');
    setRows([]);
    setStep(STEPS.IDLE);
    setFileBaseName(f.name.replace(/\.[^.]+$/, '') || 'tableau');
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
  }

  // Envoie une image (photo/scan ou page de PDF rendue) au service de
  // reconnaissance de tableau (OCR.space, appelé depuis notre backend). Le
  // fichier est d'abord compressé pour respecter la limite de 1 Mo du plan
  // gratuit.
  async function ocrImageBlob(blob) {
    const compressed = await compressImageFile(blob);
    const { pages } = await api.ocrTable(new File([compressed], 'page.jpg', { type: 'image/jpeg' }));
    return pages.join('\n');
  }

  async function handleConvertImage(f) {
    setStatusText('Reconnaissance du tableau en cours (service OCR)…');
    const text = await ocrImageBlob(f);
    return textToRows(text);
  }

  async function handleConvertPdf(f) {
    const pdf = await loadPdf(f);
    let allRows = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatusText(`Analyse de la page ${pageNumber} / ${pdf.numPages}…`);
      const { rows: pageRows, needsOcr, canvas } = await extractPdfPage(pdf, pageNumber);
      if (!needsOcr) {
        allRows = allRows.concat(pageRows);
        continue;
      }
      // Page scannée (sans texte sélectionnable) : on envoie le rendu de la
      // page au service de reconnaissance de tableau.
      setStatusText(`Page ${pageNumber} scannée — reconnaissance du tableau en cours…`);
      const compressed = await compressCanvas(canvas);
      const { pages } = await api.ocrTable(new File([compressed], `page-${pageNumber}.jpg`, { type: 'image/jpeg' }));
      allRows = allRows.concat(textToRows(pages.join('\n')));
    }
    return allRows;
  }

  async function handleAnalyse() {
    if (!file) return;
    setError('');
    setStep(STEPS.WORKING);
    try {
      let extractedRows;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        extractedRows = await handleConvertPdf(file);
      } else if (file.type.startsWith('image/')) {
        extractedRows = await handleConvertImage(file);
      } else {
        throw new Error('Format non pris en charge : chargez une image ou un PDF.');
      }

      if (extractedRows.length === 0) {
        throw new Error("Aucun texte n'a pu être extrait de ce fichier. Essayez un scan plus net ou une résolution plus élevée.");
      }

      setRows(normalizeRows(extractedRows));
      setStep(STEPS.DONE);
    } catch (err) {
      setError(err.message);
      setStep(STEPS.IDLE);
    } finally {
      setStatusText('');
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Convertisseur PDF / Image → Excel</h1>
        <p>Chargez un PDF ou une photo/scan contenant un tableau : il est automatiquement reconnu, puis vous pouvez le corriger et le télécharger en CSV ou en Excel (.xlsx).</p>
      </div>

      <div className="alert alert-notice">
        Les PDF contenant déjà du texte sont lus directement dans votre navigateur. Les scans/photos (sans texte sélectionnable) sont envoyés à un
        service de reconnaissance de tableau (OCR.space) via votre backend pour une meilleure fiabilité — configurez votre clé gratuite dans{' '}
        <code>backend/.env</code> (variable <code>OCR_SPACE_API_KEY</code>, à obtenir sur ocr.space/ocrapi/freekey). La reconnaissance reste une
        estimation : vérifiez et corrigez le tableau avant de télécharger.
      </div>

      <div className="card">
        <h2>1. Charger un fichier</h2>
        <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleFile} />
        {preview && (
          <div style={{ marginTop: 12, maxWidth: 320 }}>
            <img src={preview} alt="Aperçu" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }} />
          </div>
        )}
        {file && !preview && <p className="text-muted" style={{ marginTop: 8 }}>{file.name}</p>}
        {file && (
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={step === STEPS.WORKING} onClick={handleAnalyse}>
            {step === STEPS.WORKING ? statusText || 'Analyse en cours…' : 'Analyser le fichier'}
          </button>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {step === STEPS.DONE && rows.length > 0 && (
        <div className="card">
          <h2>2. Vérifier et corriger le tableau</h2>
          <EditableTable rows={rows} onChange={setRows} />

          <h2 style={{ marginTop: 24 }}>3. Télécharger</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => downloadXlsx(rows, `${fileBaseName}.xlsx`)}>
              Télécharger en Excel (.xlsx)
            </button>
            <button className="btn btn-ghost" onClick={() => downloadCsv(rows, `${fileBaseName}.csv`)}>
              Télécharger en CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
