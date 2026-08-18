// Extraction heuristique des informations d'une société depuis le texte OCR
// d'un document scanné (modèle J du Registre de Commerce, avis d'imposition
// à la patente/taxe professionnelle, attestation CNSS...).
//
// Comme pour le scan de factures, ce ne sont que des estimations : la qualité
// dépend fortement de la netteté du scan/photo, et l'utilisateur doit toujours
// vérifier les champs avant d'enregistrer la société.

import { VILLES_MAROC } from '../constants/societeOptions';

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

export function guessIce(text) {
  // L'ICE marocain comporte 15 chiffres.
  return (
    firstMatch(text, /ICE\D{0,10}(\d{15})/i) ||
    firstMatch(text, /identifiant\s+commun\s+de\s+l['’]entreprise\D{0,10}(\d{15})/i)
  );
}

export function guessIfFiscal(text) {
  return firstMatch(text, /(?:I\.?\s?F\.?|Identifiant\s+Fiscal)\D{0,10}(\d{6,9})/i);
}

export function guessRc(text) {
  return firstMatch(text, /R\.?\s?C\.?\D{0,10}(\d{1,7})/i);
}

export function guessPatente(text) {
  return firstMatch(text, /(?:Patente|Taxe\s+professionnelle)\D{0,10}(\d{6,9})/i);
}

export function guessCnss(text) {
  return firstMatch(text, /C\.?\s?N\.?\s?S\.?\s?S\.?\D{0,10}(\d{6,10})/i);
}

export function guessTelephone(text) {
  return firstMatch(text, /(?:T[ée]l(?:[ée]phone)?|GSM)\D{0,6}(0[\d\s.\-]{8,14}\d)/i);
}

export function guessEmail(text) {
  return firstMatch(text, /([\w.+-]+@[\w-]+\.[\w.-]+)/i);
}

export function guessVille(text) {
  for (const ville of VILLES_MAROC) {
    const re = new RegExp(`\\b${ville}\\b`, 'i');
    if (re.test(text)) return ville;
  }
  return null;
}

export function guessFormeJuridique(text) {
  const formes = ['SARL AU', 'SARL', 'SA', 'SNC', 'SCS', 'SCA', 'Auto-entrepreneur', 'Coopérative'];
  for (const f of formes) {
    const re = new RegExp(`\\b${f.replace(/\s/g, '\\s')}\\b`, 'i');
    if (re.test(text)) return f;
  }
  return null;
}

// Devine la raison sociale : cherche une ligne après "Dénomination" ou
// "Raison sociale", sinon renvoie la première ligne "propre" du document.
export function guessRaisonSociale(text) {
  const m = text.match(/(?:d[ée]nomination(?:\s+sociale)?|raison\s+sociale)\s*[:\-]?\s*([^\n]{3,60})/i);
  if (m) return m[1].trim();
  return null;
}

export function extractSocieteFields(text) {
  return {
    raison_sociale: guessRaisonSociale(text),
    forme_juridique: guessFormeJuridique(text),
    ice: guessIce(text),
    if_fiscal: guessIfFiscal(text),
    rc: guessRc(text),
    patente: guessPatente(text),
    cnss: guessCnss(text),
    ville: guessVille(text),
    telephone: guessTelephone(text),
    email: guessEmail(text),
  };
}
