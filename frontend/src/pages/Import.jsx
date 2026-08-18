import React, { useState } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';

function ImportBlock({ title, description, kind, columns }) {
  const { activeCompany } = useCompany();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (!file) return;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await api.importFile(activeCompany.id, kind, file);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="text-muted">{description}</p>
      <p style={{ fontSize: 13 }}>
        Colonnes attendues : <code>{columns}</code>
      </p>
      <a href={api.getImportModeleUrl(activeCompany.id, kind)} className="btn btn-ghost" style={{ marginBottom: 14, display: 'inline-block' }}>
        Télécharger le modèle .xlsx
      </a>

      <div className="field">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0])} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <button className="btn btn-primary" disabled={!file || loading} onClick={handleImport}>
        {loading ? 'Import en cours…' : 'Importer le fichier'}
      </button>

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="alert alert-notice">
            {result.crees != null && <>{result.crees} fiche(s) créée(s).</>}
            {result.ecritures_creees != null && <>{result.ecritures_creees} écriture(s) créée(s).</>}
          </div>
          {result.erreurs && result.erreurs.length > 0 && (
            <table className="ledger">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Problème</th>
                </tr>
              </thead>
              <tbody>
                {result.erreurs.map((e, i) => (
                  <tr key={i}>
                    <td>{e.ligne}</td>
                    <td>{e.erreur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// Import de Factures (Date, Facture N°, Client/Fournisseur, ICE, Montant TTC,
// Taux TVA, Mode) — une ligne = une facture, créée avec le règlement immédiat
// si un Mode est renseigné (CHQ/ESP/VRT/EFF/CB). Aucune limite de lignes.
function ImportFacturesBlock() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [type, setType] = useState('vente');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (!file || !activeFiscalYear) return;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await api.importFactures(activeCompany.id, file, { type, fiscalYearId: activeFiscalYear.id });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Importer des Factures</h2>
      <p className="text-muted">
        Une ligne = une facture (vente ou achat), avec règlement immédiat si un mode de paiement est renseigné. Le
        client/fournisseur est retrouvé par son nom, ou créé automatiquement s'il n'existe pas encore.
      </p>
      <p style={{ fontSize: 13 }}>
        Colonnes attendues : <code>Date, Facture N°, Client (ou Fournisseur), ICE, Montant (TTC), Taux TVA, Mode</code>
        <br />
        Mode : <code>CHQ</code> (chèque), <code>ESP</code> (espèce), <code>VRT</code> (virement), <code>EFF</code> (effet), <code>CB</code> — ou vide (facture non réglée).
      </p>

      <div className="field" style={{ maxWidth: 260 }}>
        <label>Type de facture</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="vente">Ventes (Clients)</option>
          <option value="achat">Achats (Fournisseurs)</option>
        </select>
      </div>
      <div className="field">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0])} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <button className="btn btn-primary" disabled={!file || loading} onClick={handleImport}>
        {loading ? 'Import en cours…' : 'Importer le fichier'}
      </button>

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="alert alert-notice">{result.factures_creees} facture(s) créée(s).</div>
          {result.erreurs && result.erreurs.length > 0 && (
            <table className="ledger">
              <thead>
                <tr><th>Ligne</th><th>Problème</th></tr>
              </thead>
              <tbody>
                {result.erreurs.map((e, i) => (
                  <tr key={i}><td>{e.ligne}</td><td>{e.erreur}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function Import() {
  const { activeCompany } = useCompany();

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Import Excel / CSV</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Import Excel / CSV</h1>
        <p>Téléchargez le modèle, remplissez-le, puis importez-le. Chaque ligne en erreur est signalée sans bloquer les autres.</p>
      </div>

      <ImportFacturesBlock />

      <ImportBlock
        title="Importer des Tiers"
        description="Une ligne = un client ou un fournisseur. Son sous-compte auxiliaire est créé automatiquement."
        kind="tiers"
        columns="Type (client/fournisseur), Nom, ICE, Telephone, Email, Adresse"
      />

      <ImportBlock
        title="Importer des Écritures"
        description="Une ligne = une ligne d'écriture. Les lignes qui partagent Journal + Date + Pièce + Libellé sont regroupées en une seule écriture, qui doit être équilibrée (débit = crédit)."
        kind="ecritures"
        columns="Journal, Date, Piece, Libelle, Compte, Debit, Credit, Tiers"
      />
    </div>
  );
}
