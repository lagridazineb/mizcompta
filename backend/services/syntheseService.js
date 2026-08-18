// Génère le Bilan (Actif/Passif) et le CPC (Compte de Produits et Charges) à partir
// des soldes de comptes, en suivant les grandes masses du Plan Comptable Général Marocain.
//
// Classification par préfixe de numéro de compte (convention PCGM standard) :
//   Bilan - ACTIF
//     Actif immobilisé          : classe 2, hors comptes d'amortissement (28xx)
//     Amortissements (à déduire): comptes commençant par 28
//     Actif circulant (HT)      : classe 3
//     Trésorerie - Actif        : classe 5, comptes à solde débiteur (ex: 5141, 5161)
//   Bilan - PASSIF
//     Financement permanent     : classe 1 (capitaux propres + dettes de financement 148x)
//     Passif circulant          : classe 4
//     Trésorerie - Passif       : classe 5, comptes à solde créditeur (découverts, non présents par défaut)
//   CPC
//     Produits d'exploitation   : 71xx, 712x
//     Charges d'exploitation    : 61xx (hors 631/636 financiers, hors 670 IS)
//     Produits financiers       : 73xx
//     Charges financières       : 631x
//     Produits non courants     : 75xx (hors 751 traité comme non courant ici)
//     Impôt sur les résultats   : 670x
//
// NB : cette classification couvre le jeu de comptes standard fourni avec l'application.
// Si vous ajoutez des comptes personnalisés, vérifiez qu'ils respectent la numérotation PCGM
// pour que la classification reste correcte, ou adaptez les règles ci-dessous.

const { db } = require('../config/db');

function getBalanceUpTo(companyId, dateFin) {
  return db
    .prepare(
      `
    SELECT a.numero, a.intitule, a.classe,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.date_ecriture <= ?
    WHERE a.company_id = ?
    GROUP BY a.id
  `
    )
    .all(dateFin, companyId)
    .map((r) => ({ ...r, solde: r.total_debit - r.total_credit }));
}

function getMovementsBetween(companyId, dateDebut, dateFin) {
  return db
    .prepare(
      `
    SELECT a.numero, a.intitule, a.classe,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.date_ecriture BETWEEN ? AND ?
    WHERE a.company_id = ?
    GROUP BY a.id
  `
    )
    .all(dateDebut, dateFin, companyId)
    .map((r) => ({ ...r, solde: r.total_debit - r.total_credit }));
}

