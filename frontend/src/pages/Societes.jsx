import React, { useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { useToolbarActions } from '../ToolbarContext';
import ScanDocumentSociete from '../components/ScanDocumentSociete';
import DeleteCompanyModal from '../components/DeleteCompanyModal';
import { FORMES_JURIDIQUES, MODES_DECLARATION, TYPES_PC } from '../constants/societeOptions';

const EMPTY = {
  raison_sociale: '',
  forme_juridique: '',
  type_pc: 'ENTREPRISE',
  ice: '',
  if_fiscal: '',
  rc: '',
  patente: '',
  cnss: '',
  activite: '',
  adresse: '',
  ville: '',
  telephone: '',
  email: '',
  mode_declaration: 'mensuel',
  regime_tva: 'encaissement',
};

export default function Societes() {
  const { companies, activeCompany, setActiveCompany, refreshCompanies } = useCompany();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const formRef = useRef(null);
  const nomInputRef = useRef(null);

  useToolbarActions({
    onAdd: () => nomInputRef.current?.focus(),
    onSave: () => formRef.current?.requestSubmit(),
    addLabel: 'Nouveau dossier',
    saveLabel: 'Enregistrer',
  });

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.raison_sociale, c.ice, c.if_fiscal, c.rc, c.patente, c.ville, c.activite]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [companies, search]);

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

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const created = await api.createCompany(form);
      await refreshCompanies();
      setActiveCompany(created);
      setForm(EMPTY);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Sociétés du cabinet</h1>
        <p>Chaque société créée reçoit automatiquement le Plan Comptable Marocain, les journaux standards et un exercice en cours.</p>
      </div>

      <div className="card">
        <h2>Dossiers clients</h2>
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Rechercher une société</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Raison sociale, ICE, IF, RC, patente, ville…"
          />
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Raison sociale</th>
              <th>Forme juridique</th>
              <th>Type P.C</th>
              <th>Ville</th>
              <th>ICE</th>
              <th>IF</th>
              <th>Régime TVA</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.map((c) => (
              <tr key={c.id}>
                <td>{c.raison_sociale}</td>
                <td>{c.forme_juridique || '—'}</td>
                <td>{c.type_pc || 'ENTREPRISE'}</td>
                <td>{c.ville || '—'}</td>
                <td>{c.ice || '—'}</td>
                <td>{c.if_fiscal || '—'}</td>
                <td>{c.regime_tva}</td>
                <td>
                  {activeCompany?.id === c.id ? (
                    <span className="badge badge-ok">Active</span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => setActiveCompany(c)}>
                      Sélectionner
                    </button>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Link className="btn btn-ghost" to={`/societes/${c.id}/modifier`}>
                      Modifier
                    </Link>
                    <button type="button" className="btn-icon danger" title="Supprimer ce dossier" onClick={() => setToDelete(c)}>
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredCompanies.length === 0 && companies.length > 0 && (
              <tr>
                <td colSpan={9} className="text-muted">
                  Aucune société ne correspond à cette recherche.
                </td>
              </tr>
            )}
            {companies.length === 0 && (
              <tr>
                <td colSpan={9} className="text-muted">
                  Aucune société pour le moment. Créez le premier dossier ci-dessous.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ScanDocumentSociete onExtract={handleExtract} />

      <div className="card">
        <h2>Nouveau dossier client</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form ref={formRef} onSubmit={handleCreate}>
          <div className="grid-2">
            <div className="field">
              <label>Raison sociale *</label>
              <input ref={nomInputRef} required value={form.raison_sociale} onChange={(e) => setForm({ ...form, raison_sociale: e.target.value })} />
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
              <label>Type P.C</label>
              <select value={form.type_pc} onChange={(e) => setForm({ ...form, type_pc: e.target.value })}>
                {TYPES_PC.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {form.type_pc === 'SECT.IMMOBILIER' && (
                <p className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  Plan comptable du secteur immobilier (CNC) : comptes de stocks terrains/programmes en cours et
                  charges/produits propres à la promotion immobilière.
                </p>
              )}
            </div>
            <div className="field">
              <label>Activité</label>
              <input
                value={form.activite}
                onChange={(e) => setForm({ ...form, activite: e.target.value })}
                placeholder="Négoce, BTP, services…"
              />
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
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Création…' : 'Créer la société'}
          </button>
        </form>
      </div>

      <DeleteCompanyModal
        company={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={async () => {
          const wasActive = activeCompany?.id === toDelete.id;
          setToDelete(null);
          if (wasActive) setActiveCompany(null);
          await refreshCompanies();
        }}
      />
    </div>
  );
}
