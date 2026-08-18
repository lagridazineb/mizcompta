// Options standardisées pour les fiches sociétés, afin d'éviter la saisie libre
// (et les fautes de frappe) pour les champs qui n'ont qu'un nombre limité de valeurs.

export const FORMES_JURIDIQUES = [
  'SARL',
  'SARL AU (Associé Unique)',
  'SA',
  'SNC (Société en Nom Collectif)',
  'SCS (Société en Commandite Simple)',
  'SCA (Société en Commandite par Actions)',
  'Société en participation',
  'Auto-entrepreneur',
  'Personne physique',
  'Association',
  'Coopérative',
  'Succursale',
  'Autre',
];

export const MODES_DECLARATION = [
  { value: 'mensuel', label: 'Mensuel' },
  { value: 'trimestriel', label: 'Trimestriel' },
];

// Type de plan comptable appliqué à la création du dossier : seul
// SECT.IMMOBILIER change le plan de comptes initial (comptes de stocks —
// terrains, programmes en cours… — et charges/produits propres au métier,
// tirés du Plan Comptable du Secteur Immobilier, CNC juin 2022) ; les 3
// autres types utilisent le Plan Comptable Général Marocain standard.
export const TYPES_PC = ['ENTREPRISE', 'SECT.IMMOBILIER', 'ASSOCIATION', 'PERSONNE PHYSIQUE'];

// Liste non exhaustive utilisée par l'OCR pour deviner la ville depuis un
// document scanné (registre de commerce, patente...).
export const VILLES_MAROC = [
  'Casablanca', 'Rabat', 'Tanger', 'Marrakech', 'Fès', 'Fes', 'Agadir', 'Tétouan', 'Tetouan',
  'Meknès', 'Meknes', 'Oujda', 'Kénitra', 'Kenitra', 'Salé', 'Sale', 'Nador', 'Settat',
  'El Jadida', 'Béni Mellal', 'Beni Mellal', 'Khouribga', 'Guelmim', 'Berkane', 'Taza',
  'Larache', 'Khemisset', 'Errachidia', 'Safi', 'Essaouira', 'Ouarzazate', 'Al Hoceima',
  'Dakhla', 'Laâyoune', 'Laayoune', 'Mohammedia', 'Témara', 'Temara', 'Khénifra', 'Ifrane',
  'Chefchaouen',
];
