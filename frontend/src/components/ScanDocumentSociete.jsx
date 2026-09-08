import React, { useState } from 'react';
import { extractDocument } from '../utils/documentText';
import { extractSocieteFields } from '../utils/scanSociete';

// Widget de saisie par scan (OCR) réutilisable pour la création et la
// modification d'une société : on charge une photo/scan (ou un PDF, y
// compris un PDF "texte" sans passer par l'OCR) du Registre de Commerce
// (modèle J), de l'avis de patente, de l'attestation CNSS ou d'une
// attestation fiscale, et les champs détectés sont proposés pour
// préremplir le formulaire (l'utilisateur garde la main pour corriger).
export default function ScanDocumentSociete({ onExtract }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const isPdfFile = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
    setRawText('');
    setError('');
  }

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    setProgress(0);
    setStatus('');
    setError('');
    try {
      const { text } = await extractDocument(file, { onStatus: setStatus, onProgress: setProgress });
      setRawText(text);
      const fields = extractSocieteFields(text);
      onExtract(fields);
    } catch (err) {
      setError("Échec de la lecture OCR : " + err.message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="card">
      <h2>Saisie par scan (OCR)</h2>
      <p className="text-muted" style={{ marginTop: -4 }}>
        Chargez une photo, un scan ou un PDF du Registre de Commerce (modèle J), de l'avis de patente, de l'attestation CNSS
        ou d'une attestation fiscale : les champs détectés préremplissent le formulaire ci-dessous. Vérifiez toujours les
        valeurs avant d'enregistrer.
      </p>
      <div className="alert alert-notice">
        La lecture OCR se fait entièrement dans votre navigateur (aucune donnée envoyée à un service externe), mais elle reste
        approximative — surtout sur une photo prise au téléphone.
      </div>
      <input type="file" accept="image/*,application/pdf,.pdf" onChange={handleFile} />
      {preview && (
        <div style={{ marginTop: 12, maxWidth: 280 }}>
          <img src={preview} alt="Aperçu document" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }} />
        </div>
      )}
      {isPdfFile && !preview && <p className="text-muted" style={{ marginTop: 8, fontSize: 13 }}>Fichier PDF chargé : {file.name}</p>}
      {file && (
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={scanning} onClick={handleScan}>
          {scanning ? `${status || 'Analyse en cours…'} ${progress ? `${progress}%` : ''}` : 'Analyser le document (OCR)'}
        </button>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {rawText && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>Texte brut détecté par l'OCR</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--ink-800)', padding: 12, borderRadius: 6 }}>{rawText}</pre>
        </details>
      )}
    </div>
  );
}
