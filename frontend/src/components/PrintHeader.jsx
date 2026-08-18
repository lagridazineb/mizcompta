import React from 'react';
import { formatDateFR } from '../utils/dateFr';

// En-tête d'impression commun à tous les états (Grand livre, Balance, Écritures,
// Relevé bancaire, Factures…) : nom de la société sélectionnée par défaut en
// haut à gauche, IF en haut à droite, titre du document, et période "Du: ...
// au: ...", exactement comme sur les impressions du logiciel bureau. N'est
// visible qu'à l'impression (classe .print-only) — jamais à l'écran.
export default function PrintHeader({ company, title, periodeDebut, periodeFin, compte, extra }) {
  return (
    <div className="print-only print-header">
      <div className="print-header-row">
        <div className="print-header-company">{company?.raison_sociale || ''}</div>
        <div className="print-header-if">{company?.if_fiscal ? `IF:${company.if_fiscal}` : ''}</div>
      </div>
      <h1 className="print-header-title">{title}</h1>
      {(periodeDebut || periodeFin) && (
        <div className="print-header-periode">
          Du: {formatDateFR(periodeDebut)} au: {formatDateFR(periodeFin)}
        </div>
      )}
      {compte && (
        <div className="print-header-compte">
          <strong>Compte :</strong> {compte}
        </div>
      )}
      {extra && <div className="print-header-compte">{extra}</div>}
    </div>
  );
}
