// En production (Render, etc.), le frontend et le backend sont deux services
// séparés avec des URLs différentes : on utilise alors la variable
// d'environnement VITE_API_URL (définie au moment du build) pour pointer vers
// l'API. En local, elle est absente et on garde '/api', que le proxy Vite
// (vite.config.js) redirige vers http://localhost:4000.
let apiUrl = import.meta.env.VITE_API_URL || '';
// Filet de sécurité "contenu mixte" : si le frontend est servi en HTTPS (cas de
// tout déploiement Render) mais que VITE_API_URL a été saisie en http:// par
// erreur, le navigateur bloque silencieusement la requête (aucune erreur nette,
// juste une requête qui ne part jamais) — d'où un bouton "Veuillez patienter…"
// bloqué indéfiniment sans aucun message. On corrige automatiquement le
// protocole dans ce cas précis plutôt que de laisser l'utilisateur deviner.
if (apiUrl.startsWith('http://') && typeof window !== 'undefined' && window.location.protocol === 'https:') {
  apiUrl = apiUrl.replace('http://', 'https://');
}
const BASE = apiUrl ? `${apiUrl}/api` : '/api';

function getToken() {
  return localStorage.getItem('mc_token');
}

function getApiBase() {
  return BASE;
}

// Délai maximal avant d'abandonner une requête. Volontairement généreux
// (45s) car les services gratuits (ex. Render free tier) peuvent mettre
// jusqu'à ~50s à "se réveiller" après une période d'inactivité — on ne veut
// pas afficher une fausse erreur pendant ce démarrage à froid. Au-delà, on
// affiche un message clair plutôt que de laisser le bouton "Veuillez
// patienter…" tourner indéfiniment sans aucun retour à l'utilisateur.
const REQUEST_TIMEOUT_MS = 45000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        "Le serveur ne répond pas (délai dépassé). S'il vient d'être inactif, il peut mettre jusqu'à une minute à redémarrer : réessayez dans quelques instants. Si le problème persiste, vérifiez que le backend est bien démarré et accessible."
      );
    }
    // Erreur réseau générique (DNS invalide, backend injoignable, CORS bloqué,
    // pas de connexion internet…) : fetch() rejette avec un message technique
    // peu clair pour l'utilisateur final ("Failed to fetch").
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion et que l'adresse de l'API est correcte.");
  } finally {
    clearTimeout(timer);
  }
}

