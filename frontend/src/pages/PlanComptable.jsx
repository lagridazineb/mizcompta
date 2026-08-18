import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { useToolbarActions } from '../ToolbarContext';

const emptyForm = { numero: '', intitule: '', classe: '', nature: '', lettrable: false };

export default function PlanComptable() {
  const { activeCompany } = useCompany();
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef(null);
  const numeroRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await api.getAccounts(activeCompany.id);
    setAccounts(rows);
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load]);

  useToolbarActions({
    onAdd: () => numeroRef.current?.focus(),
    onSave: () => formRef.current?.requestSubmit(),
    addLabel: 'Nouveau (F2)',
    saveLabel: 'Enregistrer (F3)',
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createAccount(activeCompany.id, form);
      setForm(emptyForm);
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
        <h1>Le plan comptable</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  const filtered = accounts.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.numero.toLowerCase().includes(q) || a.intitule.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="page-header">
        <h1>Le plan comptable</h1>
        <p>Comptes du Plan Comptable Général Marocain (PCGM) initialisés automatiquement, plus vos comptes personnalisés.</p>
      </div>

      <div className="card">
        <h2>Nouveau compte</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="grid-3">
            <div className="field">
              <label>Compte</label>
              <input ref={numeroRef} required value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ex : 61313" />
            </div>
            <div className="field">
              <label>Intitulé</label>
              <input required value={form.intitule} onChange={(e) => setForm({ ...form, intitule: e.target.value })} placeholder="Ex : Maintenance" />
            </div>
            <div className="field">
              <label>Classe</label>
              <input required value={form.classe} onChange={(e) => setForm({ ...form, classe: e.target.value })} placeholder="Ex : 6" maxLength={1} />
            </div>
          </div>
          <div className="grid-3">
            <div className="field">
              <label>Nature</label>
              <select value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })}>
                <option value="">—</option>
                <option value="debit">Débit</option>
                <option value="credit">Crédit</option>
              </select>
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.lettrable}
                onChange={(e) => setForm({ ...form, lettrable: e.target.checked })}
                id="lettrable"
              />
              <label htmlFor="lettrable" style={{ margin: 0 }}>Compte lettrable</label>
            </div>
          </div>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Enregistrement…' : 'Créer le compte'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="flex-between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Comptes ({filtered.length})</h2>
          <input
            style={{ maxWidth: 280 }}
            placeholder="Rechercher un compte ou un intitulé…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Intitulé</th>
              <th>Classe</th>
              <th>Nature</th>
              <th>Lettrable</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 400).map((a) => (
              <tr key={a.id}>
                <td className="num">{a.numero}</td>
                <td>{a.intitule}</td>
                <td>{a.classe}</td>
                <td>{a.nature || '—'}</td>
                <td>{a.lettrable ? 'Oui' : '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  Aucun compte trouvé.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > 400 && (
          <p className="text-muted" style={{ marginTop: 10 }}>
            Affichage limité aux 400 premiers résultats — affinez la recherche pour voir plus.
          </p>
        )}
      </div>
    </div>
  );
}
