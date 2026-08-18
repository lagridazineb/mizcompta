import React from 'react';
import { Link } from 'react-router-dom';

// Étoile géométrique à 8 branches (motif marocain), utilisée comme
// décoration — reprend le style du logo MizCompta.
function StarMotif({ size = 40, className }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <g transform="translate(50,50)">
        <polygon
          points="0,-45 10,-10 45,0 10,10 0,45 -10,10 -45,0 -10,-10"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <polygon
          points="0,-32 7,-7 32,0 7,7 0,32 -7,7 -32,0 -7,-7"
          transform="rotate(45)"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}

// Icônes simples (trait, style cohérent) — pas d'emoji, dont le rendu varie
// trop selon le système d'exploitation.
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 19h16" strokeLinecap="round" />
      <rect x="6" y="12" width="3" height="6" />
      <rect x="11" y="8" width="3" height="10" />
      <rect x="16" y="4" width="3" height="14" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M9.5 12h5M9.5 15.5h5" strokeLinecap="round" />
    </svg>
  );
}
function IconHeadset() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 13a8 8 0 0 1 16 0" strokeLinecap="round" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a3 3 0 0 1-3 3h-3" strokeLinecap="round" />
    </svg>
  );
}

const FONCTIONNALITES = [
  {
    Icone: IconShield,
    titre: 'Sécurité renforcée',
    texte: 'Vos données sont protégées avec les meilleurs standards de sécurité.',
  },
  {
    Icone: IconChart,
    titre: 'Tableaux de bord intuitifs',
    texte: "Visualisez vos performances et prenez des décisions éclairées en un coup d'œil.",
  },
  {
    Icone: IconDoc,
    titre: 'Conformité fiscale',
    texte: 'Restez en conformité avec la législation marocaine en toute simplicité.',
  },
  {
    Icone: IconHeadset,
    titre: 'Support dédié',
    texte: 'Notre équipe est là pour vous accompagner à chaque étape.',
  },
];

export default function Landing() {
  return (
    <div className="landing-shell">
      <StarMotif size={26} className="land-star land-star-1" />
      <StarMotif size={18} className="land-star land-star-2" />
      <StarMotif size={22} className="land-star land-star-3" />

      <header className="landing-header">
        <div className="brand">
          <img src="/logo-mizcompta.png" alt="MizCompta" className="brand-seal-img" />
          <span className="brand-name">MizCompta</span>
        </div>
        <Link to="/login" className="btn btn-brass">
          Se connecter
        </Link>
      </header>

      <main className="landing-hero">
        <div className="landing-hero-text">
          <h1>
            Bienvenue, gardez le contrôle <span className="landing-accent">de votre activité</span>.
          </h1>
          <p>
            MizCompta est une solution complète pensée pour les entreprises et cabinets comptables au Maroc : saisie
            des écritures, scan automatique des factures et relevés bancaires, TVA, CNSS, Bilan et CPC — conforme au
            Plan Comptable Général Marocain.
          </p>
          <div className="landing-cta">
            <Link to="/login" className="btn btn-brass btn-lg">
              Accéder à mon espace
            </Link>
          </div>
        </div>

        {/* Logo mis en scène, animé — à la place de l'ancien aperçu de tableau
            de bord factice. */}
        <div className="landing-logo-showcase" aria-hidden="true">
          <div className="landing-logo-glow" />
          <img src="/logo-mizcompta.png" alt="" className="landing-logo-big" />
        </div>
      </main>

      <section className="landing-features">
        <div className="landing-features-kicker">POURQUOI NOUS CHOISIR ?</div>
        <h2>Une gestion simple, complète et sécurisée</h2>
        <div className="landing-features-grid">
          {FONCTIONNALITES.map((f) => (
            <div key={f.titre} className="landing-feature-card">
              <div className="landing-feature-icon">
                <f.Icone />
              </div>
              <h3>{f.titre}</h3>
              <p>{f.texte}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} MizCompta — Comptabilité marocaine simplifiée.</span>
      </footer>
    </div>
  );
}
