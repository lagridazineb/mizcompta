import React from 'react';

// Reproduit la pop-up d'alerte légale du logiciel bureau : "Le solde de caisse...
// Voulez-vous continuer comme même ?" — s'affiche une alerte à la fois, l'utilisateur
// doit répondre Oui/Non pour chacune avant que l'écriture ne soit enregistrée.
export default function LegalWarningModal({ warning, onConfirm, onCancel }) {
  if (!warning) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>MizCompta</h2>
        </div>
        <p style={{ lineHeight: 1.5 }}>{warning.message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Non
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Oui
          </button>
        </div>
      </div>
    </div>
  );
}
