import React, { useState } from 'react';
import { api } from '../api/client';

// Suppression d'un dossier client : opération irréversible qui efface toutes
// les écritures, comptes, tiers, immobilisations… de la société. Par
// sécurité, on demande de retaper la raison sociale exacte avant que le
// bouton de confirmation ne s'active (même principe que la suppression d'un
// dépôt sur GitHub) — ça évite qu'un clic malheureux efface un vrai dossier
// client une fois le logiciel en production.
export default function DeleteCompanyModal({ company, onClose, onDeleted }) {
  const [texte, setTexte] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!company) return null;

  const confirmationOk = texte.trim() === company.raison_sociale;

  async function handleDelete() {
    setError('');
    setLoading(true);
    try {
      await api.deleteCompany(company.id, texte.trim());
      onDeleted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Supprimer le dossier « {company.raison_sociale} »</h2>
        </div>
        <p style={{ lineHeight: 1.6, color: 'var(--text-muted)' }}>
          Cette action est <strong style={{ color: 'var(--debit)' }}>définitive</strong> : toutes les écritures, tous
          les comptes, tiers et immobilisations de cette société seront supprimés. Pour confirmer, retapez la raison
          sociale exacte ci-dessous.
        </p>
        <div className="field">
          <label>Raison sociale à confirmer</label>
          <input
            autoFocus
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={company.raison_sociale}
          />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Annuler
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: 'var(--debit)', color: '#fff', opacity: confirmationOk ? 1 : 0.4, cursor: confirmationOk ? 'pointer' : 'not-allowed' }}
            onClick={handleDelete}
            disabled={!confirmationOk || loading}
          >
            {loading ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
        </div>
      </div>
    </div>
  );
}
