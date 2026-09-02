import { createWorker } from 'tesseract.js';
import { loadPdf, extractPdfPagePositioned, renderPageToCanvas, fileToCanvas, preprocessCanvasForOcr, upscaleCanvasIfSmall } from './pdfExtract';

// Extraction des opérations d'un relevé bancaire marocain (CIH, Attijari,
// BMCE, Bank Of Africa, Banque Populaire, CFG, Saham…) à partir des lignes
// positionnées d'un PDF texte (voir extractPdfPagePositioned dans
// pdfExtract.js). Le repère clé : une même ligne ne contient JAMAIS deux
// montants (une opération est soit un débit, soit un crédit) — on utilise
// donc la position x du montant pour savoir dans quelle colonne il tombe.

// Un OCR même de bonne qualité confond régulièrement certaines lettres et
// chiffres qui se ressemblent (O/0, G/6, S/5, B/8, I·l/1, Z/2) — surtout
// sur un scan de qualité moyenne. On ne corrige cette confusion que dans
// les jetons COURTS et MAJORITAIREMENT numériques (donc très probablement
// une date ou un montant mal lus), jamais dans un mot ordinaire, pour ne
// pas corrompre les libellés.
const CONFUSIONS_OCR = { O: '0', o: '0', I: '1', l: '1', S: '5', s: '5', B: '8', G: '6', g: '6', Z: '2', z: '2' };
function normaliserJetonNumerique(token) {
  if (!token || token.length > 8) return token;
  const car = [...token];
  const ressembleChiffre = car.filter((c) => /\d/.test(c) || CONFUSIONS_OCR[c]).length;
  if (ressembleChiffre < car.length * 0.6) return token;
  return car.map((c) => CONFUSIONS_OCR[c] || c).join('');
}

// Montant : accepte indifféremment le format marocain/français ("20 000,00"
// ou "20.000,00", séparateur de milliers espace/point, décimales avec
// virgule) ET le format anglo-saxon utilisé par certaines banques comme CFG
// ("1,330.15", virgule pour les milliers, point pour les décimales) — les
// deux se distinguent uniquement au moment de la conversion (toNumber), pas
// à la détection, donc on accepte virgule ET point comme séparateur.
const MONTANT_RE = /^\d{1,3}(?:[\s.,\u00A0]\d{3})*[.,]\d{2}$/;
// Repli tolérant : la même chose mais en autorisant un caractère parasite
// isolé (une marque de scan mal filtrée) avant ou après le nombre lui-même
// — utilisé cellule par cellule pour ne pas perdre une ligne entière à
// cause d'un seul caractère de bruit collé au montant par l'OCR.
const MONTANT_TOLERANT_RE = /^.{0,2}?(\d{1,3}(?:[\s.,\u00A0]\d{3})*[.,]\d{2}).{0,2}$/;

function montantDeCellule(text) {
  const normalise = normaliserJetonNumerique(text);
  if (MONTANT_RE.test(normalise)) return normalise;
  const m = normalise.match(MONTANT_TOLERANT_RE);
  return m ? m[1] : null;
}

function toNumber(raw) {
  const cleaned = raw.replace(/[\s\u00A0]/g, '');
  const m = cleaned.match(/^(\d+(?:[.,]\d{3})*)[.,](\d{2})$/);
  if (!m) return null;
  return Number(`${m[1].replace(/[.,]/g, '')}.${m[2]}`);
}

