import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import { formatDateFR } from '../utils/dateFr';

export default function Lettrage() {
  const { activeCompany } = useCompany();
  const [type, setType] = useState('client');
  const [tiersList, setTiersList] = useState([]);
  const [selectedTiers, setSelectedTiers] = useState('');
  const [lignes, setLignes] = useState([]);
  const [checked, setChecked] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompany) return;
    api.getTiers(activeCompany.id, type).then((list) => {
      setTiersList(list);
      setSelectedTiers('');
      setLignes([]);
    });
  }, [activeCompany, type]);

  const loadLignes = useCallback(async () => {
    if (!activeCompany || !selectedTiers) return;
    const tiersRow = tiersList.find((t) => String(t.id) === String(selectedTiers));
    if (!tiersRow) return;
    const data = await api.getLettrageCandidats(activeCompany.id, tiersRow.account_id);
    setLignes(data.lignes);
    setChecked({});
    setMessage('');
  }, [activeCompany, selectedTiers, tiersList]);

  useEffect(() => {
    loadLignes();
  }, [loadLignes]);

  const selectedIds = Object.keys(checked).filter((id) => checked[id]).map(Number);
  const selectedLignes = lignes.filter((l) => selectedIds.includes(l.id));
  const totalDebit = selectedLignes.reduce((s, l) => s + l.debit, 0);
  const totalCredit = selectedLignes.reduce((s, l) => s + l.credit, 0);
  const equilibre = selectedIds.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.005;

  async function handleLettrer() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await api.lettrer(activeCompany.id, selectedIds);
      setMessage(`Lettrage "${res.lettrage}" effectué avec succès.`);
      loadLignes();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!activeCompany) {
    return (
      <div className="page-header">
        <h1>Lettrage</h1>
        <p>Sélectionnez ou créez d'abord une société.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Lettrage</h1>
        <p>Rapprochez les mouvements d'un compte client/fournisseur (facture ↔ règlement).</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${type === 'client' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('client')}>
          Clients
        </button>
        <button className={`btn ${type === 'fournisseur' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('fournisseur')}>
          Fournisseurs
        </button>
      </div>

      <div className="card">
        <div className="field">
          <label>{type === 'client' ? 'Client' : 'Fournisseur'}</label>
          <select value={selectedTiers} onChange={(e) => setSelectedTiers(e.target.value)}>
            <option value="">Sélectionner…</option>
            {tiersList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.account_numero} — {t.nom}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-notice">{message}</div>}

        {selectedTiers && (
          <>
            <table className="ledger">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Pièce</th>
                  <th>Libellé</th>
                  <th className="num">Débit</th>
                  <th className="num">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!checked[l.id]}
                        onChange={(e) => setChecked({ ...checked, [l.id]: e.target.checked })}
                      />
                    </td>
                    <td>{formatDateFR(l.date_ecriture)}</td>
                    <td>{l.numero_piece || '—'}</td>
                    <td>{l.libelle_ecriture}</td>
                    <td className="num debit">{l.debit ? l.debit.toFixed(2) : ''}</td>
                    <td className="num credit">{l.credit ? l.credit.toFixed(2) : ''}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      Aucun mouvement non lettré pour ce tiers.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {lignes.length > 0 && (
              <div className="flex-between mt-24" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13 }}>
                  Sélection — Débit : <strong className="num debit">{totalDebit.toFixed(2)} DH</strong> &nbsp;·&nbsp; Crédit :{' '}
                  <strong className="num credit">{totalCredit.toFixed(2)} DH</strong>
                </div>
                {selectedIds.length >= 2 &&
                  (equilibre ? <span className="badge badge-ok">Équilibrée</span> : <span className="badge badge-warn">Non équilibrée</span>)}
              </div>
            )}

            <button className="btn btn-primary" disabled={!equilibre || loading} onClick={handleLettrer}>
              {loading ? 'Lettrage en cours…' : 'Lettrer la sélection'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
