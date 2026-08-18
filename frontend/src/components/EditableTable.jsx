import React from 'react';

// Grille simple, éditable, pour vérifier/corriger un tableau extrait par OCR
// avant de l'exporter. Chaque cellule est un champ texte indépendant.
export default function EditableTable({ rows, onChange }) {
  function updateCell(rowIdx, colIdx, value) {
    const next = rows.map((r) => r.slice());
    next[rowIdx][colIdx] = value;
    onChange(next);
  }

  function addRow() {
    const width = rows[0] ? rows[0].length : 1;
    onChange([...rows, Array(width).fill('')]);
  }

  function addColumn() {
    onChange(rows.map((r) => [...r, '']));
  }

  function removeRow(rowIdx) {
    onChange(rows.filter((_, i) => i !== rowIdx));
  }

  function removeColumn(colIdx) {
    onChange(rows.map((r) => r.filter((_, i) => i !== colIdx)));
  }

  const colCount = rows[0] ? rows[0].length : 0;

  return (
    <div>
      <div className="editable-table-wrap">
        <table className="editable-table">
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={c}>
                  <div className="flex-between" style={{ gap: 4 }}>
                    <span>Col {c + 1}</span>
                    <button type="button" className="mini-btn" title="Supprimer la colonne" onClick={() => removeColumn(c)}>
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="row-handle">
                  <button type="button" className="mini-btn" title="Supprimer la ligne" onClick={() => removeRow(r)}>
                    ×
                  </button>
                </td>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input value={cell} onChange={(e) => updateCell(r, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          + Ligne
        </button>
        <button type="button" className="btn btn-ghost" onClick={addColumn}>
          + Colonne
        </button>
      </div>
    </div>
  );
}
