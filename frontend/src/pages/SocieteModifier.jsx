import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import ScanDocumentSociete from '../components/ScanDocumentSociete';
import { FORMES_JURIDIQUES, MODES_DECLARATION } from '../constants/societeOptions';

// Page de modification d'une société existante : au cas où une erreur se
// serait glissée dans les données lors de la création, tous les champs
// peuvent être corrigés ici.
export default function SocieteModifier() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refreshCompanies, setActiveCompany } = useCompany();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCompany(id)
      .then((company) => {
        if (cancelled) return;
        setForm({
          raison_sociale: company.raison_sociale || '',
          forme_juridique: company.forme_juridique || '',
          ice: company.ice || '',
          if_fiscal: company.if_fiscal || '',
          rc: company.rc || '',
          patente: company.patente || '',
          cnss: company.cnss || '',
          activite: company.activite || '',
          adresse: company.adresse || '',
          ville: company.ville || '',
          telephone: company.telephone || '',
          email: company.email || '',
          mode_declaration: company.mode_declaration || 'mensuel',
          regime_tva: company.regime_tva || 'encaissement',
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleExtract(fields) {
    setForm((f) => ({
      ...f,
      raison_sociale: fields.raison_sociale || f.raison_sociale,
      forme_juridique: fields.forme_juridique || f.forme_juridique,
      ice: fields.ice || f.ice,
      if_fiscal: fields.if_fiscal || f.if_fiscal,
      rc: fields.rc || f.rc,
      patente: fields.patente || f.patente,
      cnss: fields.cnss || f.cnss,
      ville: fields.ville || f.ville,
      telephone: fields.telephone || f.telephone,
      email: fields.email || f.email,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const updated = await api.updateCompany(id, form);
      await refreshCompanies();
      setActiveCompany(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page-header">
        <h1>Modifier la société</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="page-header">
        <h1>Modifier la société</h1>
        {error && <div className="alert alert-error">{error}</div>}
        <p>
          <Link to="/societes">← Retour à la liste des sociétés</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Modifier la société</h1>
        <p>Corrigez ici les informations de la société si une erreur s'est glissée à la création. Tous les champs sont modifiables.</p>
      </div>

      <ScanDocumentSociete onExtract={handleExtract} />

      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}
        {saved && <div className="alert alert-notice">Société mise à jour avec succès.</div>}
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label>Raison sociale *</label>
              <input required value={form.raison_sociale} onChange={(e) => setForm({ ...form, raison_sociale: e.target.value })} />
            </div>
            <div className="field">
              <label>Forme juridique</label>
              <select value={form.forme_juridique} onChange={(e) => setForm({ ...form, forme_juridique: e.target.value })}>
                <option value="">Sélectionner…</option>
                {FORMES_JURIDIQUES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Activité</label>
              <input value={form.activite} onChange={(e) => setForm({ ...form, activite: e.target.value })} />
            </div>
            <div className="field">
              <label>ICE</label>
              <input value={form.ice} onChange={(e) => setForm({ ...form, ice: e.target.value })} />
            </div>
            <div className="field">
              <label>Identifiant Fiscal (IF)</label>
              <input value={form.if_fiscal} onChange={(e) => setForm({ ...form, if_fiscal: e.target.value })} />
            </div>
            <div className="field">
              <label>Registre de Commerce (RC)</label>
              <input value={form.rc} onChange={(e) => setForm({ ...form, rc: e.target.value })} />
            </div>
            <div className="field">
              <label>Patente (Taxe professionnelle)</label>
              <input value={form.patente} onChange={(e) => setForm({ ...form, patente: e.target.value })} />
            </div>
            <div className="field">
              <label>Numéro CNSS</label>
              <input value={form.cnss} onChange={(e) => setForm({ ...form, cnss: e.target.value })} />
            </div>
            <div className="field">
              <label>Adresse</label>
              <input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
            </div>
            <div className="field">
              <label>Ville</label>
              <input value={form.ville} onChange={(e) => setForm({ ...form, ville: e.target.value })} />
            </div>
            <div className="field">
              <label>Téléphone</label>
              <input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Mode de déclaration (TVA)</label>
              <select value={form.mode_declaration} onChange={(e) => setForm({ ...form, mode_declaration: e.target.value })}>
                {MODES_DECLARATION.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Régime de TVA</label>
              <select value={form.regime_tva} onChange={(e) => setForm({ ...form, regime_tva: e.target.value })}>
                <option value="encaissement">Encaissement</option>
                <option value="debit">Débit (facturation)</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/societes')}>
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
