import React, { useMemo, useState } from 'react';
import CreateAccountModal from './CreateAccountModal';

// Champ de sélection de compte : un vrai <select> qui liste TOUJOURS tous les
// comptes de la/les classe(s) demandée(s) (ex: toute la classe 6 pour un
// compte d'achat), plus un champ de recherche au-dessus pour filtrer par
// numéro ou intitulé quand la liste est longue. On peut aussi taper un
// nouveau numéro inconnu pour ouvrir la pop-up de création de compte.
//
// (Un <input list=…><datalist> a été essayé auparavant, mais le navigateur
// filtre nativement ses suggestions sur le texte déjà saisi : dès qu'un
// compte était sélectionné, une seule suggestion restait visible. Un <select>
// n'a pas ce problème — toutes les options restent toujours proposées.)
export default function AccountPicker({ accounts, value, onChange, companyId, onAccountCreated, placeholder, classes }) {
  const [recherche, setRecherche] = useState('');
  const [modalNumero, setModalNumero] = useState(null);

  const selected = useMemo(() => accounts.find((a) => String(a.id) === String(value)), [accounts, value]);

  // Comptes proposés : restreints à la/les classe(s) pertinente(s) si précisé
  // (ex: classe 6 pour un compte d'achat, classe 7 pour une vente, classe 2
  // pour une immobilisation…). Le compte déjà sélectionné reste toujours
  // visible même s'il sort du filtre (ex: on avait choisi un compte hors
  // classe avant de cocher "Immo.").
  const parClasse = useMemo(() => {
    if (!classes || classes.length === 0) return accounts;
    const filtered = accounts.filter((a) => classes.includes(a.classe));
    if (selected && !filtered.some((a) => a.id === selected.id)) return [selected, ...filtered];
    return filtered;
  }, [accounts, classes, selected]);

  const options = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const base = q ? parClasse.filter((a) => a.numero.toLowerCase().includes(q) || a.intitule.toLowerCase().includes(q)) : parClasse;
    return [...base].sort((a, b) => a.numero.localeCompare(b.numero));
  }, [parClasse, recherche]);

  function handleSelectChange(e) {
    const id = e.target.value;
    if (!id) {
      onChange('');
      return;
    }
    onChange(id);
  }

  function handleRechercheKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = recherche.trim();
    if (!q) return;
    // Numéro tapé exactement : le sélectionner directement s'il existe,
    // sinon proposer de créer le compte (comme sur le logiciel bureau).
    const match = accounts.find((a) => a.numero === q);
    if (match) {
      onChange(match.id);
      setRecherche('');
    } else if (/^\d{3,}$/.test(q) && options.length === 0) {
      setModalNumero(q);
    }
  }

  return (
    <div className="account-picker">
      <input
        value={recherche}
        placeholder={placeholder || 'Filtrer par numéro ou intitulé…'}
        onChange={(e) => setRecherche(e.target.value)}
        onKeyDown={handleRechercheKeyDown}
        style={{ marginBottom: 6 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={selected?.id || ''} onChange={handleSelectChange} style={{ flex: 1 }} size={1}>
          <option value="">— Sélectionner un compte ({options.length}) —</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.numero} — {a.intitule}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" title="Créer un nouveau compte" onClick={() => setModalNumero(recherche.trim())}>
          + Compte
        </button>
      </div>

      <CreateAccountModal
        open={modalNumero !== null}
        numeroInitial={modalNumero || ''}
        companyId={companyId}
        onClose={() => setModalNumero(null)}
        onCreated={(created) => {
          setModalNumero(null);
          setRecherche('');
          onAccountCreated?.(created);
          onChange(created.id);
        }}
      />
    </div>
  );
}
