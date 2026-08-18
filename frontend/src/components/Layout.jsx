import React from 'react';
import { useAuth } from '../AuthContext';
import { useCompany } from '../CompanyContext';
import { useNavigate } from 'react-router-dom';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { activeCompany, activeFiscalYear } = useCompany();
  const navigate = useNavigate();

  return (
    <div className="app-shell-top">
      <div className="title-strip">
        <div className="title-strip-brand">
          <img src="/logo-mizcompta.png" alt="MizCompta" className="brand-seal-img" />
          <span className="brand-name">MizCompta</span>
        </div>
        <div className="title-strip-info">
          {activeCompany ? (
            <>
              <span>[Sté: {activeCompany.raison_sociale}]</span>
              {activeCompany.ice && <span>[ICE: {activeCompany.ice}]</span>}
              {activeFiscalYear && (
                <span
                  className="no-print"
                  title="Cliquer pour ouvrir Paramètres > Clôture"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/parametres/cloture')}
                >
                  [Ex.: {activeFiscalYear.date_debut} au {activeFiscalYear.date_fin}]
                  {activeFiscalYear.cloture ? (
                    <strong style={{ color: '#ffb3b3', marginLeft: 6 }}>🔒 Clôturé</strong>
                  ) : null}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Aucun dossier ouvert</span>
          )}
        </div>
        <div className="title-strip-user">
          <span>{user?.full_name}</span>
          <button className="btn btn-ghost btn-tiny" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </div>

      <MenuBar />
      <Toolbar />

      <main className="main-full">
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
