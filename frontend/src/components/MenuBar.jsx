import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useCompany } from '../CompanyContext';
import { SAISIE_TILES } from '../constants/saisieTiles';

// Structure du menu, calquée sur la barre de menus de MegaCompta (desktop) :
// Fichier / Affichages / Saisie / Consultation / Traitements / Paramètres /
// Etats / Formations_Assistance / Outils / Gestion Utilisateurs
function buildMenus({ navigate, logout, closeCompany, hasCompany }) {
  return [
    {
      label: 'Fichier',
      items: [
        { label: 'Ouvrir un dossier (Sociétés)', to: '/societes' },
        { label: 'Nouveau dossier', to: '/societes' },
        { type: 'sep' },
        { label: 'Fermer le dossier', onClick: closeCompany, disabled: !hasCompany },
        { type: 'sep' },
        { label: 'Se déconnecter', onClick: logout },
      ],
    },
    {
      label: 'Affichages',
      items: [
        { label: 'Ecritures comptables', to: '/ecritures' },
        { label: 'CNSS / AMO', to: '/cnss' },
        { label: 'Tableau de Bord', to: '/' },
      ],
    },
    {
      label: 'Saisie',
      items: SAISIE_TILES.map((t) => ({ label: t.title, desc: t.desc, to: t.to })),
    },
    {
      label: 'Consultation',
      items: [
        { label: 'Ecritures comptables', to: '/ecritures' },
        { label: 'Grand livre', to: '/grand-livre' },
        { label: 'Balance', to: '/balance' },
        { label: 'Balance âgée', to: '/balance-agee' },
        { label: 'Tiers (Clients / Fournisseurs)', to: '/tiers' },
      ],
    },
    {
      label: 'Traitements',
      items: [
        { label: 'Déclaration TVA + RAS', to: '/tva' },
        { label: 'Simple TVA + RAS', to: '/tva' },
        { label: 'Lettrages', to: '/lettrage' },
        { type: 'sep' },
        { label: 'Import et Export', to: '/import' },
        { label: 'Convertisseur PDF/Image → Excel', to: '/convertisseur' },
        { label: 'Scan Factures', to: '/scan' },
      ],
    },
    {
      label: 'Paramètres',
      items: [
        { label: 'Plan Comptable', to: '/plan-comptable' },
        { label: 'Journaux', to: '/journaux' },
        { label: 'Banque', to: '/banque' },
        { label: 'Tiers (Client + Frs..)', to: '/tiers' },
        { type: 'sep' },
        { label: 'Clôture (fermeture de dossier/exercice)', to: '/parametres/cloture' },
        { type: 'sep' },
        { label: 'Sociétés', to: '/societes' },
      ],
    },
    {
      label: 'Etats',
      items: [
        { label: 'Bilan & CPC', to: '/etats' },
        { label: 'Balance', to: '/balance' },
        { label: 'Grand livre', to: '/grand-livre' },
        { label: 'Balance âgée', to: '/balance-agee' },
      ],
    },
    {
      label: 'Formations_Assistance',
      items: [{ label: 'Assistance (bientôt disponible)', disabled: true }],
    },
    {
      label: 'Outils',
      items: [
        { label: 'Import Excel/CSV', to: '/import' },
        { label: 'Convertisseur PDF/Image → Excel', to: '/convertisseur' },
      ],
    },
    {
      label: 'Gestion Utilisateurs',
      items: [{ label: 'Se déconnecter', onClick: logout }],
    },
  ];
}

export default function MenuBar() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { activeCompany, setActiveCompany } = useCompany();
  const [openIndex, setOpenIndex] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenIndex(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function closeCompany() {
    setActiveCompany(null);
    navigate('/societes');
  }

  const menus = buildMenus({ navigate, logout, closeCompany, hasCompany: !!activeCompany });

  function handleItemClick(item) {
    if (item.disabled) return;
    setOpenIndex(null);
    if (item.onClick) item.onClick();
    else if (item.to) navigate(item.to);
  }

  return (
    <div className="menubar" ref={rootRef}>
      {menus.map((menu, idx) => (
        <div className="menubar-anchor" key={menu.label}>
          <button
            type="button"
            className={`menubar-item${openIndex === idx ? ' open' : ''}`}
            onClick={() => setOpenIndex((v) => (v === idx ? null : idx))}
            onMouseEnter={() => setOpenIndex((v) => (v !== null ? idx : v))}
          >
            {menu.label}
          </button>
          {openIndex === idx && (
            <div className="menubar-dropdown">
              {menu.items.map((item, i) =>
                item.type === 'sep' ? (
                  <div className="menubar-sep" key={`sep-${i}`} />
                ) : (
                  <button
                    type="button"
                    key={item.label}
                    className="menubar-dropdown-item"
                    disabled={item.disabled}
                    onClick={() => handleItemClick(item)}
                  >
                    <span className="title">{item.label}</span>
                    {item.desc && <span className="desc">{item.desc}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