// Mots-clés typiques d'une opération sortante (débit) — utilisés en repli
// quand on ne dispose ni de colonnes DEBIT/CREDIT explicites ni d'une
// disposition en deux colonnes détectable (voir detecterColonnesMontant).
const MOTS_DEBIT = /virement\s*(instantane\s*)?emis|commission|frais|prelevement|prlv/i;
// "remise à l'encaissement" (chèque/LCN déposé -> crédité), versement,
// virement reçu : signaux forts de crédit, prioritaires même si le libellé
// contient par ailleurs le mot "paiement" (ex: "PAIEMENT LCN REMISE A
// L'ENCAISSEMENT" est un encaissement, donc un crédit).
const MOTS_CREDIT_FORT = /remise\s*a\s*l[’'\s]?encaissement|effet[s]?\s*remis|virement\s*(instantane\s*)?recu|versement/i;
const MOTS_CREDIT = /remise|versement|encaissement/i;
const MOTS_DEBIT_FAIBLE = /paiement|retrait|cheque\s*n/i;

const LIGNES_A_IGNORER = /\bsolde\b|total\s*(des\s*)?mouvements?|page\s*n|^dates?$|oper\s*valeur/i;

// Solde initial ("ancien solde", "solde précédent", "solde de départ"…) et
// solde final ("nouveau solde", "solde de clôture"…) : ces lignes sont
// délibérément exclues des OPÉRATIONS (LIGNES_A_IGNORER ci-dessus, une ligne
// de solde n'est pas un mouvement) mais elles portent une information utile
// à afficher et à vérifier — le solde de départ doit en particulier
// correspondre à ce que Saisie Relevé Bancaire calcule à partir des
// écritures déjà enregistrées, et un écart révèle un mouvement manquant. Les
// libellés varient beaucoup d'une banque marocaine à l'autre, d'où la liste
// assez large de synonymes.
const RE_SOLDE_INITIAL = /solde\s*(?:ancien|initial|pr[ée]c[ée]dent|de\s*d[ée]part|au\s*d[ée]but|d[ée]but\s*de\s*p[ée]riode)|ancien\s*solde|report\s*(?:de\s*)?solde/i;
const RE_SOLDE_FINAL = /solde\s*(?:final|nouveau|de\s*cl[ôo]ture|actuel|fin\s*de\s*p[ée]riode|arr[êe]t[ée]?)|nouveau\s*solde/i;

// Cherche, parmi des lignes positionnées ({ text, x }[][]), une ligne dont le
// texte correspond au libellé recherché, puis le DERNIER montant de cette
// ligne (le solde est en général le seul ou le dernier nombre de la ligne —
// une éventuelle date de valeur qui précède n'a pas le format décimal d'un
// montant et n'est donc jamais confondue avec lui par montantDeCellule).
function soldeDepuisLignes(rows, labelRegex) {
  for (const row of rows || []) {
    const texteLigne = row.map((c) => c.text).join(' ');
    if (!labelRegex.test(texteLigne)) continue;
    const montants = row.map((c) => montantDeCellule(c.text)).filter(Boolean);
    if (montants.length > 0) return toNumber(montants[montants.length - 1]);
  }
  return null;
}

// Repli en texte brut (pas de lignes positionnées disponibles — OCR sans
// bounding boxes, ou relevé texte simple) : même principe, ligne par ligne.
function soldeDepuisTexte(texte, labelRegex) {
  for (const ligneBrute of (texte || '').split(/\r?\n/)) {
    const ligne = ligneBrute.trim();
    if (!ligne || !labelRegex.test(ligne)) continue;
    const montants = [...ligne.matchAll(/(\d{1,3}(?:[\s.,\u00A0]\d{3})*[.,]\d{2})/g)];
    if (montants.length > 0) return toNumber(montants[montants.length - 1][1]);
  }
  return null;
}

// Extrait le solde initial et le solde final d'une page, en préférant les
// lignes positionnées (plus fiables : le montant est isolé dans sa propre
// cellule) et en repliant sur le texte brut si elles ne sont pas
// disponibles ou n'ont rien donné.
export function extraireSoldesDePage(rows, texteLigne) {
  return {
    soldeInitial: soldeDepuisLignes(rows, RE_SOLDE_INITIAL) ?? soldeDepuisTexte(texteLigne, RE_SOLDE_INITIAL),
    soldeFinal: soldeDepuisLignes(rows, RE_SOLDE_FINAL) ?? soldeDepuisTexte(texteLigne, RE_SOLDE_FINAL),
  };
}

function deviner_sens(libelle) {
  if (MOTS_DEBIT.test(libelle)) return 'debit';
  if (MOTS_CREDIT_FORT.test(libelle)) return 'credit';
  if (MOTS_DEBIT_FAIBLE.test(libelle)) return 'debit';
  if (MOTS_CREDIT.test(libelle)) return 'credit';
  return 'debit'; // par défaut : la plupart des lignes d'un relevé sont des sorties
}

function extraireAnnee(text) {
  const m =
    text.match(/(?:au|le)\s*:?\s*\d{2}[/.\- ]\d{2}[/.\- ](\d{4})/i) || text.match(/\b(20\d{2})\b/);
  return m ? m[1] : String(new Date().getFullYear());
}

// Les libellés imprimés par certaines banques sont très verbeux (agence,
// ville, date et heure déjà présentes par ailleurs dans la ligne du
// relevé) — on garde l'essentiel plutôt que de recopier tout le texte brut,
// ex : "Retrait Guichet Automatique BCP B C P BP BETTANA le 03/04 10:47" ->
// "Retrait GAB BCP". Seuls les cas très répétitifs et peu informatifs sont
// raccourcis ; les libellés avec un tiers/bénéficiaire (virements,
// paiements carte, prélèvements) sont conservés tels quels, ce nom étant
// justement ce qui importe pour la comptabilité et le lettrage.
const RACCOURCIS_LIBELLE = [
  [/retrait\s+guichet\s+automatique\s+([a-zàâéèêëîïôöùûüç]+)/i, (m) => `Retrait GAB ${m[1].toUpperCase()}`],
  [/retrait\s+guichet\s+automatique\b/i, () => 'Retrait GAB'],
  [/retrait\s+d.?esp[eè]ces\s+aupr[eè]s\s+(d.?un\s+gab\s+confr[eè]re|d.?un\s+gab|de\s+gab)\b/i, () => 'Retrait GAB confrère'],
  [/frais\s+de\s+retrait\s+gab\s+confr[eè]re\b/i, () => 'Frais retrait GAB confrère'],
  [/frais\s+de\s+timbre\s+sur\s+versement\s+d.?esp[eè]ces?\b/i, () => 'Frais de timbre sur versement'],
  [/versement\s+d.?esp[eè]ces?\b/i, () => 'Versement espèces'],
  [/versement\s+esp[eè]ces?\b/i, () => 'Versement espèces'],
];

// Repère un des motifs verbeux connus n'IMPORTE OÙ dans le libellé (pas
// seulement en tout début) : la plupart des relevés font précéder le
// libellé d'un code ou numéro de référence collé à la même cellule (ex :
// "068411 VERSEMENT ESPECE N 973568322", "203751086 Retrait Guichet
// Automatique BCP…") — le motif reste identifiable ailleurs dans la chaîne.
function raccourcirLibelle(libelle) {
  for (const [re, build] of RACCOURCIS_LIBELLE) {
    const m = libelle.match(re);
    if (m) return build(m);
  }
  return libelle;
}

// Beaucoup de relevés (CIH notamment) impriment la date d'opération et la
// date de valeur collées l'une à l'autre, sans espace ni séparateur
// ("30/0430/04" = 30/04 puis 30/04). D'autres (Bank Of Africa, Attijariwafa)
// n'impriment carrément AUCUN séparateur entre jour et mois ("01 08" pour le
// 1er août) et collent souvent un code d'opération devant ("068411 01 08").
// On raisonne donc par JETONS (texte découpé sur les espaces) plutôt que par
// simple expression régulière ancrée en début de cellule, avec validation
// des plages jour (1-31) / mois (1-12) pour éviter les faux positifs.
function extraireDateDeCellule(text) {
  const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
  // Jetons normalisés (O→0, G→6…) utilisés uniquement pour la DÉTECTION —
  // le texte d'origine reste ce qui est retiré du libellé (reste), pour ne
  // jamais réécrire silencieusement un mot ordinaire.
  const tokensNorm = tokens.map(normaliserJetonNumerique);

  // Cas 1 : un jeton contient déjà jour + séparateur + mois (+ année) —
  // "29/03/2026", "01.08.25", "30/0430/04" (deux dates collées : on ne garde
  // que la première, la date d'opération).
  for (let i = 0; i < tokens.length; i += 1) {
    const m = tokensNorm[i].match(/^(\d{2})[/.\-](\d{2})(?:[/.\-](\d{2,4}))?/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const resteToken = tokens[i].slice(m[0].length);
        const reste = [resteToken, ...tokens.slice(0, i), ...tokens.slice(i + 1)].filter(Boolean).join(' ');
        return { day: m[1], month: m[2], year: m[3] || null, reste };
      }
    }
  }

  // Cas 2 : deux jetons distincts purement numériques à 2 chiffres,
  // consécutifs, sans séparateur imprimé entre eux ("01" "08" = 1er août),
  // éventuellement suivis d'un troisième jeton "année" (4 ou 2 chiffres).
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (/^\d{2}$/.test(tokensNorm[i]) && /^\d{2}$/.test(tokensNorm[i + 1])) {
      const day = Number(tokensNorm[i]);
      const month = Number(tokensNorm[i + 1]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        let year = null;
        let consumed = 2;
        if (tokensNorm[i + 2] && /^\d{4}$/.test(tokensNorm[i + 2])) {
          year = tokensNorm[i + 2];
          consumed = 3;
        }
        const reste = [...tokens.slice(0, i), ...tokens.slice(i + consumed)].filter(Boolean).join(' ');
        return { day: tokensNorm[i], month: tokensNorm[i + 1], year, reste };
      }
    }
  }

  return null;
}

