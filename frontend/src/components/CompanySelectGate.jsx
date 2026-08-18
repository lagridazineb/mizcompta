import React from 'react';
import { Link } from 'react-router-dom';
import { useCompany } from '../CompanyContext';

// Bloque l'accès à un écran de saisie tant qu'aucune société n'est active —
// reproduit le comportement du logiciel bureau qui demande toujours de choisir
// le dossier (la société) avant d'ouvrir un écran de saisie.
export default function CompanySelectGate({ title, children }) {
  const { companies, activeCompany, setActiveCompany, loading } = useCompany();

  if (activeCompany) return children;

  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="card">
        <h2>Choisissez d'abord une société</h2>
        <p className="text-muted">La saisie n'est disponible qu'une fois une société sélectionnée.</p>
        {loading && <p className="text-muted">Chargement des sociétés…</p>}
        {!loading && companies.length === 0 && (
          <p>
            Aucune société pour le moment. <Link to="/societes">Créer une société</Link>
          </p>
        )}
        {!loading && companies.length > 0 && (
          <div className="field" style={{ maxWidth: 420 }}>
            <label>Société</label>
            <select
              defaultValue=""
              onChange={(e) => {
                const c = companies.find((x) => String(x.id) === e.target.value);
                if (c) setActiveCompany(c);
              }}
            >
              <option value="" disabled>
                Sélectionner…
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.raison_sociale} {c.ville ? `— ${c.ville}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
