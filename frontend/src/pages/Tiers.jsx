import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { useToolbarActions } from '../ToolbarContext';

const emptyForm = { type: 'client', nom: '', ice: '', telephone: '', email: '', adresse: '' };

export default function Tiers() {
  const { activeCompany } = useCompany();
  const [tab, setTab] = useState('client');
  const [list, setList] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef(null);
  const nomInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await api.getTiers(activeCompany.id, tab);
    setList(rows);
  }, [activeCompany, tab]);

  useEffect(() => {
    load();
    setForm((f) => ({ ...f, type: tab }));
  }, [load, tab]);

  useToolbarActions({
    onAdd: () => nomInputRef.current?.focus(),
    onSave: () => formRef.current?.requestSubmit(),
    addLabel: 'Ajouter',
    saveLabel: 'Enregistrer',
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createTiers(activeCompany.id, form);
      setForm({ ...emptyForm, type: tab });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Tiers</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Tiers</h1>
        <p>Clients et fournisseurs — chaque fiche crée automatiquement son sous-compte auxiliaire.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'client' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('client')}>
          Clients
        </button>
        <button className={`btn ${tab === 'fournisseur' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('fournisseur')}>
          Fournisseurs
        </button>
      </div>

      <div className="card">
        <h2>Nouveau {tab === 'client' ? 'client' : 'fournisseur'}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label>Raison sociale / Nom</label>
              <input ref={nomInputRef} required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex : Société XYZ SARL" />
            </div>
            <div className="field">
              <label>ICE</label>
              <input value={form.ice} onChange={(e) => setForm({ ...form, ice: e.target.value })} />
            </div>
            <div className="field">
              <label>Téléphone</label>
              <input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Adresse</label>
            <input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Enregistrement…' : 'Créer la fiche'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>{tab === 'client' ? 'Clients' : 'Fournisseurs'} ({list.length})</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th>Code</th>
              <th>Compte</th>
              <th>Nom</th>
              <th>ICE</th>
              <th>Téléphone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>{t.account_numero}</td>
                <td>{t.nom}</td>
                <td>{t.ice || '—'}</td>
                <td>{t.telephone || '—'}</td>
                <td>{t.email || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted">
                  Aucune fiche pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