function sumWhere(rows, predicate, use = 'solde') {
  return rows.filter(predicate).reduce((s, r) => s + r[use], 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeBilan(companyId, dateFin, dateDebutExercice) {
  const rows = getBalanceUpTo(companyId, dateFin);
  const dateDebut = dateDebutExercice || `${dateFin.slice(0, 4)}-01-01`;
  // Résultat de l'exercice à la date d'arrêté, calculé comme un CPC "en cours" : tant que
  // l'écriture de clôture (affectation du résultat en 1191) n'a pas été passée, ce montant
  // est affiché séparément au passif pour que le bilan reste équilibré (bilan provisoire).
  const resultatExercice = computeCPC(companyId, dateDebut, dateFin).resultat_net;

  const isAmortissement = (r) => r.numero.startsWith('28');
  const isImmobilisationBrute = (r) => r.classe === 2 && !isAmortissement(r);
  const isActifCirculant = (r) => r.classe === 3;
  const isTresorerieActif = (r) => r.classe === 5 && r.solde > 0;
  const isTresoreriePassif = (r) => r.classe === 5 && r.solde < 0;
  const isDetteFinancement = (r) => r.numero.startsWith('148');
  const isCapitauxPropres = (r) => r.classe === 1 && !isDetteFinancement(r);
  const isPassifCirculant = (r) => r.classe === 4;

  const immobilisationsBrutes = sumWhere(rows, isImmobilisationBrute);
  const amortissements = -sumWhere(rows, isAmortissement); // solde créditeur -> positif en réduction
  const immobilisationsNettes = round2(immobilisationsBrutes - amortissements);

  const actifCirculant = round2(sumWhere(rows, isActifCirculant));
  const tresorerieActif = round2(sumWhere(rows, isTresorerieActif));
  const totalActif = round2(immobilisationsNettes + actifCirculant + tresorerieActif);

  const capitauxPropresHorsResultat = round2(-sumWhere(rows, isCapitauxPropres)); // classe 1 normalement créditrice
  const capitauxPropres = round2(capitauxPropresHorsResultat + resultatExercice);
  const dettesFinancement = round2(-sumWhere(rows, isDetteFinancement));
  const financementPermanent = round2(capitauxPropres + dettesFinancement);
  const passifCirculant = round2(-sumWhere(rows, isPassifCirculant));
  const tresoreriePassif = round2(-sumWhere(rows, isTresoreriePassif));
  const totalPassif = round2(financementPermanent + passifCirculant + tresoreriePassif);

  return {
    date_arrete: dateFin,
    actif: {
      immobilisations_brutes: round2(immobilisationsBrutes),
      amortissements: round2(amortissements),
      immobilisations_nettes: immobilisationsNettes,
      actif_circulant: actifCirculant,
      tresorerie_actif: tresorerieActif,
      total_actif: totalActif,
    },
    passif: {
      capitaux_propres_hors_resultat: capitauxPropresHorsResultat,
      resultat_exercice: round2(resultatExercice),
      capitaux_propres: capitauxPropres,
      dettes_financement: dettesFinancement,
      financement_permanent: financementPermanent,
      passif_circulant: passifCirculant,
      tresorerie_passif: tresoreriePassif,
      total_passif: totalPassif,
    },
    equilibre: Math.abs(totalActif - totalPassif) < 0.01,
    ecart: round2(totalActif - totalPassif),
  };
}

function computeCPC(companyId, dateDebut, dateFin) {
  const rows = getMovementsBetween(companyId, dateDebut, dateFin);

  const isChargeIS = (r) => r.numero.startsWith('670');
  const isChargeFinanciere = (r) => r.numero.startsWith('63');
  const isProduitFinancier = (r) => r.numero.startsWith('73');
  const isProduitNonCourant = (r) => r.numero.startsWith('75');
  const isChargeExploitation = (r) => r.classe === 6 && !isChargeFinanciere(r) && !isChargeIS(r);
  const isProduitExploitation = (r) => r.classe === 7 && !isProduitFinancier(r) && !isProduitNonCourant(r);

  // Charges (classe 6) ont un solde normalement débiteur -> valeur positive attendue
  const chargesExploitation = round2(sumWhere(rows, isChargeExploitation));
  const produitsExploitation = round2(-sumWhere(rows, isProduitExploitation)); // classe 7 normalement créditrice
  const resultatExploitation = round2(produitsExploitation - chargesExploitation);

  const chargesFinancieres = round2(sumWhere(rows, isChargeFinanciere));
  const produitsFinanciers = round2(-sumWhere(rows, isProduitFinancier));
  const resultatFinancier = round2(produitsFinanciers - chargesFinancieres);

  const resultatCourant = round2(resultatExploitation + resultatFinancier);

  const produitsNonCourants = round2(-sumWhere(rows, isProduitNonCourant));
  const resultatNonCourant = produitsNonCourants; // pas de charges non courantes dans le jeu standard

  const resultatAvantImpot = round2(resultatCourant + resultatNonCourant);
  const impotSurResultats = round2(sumWhere(rows, isChargeIS));
  const resultatNet = round2(resultatAvantImpot - impotSurResultats);

  return {
    periode: { date_debut: dateDebut, date_fin: dateFin },
    exploitation: {
      produits_exploitation: produitsExploitation,
      charges_exploitation: chargesExploitation,
      resultat_exploitation: resultatExploitation,
    },
    financier: {
      produits_financiers: produitsFinanciers,
      charges_financieres: chargesFinancieres,
      resultat_financier: resultatFinancier,
    },
    resultat_courant: resultatCourant,
    non_courant: {
      produits_non_courants: produitsNonCourants,
      resultat_non_courant: resultatNonCourant,
    },
    resultat_avant_impot: resultatAvantImpot,
    impot_sur_resultats: impotSurResultats,
    resultat_net: resultatNet,
  };
}

module.exports = {
  computeBilan,
  computeCPC,
  computeBilanDetaille,
  computeCPCDetaille,
  computeTableau3,
  computeESG,
  computeTableauImmobilisations,
  computeTableauAmortissements,
  computeDetailPostesCPC,
  computeTableauFinancement,
  computeTableauTVA,
};

// ---------------------------------------------------------------------------
// Tableau 3 — Passage du résultat net comptable au résultat net fiscal.
// Réintégrations par défaut : l'IS lui-même (670) et les autres charges non
// courantes (658, souvent des pénalités/amendes non déductibles) — ce sont
// les deux seules réintégrations qu'on peut déduire sans jugement fiscal.
// Le reste (autres réintégrations, déductions, reports déficitaires) est
// modifiable manuellement, car cela dépend de règles fiscales au cas par cas
// que l'application ne peut pas deviner depuis les écritures.
function computeTableau3(cpc, overrides = {}) {
  const resultatNetComptable = cpc.resultatNet;
  const reintegrationCourantes = round2(overrides.reintegrations_courantes ?? 0);
  const reintegrationNonCourantes = round2((overrides.reintegrations_non_courantes ?? 0) + cpc.impotsResultats + cpc.nonCourant.autresChargesNC);
  const totalReintegrations = round2(reintegrationCourantes + reintegrationNonCourantes);
  const deductionCourantes = round2(overrides.deductions_courantes ?? 0);
  const deductionNonCourantes = round2(overrides.deductions_non_courantes ?? 0);
  const totalDeductions = round2(deductionCourantes + deductionNonCourantes);
  const resultatBrutFiscal = round2(resultatNetComptable + totalReintegrations - totalDeductions);
  const reportsDeficitairesImputes = round2(overrides.reports_deficitaires_imputes ?? 0);
  const resultatNetFiscal = round2(resultatBrutFiscal - reportsDeficitairesImputes);
  return {
    resultatNetComptable,
    benefice: resultatNetComptable >= 0 ? resultatNetComptable : 0,
    perte: resultatNetComptable < 0 ? -resultatNetComptable : 0,
    reintegrationCourantes,
    reintegrationNonCourantes,
    totalReintegrations,
    deductionCourantes,
    deductionNonCourantes,
    totalDeductions,
    resultatBrutFiscal,
    reportsDeficitairesImputes,
    resultatNetFiscal,
  };
}

// ---------------------------------------------------------------------------
// Tableau 5 — État des Soldes de Gestion (E.S.G.), calculé à partir du détail
// du CPC : marge brute, valeur ajoutée, EBE, CAF/autofinancement.
function computeESG(cpc) {
  const margeBrute = round2(cpc.exploitation.ventesMarchandises - cpc.exploitation.achatsRevendus);
  const produitExercice = round2(cpc.exploitation.ventes + cpc.exploitation.variationStocks + cpc.exploitation.immoProduites);
  const consommationExercice = round2(cpc.exploitation.achatsConsommes + cpc.exploitation.autresChargesExternes);
  const valeurAjoutee = round2(margeBrute + produitExercice - consommationExercice);
  const ebe = round2(valeurAjoutee + cpc.exploitation.subventionExploit - cpc.exploitation.impotsTaxes - cpc.exploitation.chargesPersonnel);
  const resultatExploitation = round2(
    ebe + cpc.exploitation.autresProduitsExploit - cpc.exploitation.autresChargesExploit + cpc.exploitation.reprisesExploit - cpc.exploitation.dotationsExploit
  );
  const resultatCourant = round2(resultatExploitation + cpc.financier.resultatFinancier);
  const resultatNet = cpc.resultatNet;

  const dotations = round2(cpc.exploitation.dotationsExploit + cpc.financier.dotationsFin + cpc.nonCourant.dotationsNC);
  const reprises = round2(cpc.exploitation.reprisesExploit + cpc.financier.reprisesFinancieres + cpc.nonCourant.reprisesNC);
  const caf = round2(resultatNet + dotations - reprises - cpc.nonCourant.produitsCessionImmo + cpc.nonCourant.vnaImmoCedees);
  const autofinancement = caf; // distribution de bénéfices non modélisée -> AF = CAF

  return { margeBrute, produitExercice, consommationExercice, valeurAjoutee, ebe, resultatExploitation, resultatCourant, resultatNonCourant: cpc.nonCourant.resultatNonCourant, resultatNet, caf, autofinancement };
}

// ---------------------------------------------------------------------------
// Tableau 4 — Tableau des immobilisations autres que financières : brut début
// d'exercice (solde avant la période) + acquisitions (débits sur la période)
// - cessions (crédits sur la période) = brut fin d'exercice, par rubrique.
const RUBRIQUES_IMMOS = [
  { label: 'IMMOBILISATIONS EN NON-VALEURS', prefixes: ['21'] },
  { label: 'IMMOBILISATIONS INCORPORELLES', prefixes: ['22'] },
  { label: 'IMMOBILISATIONS CORPORELLES', prefixes: ['23'] },
];

function computeTableauImmobilisations(companyId, dateDebut, dateFin) {
  const avant = getBalanceUpTo(companyId, dateAvant(dateDebut));
  const mouvements = getMovementsBetween(companyId, dateDebut, dateFin);

  const lignes = RUBRIQUES_IMMOS.map((r) => {
    const brutDebut = round2(sumWhere(avant, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'solde'));
    const acquisition = round2(sumWhere(mouvements, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'total_debit'));
    const cession = round2(sumWhere(mouvements, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'total_credit'));
    const brutFin = round2(brutDebut + acquisition - cession);
    return { label: r.label, brutDebut, acquisition, cession, virement: 0, production: 0, retrait: 0, brutFin };
  });

  const total = lignes.reduce(
    (acc, l) => ({
      brutDebut: round2(acc.brutDebut + l.brutDebut),
      acquisition: round2(acc.acquisition + l.acquisition),
      cession: round2(acc.cession + l.cession),
      brutFin: round2(acc.brutFin + l.brutFin),
    }),
    { brutDebut: 0, acquisition: 0, cession: 0, brutFin: 0 }
  );

  return { lignes, total };
}

// ---------------------------------------------------------------------------
// Tableau 8 — Tableau des amortissements : cumul début (solde créditeur avant
// la période) + dotation de l'exercice (crédits sur la période) - amort. sur
// immob. sortie (débits sur la période) = cumul fin, par rubrique.
const RUBRIQUES_AMORT = [
  { label: 'IMMOBILISATIONS EN NON-VALEURS', prefixes: ['281'] },
  { label: 'IMMOBILISATIONS INCORPORELLES', prefixes: ['282'] },
  { label: 'IMMOBILISATIONS CORPORELLES', prefixes: ['283', '284'] },
];

function computeTableauAmortissements(companyId, dateDebut, dateFin) {
  const avant = getBalanceUpTo(companyId, dateAvant(dateDebut));
  const mouvements = getMovementsBetween(companyId, dateDebut, dateFin);

  const lignes = RUBRIQUES_AMORT.map((r) => {
    const cumulDebut = round2(-sumWhere(avant, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'solde'));
    const dotation = round2(sumWhere(mouvements, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'total_credit'));
    const sortie = round2(sumWhere(mouvements, (row) => r.prefixes.some((p) => row.numero.startsWith(p)), 'total_debit'));
    const cumulFin = round2(cumulDebut + dotation - sortie);
    return { label: r.label, cumulDebut, dotation, sortie, cumulFin };
  });

  const total = lignes.reduce(
    (acc, l) => ({
      cumulDebut: round2(acc.cumulDebut + l.cumulDebut),
      dotation: round2(acc.dotation + l.dotation),
      sortie: round2(acc.sortie + l.sortie),
      cumulFin: round2(acc.cumulFin + l.cumulFin),
    }),
    { cumulDebut: 0, dotation: 0, sortie: 0, cumulFin: 0 }
  );

  return { lignes, total };
}

// ---------------------------------------------------------------------------
// Tableau 6 — Détail des postes du CPC (Charges / Produits) : liste, pour
// chaque poste (611, 612, 613/614, 617, 618, 638, 658 / 711, 712, 713, 718,
// 719, 738), les comptes réellement mouvementés avec leur solde exercice et
// exercice précédent — reproduit le détail par "reste du poste" du modèle.
const POSTES_CHARGES = [
  { poste: '611', label: 'Achats revendus de marchandises', prefixes: ['611'] },
  { poste: '612', label: 'Achats consommés de matières et fournitures', prefixes: ['612'] },
  { poste: '613/614', label: 'Autres charges externes', prefixes: ['613', '614'] },
  { poste: '616', label: 'Impôts et taxes', prefixes: ['616'] },
  { poste: '617', label: 'Charges de personnel', prefixes: ['617'] },
  { poste: '618', label: "Autres charges d'exploitation", prefixes: ['618'] },
  { poste: '638', label: 'Autres charges financières', prefixes: ['638'] },
  { poste: '658', label: 'Autres charges non courantes', prefixes: ['658'] },
];
const POSTES_PRODUITS = [
  { poste: '711', label: 'Ventes de marchandises', prefixes: ['711'] },
  { poste: '712', label: 'Ventes de biens et services produits', prefixes: ['712'] },
  { poste: '713', label: 'Variations des stocks de produits', prefixes: ['713'] },
  { poste: '718', label: "Autres produits d'exploitation", prefixes: ['718'] },
  { poste: '719', label: "Reprise d'exploitation ; transfert de charges", prefixes: ['719'] },
  { poste: '738', label: 'Intérêts et autres produits financiers', prefixes: ['738'] },
];

function detailParPoste(rows, rowsPrec, postes, sens) {
  return postes.map((p) => {
    const comptes = rows
      .filter((r) => p.prefixes.some((pref) => r.numero.startsWith(pref)) && r.solde !== 0)
      .map((r) => {
        const prec = rowsPrec ? rowsPrec.find((rp) => rp.numero === r.numero) : null;
        const montant = round2(sens === 'credit' ? -r.solde : r.solde);
        const montantPrec = prec ? round2(sens === 'credit' ? -prec.solde : prec.solde) : 0;
        return { numero: r.numero, intitule: r.intitule, montant, montantPrec };
      });
    const total = round2(comptes.reduce((s, c) => s + c.montant, 0));
    const totalPrec = round2(comptes.reduce((s, c) => s + c.montantPrec, 0));
    return { ...p, comptes, total, totalPrec };
  });
}

function computeDetailPostesCPC(companyId, dateDebut, dateFin, dateDebutPrec, dateFinPrec) {
  const rows = getMovementsBetween(companyId, dateDebut, dateFin);
  const rowsPrec = dateDebutPrec && dateFinPrec ? getMovementsBetween(companyId, dateDebutPrec, dateFinPrec) : null;
  return {
    charges: detailParPoste(rows, rowsPrec, POSTES_CHARGES, 'debit'),
    produits: detailParPoste(rows, rowsPrec, POSTES_PRODUITS, 'credit'),
  };
}

// ---------------------------------------------------------------------------
// Tableau de financement (I - Synthèse des masses du bilan) : dérivé
// directement des totaux déjà calculés par computeBilanDetaille pour
// l'exercice et l'exercice précédent.
function computeTableauFinancement(bilan, cpc) {
  const financementPermanent = bilan.passif.totalI;
  const financementPermanentPrec = bilan.passif.precedent?.totalI ?? 0;
  const actifImmobilise = bilan.actif.totalI.net;
  const actifImmobilisePrec = bilan.actif.precedent?.totalI ?? 0;
  const fdr = round2(financementPermanent - actifImmobilise);
  const fdrPrec = round2(financementPermanentPrec - actifImmobilisePrec);

  const actifCirculant = bilan.actif.totalII.net;
  const actifCirculantPrec = bilan.actif.precedent?.totalII ?? 0;
  const passifCirculant = bilan.passif.totalII;
  const passifCirculantPrec = bilan.passif.precedent?.totalII ?? 0;
  const bfg = round2(actifCirculant - passifCirculant);
  const bfgPrec = round2(actifCirculantPrec - passifCirculantPrec);

  const tresorerieNette = round2(fdr - bfg);
  const tresorerieNettePrec = round2(fdrPrec - bfgPrec);

  return {
    financementPermanent, financementPermanentPrec, variation1: round2(financementPermanent - financementPermanentPrec),
    actifImmobilise, actifImmobilisePrec, variation2: round2(actifImmobilise - actifImmobilisePrec),
    fdr, fdrPrec, variationFdr: round2(fdr - fdrPrec),
    actifCirculant, actifCirculantPrec, variation4: round2(actifCirculant - actifCirculantPrec),
    passifCirculant, passifCirculantPrec, variation5: round2(passifCirculant - passifCirculantPrec),
    bfg, bfgPrec, variationBfg: round2(bfg - bfgPrec),
    tresorerieNette, tresorerieNettePrec, variationTresorerie: round2(tresorerieNette - tresorerieNettePrec),
  };
}

// ---------------------------------------------------------------------------
// Tableau 12 — Détail de la TVA (simplifié) : solde en début d'exercice
// (compte "État, TVA due ou crédit de TVA" avant la période), opérations
// comptables de l'exercice (TVA facturée / récupérable, via le même moteur
// que la déclaration TVA), solde en fin d'exercice.
function computeTableauTVA(companyId, dateDebut, dateFin) {
  const { calculateTVA } = require('./tvaService');
  const avant = getBalanceUpTo(companyId, dateAvant(dateDebut));
  const soldeDebutTvaDue = round2(-sumWhere(avant, (r) => r.numero.startsWith('4455'), 'solde') - -sumWhere(avant, (r) => r.numero.startsWith('3455'), 'solde'));
  const operations = calculateTVA(companyId, dateDebut, dateFin);
  return {
    soldeDebut: soldeDebutTvaDue,
    tvaFactureeExercice: round2(operations.tva_collectee || 0),
    tvaRecuperableExercice: round2(operations.tva_deductible_totale || 0),
    tvaDueExercice: round2(operations.tva_due_ou_credit || 0),
    soldeFin: round2(soldeDebutTvaDue + (operations.tva_due_ou_credit || 0)),
  };
}

function dateAvant(dateISO) {
  const d = new Date(dateISO);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Liasse fiscale détaillée (Bilan Actif / Bilan Passif / C.P.C.) — reproduit
// la structure officielle du modèle normal du PCGM (rubriques A à I de
// l'actif, A à H du passif, lignes I à XVI du CPC), avec comparaison à
// l'exercice précédent quand celui-ci existe.

function sumPrefixes(rows, prefixes) {
  return rows.filter((r) => prefixes.some((p) => r.numero.startsWith(p))).reduce((s, r) => s + r.solde, 0);
}

// Une rubrique d'actif : brut (débiteur), amort/provisions (créditeur, à
// déduire), net = brut - amort.
function rubriqueActif(rows, label, prefixesBrut, prefixesAmort = []) {
  const brut = round2(sumPrefixes(rows, prefixesBrut));
  const amort = round2(sumPrefixes(rows, prefixesAmort)); // compte d'amort/provision : solde créditeur -> négatif -> on l'inverse
  const amortPositif = round2(-amort);
  return { label, brut, amort: amortPositif, net: round2(brut - amortPositif) };
}

// Amortissement d'une immobilisation corporelle/incorporelle/non-valeur :
// convention PCGM standard, le compte d'amortissement reprend le préfixe de
// la classe 28 suivi des deux derniers chiffres du compte d'actif (211 ->
// 2811, 232 -> 2832, etc.) — permet de ventiler l'amortissement au niveau du
// sous-poste sans le saisir séparément.
function amortPrefixFor(assetPrefix) {
  return '28' + assetPrefix.slice(1);
}

// Détail des sous-postes d'une rubrique (ex: "Terrains", "Constructions"…
// sous IMMOBILISATIONS CORPORELLES) — reproduit l'ensemble des lignes du
// modèle normal officiel, même à 0, pour que le tableau garde toujours la
// même forme qu'imprimé (voir Bilan.jsx). `items` est une liste de
// { label, prefix } ; l'amortissement de chaque sous-poste est déduit
// automatiquement du compte 28xx correspondant quand `withAmort` est vrai.
function sousPostesRubrique(rows, rowsPrec, items, withAmort = true) {
  return items.map(({ label, prefix }) => {
    const amortPrefixes = withAmort ? [amortPrefixFor(prefix)] : [];
    const cur = rubriqueActif(rows, label, [prefix], amortPrefixes);
    const prec = rowsPrec ? rubriqueActif(rowsPrec, label, [prefix], amortPrefixes) : null;
    return { ...cur, precedentNet: prec ? prec.net : null };
  });
}

// Détail des sous-postes du passif (une seule colonne de montant, signe
// inversé car les comptes de passif sont normalement créditeurs).
function sousPostesPassif(rows, rowsPrec, items) {
  return items.map(({ label, prefix }) => ({
    label,
    montant: round2(-sumPrefixes(rows, [prefix])),
    precedent: rowsPrec ? round2(-sumPrefixes(rowsPrec, [prefix])) : null,
  }));
}

const SOUS_POSTES_A = [{ label: 'Frais préliminaires', prefix: '211' }, { label: 'Charges à répartir sur plusieurs exercices', prefix: '212' }, { label: 'Primes de remboursement des obligations', prefix: '213' }];
const SOUS_POSTES_B = [{ label: 'Immobilisation en recherche et développement', prefix: '221' }, { label: 'Brevets, marques, droits et valeurs similaires', prefix: '222' }, { label: 'Fonds commercial', prefix: '223' }, { label: 'Autres immobilisations incorporelles', prefix: '228' }];
const SOUS_POSTES_C = [{ label: 'Terrains', prefix: '231' }, { label: 'Constructions', prefix: '232' }, { label: 'Installations techniques, matériel et outillage', prefix: '233' }, { label: 'Matériel de transport', prefix: '234' }, { label: 'Mobilier, matériel de bureau et aménagements divers', prefix: '235' }, { label: 'Autres immobilisations corporelles', prefix: '238' }, { label: 'Immobilisations corporelles en cours', prefix: '239' }];
const SOUS_POSTES_D = [{ label: 'Prêts immobilisés', prefix: '241' }, { label: 'Autres créances financières', prefix: '248' }, { label: 'Titres de participation', prefix: '251' }, { label: 'Autres titres immobilisés', prefix: '258' }];
const SOUS_POSTES_F = [{ label: 'Marchandises', prefix: '311' }, { label: 'Matières et fournitures consommables', prefix: '312' }, { label: 'Produits en cours', prefix: '313' }, { label: 'Produits intermédiaires et produits résiduels', prefix: '314' }, { label: 'Produits finis', prefix: '315' }];
// Détail des stocks (poste F) pour le secteur immobilier — les comptes 310 à
// 315 n'ont pas le même sens que dans le PCGM standard : pas de
// "Marchandises", mais des réserves foncières et terrains autorisés (Plan
// Comptable du Secteur Immobilier, CNC, juin 2022, classe 3).
const SOUS_POSTES_F_IMMOBILIER = [{ label: 'Réserves foncières', prefix: '310' }, { label: 'Terrains autorisés', prefix: '311' }, { label: 'Matières et fournitures consommables', prefix: '312' }, { label: 'Produits en cours', prefix: '313' }, { label: 'Produits intermédiaires et produits résiduels', prefix: '314' }, { label: 'Produits finis', prefix: '315' }];
const SOUS_POSTES_G = [{ label: 'Fournisseurs débiteurs, avances et acomptes', prefix: '341' }, { label: 'Clients et comptes rattachés', prefix: '342' }, { label: 'Personnel débiteur', prefix: '343' }, { label: 'État débiteur', prefix: '345' }, { label: "Comptes d'associés débiteurs", prefix: '346' }, { label: 'Autres débiteurs', prefix: '348' }, { label: 'Comptes de régularisation actif', prefix: '349' }];
const SOUS_POSTES_TRESORERIE_ACTIF = [{ label: 'Chèques et valeurs à encaisser', prefix: '511' }, { label: 'Banques, T.G. et chèques postaux débiteurs', prefix: '514' }, { label: "Caisses, régies d'avances et accréditifs", prefix: '516' }];

const SOUS_POSTES_PASSIF_A = [{ label: 'Capital social ou personnel', prefix: '111' }, { label: "Primes d'émission, de fusion et d'apport", prefix: '112' }, { label: 'Écarts de réévaluation', prefix: '113' }, { label: 'Réserve légale', prefix: '114' }, { label: 'Autres réserves', prefix: '115' }, { label: 'Report à nouveau', prefix: '116' }, { label: "Résultats nets en instance d'affectation", prefix: '118' }];
const SOUS_POSTES_PASSIF_B = [{ label: "Subventions d'investissement", prefix: '131' }, { label: 'Provisions réglementées', prefix: '135' }];
const SOUS_POSTES_PASSIF_C = [{ label: 'Emprunts obligataires', prefix: '141' }, { label: 'Autres dettes de financement', prefix: '148' }];
const SOUS_POSTES_PASSIF_D = [{ label: 'Provisions pour risques', prefix: '151' }, { label: 'Provisions pour charges', prefix: '155' }];
const SOUS_POSTES_PASSIF_F = [{ label: 'Fournisseurs et comptes rattachés', prefix: '441' }, { label: 'Clients créditeurs, avances et acomptes', prefix: '442' }, { label: 'Personnel créditeur', prefix: '443' }, { label: 'Organismes sociaux', prefix: '444' }, { label: 'État créditeur', prefix: '445' }, { label: "Comptes d'associés créditeurs", prefix: '446' }, { label: 'Autres créanciers', prefix: '448' }, { label: 'Comptes de régularisation passif', prefix: '449' }];
const SOUS_POSTES_TRESORERIE_PASSIF = [{ label: "Crédits d'escompte", prefix: '552' }, { label: 'Crédits de trésorerie', prefix: '553' }, { label: 'Banques (soldes créditeurs)', prefix: '554' }];

function computeBilanDetaille(companyId, dateDebut, dateFin, dateDebutPrec, dateFinPrec) {
  const rows = getBalanceUpTo(companyId, dateFin);
  const rowsPrec = dateFinPrec ? getBalanceUpTo(companyId, dateFinPrec) : null;
  // Le détail du poste Stocks (F) dépend du secteur d'activité de la société
  // (voir SOUS_POSTES_F_IMMOBILIER ci-dessus) — n'affecte que les libellés du
  // détail, pas les totaux du bilan qui restent calculés sur toute la classe 3.
  const company = db.prepare('SELECT type_pc FROM companies WHERE id = ?').get(companyId);
  const sousPostesF = company?.type_pc === 'SECT.IMMOBILIER' ? SOUS_POSTES_F_IMMOBILIER : SOUS_POSTES_F;

  // --- ACTIF ---
  const A = rubriqueActif(rows, 'IMMOBILISATIONS EN NON-VALEURS (A)', ['21'], ['281']);
  const B = rubriqueActif(rows, 'IMMOBILISATIONS INCORPORELLES (B)', ['22'], ['282']);
  const C = rubriqueActif(rows, 'IMMOBILISATIONS CORPORELLES (C)', ['23'], ['283', '284']);
  const D = rubriqueActif(rows, 'IMMOBILISATIONS FINANCIERES (D)', ['24', '25'], ['294', '295']);
  const E = rubriqueActif(rows, 'ECARTS DE CONVERSION ACTIF (E)', ['27']);
  const totalI = {
    label: 'TOTAL I (A+B+C+D+E)',
    brut: round2(A.brut + B.brut + C.brut + D.brut + E.brut),
    amort: round2(A.amort + B.amort + C.amort + D.amort + E.amort),
    net: round2(A.net + B.net + C.net + D.net + E.net),
  };

  const F = rubriqueActif(rows, 'STOCKS (F)', ['31'], ['391']);
  const G = rubriqueActif(rows, "CREANCES DE L'ACTIF CIRCULANT (G)", ['341', '342', '343', '345', '346', '348', '349'], ['394']);
  const H = rubriqueActif(rows, 'TITRES ET VALEURS DE PLACEMENT (H)', ['350'], ['395']);
  const I = rubriqueActif(rows, 'ECARTS DE CONVERSION ACTIF - ELTS CIRC (I)', ['370']);
  const totalII = {
    label: 'TOTAL II (F+G+H+I)',
    brut: round2(F.brut + G.brut + H.brut + I.brut),
    amort: round2(F.amort + G.amort + H.amort + I.amort),
    net: round2(F.net + G.net + H.net + I.net),
  };

  const tresorerieActifBrut = round2(sumPrefixes(rows.filter((r) => r.solde > 0), ['511', '514', '516']));
  const totalIII = { label: 'TOTAL III', brut: tresorerieActifBrut, amort: 0, net: tresorerieActifBrut };

  const totalGeneralActif = {
    label: 'TOTAL GENERAL (I+II+III)',
    brut: round2(totalI.brut + totalII.brut + totalIII.brut),
    amort: round2(totalI.amort + totalII.amort + totalIII.amort),
    net: round2(totalI.net + totalII.net + totalIII.net),
  };

  // Exercice précédent : uniquement la colonne Net, comme sur le modèle officiel.
  function netPrecedent(prefixesBrut, prefixesAmort = []) {
    if (!rowsPrec) return null;
    const brut = round2(sumPrefixes(rowsPrec, prefixesBrut));
    const amort = round2(-sumPrefixes(rowsPrec, prefixesAmort));
    return round2(brut - amort);
  }
  const actifNetPrec = {
    A: netPrecedent(['21'], ['281']),
    B: netPrecedent(['22'], ['282']),
    C: netPrecedent(['23'], ['283', '284']),
    D: netPrecedent(['24', '25'], ['294', '295']),
    E: netPrecedent(['27']),
    F: netPrecedent(['31'], ['391']),
    G: netPrecedent(['341', '342', '343', '345', '346', '348', '349'], ['394']),
    H: netPrecedent(['350'], ['395']),
    I: netPrecedent(['370']),
  };
  if (rowsPrec) {
    actifNetPrec.totalI = round2(actifNetPrec.A + actifNetPrec.B + actifNetPrec.C + actifNetPrec.D + actifNetPrec.E);
    actifNetPrec.totalII = round2(actifNetPrec.F + actifNetPrec.G + actifNetPrec.H + actifNetPrec.I);
    actifNetPrec.totalIII = round2(sumPrefixes(rowsPrec.filter((r) => r.solde > 0), ['511', '514', '516']));
    actifNetPrec.totalGeneral = round2(actifNetPrec.totalI + actifNetPrec.totalII + actifNetPrec.totalIII);
  }

  const actif = {
    A, B, C, D, E, totalI, F, G, H, I, totalII, tresorerieActif: totalIII, totalIII, totalGeneral: totalGeneralActif, precedent: rowsPrec ? actifNetPrec : null,
    sousPostes: {
      A: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_A),
      B: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_B),
      C: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_C),
      D: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_D, false),
      F: sousPostesRubrique(rows, rowsPrec, sousPostesF, false),
      G: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_G, false),
      tresorerieActif: sousPostesRubrique(rows, rowsPrec, SOUS_POSTES_TRESORERIE_ACTIF, false),
    },
  };

  // --- PASSIF ---
  const resultatExercice = computeCPCDetaille(companyId, dateDebut, dateFin).resultatNet;
  const resultatExercicePrec = dateDebutPrec && dateFinPrec ? computeCPCDetaille(companyId, dateDebutPrec, dateFinPrec).resultatNet : null;

  function passifLigne(label, rowsSrc, prefixes, extra = 0) {
    return round2(-sumPrefixes(rowsSrc, prefixes) + extra);
  }

  const capitauxPropres = passifLigne('A', rows, ['111', '112', '113', '114', '115', '116', '118'], resultatExercice);
  const capitauxPropresAssimiles = passifLigne('B', rows, ['131', '135']);
  const dettesFinancement = passifLigne('C', rows, ['141', '148']);
  const provisionsDurables = passifLigne('D', rows, ['151', '155']);
  const ecartsConversionPassif = passifLigne('E', rows, ['171', '172']);
  const totalIPassif = round2(capitauxPropres + capitauxPropresAssimiles + dettesFinancement + provisionsDurables + ecartsConversionPassif);

  const dettesPassifCirculant = passifLigne('F', rows, ['441', '442', '443', '444', '445', '446', '448', '449']);
  const autresProvisions = passifLigne('G', rows, ['450']);
  const ecartsConversionPassifCirc = passifLigne('H', rows, ['470']);
  const totalIIPassif = round2(dettesPassifCirculant + autresProvisions + ecartsConversionPassifCirc);

  const tresoreriePassif = round2(-sumPrefixes(rows.filter((r) => r.solde < 0), ['552', '553', '554']));
  const totalIIIPassif = tresoreriePassif;

  const totalGeneralPassif = round2(totalIPassif + totalIIPassif + totalIIIPassif);

  let passifPrec = null;
  if (rowsPrec) {
    const cpPrec = passifLigne('A', rowsPrec, ['111', '112', '113', '114', '115', '116', '118'], resultatExercicePrec || 0);
    const cpaPrec = passifLigne('B', rowsPrec, ['131', '135']);
    const dfPrec = passifLigne('C', rowsPrec, ['141', '148']);
    const pdPrec = passifLigne('D', rowsPrec, ['151', '155']);
    const ecpPrec = passifLigne('E', rowsPrec, ['171', '172']);
    const totalIPrec = round2(cpPrec + cpaPrec + dfPrec + pdPrec + ecpPrec);
    const dpcPrec = passifLigne('F', rowsPrec, ['441', '442', '443', '444', '445', '446', '448', '449']);
    const apPrec = passifLigne('G', rowsPrec, ['450']);
    const ecpcPrec = passifLigne('H', rowsPrec, ['470']);
    const totalIIPrec = round2(dpcPrec + apPrec + ecpcPrec);
    const tpPrec = round2(-sumPrefixes(rowsPrec.filter((r) => r.solde < 0), ['552', '553', '554']));
    passifPrec = {
      capitauxPropres: cpPrec, capitauxPropresAssimiles: cpaPrec, dettesFinancement: dfPrec,
      provisionsDurables: pdPrec, ecartsConversionPassif: ecpPrec, totalI: totalIPrec,
      dettesPassifCirculant: dpcPrec, autresProvisions: apPrec, ecartsConversionPassifCirc: ecpcPrec, totalII: totalIIPrec,
      tresoreriePassif: tpPrec, totalIII: tpPrec, totalGeneral: round2(totalIPrec + totalIIPrec + tpPrec),
    };
  }

  const passif = {
    capitauxPropres, capitauxPropresAssimiles, dettesFinancement, provisionsDurables, ecartsConversionPassif, totalI: totalIPassif,
    dettesPassifCirculant, autresProvisions, ecartsConversionPassifCirc, totalII: totalIIPassif,
    tresoreriePassif, totalIII: totalIIIPassif, totalGeneral: totalGeneralPassif, precedent: passifPrec,
    sousPostes: {
      // Le résultat de l'exercice (1191) est ajouté séparément à la rubrique A pour
      // rester cohérent avec `capitauxPropres` ci-dessus (voir passifLigne) ; on ne
      // le mélange pas au solde du compte 118 (résultats en instance d'affectation).
      A: [...sousPostesPassif(rows, rowsPrec, SOUS_POSTES_PASSIF_A), { label: "Résultat net de l'exercice", montant: round2(resultatExercice), precedent: rowsPrec ? round2(resultatExercicePrec || 0) : null }],
      B: sousPostesPassif(rows, rowsPrec, SOUS_POSTES_PASSIF_B),
      C: sousPostesPassif(rows, rowsPrec, SOUS_POSTES_PASSIF_C),
      D: sousPostesPassif(rows, rowsPrec, SOUS_POSTES_PASSIF_D),
      F: sousPostesPassif(rows, rowsPrec, SOUS_POSTES_PASSIF_F),
      tresoreriePassif: sousPostesPassif(rows, rowsPrec, SOUS_POSTES_TRESORERIE_PASSIF),
    },
  };

  return {
    date_debut: dateDebut,
    date_fin: dateFin,
    actif,
    passif,
    equilibre: Math.abs(totalGeneralActif.net - totalGeneralPassif) < 0.01,
    ecart: round2(totalGeneralActif.net - totalGeneralPassif),
  };
}

