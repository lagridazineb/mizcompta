// Calcul du plan d'amortissement linéaire, avec prorata temporis sur
// l'exercice de mise en service.
//
// Convention retenue (usage courant au Maroc) : le prorata temporis se
// calcule en nombre de mois, chaque mois comptant pour 30 jours (année de
// 360 jours), du jour de la date de début d'amortissement jusqu'au 31/12 de
// la même année civile.
//
// Formules (cf. cahier des charges) :
//   Taux annuel = 100 / durée en années
//   Annuité pleine = Base amortissable × taux annuel
//   Dotation 1ère année = Valeur d'origine × taux annuel × prorata temporis
// Les années suivantes reçoivent l'annuité pleine jusqu'à épuisement de la
// base amortissable ; la dernière annuité est réduite pour ne jamais
// dépasser la valeur d'origine (VNC finale = 0).

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Nombre de mois (base 30 jours) entre dateDebut et le 31/12 de son année,
// bornes incluses sur le jour de départ (jour d'acquisition compté comme
// premier jour d'amortissement).
function moisRestantsAnneeCivile(dateDebutISO) {
  const d = new Date(dateDebutISO);
  const jour = d.getUTCDate();
  const mois = d.getUTCMonth() + 1; // 1-12
  // Jours restants dans le mois de départ (mois "plein" à 30 jours) + mois
  // complets restants jusqu'à décembre inclus.
  const joursRestantsMoisDepart = 30 - jour + 1;
  const moisCompletsRestants = 12 - mois; // mois pleins après le mois de départ
  const totalJours = Math.max(0, Math.min(360, joursRestantsMoisDepart + moisCompletsRestants * 30));
  return totalJours / 360;
}

/**
 * Calcule le tableau d'amortissement linéaire d'une immobilisation.
 * @param {object} params
 * @param {number} params.valeurOrigine - Valeur d'origine (base amortissable HT).
 * @param {number} params.dureeAnnees - Durée d'amortissement en années.
 * @param {string} params.dateDebutAmortissement - Date ISO (YYYY-MM-DD) de début d'amortissement.
 * @returns {{taux:number, lignes:Array}}
 */
function calculerTableauAmortissementLineaire({ valeurOrigine, dureeAnnees, dateDebutAmortissement }) {
  const valeur = Number(valeurOrigine);
  const duree = Number(dureeAnnees);
  if (!(valeur > 0)) throw new Error('La valeur d\'origine doit être positive.');
  if (!(duree > 0)) throw new Error('La durée d\'amortissement doit être positive.');
  if (!dateDebutAmortissement) throw new Error('La date de début d\'amortissement est requise.');

  const tauxAnnuel = round2(100 / duree);
  const anneeDebut = new Date(dateDebutAmortissement).getUTCFullYear();
  const prorataPremiereAnnee = moisRestantsAnneeCivile(dateDebutAmortissement);

  const lignes = [];
  let cumul = 0;
  let annee = anneeDebut;
  let base = valeur;
  let i = 0;
  // Nombre d'années nécessaire : durée entière, +1 si prorata < 1 (la fraction
  // de première année décale la fin d'un an).
  const nbAnnees = prorataPremiereAnnee < 1 ? Math.ceil(duree) + 1 : Math.ceil(duree);

  while (cumul < valeur - 0.01 && i < nbAnnees + 1) {
    const prorata = i === 0 ? prorataPremiereAnnee : 1;
    let dotation = round2(base * (tauxAnnuel / 100) * prorata);
    // Dernière annuité : on ne dépasse jamais la valeur d'origine (VNC = 0 pile).
    if (round2(cumul + dotation) >= valeur - 0.01) {
      dotation = round2(valeur - cumul);
    }
    if (dotation <= 0) break;
    cumul = round2(cumul + dotation);
    const vnc = round2(valeur - cumul);
    lignes.push({ annee: annee + i, base_amortissable: valeur, taux: tauxAnnuel, prorata: round2(prorata), dotation, cumul, vnc });
    i += 1;
    if (vnc <= 0.01) break;
  }

  return { taux: tauxAnnuel, lignes };
}

module.exports = { calculerTableauAmortissementLineaire, round2 };
