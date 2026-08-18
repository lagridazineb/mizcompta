import React from 'react';
import { useCompany } from '../CompanyContext';
import PrintHeader from './PrintHeader';
import DownloadMenu from './DownloadMenu';
import { api } from '../api/client';
import { formatDateFR } from '../utils/dateFr';

// Affiche le détail comptable réel de chaque facture (toutes les lignes
// d'écriture, règlement compris), exactement comme le logiciel bureau —
// jamais une ligne résumée avec un simple badge de statut.
export default function FacturesLignesTable({ factures, type, onEdit, onDelete, onPrint, title }) {
  const { activeCompany, activeFiscalYear } = useCompany();
  return (
    <div className="card">
      <div className="flex-between no-print">
        <h2>{title || `Dernières factures ${type === 'vente' ? 'de ventes' : "d'achats"}`}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <DownloadMenu onDownload={(format) => api.downloadFactures(activeCompany.id, type, format)} />
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖶 Imprimer</button>
        </div>
      </div>
      <PrintHeader
        company={activeCompany}
        title={`FACTURES ${type === 'vente' ? 'DE VENTES' : "D'ACHATS"}`}
        periodeDebut={activeFiscalYear?.date_debut}
        periodeFin={activeFiscalYear?.date_fin}
      />
      <table className="ledger">
        <thead>
          <tr>
            <th>N° Écri.</th>
            <th>Date</th>
            <th>Jrn</th>
            <th>Pièce</th>
            <th>Facture N°</th>
            <th>Libellé</th>
            <th>Compte</th>
            <th>Intitulé</th>
            <th className="num">Débit</th>
            <th className="num">Crédit</th>
            {(onEdit || onDelete || onPrint) && <th className="no-print" style={{ width: 1 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {factures.flatMap((f) => {
            // Le(s) règlement(s) lié(s) s'affichent en premier (comme JC avant
            // JA sur le logiciel bureau), puis l'écriture de la facture elle-même.
            const groupes = [...(f.reglements || []), f];
            return groupes.flatMap((entry, gi) =>
              entry.lignes.map((l, li) => (
                <tr key={`${entry.id}-${l.id}`} style={gi === 0 && li === 0 ? { borderTop: '2px solid var(--border)' } : undefined}>
                  <td>{li === 0 ? `${entry.journal_code || ''}${String(entry.id).padStart(6, '0')}` : ''}</td>
                  <td>{li === 0 ? formatDateFR(entry.date_ecriture) : ''}</td>
                  <td>{li === 0 ? entry.journal_code : ''}</td>
                  <td>{li === 0 ? entry.numero_piece || '—' : ''}</td>
                  <td>
                    {li === 0 && gi === 0 ? f.numero_piece || '—' : ''}
                    {li === 0 && gi === 0 && f.cheque_en_attente && (
                      <span className="badge badge-warn" style={{ marginLeft: 6 }} title="Chèque non encore retrouvé sur le relevé bancaire">
                        Chèque en attente
                      </span>
                    )}
                  </td>
                  <td>{l.libelle || entry.libelle}</td>
                  <td>{l.account_numero}</td>
                  <td>{l.account_intitule}</td>
                  <td className="num debit">{l.debit ? l.debit.toFixed(2) : ''}</td>
                  <td className="num credit">{l.credit ? l.credit.toFixed(2) : ''}</td>
                  {(onEdit || onDelete || onPrint) && (
                    <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                      {gi === 0 && li === 0 && (
                        <div className="row-actions">
                          {onPrint && (
                            <button type="button" className="btn-icon" title="Imprimer" aria-label="Imprimer" onClick={() => onPrint(f)}>
                              🖶
                            </button>
                          )}
                          {onEdit && (
                            <button type="button" className="btn-icon" title="Modifier" aria-label="Modifier" onClick={() => onEdit(f)}>
                              ✎
                            </button>
                          )}
                          {onDelete && (
                            <button type="button" className="btn-icon danger" title="Supprimer" aria-label="Supprimer" onClick={() => onDelete(f)}>
                              🗑
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))
            );
          })}
          {factures.length === 0 && (
            <tr>
              <td colSpan={(onEdit || onDelete || onPrint) ? 11 : 10} className="text-muted">
                Aucune facture pour le moment.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
