// ============================================================================
// IMPORTANT — À LIRE AVANT UTILISATION EN PRODUCTION
// ============================================================================
// Ce module génère un fichier XML structuré à partir des données de TVA calculées
// dans l'application. Il s'agit d'un GABARIT DE DÉPART, construit sur la structure
// générale que ce type d'échange (EDI) suit habituellement.
//
// Les spécifications techniques exactes (XSD officiel, noms de balises précis,
// codes de nomenclature, règles de validation) sont définies par la DGI et
// distribuées aux éditeurs homologués. Elles ne sont pas incluses ici.
//
// AVANT toute télédéclaration réelle, il faut impérativement :
//   1. Obtenir le cahier des charges / XSD officiel auprès de la DGI ou d'un
//      éditeur déjà homologué.
//   2. Faire valider la structure exacte par un expert-comptable ou un
//      spécialiste de l'intégration EDI marocaine.
//   3. Tester sur l'environnement de recette de la DGI si disponible avant
//      tout envoi en production.
// ============================================================================

const { create } = require('xmlbuilder2');

function buildTvaDeclarationXML(company, tvaData) {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('DeclarationTVA')
    .ele('Entreprise')
    .ele('ICE').txt(company.ice || '').up()
    .ele('IdentifiantFiscal').txt(company.if_fiscal || '').up()
    .ele('RaisonSociale').txt(company.raison_sociale || '').up()
    .up() // fin Entreprise
    .ele('Periode')
    .ele('DateDebut').txt(tvaData.periode.date_debut).up()
    .ele('DateFin').txt(tvaData.periode.date_fin).up()
    .up() // fin Periode
    .ele('Montants')
    .ele('TVACollectee').txt(String(tvaData.tva_collectee)).up()
    .ele('TVADeductibleCharges').txt(String(tvaData.tva_deductible_charges)).up()
    .ele('TVADeductibleImmobilisations').txt(String(tvaData.tva_deductible_immobilisations)).up()
    .ele('TVADueOuCredit').txt(String(tvaData.tva_due_ou_credit)).up()
    .up(); // fin Montants

  return doc.end({ prettyPrint: true });
}

module.exports = { buildTvaDeclarationXML };