// Télécharge un fichier binaire (PDF/Excel/Word) protégé par le jeton
// d'authentification — un simple <a href> ne fonctionnerait pas puisque le
// jeton est envoyé en en-tête Authorization, pas en cookie.
async function downloadFile(path, fallbackFilename) {
  const token = getToken();
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Échec du téléchargement (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const isXml = res.headers.get('content-type')?.includes('xml');
  if (isXml) return res.text();

  const data = await res.json().catch(() => ({}));

  // Le jeton stocké n'est plus valide pour le serveur actuel (expiré, ou secret
  // changé suite à un redémarrage) : on force une déconnexion propre plutôt que
  // de laisser l'interface afficher un utilisateur "connecté" dont toutes les
  // requêtes échouent silencieusement. AuthContext écoute cet événement et
  // redirige vers /login avec un message clair.
  if (auth && res.status === 401) {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    localStorage.setItem('mc_session_expired', '1');
    window.dispatchEvent(new Event('mc:unauthorized'));
  }

  if (!res.ok) {
    // On garde le corps de la réponse (ex: détails d'un 409 anti-doublon CNSS)
    // accroché à l'erreur, pour que l'écran appelant puisse proposer une
    // action de confirmation plutôt qu'un simple message figé.
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Délai pour les envois de fichiers (import Excel/CSV, OCR) : plus long que
// REQUEST_TIMEOUT_MS car un traitement serveur (parsing de centaines de
// lignes, appel OCR externe) peut légitimement prendre plus de temps qu'un
// simple GET/POST JSON — mais reste borné : avant ce correctif, ces trois
// fonctions faisaient un fetch() sans AUCUN timeout, donc si le serveur
// était lent à répondre (démarrage à froid, gros fichier), le bouton restait
// bloqué sur "Import en cours…" indéfiniment, sans le moindre message.
const UPLOAD_TIMEOUT_MS = 120000;

async function uploadRequest(path, fields) {
  const token = getToken();
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) formData.append(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        "Le serveur met trop de temps à répondre. S'il vient d'être inactif, il peut mettre jusqu'à une minute à redémarrer : réessayez dans quelques instants. Si le fichier est volumineux, essayez de le scinder en plusieurs fichiers plus petits."
      );
    }
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion et que l'adresse de l'API est correcte.");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    localStorage.setItem('mc_session_expired', '1');
    window.dispatchEvent(new Event('mc:unauthorized'));
  }

  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),

  getCompanies: (q) => request(`/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getCompany: (id) => request(`/companies/${id}`),
  createCompany: (payload) => request('/companies', { method: 'POST', body: payload }),
  updateCompany: (id, payload) => request(`/companies/${id}`, { method: 'PUT', body: payload }),
  deleteCompany: (id, confirmation) => request(`/companies/${id}`, { method: 'DELETE', body: { confirmation } }),
  getFiscalYears: (companyId) => request(`/companies/${companyId}/fiscal-years`),
  setFiscalYearCloture: (companyId, yearId, cloture) =>
    request(`/companies/${companyId}/fiscal-years/${yearId}`, { method: 'PATCH', body: { cloture } }),
  createFiscalYear: (companyId, payload) =>
    request(`/companies/${companyId}/fiscal-years`, { method: 'POST', body: payload }),

  getAccounts: (companyId) => request(`/companies/${companyId}/accounts`),
  createAccount: (companyId, payload) => request(`/companies/${companyId}/accounts`, { method: 'POST', body: payload }),
  getJournals: (companyId) => request(`/companies/${companyId}/journals`),

  getEntries: (companyId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/companies/${companyId}/entries${qs ? `?${qs}` : ''}`);
  },
  precheckEntry: (companyId, payload) => request(`/companies/${companyId}/entries/precheck`, { method: 'POST', body: payload }),
  createEntry: (companyId, payload) => request(`/companies/${companyId}/entries`, { method: 'POST', body: payload }),
  deleteEntry: (entryId) => request(`/entries/${entryId}`, { method: 'DELETE' }),
  reimputerCompte: (companyId, lineIds, compteNumero) =>
    request(`/companies/${companyId}/journal-lines/reimputer-compte`, { method: 'PATCH', body: { line_ids: lineIds, compte_numero: compteNumero } }),
  reimputerJournal: (companyId, entryIds, journalCode) =>
    request(`/companies/${companyId}/entries/reimputer-journal`, { method: 'PATCH', body: { entry_ids: entryIds, journal_code: journalCode } }),
  reimputerDate: (companyId, entryIds, dateEcriture) =>
    request(`/companies/${companyId}/entries/reimputer-date`, { method: 'PATCH', body: { entry_ids: entryIds, date_ecriture: dateEcriture } }),
  validerEntries: (companyId, entryIds, valide = true) =>
    request(`/companies/${companyId}/entries/valider`, { method: 'PATCH', body: { entry_ids: entryIds, valide } }),
  supprimerEntriesMasse: (companyId, entryIds) =>
    request(`/companies/${companyId}/entries/supprimer-masse`, { method: 'POST', body: { entry_ids: entryIds } }),

  getBalance: (companyId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/companies/${companyId}/reports/balance${qs ? `?${qs}` : ''}`);
  },
  getJournalCentralisateur: (companyId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/companies/${companyId}/reports/journal-centralisateur${qs ? `?${qs}` : ''}`);
  },
  getGrandLivre: (companyId, accountId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/companies/${companyId}/reports/grand-livre/${accountId}${qs ? `?${qs}` : ''}`);
  },

  getBilan: (companyId, dateArrete) => request(`/companies/${companyId}/reports/bilan?date_arrete=${dateArrete}`),
  getCpc: (companyId, dateDebut, dateFin) =>
    request(`/companies/${companyId}/reports/cpc?date_debut=${dateDebut}&date_fin=${dateFin}`),
  getBilanDetaille: (companyId, fiscalYearId) => request(`/companies/${companyId}/reports/bilan-detaille?fiscal_year_id=${fiscalYearId}`),
  getLiasseComplete: (companyId, fiscalYearId, tableau3Overrides) => {
    const qs = tableau3Overrides ? `&tableau3=${encodeURIComponent(JSON.stringify(tableau3Overrides))}` : '';
    return request(`/companies/${companyId}/reports/liasse-complete?fiscal_year_id=${fiscalYearId}${qs}`);
  },
  getEtatsAnnexes: (companyId, fiscalYearId) => request(`/companies/${companyId}/etats-annexes?fiscal_year_id=${fiscalYearId}`),
  saveEtatAnnexe: (companyId, tableauCode, fiscalYearId, lignes) =>
    request(`/companies/${companyId}/etats-annexes/${tableauCode}`, { method: 'PUT', body: { fiscal_year_id: fiscalYearId, lignes } }),
  downloadBilan: (companyId, fiscalYearId, tableau, format) =>
    downloadFile(`/companies/${companyId}/reports/bilan-export?fiscal_year_id=${fiscalYearId}&tableau=${tableau}&format=${format}`, `${tableau}.${format}`),
  downloadBalance: (companyId, fiscalYearId, format) =>
    downloadFile(`/companies/${companyId}/reports/balance-export?${fiscalYearId ? `fiscal_year_id=${fiscalYearId}&` : ''}format=${format}`, `balance.${format}`),
  downloadGrandLivre: (companyId, accountId, fiscalYearId, format, extra = {}) => {
    const qs = new URLSearchParams({ account_id: accountId, ...(fiscalYearId ? { fiscal_year_id: fiscalYearId } : {}), ...extra, format }).toString();
    return downloadFile(`/companies/${companyId}/reports/grand-livre-export?${qs}`, `grand_livre.${format}`);
  },
  downloadBalanceAgee: (companyId, type, format) =>
    downloadFile(`/companies/${companyId}/reports/balance-agee-export?type=${type}&format=${format}`, `balance_agee_${type}.${format}`),
  downloadReleve: (companyId, params, format) => {
    const qs = new URLSearchParams({ ...params, format }).toString();
    return downloadFile(`/companies/${companyId}/releve-bancaire/export?${qs}`, `releve.${format}`);
  },
  downloadFactures: (companyId, type, format) =>
    downloadFile(`/companies/${companyId}/factures/export?type=${type}&format=${format}`, `factures_${type}.${format}`),

  getTvaCalcul: (companyId, dateDebut, dateFin) =>
    request(`/companies/${companyId}/tva/calcul?date_debut=${dateDebut}&date_fin=${dateFin}`),
  getTvaExportUrl: (companyId, dateDebut, dateFin) =>
    `${BASE}/companies/${companyId}/tva/export-xml?date_debut=${dateDebut}&date_fin=${dateFin}`,

  getTiers: (companyId, type) => request(`/companies/${companyId}/tiers${type ? `?type=${type}` : ''}`),
  createTiers: (companyId, payload) => request(`/companies/${companyId}/tiers`, { method: 'POST', body: payload }),
  updateTiers: (companyId, id, payload) => request(`/companies/${companyId}/tiers/${id}`, { method: 'PUT', body: payload }),
  getTiersSolde: (companyId, id) => request(`/companies/${companyId}/tiers/${id}/solde`),

  getFactures: (companyId, type) => request(`/companies/${companyId}/factures?type=${type}`),
  createFacture: (companyId, payload) => request(`/companies/${companyId}/factures`, { method: 'POST', body: payload }),
  deleteFacture: (companyId, entryId) => request(`/companies/${companyId}/factures/${entryId}`, { method: 'DELETE' }),

  getImmobilisations: (companyId) => request(`/companies/${companyId}/immobilisations`),
  getImmobilisation: (companyId, id) => request(`/companies/${companyId}/immobilisations/${id}`),
  createImmobilisation: (companyId, payload) => request(`/companies/${companyId}/immobilisations`, { method: 'POST', body: payload }),
  genererEcritureAmortissement: (companyId, id, payload) =>
    request(`/companies/${companyId}/immobilisations/${id}/generer-ecriture`, { method: 'POST', body: payload }),
  importReleveBancaire: (companyId, payload) => request(`/companies/${companyId}/releve-bancaire/import`, { method: 'POST', body: payload }),
  getChequesEnAttente: (companyId, type) => request(`/companies/${companyId}/releve-bancaire/cheques-en-attente${type ? `?type=${type}` : ''}`),
  getReleveLignes: (companyId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/companies/${companyId}/releve-bancaire/lignes${qs ? `?${qs}` : ''}`);
  },
  createReleveFrais: (companyId, payload) => request(`/companies/${companyId}/releve-bancaire/frais`, { method: 'POST', body: payload }),
  createReleveVirement: (companyId, payload) => request(`/companies/${companyId}/releve-bancaire/virement`, { method: 'POST', body: payload }),
  createReleveLigne: (companyId, payload) => request(`/companies/${companyId}/releve-bancaire/ligne`, { method: 'POST', body: payload }),
  updateReleveLigne: (companyId, entryId, payload) => request(`/companies/${companyId}/releve-bancaire/ligne/${entryId}`, { method: 'PUT', body: payload }),
  getReleveLigneDetail: (companyId, entryId) => request(`/companies/${companyId}/releve-bancaire/ligne/${entryId}`),
  getBanques: (companyId) => request(`/companies/${companyId}/banques`),
  getProchainCompteBanque: (companyId) => request(`/companies/${companyId}/banques/prochain-compte`),
  saveBanque: (companyId, payload) => request(`/companies/${companyId}/banques`, { method: 'POST', body: payload }),
  deleteBanque: (companyId, id) => request(`/companies/${companyId}/banques/${id}`, { method: 'DELETE' }),

  getBalanceAgee: (companyId, type) => request(`/companies/${companyId}/reports/balance-agee?type=${type}`),

  getLettrageCandidats: (companyId, accountId) => request(`/companies/${companyId}/lettrage/compte/${accountId}`),
  lettrer: (companyId, lineIds) => request(`/companies/${companyId}/lettrage`, { method: 'POST', body: { line_ids: lineIds } }),
  delettrer: (companyId, code) => request(`/companies/${companyId}/lettrage/${code}`, { method: 'DELETE' }),
  createPaiementFournisseur: (companyId, payload) => request(`/companies/${companyId}/paiements/fournisseur`, { method: 'POST', body: payload }),
  createPaiementCnss: (companyId, payload) => request(`/companies/${companyId}/paiements/cnss`, { method: 'POST', body: payload }),
  getHistoriqueCnss: (companyId, params) => request(`/companies/${companyId}/paiements/cnss/historique?${new URLSearchParams(params).toString()}`),

  getImportModeleUrl: (companyId, kind) => `${BASE}/companies/${companyId}/import/modele/${kind}`,
  importFile: (companyId, kind, file) => uploadRequest(`/companies/${companyId}/import/${kind}`, { file }),
  importFactures: (companyId, file, { type, fiscalYearId, compteNumero }) =>
    uploadRequest(`/companies/${companyId}/import/factures`, {
      file,
      type,
      fiscal_year_id: fiscalYearId,
      ...(compteNumero ? { compte_numero: compteNumero } : {}),
    }),

  // Reconnaissance de tableau (OCR.space, côté serveur) pour le Convertisseur
  // PDF/Image -> Excel. Renvoie { pages: [texte de chaque page] }.
  ocrTable: (file) => uploadRequest('/ocr/table', { file }),
};

export { getToken, getApiBase };
