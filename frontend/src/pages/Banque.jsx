import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import CompanySelectGate from '../components/CompanySelectGate';

const emptyForm = { compte_numero: '', banque_nom: '', adresse_agence: '', rib: '', ice: '', mode_saisie: 'TTC', par_defaut: false };

function BanqueContent() {
  const { activeCompany } = useCompany();
  const [banques, setBanques] = useState([]);
  const [banquesDisponibles, setBanquesDisponibles] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const data = await api.getBanques(activeCompany.id);
    setBanques(data.banques);
    setBanquesDisponibles(data.banques_disponibles);
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleNew() {
    setError('');
    const { compte_numero } = await api.getProchainCompteBanque(activeCompany.id);
    setForm({ ...emptyForm, compte_numero });
  }

  function handleRowClick(b) {
    setForm({
      compte_numero: b.compte_numero,
      banque_nom: b.banque_nom,
      adresse_agence: b.adresse_agence || '',
      rib: b.rib || '',
      ice: b.ice || '',
      mode_saisie: b.mode_saisie || 'TTC',
      par_defaut: !!b.par_defaut,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.compte_numero || !form.banque_nom) {
      setError('Compte comptable et nom de la banque sont requis.');
      return;
    }
    setLoading(true);
    try {
      await api.saveBanque(activeCompany.id, form);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(b) {
    if (!window.confirm(`Supprimer le compte bancaire ${b.compte_numero} (${b.banque_nom}) ?`)) return;
    await api.deleteBanque(activeCompany.id, b.id);
    if (form.compte_numero === b.compte_numero) setForm(emptyForm);
    load();
  }

  if (!activeCompany) return null;

  return (
    <div>
      <div className="page-header">
        <h1>Paramètres — Banque</h1>
        <p>Comptes bancaires de la société (un sous-compte 5141 par banque), utilisés dans la Saisie du Relevé Bancaire et les règlements de factures.</p>
      </div>

      <div className="card">
        <div className="flex-between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Édition des comptes</h2>
          <button type="button" className="btn btn-ghost" onClick={handleNew}>+ Nouveau (F2)</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="grid-3">
            <div className="field">
              <label>Nom Banque</label>
              <select required value={form.banque_nom} onChange={(e) => setForm({ ...form, banque_nom: e.target.value })}>
                <option value="">Sélectionner…</option>
                {banquesDisponibles.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Compte Comptable</label>
              <input required value={form.compte_numero} onChange={(e) => setForm({ ...form, compte_numero: e.target.value })} placeholder="Ex : 51410001" />
            </div>
            <div className="field">
              <label>Mode de Saisie</label>
              <select value={form.mode_saisie} onChange={(e) => setForm({ ...form, mode_saisie: e.target.value })}>
                <option value="TTC">TTC</option>
                <option value="HT">HT</option>
                <option value="LIBRE">Libre</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Adresse Agence</label>
            <input value={form.adresse_agence} onChange={(e) => setForm({ ...form, adresse_agence: e.target.value })} />
          </div>
          <div className="grid-3">
            <div className="field">
              <label>RIB</label>
              <input value={form.rib} onChange={(e) => setForm({ ...form, rib: e.target.value })} />
            </div>
            <div className="field">
              <label>ICE</label>
              <input value={form.ice} onChange={(e) => setForm({ ...form, ice: e.target.value })} />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.par_defaut} onChange={(e) => setForm({ ...form, par_defaut: e.target.checked })} id="par-defaut" />
              <label htmlFor="par-defaut" style={{ margin: 0 }}>Par Défaut</label>
            </div>
          </div>
          <button className="btn btn-primary" disabled={loading}>{loading ? 'Enregistrement…' : 'Enregistrer (F3)'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Liste des comptes</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th>Compte</th><th>Banque</th><th>Agence</th><th>RIB</th><th>Mode</th><th>ICE</th><th>Par Défaut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {banques.map((b) => (
              <tr key={b.id} onClick={() => handleRowClick(b)} style={{ cursor: 'pointer' }}>
                <td className="num">{b.compte_numero}</td>
                <td>{b.banque_nom}</td>
                <td>{b.adresse_agence || ''}</td>
                <td>{b.rib || ''}</td>
                <td>{b.mode_saisie}</td>
                <td>{b.ice || ''}</td>
                <td>{b.par_defaut ? 'Oui' : ''}</td>
                <td>
                  <button type="button" className="btn-icon danger" title="Supprimer" aria-label="Supprimer" onClick={(e) => { e.stopPropagation(); handleDelete(b); }}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {banques.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted">Aucun compte bancaire configuré pour le moment.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Banque() {
  return (
    <CompanySelectGate title="Paramètres — Banque">
      <BanqueContent />
    </CompanySelectGate>
  );
}
