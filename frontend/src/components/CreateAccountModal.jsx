import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const RACINE_CLIENT = '3421';
const RACINE_FOURNISSEUR = '4411';

function guessNature(classe) {
  if (classe === 6) return 'charge';
  if (classe === 7) return 'produit';
  if (classe === 4) return 'passif';
  return 'actif';
}

function kindForNumero(numero) {
  if (numero.startsWith(RACINE_CLIENT)) return 'client';
  if (numero.startsWith(RACINE_FOURNISSEUR)) return 'fournisseur';
  return 'generic';
}

// Pop-up "Création du Compte" — reproduit l'écran du logiciel bureau : quand un
// numéro de compte tapé pendant la saisie n'existe pas encore, on propose de le
// créer directement (client/fournisseur sous 3421/4411, ou compte générique sinon).
export default function CreateAccountModal({ open, numeroInitial, nomInitial, iceInitial, companyId, onClose, onCreated }) {
  const [numero, setNumero] = useState(numeroInitial || '');
  const [intitule, setIntitule] = useState(nomInitial || '');
  const [ifFiscal, setIfFiscal] = useState('');
  const [ice, setIce] = useState(iceInitial || '');
  const [rc, setRc] = useState('');
  const [adresse, setAdresse] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNumero(numeroInitial || '');
      setIntitule(nomInitial || '');
      setIfFiscal('');
      setIce(iceInitial || '');
      setRc('');
      setAdresse('');
      setError('');
    }
  }, [open, numeroInitial, nomInitial, iceInitial]);

  if (!open) return null;

  const kind = kindForNumero(numero || '');
  const isTiers = kind === 'client' || kind === 'fournisseur';

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!numero.trim()) {
      setError('Le numéro de compte est requis.');
      return;
    }
    if (!intitule.trim()) {
      setError("L'intitulé est requis.");
      return;
    }
    setSaving(true);
    try {
      let created;
      if (isTiers) {
        const tiersRow = await api.createTiers(companyId, {
          type: kind,
          nom: intitule.trim(),
          numero: numero.trim(),
          ice: ice || undefined,
          if_fiscal: ifFiscal || undefined,
          rc: rc || undefined,
          adresse: adresse || undefined,
        });
        created = { id: tiersRow.account_id, numero: tiersRow.account_numero, intitule: tiersRow.nom, tiers_id: tiersRow.id };
      } else {
        const classe = Number(numero[0]) || 1;
        const account = await api.createAccount(companyId, {
          numero: numero.trim(),
          intitule: intitule.trim(),
          classe,
          nature: guessNature(classe),
          lettrable: false,
        });
        created = account;
      }
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        <div className="modal-header">
          <h2>Création du Compte</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="grid-2">
            <div className="field">
              <label>Compte *</label>
              <input required value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="342101, 6111…" />
            </div>
            <div className="field">
              <label>Intitulé *</label>
              <input required autoFocus value={intitule} onChange={(e) => setIntitule(e.target.value)} placeholder="Nom du client / fournisseur / compte" />
            </div>
          </div>
          {isTiers && (
            <>
              <div className="alert alert-notice" style={{ marginTop: 4 }}>
                {kind === 'client' ? 'Compte client (sous 3421)' : 'Compte fournisseur (sous 4411)'} — informations fiscales facultatives, à
                compléter si connues.
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>IF / TVA</label>
                  <input value={ifFiscal} onChange={(e) => setIfFiscal(e.target.value)} />
                </div>
                <div className="field">
                  <label>ICE</label>
                  <input value={ice} onChange={(e) => setIce(e.target.value)} />
                </div>
                <div className="field">
                  <label>RC</label>
                  <input value={rc} onChange={(e) => setRc(e.target.value)} />
                </div>
                <div className="field">
                  <label>Adresse</label>
                  <input value={adresse} onChange={(e) => setAdresse(e.target.value)} />
                </div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler (ESC)
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Création…' : 'Créer (F2)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
