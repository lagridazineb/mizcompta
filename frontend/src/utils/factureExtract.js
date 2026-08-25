function trouverCelluleTableau(rows, labelRegex, valueRegex) {
  if (!rows || rows.length === 0) return null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const colIndex = row.findIndex((cell) => labelRegex.test(cell.trim()));
    if (colIndex === -1) continue;
    for (let j = i + 1; j <= i + 3 && j < rows.length; j += 1) {
      const candidateRow = rows[j];
      const direct = candidateRow[colIndex];
      if (direct && valueRegex.test(direct.trim())) return direct.trim();
      const any = candidateRow.find((c) => valueRegex.test(c.trim()));
      if (any) return any.trim();
    }
  }
  return null;
}

const MONTANT = String.raw`(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})`;

// Repli "triplet positionnel" : sur un document OCR (scan), les 3 en-têtes
// "Total H.T / TVA xx% / Total T.T.C" atterrissent très souvent dans UNE
// SEULE cellule de texte (l'OCR ne restitue pas l'espacement large des
// colonnes du tableau), suivie d'une seule autre cellule contenant les 3
// montants correspondants. Le repérage "colonne par colonne" ci-dessus
// échoue alors silencieusement : les trois montants (HT, TVA, TTC) captent
// tous la MÊME valeur (le premier nombre de la cellule de valeurs), ce qui
// est faux dès que la TVA n'est pas nulle. On détecte ce cas précis — une
// ligne qui contient les 3 libellés à la fois — et on assigne les 3
// derniers montants trouvés sur la ligne suivante, dans l'ordre HT/TVA/TTC.
function extraireTripletTotal(rows) {
  if (!rows || rows.length === 0) return null;
  const labelHT = /total\s*\(?\s*h\.?\s*t\.?\s*\)?/i;
  const labelTVA = /(?:montant\s*)?t\.?v\.?a\.?\s*\(?\s*(\d{1,2})\s*%\s*\)?/i;
  const labelTTC = /total\s*\(?\s*t\.?\s*t\.?\s*c\.?\s*\)?/i;
  for (let i = 0; i < rows.length; i += 1) {
    const rowText = rows[i].join(' ');
    if (!labelHT.test(rowText) || !labelTVA.test(rowText) || !labelTTC.test(rowText)) continue;
    for (let j = i + 1; j <= i + 2 && j < rows.length; j += 1) {
      const montants = [...rows[j].join(' ').matchAll(new RegExp(MONTANT, 'g'))].map((m) => toNumber(m[1]));
      if (montants.length >= 3) {
        const tauxMatch = rowText.match(labelTVA);
        const [ht, tva, ttc] = montants.slice(-3);
        return { ht, tva, ttc, taux: tauxMatch ? tauxMatch[1] : null };
      }
    }
  }
  return null;
}

// Repli "ligne d'article unique" : quand même le triplet ci-dessus est
// introuvable (le tableau des totaux n'a tout simplement pas été lu par
// l'OCR — arrive sur des mises en page en petites cases très chargées
// visuellement), mais que le document ne contient qu'UNE seule ligne
// d'article de type "désignation, quantité, prix unitaire, montant" (cas
// très fréquent des bons de livraison facturés en une seule ligne), le
// dernier montant de cette ligne est le Total TTC de la facture.
function guessMontantDepuisLigneUnique(rows) {
  if (!rows || rows.length === 0) return null;
  const candidats = [];
  for (const row of rows) {
    const montants = [...row.join(' ').matchAll(new RegExp(MONTANT, 'g'))];
    // Une ligne d'article typique contient au moins 3 nombres décimaux :
    // quantité, prix unitaire, montant total de la ligne (dans cet ordre) —
    // le montant recherché est donc le DERNIER de la ligne, sans exiger
    // qu'il soit collé à la fin de la cellule (du bruit OCR — barres "|",
    // espaces de cadre… — suit souvent le dernier nombre).
    if (montants.length >= 3) candidats.push(toNumber(montants[montants.length - 1][1]));
  }
  return candidats.length === 1 ? candidats[0] : null;
}

function toNumber(raw) {
  if (!raw) return null;
  // "79 166.67" / "42 291,67" / "95 000.00" -> 79166.67
  const cleaned = raw.replace(/\s/g, '');
  // Le dernier séparateur (. ou ,) avant 2 chiffres est la virgule décimale ;
  // les séparateurs précédents sont des séparateurs de milliers.
  const m = cleaned.match(/^(\d+(?:[.,]\d{3})*)[.,](\d{2})$/);
  if (m) {
    const entier = m[1].replace(/[.,]/g, '');
    return Number(`${entier}.${m[2]}`);
  }
  const asIs = Number(cleaned.replace(',', '.'));
  return Number.isFinite(asIs) ? asIs : null;
}

