// Calcule le prochain numéro de sous-compte tiers disponible (ex: 342101,
// 441102…) à partir de la liste des comptes déjà chargée côté client.
// Le Plan Comptable Général Marocain complet contient déjà des comptes
// génériques sous ces racines (3421, 34211, 3423, 3428, 4411, 44111, 4415…) —
// il ne faut donc JAMAIS pré-remplir la racine seule dans la pop-up de
// création, sous peine de "Le compte existe déjà" dès que l'utilisateur ne
// modifie pas le champ (ou choisit un numéro qui existe déjà en générique).
export function nextTiersNumero(accounts, racine) {
  const longueurCible = racine.length + 2;
  const existants = new Set(accounts.filter((a) => a.numero.startsWith(racine) && a.numero.length === longueurCible).map((a) => a.numero));
  let suffix = 1;
  let numero;
  do {
    numero = `${racine}${String(suffix).padStart(2, '0')}`;
    suffix += 1;
  } while (existants.has(numero));
  return numero;
}
