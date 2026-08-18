import React, { forwardRef, useEffect, useState } from 'react';

// Un <input type="date"> natif affiche le format (jj/mm/aaaa ou mm/jj/aaaa)
// choisi par le SYSTÈME D'EXPLOITATION du visiteur, pas par l'application —
// c'est ce qui faisait apparaître des dates en mm/jj/aaaa sur certains
// postes. Ce composant affiche toujours jj/mm/aaaa, tout en gardant la même
// API que l'input natif (value = date ISO "aaaa-mm-jj", onChange reçoit un
// évènement avec .target.value en ISO) pour rester un remplacement direct
// partout où <input type="date" value={x} onChange={e => ...} /> est utilisé.
// Un petit bouton calendrier ouvre quand même le sélecteur natif du
// navigateur pour le confort de saisie à la souris.

function isoVersAffichage(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function affichageVersIso(texte) {
  const m = texte.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = Number(m[2]);
  if (jour < 1 || jour > 31 || mois < 1 || mois > 12) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const DateInputFR = forwardRef(function DateInputFR({ value, onChange, required, disabled, className, style, ...rest }, ref) {
  const [texte, setTexte] = useState(isoVersAffichage(value));

  // Resynchronise l'affichage si la valeur change depuis l'extérieur
  // (chargement de données, réinitialisation de formulaire…).
  useEffect(() => {
    setTexte(isoVersAffichage(value));
  }, [value]);

  function handleTexteChange(e) {
    const chiffres = e.target.value.replace(/\D/g, '').slice(0, 8);
    let formate = chiffres;
    if (chiffres.length > 4) formate = `${chiffres.slice(0, 2)}/${chiffres.slice(2, 4)}/${chiffres.slice(4)}`;
    else if (chiffres.length > 2) formate = `${chiffres.slice(0, 2)}/${chiffres.slice(2)}`;
    setTexte(formate);
    if (formate === '') {
      onChange({ target: { value: '' } });
      return;
    }
    const iso = affichageVersIso(formate);
    if (iso) onChange({ target: { value: iso } });
  }

  function handleBlur() {
    // Si la saisie manuelle est incomplète/invalide en quittant le champ,
    // on revient à la dernière valeur ISO connue plutôt que de laisser un
    // texte invalide affiché.
    setTexte(isoVersAffichage(value));
  }

  return (
    <div className={`date-fr-wrap${className ? ` ${className}` : ''}`} style={{ position: 'relative', display: 'inline-flex', width: '100%', ...style }}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder="jj/mm/aaaa"
        value={texte}
        onChange={handleTexteChange}
        onBlur={handleBlur}
        required={required}
        disabled={disabled}
        style={{ width: '100%', paddingRight: 26 }}
        {...rest}
      />
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange({ target: { value: e.target.value } })}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        title="Ouvrir le calendrier"
        style={{
          position: 'absolute',
          right: 3,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 20,
          height: 20,
          opacity: 0,
          cursor: disabled ? 'default' : 'pointer',
          padding: 0,
          border: 'none',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: 5,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          fontSize: 12.5,
          opacity: disabled ? 0.4 : 0.75,
        }}
      >
        📅
      </span>
    </div>
  );
});

export default DateInputFR;