// Quand aucun en-tête "Débit"/"Crédit" n'est extractible en texte (fréquent
// sur les relevés dont le tableau est en partie une image — Bank Of Africa,
// Attijariwafa…), on retrouve quand même les deux colonnes en regroupant les
// positions x de tous les montants du document : le plus grand écart entre
// deux positions x triées sépare la colonne débit (à gauche) de la colonne
// crédit (à droite) — convention quasi universelle des relevés marocains.
function detecterColonnesMontant(rows) {
  let xDebit = null;
  let xCredit = null;
  for (const row of rows) {
    for (const cell of row) {
      if (/^d[ée]bit/i.test(cell.text)) xDebit = cell.x;
      if (/^cr[ée]dit/i.test(cell.text)) xCredit = cell.x;
    }
    if (xDebit != null && xCredit != null) return { xDebit, xCredit };
  }

  const xs = [];
  for (const row of rows) {
    for (const cell of row) {
      if (montantDeCellule(cell.text)) xs.push(cell.x);
    }
  }
  if (xs.length < 4) return { xDebit: null, xCredit: null };
  xs.sort((a, b) => a - b);
  let bestGap = 0;
  let splitAt = -1;
  for (let i = 1; i < xs.length; i += 1) {
    const gap = xs[i] - xs[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      splitAt = i;
    }
  }
  if (splitAt === -1 || bestGap < 20) return { xDebit: null, xCredit: null };
  const gauche = xs.slice(0, splitAt);
  const droite = xs.slice(splitAt);
  if (gauche.length < 2 || droite.length < 2) return { xDebit: null, xCredit: null };
  const moyenne = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return { xDebit: moyenne(gauche), xCredit: moyenne(droite) };
}

