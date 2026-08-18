require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { isNewDatabase } = require('./config/db');

const authRoutes = require('./routes/auth');
const companiesRoutes = require('./routes/companies');
const accountsRoutes = require('./routes/accounts');
const entriesRoutes = require('./routes/entries');
const reportsRoutes = require('./routes/reports');
const tvaRoutes = require('./routes/tva');
const tiersRoutes = require('./routes/tiers');
const facturesRoutes = require('./routes/factures');
const lettrageRoutes = require('./routes/lettrage');
const importRoutes = require('./routes/import');
const ocrRoutes = require('./routes/ocr');
const releveBancaireRoutes = require('./routes/releveBancaire');
const banquesRoutes = require('./routes/banques');
const etatsAnnexesRoutes = require('./routes/etatsAnnexes');
const paiementsRoutes = require('./routes/paiements');
const immobilisationsRoutes = require('./routes/immobilisations');

const app = express();
app.use(cors());
// Limite par défaut d'Express (100 Ko) beaucoup trop basse pour l'import d'un
// relevé bancaire de plusieurs milliers d'opérations envoyé en JSON (le
// tableau "operations" dépasse vite 100 Ko) — on la relève à 20 Mo.
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api', accountsRoutes);
app.use('/api', entriesRoutes);
app.use('/api', reportsRoutes);
app.use('/api', tvaRoutes);
app.use('/api', tiersRoutes);
app.use('/api', facturesRoutes);
app.use('/api', lettrageRoutes);
app.use('/api', importRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api', releveBancaireRoutes);
app.use('/api', banquesRoutes);
app.use('/api', etatsAnnexesRoutes);
app.use('/api', paiementsRoutes);
app.use('/api', immobilisationsRoutes);

// Gestion d'erreurs générique
app.use((err, req, res, next) => {
  console.error('[Erreur non gérée]', err);
  // On renvoie le message réel (utile en développement local pour diagnostiquer
  // vite depuis l'onglet Réseau du navigateur, sans avoir à rouvrir le terminal).
  res.status(err.status || 500).json({ error: err.message || 'Erreur interne du serveur.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  if (isNewDatabase) {
    console.log('Nouvelle base de données créée dans backend/data/megacompta.db');
  }
  console.log(`API MizCompta démarrée sur http://localhost:${PORT}`);
});
