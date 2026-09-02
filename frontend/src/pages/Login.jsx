import React, { useState, useEffect } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getApiBase } from '../api/client';

export default function Login() {
  const { user, login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(() => localStorage.getItem('mc_session_expired') === '1');

  // "Réveille" le backend dès l'affichage de la page, avant même que
  // l'utilisateur ait fini de saisir ses identifiants. Sur les hébergements
  // gratuits (ex. Render), un service inactif peut mettre jusqu'à ~50s à
  // redémarrer : sans cet appel, ce délai s'ajoutait entièrement au moment
  // du clic sur "Se connecter", donnant l'impression que l'appli est figée.
  // Échec ignoré volontairement (pas d'affichage d'erreur) : ce n'est qu'un
  // préchauffage, la vraie tentative de connexion gérera ses propres erreurs.
  useEffect(() => {
    fetch(`${getApiBase()}/health`).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      setSessionExpired(false);
      localStorage.removeItem('mc_session_expired');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <img src="/logo-mizcompta.png" alt="MizCompta" className="brand-seal-img" />
          <div className="brand-name">MizCompta</div>
        </div>

        {sessionExpired && !error && (
          <div className="alert alert-notice">Votre session a expiré ou n'est plus valide. Veuillez vous reconnecter.</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Identifiant</label>
            <input
              required
              type="text"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="admin"
            />
          </div>
          <div className="field">
            <label>Mot de passe</label>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-brass" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Veuillez patienter…' : 'Se connecter'}
          </button>
        </form>

        <div className="mt-24" style={{ textAlign: 'center' }}>
          <Link to="/bienvenue" className="text-muted" style={{ fontSize: 13 }}>
            ← Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