// À partir de lignes positionnées ({ text, x }[][]) pour un relevé PDF natif
// ou un relevé scanné passé à l'OCR avec positions des mots.
export function parseReleveDepuisLignesPositionnees(rows, texteComplet) {
  const { xDebit, xCredit } = detecterColonnesMontant(rows);
  const annee = extraireAnnee(texteComplet);
  const operations = [];

  for (const row of rows) {
    const texteLigne = row.map((c) => c.text).join(' ');
    if (!texteLigne.trim() || LIGNES_A_IGNORER.test(texteLigne)) continue;

    // Une ligne d'opération contient, dans l'une de ses cellules, une date
    // (jour/mois, avec ou sans séparateur imprimé, avec ou sans année) — on
    // prend la première trouvée dans l'ordre des colonnes (= la date
    // d'opération, toujours la plus à gauche sur tous les formats vus).
    let dateCell = null;
    let dateInfo = null;
    for (const c of row) {
      const info = extraireDateDeCellule(c.text);
      if (info) {
        dateCell = c;
        dateInfo = info;
        break;
      }
    }
    if (!dateCell) continue;
    const annee4 = dateInfo.year ? (dateInfo.year.length === 2 ? `20${dateInfo.year}` : dateInfo.year) : annee;
    const date = `${annee4}-${dateInfo.month}-${dateInfo.day}`;

    // Le(s) montant(s) de la ligne. On tolère un caractère de bruit isolé
    // collé au nombre par l'OCR (cellule non "pure" mais dominée par un
    // montant valide) avant de conclure qu'aucune cellule n'en contient. Si
    // malgré tout aucune cellule n'est reconnaissable comme montant (arrive
    // quand une ligne de libellé très longue laisse trop peu d'espace avant
    // le chiffre pour former une colonne séparée — le nombre reste collé au
    // texte, ex : "...147... 15,000.00"), on tente de détacher un montant
    // en fin de la dernière cellule. Dans ce cas, la position x du montant
    // n'est pas fiable (elle vient du DÉBUT de la cellule fusionnée) : on
    // décide alors le sens par mots-clés plutôt que par distance aux
    // colonnes DEBIT/CREDIT.
    let montants = row
      .map((c) => {
        const m = montantDeCellule(c.text);
        return m ? { text: m, x: c.x, __source: c } : null;
      })
      .filter(Boolean);
    let montantCell = montants[montants.length - 1];
    let positionIncertaine = false;
    if (!montantCell) {
      const derniere = row[row.length - 1];
      const m = derniere && derniere !== dateCell ? derniere.text.match(/^(.*?)\s*(\d{1,3}(?:[\s.,\u00A0]\d{3})*[.,]\d{2})$/) : null;
      if (m && m[1].trim()) {
        montantCell = { text: m[2], x: derniere.x, __prefixe: m[1].trim(), __source: derniere };
        positionIncertaine = true;
      }
    }
    if (!montantCell) continue;

    // Libellé : le reste du texte de la cellule "date" une fois la date
    // retirée, + les autres cellules qui ne sont ni une autre date "pure"
    // (ex : colonne Date valeur, qui ne contient QUE une date) ni le
    // montant. Une cellule de libellé qui contient par ailleurs une date
    // (ex : "PAIEMENT CB 07/08/25 COMMERCANT") n'est PAS exclue : on ne
    // retire que les cellules entièrement consommées par la date détectée
    // (reste vide), pas celles où la date n'est qu'un fragment du texte.
    const estCelluleDatePure = (c) => {
      const info = extraireDateDeCellule(c.text);
      return info != null && info.reste.trim() === '';
    };
    const sourceMontant = montantCell.__source || montantCell;
    const libelle = [
      dateInfo.reste,
      montantCell.__prefixe || null,
      ...row
        .filter((c) => c !== dateCell && c !== sourceMontant && !estCelluleDatePure(c) && !MONTANT_RE.test(c.text))
        .map((c) => c.text),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    let debit = 0;
    let credit = 0;
    const montant = toNumber(montantCell.text);
    if (!positionIncertaine && xDebit != null && xCredit != null) {
      const distDebit = Math.abs(montantCell.x - xDebit);
      const distCredit = Math.abs(montantCell.x - xCredit);
      if (distDebit <= distCredit) debit = montant;
      else credit = montant;
    } else if (deviner_sens(libelle) === 'credit') {
      credit = montant;
    } else {
      debit = montant;
    }

    if (!libelle) continue;
    if (!montant || Number.isNaN(montant)) continue; // pas de montant exploitable : mieux vaut ignorer la ligne que garder un 0,00 fantôme
    operations.push({ date, libelle: raccourcirLibelle(libelle), debit, credit });
  }

  return operations;
}

// Regroupe les mots d'une ligne OCR (avec leur bbox en pixels canvas) en
// "cellules" comme reconstructRowsWithPositions le fait pour un PDF texte :
// les mots proches (même colonne) sont fusionnés, un grand espacement
// horizontal signale une nouvelle colonne. Indispensable pour retrouver les
// colonnes DEBIT / CREDIT d'un relevé, que l'OCR ne connaît pas nativement.
const OCR_COLUMN_GAP_PX = 30; // ~12pt à l'échelle de rendu (3x) utilisée pour l'OCR

// Un scan de qualité moyenne produit souvent, en plus du vrai texte, de
// petites marques parasites reconnues comme des "mots" isolés d'un ou deux
// caractères de ponctuation pure (', |, \, ~, {, }...) — un bruit de fond
// du papier, un artefact de compression, une trace de pliure. Regroupées
// avec la cellule voisine (le montant, la date...), elles empêchent celle-
// ci de correspondre exactement au motif attendu. On les élimine avant
// reconstruction des cellules plutôt que d'essayer de les tolérer partout.
const MOT_PARASITE_RE = /^[|{}'"´`~^;:!\\]{1,2}$/;

function groupOcrWordsIntoCells(words) {
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const cells = [];
  let current = '';
  let startX = null;
  let lastX = null;
  for (const w of sorted) {
    const text = (w.text || '').trim();
    if (!text || MOT_PARASITE_RE.test(text)) continue;
    if (lastX !== null && w.bbox.x0 - lastX > OCR_COLUMN_GAP_PX) {
      cells.push({ text: current.trim(), x: startX });
      current = '';
      startX = null;
    }
    if (startX === null) startX = w.bbox.x0;
    current += (current ? ' ' : '') + text;
    lastX = w.bbox.x1;
  }
  if (current) cells.push({ text: current.trim(), x: startX });
  return cells;
}

// Aplati la hiérarchie blocks > paragraphs > lines renvoyée par Tesseract
// (quand on demande `{ blocks: true }`) en une simple liste de lignes, dans
// l'ordre de lecture (haut en bas).
function linesFromOcrBlocks(blocks) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        if (line.words && line.words.length > 0) lines.push(line);
      }
    }
  }
  return lines;
}

