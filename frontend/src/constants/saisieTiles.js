// Options du menu "Saisie", partagées entre la page Saisie et le menu
// déroulant de la barre d'outils.
export const SAISIE_TILES = [
  { icon: '🧾', title: 'Factures de Ventes', desc: 'Saisie des ventes clients', to: '/factures?type=vente' },
  { icon: '📘', title: "Factures d'Achats", desc: 'Saisie des achats fournisseurs', to: '/factures?type=achat' },
  { icon: '✍️', title: 'Par Pièces', desc: 'Écriture libre en partie double', to: '/ecritures' },
  { icon: '🏦', title: 'Relevés Bancaires', desc: 'Saisie du relevé, frais bancaires, virements de fonds', to: '/releve-bancaire' },
  { icon: '🔗', title: 'Lettrage', desc: 'Rapprocher manuellement facture ↔ règlement', to: '/lettrage' },
  { icon: '💰', title: 'Encaissement Clients', desc: 'Règlements reçus des clients', to: '/factures?type=vente' },
  { icon: '💸', title: 'Paiement Fournisseurs', desc: 'Écran de règlement fournisseur, avec lettrage', to: '/paiement-fournisseur' },
  { icon: '🛡️', title: 'CNSS / AMO', desc: 'Bordereau de cotisations : saisie manuelle ou scan', to: '/cnss' },
  { icon: '📷', title: "Scan Factures d'Achats", desc: 'Saisie automatique par photo', to: '/scan?type=achat' },
  { icon: '📷', title: 'Scan Factures de Vente', desc: 'Saisie automatique par photo', to: '/scan?type=vente' },
  { icon: '📷', title: 'Scan Relevé Bancaire', desc: 'Saisie automatique par photo ou PDF', to: '/scan?type=releve' },
];