// --- Extraction "en tableau" ------------------------------------------------
// Beaucoup de factures présentent leurs totaux comme un VRAI tableau : une
// ligne d'en-têtes ("Total (HT)" | "Montant TVA (20%)" | "Total (TTC)"),
// puis, sur la ou les lignes suivantes, les valeurs correspondantes dans le
// même ordre/à peu près la même position. Le texte à plat (une fois les
// lignes concaténées) intercale alors TOUS les en-têtes avant TOUTES les
// valeurs — "Total (HT) Montant TVA (20%) Total (TTC) 4125,00 825,00
// 4950,00" — ce qu'une regex "label suivi de près par un nombre" ne peut
// pas retrouver. On cherche donc d'abord dans les LIGNES déjà reconstruites
// (rows, une entrée par ligne du document, colonnes déjà séparées) une ligne
// d'en-têtes, puis on prend le nombre à la même position (colonne) dans la
// ou les lignes suivantes qui contiennent des montants.
function trouverValeurTableau(rows, labelRegex) {
  if (!rows || rows.length === 0) return null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const colIndex = row.findIndex((cell) => labelRegex.test(cell));
    if (colIndex === -1) continue;
    // Le nombre est parfois DANS la même cellule que le libellé (rare),
    // sinon on regarde les 3 lignes suivantes à la même position de colonne,
    // puis, si la ligne n'a pas autant de colonnes (tableau mal aligné), on
    // retombe sur le premier montant de cette ligne.
    const memeCase = row[colIndex].match(new RegExp(MONTANT));
    if (memeCase) return toNumber(memeCase[1]);
    for (let j = i + 1; j <= i + 3 && j < rows.length; j += 1) {
      const candidateRow = rows[j];
      const cell = candidateRow[colIndex] ?? candidateRow.find((c) => new RegExp(`^${MONTANT}$`).test(c.trim()));
      if (!cell) continue;
      const found = cell.match(new RegExp(MONTANT));
      if (found) return toNumber(found[1]);
    }
  }
  return null;
}

// Cherche `label` suivi (à quelques caractères ou une ligne près) d'un
// montant, et renvoie le nombre. On tolère un saut de ligne entre le libellé
// et le montant (mise en page en tableau/colonnes).
function montantApresLabel(text, labelRegexSrc) {
  const re = new RegExp(`${labelRegexSrc}[\\s\\S]{0,25}?${MONTANT}`, 'gi');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  return toNumber(matches[matches.length - 1][1]);
}

export function guessMontantHT(text, rows) {
  return (
    trouverValeurTableau(rows, /total\s*\(?\s*h\.?\s*t\.?\s*\)?/i) ??
    montantApresLabel(text, String.raw`total\s*h\.?\s*t\.?`) ??
    montantApresLabel(text, String.raw`montant\s*h\.?t\.?`) ??
    montantApresLabel(text, String.raw`(?<!t\.?)\bh\.?t\.?\s*:?`)
  );
}

export function guessMontantTTC(text, rows) {
  return (
    trouverValeurTableau(rows, /total\s*\(?\s*t\.?\s*t\.?\s*c\.?\s*\)?/i) ??
    trouverValeurTableau(rows, /net\s*(?:a|à)\s*payer/i) ??
    montantApresLabel(text, String.raw`total\s*t\.?\s*t\.?\s*c\.?`) ??
    montantApresLabel(text, String.raw`total\s*(?:a|à)\s*payer`) ??
    montantApresLabel(text, String.raw`net\s*(?:a|à)\s*payer`) ??
    montantApresLabel(text, String.raw`montant\s*t\.?t\.?c\.?`) ??
    montantApresLabel(text, String.raw`\bt\.?\s*t\.?\s*c\.?\s*:?`)
  );
}

