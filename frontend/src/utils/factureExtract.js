// Heuristiques d'extraction des champs d'une facture à partir du texte détecté
// (PDF texte ou OCR). Ce ne sont que des estimations : l'utilisateur doit
// toujours vérifier les champs avant d'enregistrer — mais on essaie ici de
// coller aux formats réellement utilisés sur les factures marocaines
// (Total H.T / T.V.A xx% / Total T.T.C, Numéro de facture, ICE, Client :…),
// y compris quand le nom de l'émetteur est en gros caractères (logo/entête)
// plutôt que précédé d'un mot-clé.

const MONTANT = String.raw`(\d{1,3}(?:[\s.]\d{3})*[.,]\d{2})`;

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

// Cherche `label` suivi (à quelques caractères ou une ligne près) d'un
// montant, et renvoie le nombre. On tolère un saut de ligne entre le libellé
// et le montant (mise en page en tableau/colonnes).
function montantApresLabel(text, labelRegexSrc) {
  const re = new RegExp(`${labelRegexSrc}[\\s\\S]{0,25}?${MONTANT}`, 'gi');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  return toNumber(matches[matches.length - 1][1]);
}

export function guessMontantHT(text) {
  return (
    montantApresLabel(text, String.raw`total\s*h\.?\s*t\.?`) ??
    montantApresLabel(text, String.raw`montant\s*h\.?t\.?`) ??
    montantApresLabel(text, String.raw`(?<!t\.?)\bh\.?t\.?\s*:?`)
  );
}

export function guessMontantTTC(text) {
  return (
    montantApresLabel(text, String.raw`total\s*t\.?\s*t\.?\s*c\.?`) ??
    montantApresLabel(text, String.raw`total\s*(?:a|à)\s*payer`) ??
    montantApresLabel(text, String.raw`net\s*(?:a|à)\s*payer`) ??
    montantApresLabel(text, String.raw`montant\s*t\.?t\.?c\.?`) ??
    montantApresLabel(text, String.raw`\bt\.?\s*t\.?\s*c\.?\s*:?`)
  );
}

// Le taux ET le montant de TVA sont souvent sur la même ligne : "T.V.A 20% : 8 458,33"
export function guessTva(text) {
  const combine = text.match(new RegExp(String.raw`t\.?v\.?a\.?\s*(\d{1,2})\s*%[\s\S]{0,20}?${MONTANT}`, 'i'));
  if (combine) return { taux: combine[1], montant: toNumber(combine[2]) };
  const tauxSeul = text.match(/t\.?v\.?a\.?\D{0,10}(\d{1,2})\s*%/i);
  return { taux: tauxSeul ? tauxSeul[1] : null, montant: null };
}

export function guessDate(text) {
  // Priorité aux dates explicitement associées à la facture
  const labelled = text.match(/date\s*(?:de\s*)?(?:la\s*)?facture\s*:?[\s\S]{0,15}?(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  if (labelled) return `${labelled[3]}-${labelled[2]}-${labelled[1]}`;
  const saleLe = text.match(/\b(?:le|à)\s*(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  if (saleLe) return `${saleLe[3]}-${saleLe[2]}-${saleLe[1]}`;
  // Sinon la première date qui n'est pas juste après "N°"/"facture n"
  const all = [...text.matchAll(/(\d{2})[/.\-](\d{2})[/.\-](\d{4})/g)];
  if (all.length > 0) {
    const [d, mo, y] = [all[0][1], all[0][2], all[0][3]];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

export function guessNumeroFacture(text) {
  const m =
    text.match(/num[ée]ro\s*de\s*facture\s*:?[\s\S]{0,15}?([A-Z0-9]{0,6}\d[A-Z0-9\-/]{0,12})/i) ||
    text.match(/facture\s*n[°ºo]\s*:?[\s\S]{0,10}?([A-Z0-9]{0,6}\d[A-Z0-9\-/]{0,12})/i);
  if (!m) return null;
  // Écarte un faux positif qui serait en fait une date (ex: "20/06/2026")
  if (/^\d{2}[/.\-]\d{2}[/.\-]\d{4}$/.test(m[1])) return null;
  return m[1];
}

export function guessModeReglementEtPiece(text) {
  const m = text.match(/(ch[eè]que|virement|esp[eè]ce|effet|carte)\D{0,12}n[°ºo]?\s*:?\s*([A-Z0-9]{3,15})/i);
  if (!m) return { mode: null, piece: null };
  const modeMap = { 'chèque': 'Chèque', 'cheque': 'Chèque', virement: 'Virement', 'espèce': 'Espèce', espece: 'Espèce', effet: 'Effet', carte: 'Carte Bancaire' };
  return { mode: modeMap[m[1].toLowerCase()] || m[1], piece: m[2] };
}

// Tous les ICE (15 chiffres) trouvés, dans l'ordre d'apparition. Sur une
// facture marocaine standard, le premier ICE rencontré est en général celui
// du client (juste sous "Client :"), le dernier celui de l'émetteur (bloc
// pied de page avec RC/IF/TP/ICE).
export function guessIce(text) {
  const all = [...text.matchAll(/ICE\s*:?\s*(\d{15})/gi)].map((m) => m[1]);
  return { premier: all[0] || null, dernier: all[all.length - 1] || null, tous: all };
}

// Nom indiqué après "Client :" — utile pour une facture de vente (nom du
// client) ou pour confirmer le destinataire sur une facture d'achat reçue.
export function guessNomClient(text) {
  const re = /client\s*:?[\s\S]{0,4}?\n?\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ0-9 .&'\-]{2,60})/gi;
  const rejet = /^(facture|date|num[ée]ro|ice|total|mode)/i;
  for (const m of text.matchAll(re)) {
    const val = m[1].trim();
    if (!rejet.test(val)) return val;
  }
  return null;
}

// Nom de l'émetteur (fournisseur) : le plus souvent en toute première ligne
// du document (bandeau/logo texte), avant tout mot-clé "FACTURE"/"Client".
// On écarte les lignes qui ressemblent à un mot-clé de mise en page.
const LIGNES_A_IGNORER = /^(facture|devis|bon\s*de|client|date|num[ée]ro|mode\s*de|total|designation|qte|qu?antit[ée])/i;
export function guessNomEmetteur(rows) {
  for (const row of rows.slice(0, 6)) {
    const cell = (row[0] || '').trim();
    if (cell.length >= 3 && cell.length <= 60 && !LIGNES_A_IGNORER.test(cell) && !/^\d+$/.test(cell)) {
      return cell;
    }
  }
  return null;
}

export function extractFactureFields(text, rows) {
  const ht = guessMontantHT(text);
  const ttc = guessMontantTTC(text);
  const tva = guessTva(text);
  const date = guessDate(text);
  const numero = guessNumeroFacture(text);
  const { mode, piece } = guessModeReglementEtPiece(text);
  const ice = guessIce(text);
  const nomClient = guessNomClient(text);
  const nomEmetteur = guessNomEmetteur(rows);

  let montantHt = ht;
  let taux = tva.taux;
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
