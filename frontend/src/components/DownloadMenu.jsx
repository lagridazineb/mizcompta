import React, { useState } from 'react';

// Petit menu "Télécharger" (PDF / Excel / Word) réutilisé sur le Bilan, les
// Factures et le Relevé Bancaire. `onDownload(format)` doit renvoyer une
// promesse (le fichier est déclenché côté navigateur par api.downloadXxx).
export default function DownloadMenu({ onDownload, label = 'Télécharger' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function handle(format) {
    setBusy(format);
    setError('');
    try {
      await onDownload(format);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
      setOpen(false);
    }
  }

  return (
    <div className="no-print" style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
        ⬇ {label}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--land-card)',
            border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            zIndex: 20, minWidth: 150, overflow: 'hidden',
          }}
        >
          {[
            { format: 'pdf', label: 'PDF' },
            { format: 'xlsx', label: 'Excel' },
            { format: 'docx', label: 'Word' },
          ].map((opt) => (
            <button
              key={opt.format}
              type="button"
              onClick={() => handle(opt.format)}
              disabled={busy === opt.format}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {busy === opt.format ? 'Téléchargement…' : opt.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="alert alert-error" style={{ position: 'absolute', top: '110%', right: 0, whiteSpace: 'nowrap', zIndex: 20 }}>{error}</div>}
    </div>
  );
}
