import React, { useState } from 'react';
import PrintHeader from './PrintHeader';

// Rend un tableau annexe "manuel" de la liasse fiscale : éditable (ajout /
// suppression de lignes, saisie libre par colonne) et imprimable avec le même
// en-tête que les autres états. Le tableau (en-têtes de colonnes compris)
// est TOUJOURS affiché — même sans aucune ligne saisie, avec "NEANT" écrit
// sur une ligne centrale — exactement comme le modèle officiel du bilan
// (voir tableaux 7/9/10/11/13/14/16/17/18/19/20) : jamais un simple texte
// isolé qui casse la mise en page par rapport aux autres tableaux.
export default function AnnexeManuelle({ company, tableauNumero, title, periodeDebut, periodeFin, columns, lignes, onChange, onSave, saving }) {
  const [localLignes, setLocalLignes] = useState(lignes || []);

  function update(rows) {
    setLocalLignes(rows);
    onChange?.(rows);
  }

  function addRow() {
    const empty = {};
    columns.forEach((c) => (empty[c.key] = ''));
    update([...localLignes, empty]);
  }

  function removeRow(i) {
    update(localLignes.filter((_, idx) => idx !== i));
  }

  function updateCell(i, key, value) {
    const rows = localLignes.map((r, idx) => (idx === i ? { ...r, [key]: value } : r));
    update(rows);
  }

  return (
    <div className="card">
      <div className="flex-between no-print">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={addRow}>+ Ajouter une ligne</button>
          {onSave && (
            <button type="button" className="btn btn-primary" onClick={() => onSave(localLignes)} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          )}
        </div>
      </div>
      <PrintHeader company={company} title={title} periodeDebut={periodeDebut} periodeFin={periodeFin} />

      <table className="ledger">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th className="no-print"></th>
          </tr>
        </thead>
        <tbody>
          {localLignes.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} style={{ fontWeight: 700, textAlign: 'center', padding: '14px 0' }}>
                NEANT
              </td>
            </tr>
          ) : (
            localLignes.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <input
                      className="no-print"
                      style={{ border: 'none', background: 'transparent', width: '100%', padding: 2 }}
                      value={row[c.key] || ''}
                      onChange={(e) => updateCell(i, c.key, e.target.value)}
                    />
                    <span className="print-only">{row[c.key] || ''}</span>
                  </td>
                ))}
                <td className="no-print">
                  <button type="button" className="btn btn-ghost btn-tiny" onClick={() => removeRow(i)}>Suppr.</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
