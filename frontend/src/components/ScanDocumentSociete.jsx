import React, { useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import { extractSocieteFields } from '../utils/scanSociete';

// Widget de saisie par scan (OCR) réutilisable pour la création et la
// modification d'une société : on charge une photo/scan du RC, de la
// patente ou de l'attestation CNSS, et les champs détectés sont proposés
// pour préremplir le formulaire (l'utilisateur garde la main pour corriger).
export default function ScanDocumentSociete({ onExtract }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const workerRef = useRef(null);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRawText('');
    setError('');
  }

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    setProgress(0);
    setError('');
    try {
      if (!workerRef.current) {
        workerRef.current = await createWorker('fra', 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100));
          },
        });
      }
      const { data } = await workerRef.current.recognize(file);
      setRawText(data.text);
      const fields = extractSocieteFields(data.text);
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
        Chargez une photo ou un scan du Registre de Commerce (modèle J), de l'avis de patente ou de l'attestation CNSS : les
        champs détectés préremplissent le formulaire ci-dessous. Vérifiez toujours les valeurs avant d'enregistrer.
      </p>
      <div className="alert alert-notice">
        La lecture OCR se fait entièrement dans votre navigateur (aucune donnée envoyée à un service externe), mais elle reste
        approximative — surtout sur une photo prise au téléphone.
      </div>
      <input type="file" accept="image/*" onChange={handleFile} />
      {preview && (
        <div style={{ marginTop: 12, maxWidth: 280 }}>
          <img src={preview} alt="Aperçu document" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }} />
        </div>
      )}
      {file && (
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={scanning} onClick={handleScan}>
          {scanning ? `Analyse en cours… ${progress}%` : 'Analyser le document (OCR)'}
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