function computeCPCDetaille(companyId, dateDebut, dateFin) {
  const rows = getMovementsBetween(companyId, dateDebut, dateFin);

  function ligneProduit(prefixes) {
    return round2(-sumPrefixes(rows, prefixes));
  }
  function ligneCharge(prefixes) {
    return round2(sumPrefixes(rows, prefixes));
  }

  const ventes = ligneProduit(['712']);
  const ventesMarchandises = ligneProduit(['711']);
  const variationStocks = ligneProduit(['713']);
  const immoProduites = ligneProduit(['714']);
  const subventionExploit = ligneProduit(['716']);
  const autresProduitsExploit = ligneProduit(['718']);
  const reprisesExploit = ligneProduit(['719']);
  const totalI = round2(ventesMarchandises + ventes + variationStocks + immoProduites + subventionExploit + autresProduitsExploit + reprisesExploit);

  const achatsRevendus = ligneCharge(['611']);
  const achatsConsommes = ligneCharge(['612']);
  const autresChargesExternes = ligneCharge(['613', '614']);
  const impotsTaxes = ligneCharge(['616']);
  const chargesPersonnel = ligneCharge(['617']);
  const autresChargesExploit = ligneCharge(['618']);
  const dotationsExploit = ligneCharge(['619']);
  const totalII = round2(achatsRevendus + achatsConsommes + autresChargesExternes + impotsTaxes + chargesPersonnel + autresChargesExploit + dotationsExploit);

  const resultatExploitation = round2(totalI - totalII);

  const produitsTitres = ligneProduit(['732']);
  const gainsChange = ligneProduit(['733']);
  const interetsProduits = ligneProduit(['738']);
  const reprisesFinancieres = ligneProduit(['739']);
  const totalIV = round2(produitsTitres + gainsChange + interetsProduits + reprisesFinancieres);

  const chargesInterets = ligneCharge(['631']);
  const pertesChange = ligneCharge(['633']);
  const autresChargesFin = ligneCharge(['638']);
  const dotationsFin = ligneCharge(['639']);
  const totalV = round2(chargesInterets + pertesChange + autresChargesFin + dotationsFin);

  const resultatFinancier = round2(totalIV - totalV);
  const resultatCourant = round2(resultatExploitation + resultatFinancier);

  const produitsCessionImmo = ligneProduit(['751']);
  const subventionsEquilibre = ligneProduit(['756']);
  const reprisesSubvention = ligneProduit(['757']);
  const autresProduitsNC = ligneProduit(['758']);
  const reprisesNC = ligneProduit(['759']);
  const totalVIII = round2(produitsCessionImmo + subventionsEquilibre + reprisesSubvention + autresProduitsNC + reprisesNC);

  const vnaImmoCedees = ligneCharge(['651']);
  const subventionsAccordees = ligneCharge(['656']);
  const autresChargesNC = ligneCharge(['658']);
  const dotationsNC = ligneCharge(['659']);
  const totalIX = round2(vnaImmoCedees + subventionsAccordees + autresChargesNC + dotationsNC);

  const resultatNonCourant = round2(totalVIII - totalIX);
  const resultatAvantImpots = round2(resultatCourant + resultatNonCourant);
  const impotsResultats = ligneCharge(['670']);
  const resultatNet = round2(resultatAvantImpots - impotsResultats);

  return {
    exploitation: { ventesMarchandises, ventes, variationStocks, immoProduites, subventionExploit, autresProduitsExploit, reprisesExploit, totalI, achatsRevendus, achatsConsommes, autresChargesExternes, impotsTaxes, chargesPersonnel, autresChargesExploit, dotationsExploit, totalII, resultatExploitation },
    financier: { produitsTitres, gainsChange, interetsProduits, reprisesFinancieres, totalIV, chargesInterets, pertesChange, autresChargesFin, dotationsFin, totalV, resultatFinancier },
    resultatCourant,
    nonCourant: { produitsCessionImmo, subventionsEquilibre, reprisesSubvention, autresProduitsNC, reprisesNC, totalVIII, vnaImmoCedees, subventionsAccordees, autresChargesNC, dotationsNC, totalIX, resultatNonCourant },
    resultatAvantImpots,
    impotsResultats,
    resultatNet,
    totalProduits: round2(totalI + totalIV + totalVIII),
    totalCharges: round2(totalII + totalV + totalIX + impotsResultats),
  };
}
