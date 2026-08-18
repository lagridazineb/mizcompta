import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { formatDateFR } from '../utils/dateFr';
import { useCompany } from '../CompanyContext';
import PrintHeader from '../components/PrintHeader';
import DownloadMenu from '../components/DownloadMenu';
import DateInputFR from '../components/DateInputFR';

export default function GrandLivre() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const [accounts, setAccounts] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get('account') || '';
  const [dateDebut, setDateDebut] = useState(activeFiscalYear?.date_debut || '');
  const [dateFin, setDateFin] = useState(activeFiscalYear?.date_fin || '');
  const [lettrage, setLettrage] = useState('tous'); // tous | lettre | non_lettre
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!activeCompany) return;
    api.getAccounts(activeCompany.id).then(setAccounts);
  }, [activeCompany]);

  // Par défaut, la période Du/Au reprend les bornes de l'exercice actif —
  // l'utilisateur peut ensuite les élargir ou les restreindre librement,
  // comme dans le logiciel de référence (voir capture "Consultation").
  useEffect(() => {
    if (activeFiscalYear) {
      setDateDebut((d) => d || activeFiscalYear.date_debut);
      setDateFin((d) => d || activeFiscalYear.date_fin);
    }
  }, [activeFiscalYear]);

  useEffect(() => {
    if (!activeCompany || !accountId) return;
    api
      .getGrandLivre(activeCompany.id, accountId, {
        ...(activeFiscalYear ? { fiscal_year_id: activeFiscalYear.id } : {}),
        ...(dateDebut ? { date_debut: dateDebut } : {}),
        ...(dateFin ? { date_fin: dateFin } : {}),
        ...(lettrage !== 'tous' ? { lettrage } : {}),
      })
      .then(setData);
  }, [activeCompany, accountId, activeFiscalYear, dateDebut, dateFin, lettrage]);

  if (!activeCompany) return <p className="text-muted">Sélectionnez une société.</p>;

  const compte = accounts.find((a) => String(a.id) === String(accountId));

  return (
    <div>
      <div className="page-header no-print">
        <h1>Grand livre</h1>
        <p>Détail chronologique des mouvements d'un compte.</p>
      </div>

      <div className="card no-print">
        <div className="grid-3">
          <div className="field">
            <label>Compte</label>
            <select value={accountId} onChange={(e) => setSearchParams({ account: e.target.value })}>
              <option value="">Choisir un compte…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.numero} — {a.intitule}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Du</label>
            <DateInputFR value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="field">
            <label>Au</label>
            <DateInputFR value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ maxWidth: 420 }}>
          <label>Lettrage</label>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="radio" name="lettrage" style={{ width: 'auto' }} checked={lettrage === 'tous'} onChange={() => setLettrage('tous')} /> Tous
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="radio" name="lettrage" style={{ width: 'auto' }} checked={lettrage === 'lettre'} onChange={() => setLettrage('lettre')} /> Lettré
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="radio" name="lettrage" style={{ width: 'auto' }} checked={lettrage === 'non_lettre'} onChange={() => setLettrage('non_lettre')} /> Non lettré
            </label>
          </div>
        </div>
      </div>

      {data && (
        <div className="card">
          <div className="flex-between no-print">
            <h2>Grand livre — {compte?.numero} {compte?.intitule}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <DownloadMenu
                onDownload={(format) =>
                  api.downloadGrandLivre(activeCompany.id, accountId, activeFiscalYear?.id, format, {
                    ...(dateDebut ? { date_debut: dateDebut } : {}),
                    ...(dateFin ? { date_fin: dateFin } : {}),
                    ...(lettrage !== 'tous' ? { lettrage } : {}),
                  })
                }
              />
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
            </div>
          </div>

          <PrintHeader
            company={activeCompany}
            title="GRAND LIVRE"
            periodeDebut={dateDebut || activeFiscalYear?.date_debut}
            periodeFin={dateFin || activeFiscalYear?.date_fin}
            compte={`${compte?.numero || ''}   ${compte?.intitule || ''}`}
          />

          <table className="ledger">
            <thead>
              <tr>
                <th>N° Écr.</th>
                <th>Date</th>
                <th>Jr</th>
                <th>Libellé</th>
                <th>Tiers</th>
                <th className="num">Débit</th>
                <th className="num">Crédit</th>
                <th className="num">Solde</th>
              </tr>
            </thead>
            <tbody>
              {data.mouvements.map((m, i) => (
                <tr key={i}>
                  <td>{m.journal_code}{String(m.entry_id).padStart(6, '0')}</td>
                  <td>{formatDateFR(m.date_ecriture)}</td>
                  <td>{m.journal_code}</td>
                  <td>{m.libelle_ligne || m.libelle_ecriture}</td>
                  <td>{m.tiers || '—'}</td>
                  <td className="num debit">{m.debit ? m.debit.toFixed(2) : ''}</td>
                  <td className="num credit">{m.credit ? m.credit.toFixed(2) : ''}</td>
                  <td className="num">{m.solde_cumule.toFixed(2)}{m.solde_cumule >= 0 ? 'D' : 'C'}</td>
                </tr>
              ))}
              {data.mouvements.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted">
                    Aucun mouvement pour ce compte.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>TOTAL</td>
                <td className="num">{data.total_debit.toFixed(2)}</td>
                <td className="num">{data.total_credit.toFixed(2)}</td>
                <td className="num">{data.solde_final.toFixed(2)}{data.solde_final >= 0 ? 'D' : 'C'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