// Le taux ET le montant de TVA sont souvent sur la même ligne : "T.V.A 20% : 8 458,33"
export function guessTva(text, rows) {
  const combine = text.match(new RegExp(String.raw`t\.?v\.?a\.?\s*(\d{1,2})\s*%[\s\S]{0,20}?${MONTANT}`, 'i'));
  if (combine) return { taux: combine[1], montant: toNumber(combine[2]) };
  const tauxSeul = text.match(/t\.?v\.?a\.?\D{0,10}(\d{1,2})\s*%/i);
  // "Montant TVA (20%)" en tête de tableau : le taux est dans le libellé, la
  // valeur est retrouvée en colonne comme pour HT/TTC ci-dessus.
  const montantTableau = trouverValeurTableau(rows, /(?:montant\s*)?t\.?v\.?a\.?\s*\(?\s*\d{1,2}\s*%\s*\)?/i);
  return { taux: tauxSeul ? tauxSeul[1] : null, montant: montantTableau };
}

export function guessDate(text, rows) {
  // L'OCR confond fréquemment le chiffre "0" avec la lettre "O" (ex:
  // "DATE: O4/04/2026") : on normalise ces deux caractères avant toute
  // recherche de date, uniquement dans une copie dédiée à cette détection.
  const texteNormalise = text.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  // Priorité aux dates explicitement associées à la facture
  const labelled = texteNormalise.match(/date\s*(?:de\s*)?(?:la\s*)?facture\s*:?[\s\S]{0,15}?(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  if (labelled) return `${labelled[3]}-${labelled[2]}-${labelled[1]}`;
  const saleLe = texteNormalise.match(/\b(?:le|à)\s*(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  if (saleLe) return `${saleLe[3]}-${saleLe[2]}-${saleLe[1]}`;
  // Factures en tableau "DATE | DOCUMENT | NUMERO" : valeur sous l'en-tête "DATE".
  const dateTableau = trouverCelluleTableau(rows, /^date$/i, /^\d{2}[/.\-]\d{2}[/.\-]\d{4}$/);
  if (dateTableau) {
    const m = dateTableau.match(/^(\d{2})[/.\-](\d{2})[/.\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  // Sinon la première date qui n'est pas juste après "N°"/"facture n"
  const all = [...texteNormalise.matchAll(/(\d{2})[/.\-](\d{2})[/.\-](\d{4})/g)];
  if (all.length > 0) {
    const [d, mo, y] = [all[0][1], all[0][2], all[0][3]];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

export function guessNumeroFacture(text, rows) {
  const m =
    text.match(/num[ée]ro\s*de\s*facture\s*:?[\s\S]{0,15}?([A-Z0-9]{0,6}\d[A-Z0-9\-/]{0,12})/i) ||
    text.match(/facture\s*n[°ºo]\s*:?[\s\S]{0,10}?([A-Z0-9]{0,6}\d[A-Z0-9\-/]{0,12})/i);
  if (m) {
    // Écarte un faux positif qui serait en fait une date (ex: "20/06/2026")
    if (!/^\d{2}[/.\-]\d{2}[/.\-]\d{4}$/.test(m[1])) return m[1];
  }
  // Factures présentées en tableau "DATE | DOCUMENT | NUMERO" (bons de
  // livraison/facture type Cristal Cérame) : le numéro de pièce est la
  // valeur sous l'en-tête "NUMERO", généralement un code alphanumérique
  // (ex : CC2026040049) plutôt qu'un simple nombre.
  const numeroTableau = trouverCelluleTableau(rows, /^num[ée]ro$/i, /^[A-Z]{0,4}\d[A-Z0-9\-/]{3,15}$/);
  if (numeroTableau) return numeroTableau;
  // Numéro affiché seul, sans libellé, juste sous "FACTURE" (ex: "FA2026/0095") :
  // un code qui mélange lettres/chiffres et un séparateur (/ ou -), sur sa
  // propre ligne, dans les 10 premières lignes du document.
  if (rows) {
    const codeSeul = /^[A-Z]{1,4}\d{2,4}[/\-]\d{2,6}$/;
    for (const row of rows.slice(0, 10)) {
      // L'OCR laisse parfois un caractère parasite juste avant/après le
      // code (accolade, barre verticale d'un cadre mal reconnu…) — on les
      // retire avant de tester le format, sinon "{ FA2026/0045" ne
      // correspondait jamais au motif ancré ci-dessus.
      const cell = (row[0] || '').trim().replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9/\-]+$/, '');
      if (codeSeul.test(cell)) return cell;
    }
  }
  // Bordereaux type "DATE  FACTURE/BL  NUMERO" fusionnés par l'OCR sur une
  // seule ligne (l'en-tête du tableau n'a pas été lu séparément) : le code
  // suit directement le mot "FACTURE/BL" ou "BL"/"BON DE LIVRAISON".
  const apresTypeDocument = text.match(/(?:facture\s*\/?\s*bl|bon\s*de\s*livraison)[\s\S]{0,20}?\b([A-Z]{2,4}\d{6,12})\b/i);
  if (apresTypeDocument) return apresTypeDocument[1];
  return null;
}

export function guessModeReglementEtPiece(text) {
  const modeMap = { 'chèque': 'Chèque', 'cheque': 'Chèque', virement: 'Virement', 'espèce': 'Espèce', espece: 'Espèce', 'espèces': 'Espèce', especes: 'Espèce', effet: 'Effet', carte: 'Carte Bancaire' };
  // Cas avec numéro de pièce accolé au mode : "Chèque n° 123456"
  const avecPiece = text.match(/(ch[eè]que|virement|esp[eè]ces?|effet|carte)\D{0,12}n[°ºo]?\s*:?\s*([A-Z0-9]{3,15})/i);
  if (avecPiece) return { mode: modeMap[avecPiece[1].toLowerCase()] || avecPiece[1], piece: avecPiece[2] };
  // Cas très fréquent sur les factures marocaines : un simple champ "Mode de
  // règlement : ESPECE" (ou "Mode de paiement"), sans numéro de pièce —
  // c'est notamment le cas de tout règlement en espèces, qui n'a pas de
  // numéro de chèque/virement associé.
  const simple = text.match(/mode\s*de\s*(?:r[èe]glement|paiement)\s*:?[\s\S]{0,10}?(ch[eè]que|virement|esp[eè]ces?|effet|carte)/i);
  if (simple) return { mode: modeMap[simple[1].toLowerCase()] || simple[1], piece: null };
  return { mode: null, piece: null };
}

// Tous les ICE (15 chiffres) trouvés, dans l'ordre d'apparition. Sur une
// facture marocaine standard, le premier ICE rencontré est en général celui
// du client (juste sous "Client :"), le dernier celui de l'émetteur (bloc
// pied de page avec RC/IF/TP/ICE).
export function guessIce(text) {
  // Tolère "I.C.E :" (avec points) en plus de "ICE :" — les deux graphies
  // sont courantes selon les factures, et seule la seconde était reconnue.
  const all = [...text.matchAll(/I\.?\s?C\.?\s?E\.?\s*:?\s*(\d{15})/gi)].map((m) => m[1]);
  return { premier: all[0] || null, dernier: all[all.length - 1] || null, tous: all };
}

// Nettoie un nom détecté par OCR : l'OCR laisse parfois des caractères
// parasites (accolades, arobases…) issus d'un logo stylisé mal reconnu —
// mieux vaut tronquer au premier caractère suspect que d'afficher
// "Promo @r}}." tel quel à l'utilisateur.
function nettoyerNomDetecte(nom) {
  if (!nom) return null;
  // Coupe au premier caractère qui n'est ni une lettre, un chiffre, une
  // espace, ni une ponctuation usuelle de raison sociale (&'-.,).
  const coupe = nom.match(/^[A-Za-zÀ-ÿ0-9 &'\-.,]+/);
  const nettoye = (coupe ? coupe[0] : nom).replace(/[.,\s]+$/, '').trim();
  if (nettoye.length < 3) return null;
  // Si moins de la moitié des caractères restants sont des lettres, c'est
  // très probablement du bruit OCR plutôt qu'un vrai nom.
  const lettres = (nettoye.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (lettres / nettoye.length < 0.5) return null;
  return nettoye;
}

// Nom indiqué après "Client :" — utile pour une facture de vente (nom du
// client) ou pour confirmer le destinataire sur une facture d'achat reçue.
export function guessNomClient(text) {
  const re = /client\s*:?[\s\S]{0,4}?\n?\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ0-9 .&'\-]{2,60})/gi;
  const rejet = /^(facture|date|num[ée]ro|ice|total|mode)/i;
  for (const m of text.matchAll(re)) {
    const val = m[1].trim();
    if (!rejet.test(val)) return nettoyerNomDetecte(val);
  }
  return null;
}

// Nom de l'émetteur (fournisseur) : le plus souvent en toute première ligne
// du document (bandeau/logo texte), avant tout mot-clé "FACTURE"/"Client".
// On écarte les lignes qui ressemblent à un mot-clé de mise en page.
const LIGNES_A_IGNORER = /^(facture|devis|bon\s*de|client|date|num[ée]ro|mode\s*de|total|designation|qte|qu?antit[ée])/i;
function guessNomEmetteurLogo(rows) {
  for (const row of rows.slice(0, 6)) {
    const cell = (row[0] || '').trim();
    if (cell.length >= 3 && cell.length <= 60 && !LIGNES_A_IGNORER.test(cell) && !/^\d+$/.test(cell)) {
      const nettoye = nettoyerNomDetecte(cell);
      if (nettoye) return nettoye;
    }
  }
  return null;
}

// Raison sociale suivie de sa forme juridique (S.A.R.L., SARL, SA…),
// typiquement dans le pied de page ("PROMOTILE S.A.R.L. KM 12 Rte…",
// "CRISTAL CERAME s.a.r.l. au capital de…"). Ce texte de pied de page est
// en général bien plus fiable pour l'OCR qu'un logo stylisé en en-tête (qui
// mélange souvent un pictogramme et du texte), donc on le préfère quand il
// est disponible.
function guessNomEmetteurPiedDePage(text) {
  const m = text.match(/([A-ZÀ-Ü][A-Za-zÀ-ÿ0-9 &'\-]{2,50}?)\s+s\.?\s*a\.?\s*r\.?\s*l\.?\b/i);
  return m ? nettoyerNomDetecte(m[1]) : null;
}

export function guessNomEmetteur(rows, text = '') {
  const piedDePage = text ? guessNomEmetteurPiedDePage(text) : null;
  const logo = guessNomEmetteurLogo(rows);
  // Le nom du pied de page est préféré s'il est au moins aussi long que
  // celui détecté en logo (un logo mal reconnu type "Promo" tronque
  // souvent la vraie raison sociale, ex. "PROMOTILE").
  if (piedDePage && (!logo || piedDePage.length >= logo.length)) return piedDePage;
  return logo || piedDePage;
}

export function extractFactureFields(text, rows) {
  let montantHt = guessMontantHT(text, rows);
  let ttc = guessMontantTTC(text, rows);
  let tva = guessTva(text, rows);
  const date = guessDate(text, rows);
  const numero = guessNumeroFacture(text, rows);
  const { mode, piece } = guessModeReglementEtPiece(text);
  const ice = guessIce(text);
  const nomClient = guessNomClient(text);
  const nomEmetteur = guessNomEmetteur(rows, text);

  // Filet de sécurité : si les 3 montants n'ont pas pu être associés
  // correctement à leur libellé (typiquement HT et TTC identiques, ou HT
  // supérieur au TTC — impossible dès qu'il y a de la TVA), on retente une
  // lecture positionnelle du triplet HT/TVA/TTC (voir extraireTripletTotal).
  const incoherent = montantHt != null && ttc != null && (montantHt >= ttc);
  if ((montantHt == null || ttc == null || incoherent)) {
    const triplet = extraireTripletTotal(rows);
    if (triplet) {
      montantHt = triplet.ht;
      ttc = triplet.ttc;
      tva = { taux: triplet.taux || tva.taux, montant: triplet.tva };
    }
  }

  // Dernier recours : tableau des totaux introuvable à l'OCR mais une seule
  // ligne d'article détectée sur le document -> son dernier montant est le
  // Total TTC (voir guessMontantDepuisLigneUnique).
  if (ttc == null) {
    const ligneUnique = guessMontantDepuisLigneUnique(rows);
    if (ligneUnique != null) ttc = ligneUnique;
  }

  let taux = tva.taux;
  // Le taux normal (20%) est de très loin le plus courant sur les factures
  // marocaines et c'est déjà la valeur par défaut proposée ailleurs dans le
  // formulaire (voir emptyFactureForm) : quand le TTC a pu être détecté
  // mais qu'aucun taux ne l'a été (tableau des totaux illisible par l'OCR),
  // on suppose 20% plutôt que de laisser le montant HT vide — l'utilisateur
  // reste libre de corriger le taux si la facture en indique un autre.
  if (taux == null && ttc != null) taux = '20';
  if (montantHt == null && ttc != null && taux != null) {
    montantHt = Math.round((ttc / (1 + Number(taux) / 100)) * 100) / 100;
  }
  if (montantHt == null && ttc != null && tva.montant != null) {
    montantHt = Math.round((ttc - tva.montant) * 100) / 100;
  }

  return {
    montant_ht: montantHt,
    montant_ttc: ttc,
    montant_tva: tva.montant,
    taux_tva: taux,
    date_facture: date,
    numero_piece: numero,
    mode_paiement: mode,
    piece_reglement: piece,
    ice_client: ice.premier,
    ice_emetteur: ice.dernier,
    nom_client: nomClient,
    nom_emetteur: nomEmetteur,
  };
}
