// Formatage des dates en français, utilisé partout dans l'application (Écritures,
// Relevé bancaire, CNSS/AMO, factures, immobilisations, TVA…) : jamais de nom
// de mois anglais ni de format ISO brut affiché à l'utilisateur.
//
// - formatDateFR('2026-08-11')      -> '11/08/2026'
// - formatDateFR('2026-08-11T00:00') -> '11/08/2026'
// - formatDateLongFR('2026-08-11')  -> '11 août 2026'
//
// Accepte une date ISO (YYYY-MM-DD, avec ou sans heure) ou un objet Date.
// Toute entrée invalide/vide renvoie une chaîne vide plutôt que "Invalid Date".

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function toYMD(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function formatDateFR(value) {
  const ymd = toYMD(value);
  if (!ymd) return '';
  return `${String(ymd.d).padStart(2, '0')}/${String(ymd.m).padStart(2, '0')}/${ymd.y}`;
}

export function formatDateLongFR(value) {
  const ymd = toYMD(value);
  if (!ymd) return '';
  return `${ymd.d} ${MOIS_FR[ymd.m - 1]} ${ymd.y}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
