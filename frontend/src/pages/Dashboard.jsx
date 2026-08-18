import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';

export default function Dashboard() {
  const { activeCompany, companies } = useCompany();
  const [balance, setBalance] = useState([]);

  useEffect(() => {
    if (!activeCompany) return;
    api.getBalance(activeCompany.id).then(setBalance).catch(() => {});
  }, [activeCompany]);

  const totalDebit = balance.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = balance.reduce((s, r) => s + r.total_credit, 0);
  const nbMouvements = balance.filter((r) => r.total_debit || r.total_credit).length;

  if (!activeCompany) {
    return (
      <div>
        <div className="page-header">
          <h1>Bienvenue</h1>
          <p>Créez votre première société pour commencer à saisir des écritures.</p>
        </div>
        <div className="card">
          <Link to="/societes" className="btn btn-brass">Créer une société</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>{activeCompany.raison_sociale}</h1>
        <p>{companies.length} société(s) gérée(s) dans ce cabinet · ICE {activeCompany.ice || '—'}</p>
      </div>

      <div className="grid-3">
        <div className="card">
          <h2>Total débits</h2>
          <div className="num" style={{ fontSize: 22, textAlign: 'left' }}>{totalDebit.toLocaleString('fr-MA')} DH</div>
        </div>
        <div className="card">
          <h2>Total crédits</h2>
          <div className="num" style={{ fontSize: 22, textAlign: 'left' }}>{totalCredit.toLocaleString('fr-MA')} DH</div>
        </div>
        <div className="card">
          <h2>Comptes mouvementés</h2>
          <div style={{ fontSize: 22 }}>{nbMouvements}</div>
        </div>
      </div>

      <div className="card">
        <h2>Accès rapide</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/ecritures" className="btn btn-primary">Nouvelle écriture</Link>
          <Link to="/balance" className="btn btn-ghost">Voir la balance</Link>
          <Link to="/tva" className="btn btn-ghost">Calculer la TVA</Link>
        </div>
      </div>
    </div>
  );
}