// Construit les lignes { text, x }[][] à partir du résultat détaillé de
// Tesseract (avec bounding boxes), pour pouvoir réutiliser exactement le
// même algorithme de reconnaissance des colonnes DEBIT/CREDIT que pour un
// PDF texte natif (parseReleveDepuisLignesPositionnees). Si aucune bbox
// n'est disponible (config sans `blocks: true`, ou page vide), on retombe
// sur le texte brut ligne à ligne (ancien comportement, moins précis).
export function parseReleveDepuisResultatOcr(ocrData, texteComplet) {
  const rows = lignesDepuisResultatOcr(ocrData);
  if (!rows) return parseReleveDepuisTexte(ocrData?.text || texteComplet || '');
  return parseReleveDepuisLignesPositionnees(rows, texteComplet || ocrData?.text || '');
}

// Reconstruit les lignes { text, x }[][] à partir d'un résultat Tesseract
// (voir parseReleveDepuisResultatOcr) — extrait à part pour pouvoir aussi
// s'en servir pour repérer les lignes de solde (extraireSoldesDePage), qui
// ont besoin des mêmes lignes positionnées que la reconnaissance des
// opérations, sans refaire l'OCR une seconde fois.
function lignesDepuisResultatOcr(ocrData) {
  const ocrLines = linesFromOcrBlocks(ocrData?.blocks);
  if (ocrLines.length === 0) return null;
  return ocrLines.map((line) => groupOcrWordsIntoCells(line.words));
}

