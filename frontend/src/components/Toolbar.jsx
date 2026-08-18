import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToolbar } from '../ToolbarContext';
import { useCompany } from '../CompanyContext';
import Calculator from './Calculator';
import { SAISIE_TILES } from '../constants/saisieTiles';

function Icon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'add':
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'open':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case 'save':
      return (
        <svg {...common}>
          <path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M8 3v5h8V3" />
          <path d="M7 21v-7h10v7" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'calc':
      return (
        <svg {...common}>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="8" y1="6" x2="16" y2="6" />
          <line x1="8" y1="11" x2="8" y2="11.01" />
          <line x1="12" y1="11" x2="12" y2="11.01" />
          <line x1="16" y1="11" x2="16" y2="11.01" />
          <line x1="8" y1="15" x2="8" y2="15.01" />
          <line x1="12" y1="15" x2="12" y2="15.01" />
          <line x1="16" y1="15" x2="16" y2="15.01" />
          <line x1="8" y1="19" x2="8" y2="19.01" />
          <line x1="12" y1="19" x2="12" y2="19.01" />
          <line x1="16" y1="19" x2="16" y2="19.01" />
        </svg>
      );
    case 'saisie':
      return (
        <svg {...common}>
          <path d="M4 19.5V17l10-10 2.5 2.5-10 10H4Z" />
          <path d="M13.5 6.5 16 4l2.5 2.5-2.5 2.5" />
        </svg>
      );
    case 'chevron':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    default:
      return null;
  }
}

function ToolbarButton({ icon, label, onClick, disabled, title }) {
  return (
    <button className="toolbar-btn" onClick={onClick} disabled={disabled} title={title || label}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function SaisieDropdown() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const anchorRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(to) {
    setOpen(false);
    navigate(to);
  }

  return (
    <div className="toolbar-dropdown-anchor" ref={anchorRef}>
      <button className="toolbar-btn" onClick={() => setOpen((v) => !v)} title="Saisie">
        <Icon name="saisie" />
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          Saisie <Icon name="chevron" />
        </span>
      </button>
      {open && (
        <div className="toolbar-dropdown-menu">
          {SAISIE_TILES.map((tile) => (
            <button key={tile.title} type="button" className="toolbar-dropdown-item" onClick={() => handleSelect(tile.to)}>
              <span className="icon">{tile.icon}</span>
              <span>
                <span className="title">{tile.title}</span>
                <span className="desc">{tile.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Toolbar() {
  const { actions, trigger } = useToolbar();
  const { activeCompany, setActiveCompany } = useCompany();
  const navigate = useNavigate();
  const [showCalc, setShowCalc] = useState(false);

  function handleFermer() {
    setActiveCompany(null);
    navigate('/societes');
  }

  return (
    <div className="toolbar">
      <ToolbarButton icon="open" label="Ouvrir" onClick={() => navigate('/societes')} />
      <ToolbarButton icon="add" label={actions.addLabel || 'Ajouter'} onClick={() => trigger('onAdd')} disabled={!actions.onAdd} />
      <ToolbarButton icon="calc" label="Calculatrice" onClick={() => setShowCalc((v) => !v)} />
      <SaisieDropdown />
      <div className="toolbar-sep" />
      <ToolbarButton icon="save" label={actions.saveLabel || 'Enregistrer'} onClick={() => trigger('onSave')} disabled={!actions.onSave} />
      <ToolbarButton icon="close" label="Fermer" onClick={handleFermer} disabled={!activeCompany} title="Fermer le dossier en cours" />

      {showCalc && (
        <div className="calculator-anchor">
          <Calculator onClose={() => setShowCalc(false)} />
        </div>
      )}
    </div>
  );
}
