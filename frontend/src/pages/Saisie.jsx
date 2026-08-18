import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '../CompanyContext';
import CompanySelectGate from '../components/CompanySelectGate';
import { SAISIE_TILES as TILES } from '../constants/saisieTiles';

function SaisieMenu() {
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  return (
    <div>
      <div className="page-header">
        <h1>Saisie</h1>
        <p>
          Société active : <strong>{activeCompany.raison_sociale}</strong> — choisissez le type de saisie à effectuer.
        </p>
      </div>
      <div className="saisie-menu">
        {TILES.map((tile) => (
          <button key={tile.title} type="button" className="saisie-tile" onClick={() => navigate(tile.to)}>
            <span className="icon">{tile.icon}</span>
            <span className="title">{tile.title}</span>
            <span className="desc">{tile.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Saisie() {
  return (
    <CompanySelectGate title="Saisie">
      <SaisieMenu />
    </CompanySelectGate>
  );
}