// Extraction complète d'un fichier de relevé bancaire (PDF ou image) : lit
// chaque page en conservant la position des colonnes pour distinguer DEBIT
// et CREDIT ; si une page est scannée (pas de texte sélectionnable), on
// utilise l'OCR (tesseract.js, avec les positions des mots pour reconstruire
// les colonnes comme pour un PDF texte). Chaque page est traitée
// indépendamment et son nombre d'opérations reconnues est renvoyé dans
// `pages`, pour que l'écran de scan puisse signaler une page où rien n'a été
// détecté (relevé multi-pages : rien n'est ignoré silencieusement).
export async function extractReleveDocument(file, { onStatus, onProgress } = {}) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let operations = [];
  let texteComplet = '';
  const pages = [];
  // Solde initial : on garde le PREMIER trouvé (en général en tête de la
  // première page). Solde final : on garde le DERNIER trouvé (chaque page
  // peut afficher son propre "nouveau solde" intermédiaire ; seul celui de
  // la toute dernière page correspond au solde de clôture réel du relevé).
  let soldeInitial = null;
  let soldeFinal = null;

  async function ocrImage(image, lang) {
    const worker = await createWorker(lang, 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
      },
    });
    // `blocks: true` donne accès aux bounding boxes mot par mot (data.blocks
    // > paragraphs > lines > words), indispensables pour distinguer les
    // colonnes DEBIT/CREDIT en OCR — par défaut Tesseract.js ne renvoie que
    // le texte brut.
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    await worker.terminate();
    return data;
  }

  // Selon le scan, le modèle "fra" ou le modèle "eng" de Tesseract peut
  // donner un bien meilleur résultat que l'autre pour LIRE LES MONTANTS
  // (le modèle français perd parfois la virgule décimale sur certains
  // relevés scannés — ex : "250,00" lu "25000" — là où le modèle anglais la
  // conserve, sans que l'inverse soit vrai sur d'autres documents). On
  // tente donc les deux et on garde celui qui reconnaît le plus de lignes
  // valides pour cette page, plutôt que de figer un seul choix qui
  // pourrait être le pire des deux selon le document.
  async function meilleurOcr(image, texteAvant) {
    const [eng, fra] = await Promise.all([ocrImage(image, 'eng'), ocrImage(image, 'fra')]);
    const opsEng = parseReleveDepuisResultatOcr(eng, texteAvant + (eng.text || ''));
    const opsFra = parseReleveDepuisResultatOcr(fra, texteAvant + (fra.text || ''));
    const gagnant = opsEng.length >= opsFra.length ? { data: eng, ops: opsEng } : { data: fra, ops: opsFra };
    return { ...gagnant, rows: lignesDepuisResultatOcr(gagnant.data) };
  }

  if (isPdf) {
    const pdf = await loadPdf(file);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onStatus?.(`Lecture de la page ${pageNumber} / ${pdf.numPages}…`);
      const { rows, needsOcr } = await extractPdfPagePositioned(pdf, pageNumber);
      let pageOps;
      let pageRows = rows;
      let pageTexte = '';
      if (!needsOcr && rows.length > 0) {
        pageTexte = rows.map((r) => r.map((c) => c.text).join(' ')).join('\n');
        texteComplet += pageTexte + '\n';
        pageOps = parseReleveDepuisLignesPositionnees(rows, texteComplet);
      } else {
        onStatus?.(`Page ${pageNumber} / ${pdf.numPages} scannée — reconnaissance OCR en cours…`);
        const page = await pdf.getPage(pageNumber);
        const canvas = preprocessCanvasForOcr(await renderPageToCanvas(page));
        const { data, ops, rows: ocrRows } = await meilleurOcr(canvas, texteComplet);
        pageTexte = data.text || '';
        texteComplet += pageTexte + '\n';
        pageOps = ops;
        pageRows = ocrRows;
      }
      pageOps = pageOps.map((op) => ({ ...op, page: pageNumber }));
      pages.push({ page: pageNumber, count: pageOps.length });
      operations = operations.concat(pageOps);
      // Solde initial/final : on cherche sur CHAQUE page (pas seulement la
      // première/dernière), certains relevés répétant le solde de départ en
      // en-tête de chaque page ou n'affichant le solde de clôture qu'en pied
      // de la dernière — voir le commentaire au début de la fonction pour la
      // règle de choix entre plusieurs valeurs trouvées.
      const soldesPage = extraireSoldesDePage(pageRows, pageTexte);
      if (soldeInitial == null && soldesPage.soldeInitial != null) soldeInitial = soldesPage.soldeInitial;
      if (soldesPage.soldeFinal != null) soldeFinal = soldesPage.soldeFinal;
    }
  } else {
    onStatus?.('Reconnaissance OCR en cours…');
    const canvas = preprocessCanvasForOcr(upscaleCanvasIfSmall(await fileToCanvas(file)));
    const { data, ops, rows } = await meilleurOcr(canvas, '');
    texteComplet = data.text || '';
    operations = ops.map((op) => ({ ...op, page: 1 }));
    pages.push({ page: 1, count: operations.length });
    const soldes = extraireSoldesDePage(rows, texteComplet);
    soldeInitial = soldes.soldeInitial;
    soldeFinal = soldes.soldeFinal;
  }

  return { operations, texteComplet, pages, soldeInitial, soldeFinal };
}
// un seul montant en fin de ligne, signe déduit par mots-clés.
export function parseReleveDepuisTexte(text) {
  const annee = extraireAnnee(text);
  const operations = [];
  for (const ligneBrute of text.split(/\r?\n/)) {
    const ligne = ligneBrute.trim();
    if (!ligne || LIGNES_A_IGNORER.test(ligne)) continue;
    // Date opération, éventuellement suivie — avec ou sans espace/séparateur —
    // de la date de valeur (relevés CIH : "30/0430/04 LIBELLÉ ... 33,00").
    // On tolère jusqu'à quelques caractères parasites avant la date (OCR de
    // page scannée : puce, coche, numéro de ligne mal reconnu…) plutôt que
    // d'exiger la date en tout premier caractère, sous peine de perdre des
    // lignes entières sur les pages les plus mal scannées.
    const m = ligne.match(
      /^[^\d]{0,4}(\d{2})[/.\-](\d{2})(?:[/.\-]\d{2,4})?\s*(?:\d{2}[/.\-]\d{2}(?:[/.\-]\d{2,4})?)?\s*(.+?)\s+(\d{1,3}(?:[\s.,\u00A0]\d{3})*[.,]\d{2})$/
    );
    if (!m) continue;
    const [, jj, mm, libelleRaw, montantRaw] = m;
    const libelle = raccourcirLibelle(libelleRaw.trim());
    const montant = toNumber(montantRaw);
    if (montant == null || !libelle) continue;
    const isCredit = deviner_sens(libelle) === 'credit';
    operations.push({
      date: `${annee}-${mm}-${jj}`,
      libelle,
      debit: isCredit ? 0 : montant,
      credit: isCredit ? montant : 0,
    });
  }
  return operations;
}
