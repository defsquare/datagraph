import type { DataGraphConfig } from "@defsquare/data-graph";

// Jeu de démonstration e-commerce. Volontairement dupliqué de
// `packages/core/test/fixtures.ts` : la démo est un consommateur des paquets
// publiés et n'a pas le droit d'importer les fichiers de test du cœur. Les deux
// fixtures ont divergé depuis longtemps — celle du cœur est figée par les
// comptes exacts de `build.test.ts` et `search.test.ts`, celle-ci suit les
// besoins de la démo. Ne pas les resynchroniser.
//
// AUCUN ALÉA ici : toutes les valeurs sortent de petites tables combinées par
// index. La mise en page de la vue graphe est déterministe au pixel près et les
// tests e2e épinglent des comptes exacts ; un seul `Math.random()` ferait
// tomber les deux.

/** Table des accents à plat : juste ce qu'il faut pour dériver une adresse
 * e-mail d'un nom français. Pas de `normalize("NFD")` — la table est plus
 * lisible et couvre exactement les caractères des tables ci-dessous. */
const ACCENTS: Record<string, string> = {
  à: "a", â: "a", ä: "a", ç: "c", é: "e", è: "e", ê: "e", ë: "e",
  î: "i", ï: "i", ô: "o", ö: "o", ù: "u", û: "u", ü: "u",
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[àâäçéèêëîïôöùûü]/g, (c) => ACCENTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const FIRST_NAMES = [
  "Camille", "Julien", "Amélie", "Nicolas", "Léa", "Thomas", "Chloé", "Maxime",
  "Sarah", "Antoine", "Manon", "Lucas", "Inès", "Hugo", "Émilie", "Raphaël",
  "Clara", "Baptiste", "Nadia", "Yanis",
];

const LAST_NAMES = [
  "Martin", "Bernard", "Dubois", "Petit", "Durand", "Leroy", "Moreau", "Simon",
  "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux",
  "Vincent", "Fournier", "Morel", "Girard", "Chevalier",
];

/** Vingt villes réelles, avec un code postal plausible pour chacune. */
const CITIES: { city: string; postcode: string }[] = [
  { city: "Paris", postcode: "75011" },
  { city: "Marseille", postcode: "13006" },
  { city: "Lyon", postcode: "69003" },
  { city: "Toulouse", postcode: "31000" },
  { city: "Nice", postcode: "06000" },
  { city: "Nantes", postcode: "44000" },
  { city: "Montpellier", postcode: "34000" },
  { city: "Strasbourg", postcode: "67000" },
  { city: "Bordeaux", postcode: "33000" },
  { city: "Lille", postcode: "59000" },
  { city: "Rennes", postcode: "35000" },
  { city: "Reims", postcode: "51100" },
  { city: "Toulon", postcode: "83000" },
  { city: "Saint-Étienne", postcode: "42000" },
  { city: "Le Havre", postcode: "76600" },
  { city: "Grenoble", postcode: "38000" },
  { city: "Dijon", postcode: "21000" },
  { city: "Angers", postcode: "49000" },
  { city: "Nîmes", postcode: "30000" },
  { city: "Villeurbanne", postcode: "69100" },
];

const STREETS = [
  "rue de la République", "avenue Jean Jaurès", "boulevard Victor Hugo",
  "rue des Lilas", "place du Marché", "impasse des Peupliers",
  "chemin des Vignes", "rue Gambetta", "allée des Tilleuls",
  "quai de la Loire", "rue Pasteur", "avenue de la Gare",
];

const SEGMENTS = ["nouveau", "fidèle", "VIP"];
const STATUSES = ["en attente", "payée", "expédiée", "livrée", "retournée"];
const PAYMENTS = ["carte bancaire", "PayPal", "virement", "chèque"];

/** Huit catégories, dont le préfixe sert aussi de préfixe de référence
 * produit. `Category` est une entité mais PAS une racine d'agrégat : elle est
 * tirée dans l'agrégat des produits qui la référencent. */
const CATEGORIES = [
  { name: "Informatique", prefix: "INF" },
  { name: "Mobilier", prefix: "MOB" },
  { name: "Cuisine", prefix: "CUI" },
  { name: "Audio", prefix: "AUD" },
  { name: "Jardin", prefix: "JAR" },
  { name: "Sport", prefix: "SPO" },
  { name: "Papeterie", prefix: "PAP" },
  { name: "Luminaire", prefix: "LUM" },
];

/** Catalogue écrit à la main : c'est la table qui porte le plus de
 * crédibilité, donc elle n'est pas combinée mais énumérée. `cat` indexe
 * `CATEGORIES`, `price` est en euros. */
const CATALOG: { name: string; cat: number; price: number }[] = [
  { name: "Clavier mécanique", cat: 0, price: 89.9 },
  { name: "Souris ergonomique", cat: 0, price: 45.5 },
  { name: "Écran 27 pouces", cat: 0, price: 249 },
  { name: "Station d'accueil USB-C", cat: 0, price: 129.9 },
  { name: "Disque SSD 1 To", cat: 0, price: 99 },
  { name: "Chaise de bureau", cat: 1, price: 189 },
  { name: "Bureau assis-debout", cat: 1, price: 499 },
  { name: "Étagère murale", cat: 1, price: 59.9 },
  { name: "Fauteuil de salon", cat: 1, price: 349 },
  { name: "Table basse en chêne", cat: 1, price: 219 },
  { name: "Robot pâtissier", cat: 2, price: 279 },
  { name: "Poêle inox 28 cm", cat: 2, price: 39.9 },
  { name: "Cafetière à piston", cat: 2, price: 24.5 },
  { name: "Couteau de chef", cat: 2, price: 64 },
  { name: "Bouilloire électrique", cat: 2, price: 34.9 },
  { name: "Casque bluetooth", cat: 3, price: 129 },
  { name: "Enceinte portable", cat: 3, price: 79.9 },
  { name: "Barre de son", cat: 3, price: 199 },
  { name: "Micro USB", cat: 3, price: 89 },
  { name: "Écouteurs sans fil", cat: 3, price: 149 },
  { name: "Tondeuse électrique", cat: 4, price: 229 },
  { name: "Arrosoir 10 L", cat: 4, price: 14.9 },
  { name: "Sécateur à crémaillère", cat: 4, price: 27.5 },
  { name: "Tapis de yoga", cat: 5, price: 29.9 },
  { name: "Haltères 2×5 kg", cat: 5, price: 44 },
  { name: "Sac de sport 40 L", cat: 5, price: 39 },
  { name: "Carnet A5 pointillé", cat: 6, price: 12.9 },
  { name: "Stylo plume", cat: 6, price: 49 },
  { name: "Lampe de bureau LED", cat: 7, price: 54.9 },
  { name: "Suspension en rotin", cat: 7, price: 79 },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Deux décimales, en centimes entiers : `129.9 * 3` vaut 389.70000000000005
 * en flottant, et un total qui traîne dix décimales trahit la génération
 * aussi sûrement qu'un total incohérent. */
function euros(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Address {
  street: string;
  postcode: string;
  city: string;
}

function addressOf(seed: number): Address {
  const place = CITIES[seed % CITIES.length]!;
  return {
    street: `${1 + ((seed * 7) % 180)} ${STREETS[(seed * 5) % STREETS.length]!}`,
    postcode: place.postcode,
    city: place.city,
  };
}

// --- Petit jeu, celui du chargement initial de la démo. Quatre types
// d'entités, une référence de chaque sorte, et UNE référence cassée
// (`o2.customerId` pointe sur un client qui n'existe pas) : c'est le seul
// diagnostic du jeu, et un test e2e compte dessus.
export const shopData = {
  categories: [
    { id: "cat1", name: "Informatique" },
    { id: "cat4", name: "Audio" },
  ],
  products: [
    {
      id: "p1",
      name: "Clavier mécanique",
      reference: "INF-1000",
      price: 89.9,
      stock: 42,
      categoryId: "cat1",
    },
    {
      id: "p16",
      name: "Casque bluetooth",
      reference: "AUD-1555",
      price: 129,
      stock: 17,
      categoryId: "cat4",
    },
  ],
  customers: [
    {
      id: "c1",
      name: "Camille Dubois",
      email: "camille.dubois@example.fr",
      address: { street: "1 rue de la Paix", postcode: "75002", city: "Paris" },
      segment: "VIP",
      signupDate: "2023-04-12",
    },
    {
      id: "c2",
      name: "Julien Martin",
      email: "julien.martin@example.fr",
      segment: "nouveau",
      signupDate: "2024-01-08",
    },
  ],
  orders: [
    {
      id: "o1",
      customerId: "c1",
      productId: "p1",
      quantity: 2,
      total: 179.8,
      status: "livrée",
      payment: "carte bancaire",
      date: "2024-03-05",
      shippingAddress: { street: "1 rue de la Paix", postcode: "75002", city: "Paris" },
    },
    {
      id: "o2",
      customerId: "GHOST",
      productId: "p16",
      quantity: 1,
      total: 129,
      status: "en attente",
      payment: "PayPal",
      date: "2024-03-11",
    },
  ],
};

export const shopConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    Product: { match: "$.products[*]", id: "id" },
    Category: { match: "$.categories[*]", id: "id" },
  },
  references: {
    Order: { customerId: "Customer", productId: "Product" },
    Product: { categoryId: "Category" },
  },
  rootLabel: "Boutique",
  aggregates: ["Customer", "Product"],
};

// Coût en nœuds logiques d'une entité, tel que les compte `buildGraph` : le
// nœud lui-même, plus une unité par ligne scalaire, plus les objets imbriqués
// et leurs lignes. Un client vaut 10 (1 + 5 lignes + 1 objet adresse + 3
// lignes), une commande 13 (1 + 8 lignes + 1 objet adresse + 3 lignes), un
// produit 7 et une catégorie 3. Le squelette — racine plus quatre tableaux —
// en vaut 5. Ces chiffres pilotent la boucle ci-dessous ; s'ils dérivent des
// champs réels, `bigShop(n)` ne rend plus ~`n` nœuds.
const COST_CUSTOMER = 10;
const COST_ORDER = 13;
const COST_PRODUCT = 7;
const COST_CATEGORY = 3;
const COST_SKELETON = 5;

/**
 * Génère ~`n` nœuds logiques d'un jeu e-commerce : catalogue fixe (8
 * catégories, 30 produits), puis autant de clients qu'il en faut, avec 2 à 4
 * commandes chacun pour que le regroupement par agrégat soit visible.
 *
 * Les valeurs sont tirées de tables combinées par index, avec des pas premiers
 * entre eux avec la taille des tables : deux cartes voisines ne partagent ni
 * prénom, ni nom, ni ville, ni produit commandé. Et le `total` d'une commande
 * vaut EXACTEMENT le prix du produit référencé fois la quantité — un total
 * incohérent est ce qui trahit le plus vite une donnée fabriquée.
 */
export function bigShop(n: number) {
  const categories = CATEGORIES.map((c, i) => ({ id: `cat${i + 1}`, name: c.name }));

  const products = CATALOG.map((item, i) => ({
    id: `p${i + 1}`,
    name: item.name,
    reference: `${CATEGORIES[item.cat]!.prefix}-${1000 + i * 37}`,
    price: item.price,
    stock: 3 + ((i * 17) % 140),
    categoryId: `cat${item.cat + 1}`,
  }));

  const customers: {
    id: string;
    name: string;
    email: string;
    address: Address;
    segment: string;
    signupDate: string;
  }[] = [];
  const orders: {
    id: string;
    customerId: string;
    productId: string;
    quantity: number;
    total: number;
    status: string;
    payment: string;
    date: string;
    shippingAddress: Address;
  }[] = [];

  const fixed =
    COST_SKELETON + categories.length * COST_CATEGORY + products.length * COST_PRODUCT;
  let orderSeq = 0;
  for (
    let i = 0;
    fixed + customers.length * COST_CUSTOMER + orders.length * COST_ORDER < n;
    i++
  ) {
    // Le couple (prénom, nom) est unique tant que i < 400 : le prénom avance
    // d'un cran par client, le nom de sept — premier avec 20, donc il balaie
    // toute la table — et d'un cran de plus à chaque tour complet des prénoms.
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last =
      LAST_NAMES[(i * 7 + Math.floor(i / FIRST_NAMES.length)) % LAST_NAMES.length]!;
    const address = addressOf(i);
    customers.push({
      id: `c${i}`,
      name: `${first} ${last}`,
      email: `${slug(first)}.${slug(last)}@example.fr`,
      address,
      segment: SEGMENTS[i % SEGMENTS.length]!,
      signupDate: `2023-${pad2(1 + (i % 12))}-${pad2(1 + ((i * 7) % 28))}`,
    });

    const count = 2 + (i % 3);
    for (let k = 0; k < count; k++) {
      // 7 et 11 sont premiers avec la taille du catalogue (30) : le panier
      // balaie tout le catalogue quand `i` avance, et deux clients voisins
      // n'achètent pas les mêmes produits. Un pas non premier avec 30 — le
      // premier écrit ici était 5 — découpe le catalogue en classes
      // résiduelles : le client `i` et le client `i+6` commandaient alors
      // exactement le même panier, et six produits n'étaient jamais vendus.
      const product = products[(i * 7 + k * 11) % products.length]!;
      const quantity = 1 + ((i + k) % 3);
      orders.push({
        id: `o${orderSeq++}`,
        customerId: `c${i}`,
        productId: product.id,
        quantity,
        total: euros(product.price * quantity),
        status: STATUSES[(i + k * 2) % STATUSES.length]!,
        payment: PAYMENTS[(i * 3 + k) % PAYMENTS.length]!,
        // Toutes les commandes tombent en 2024, toutes les inscriptions en
        // 2023 : une commande est toujours postérieure à l'inscription du
        // client qui la passe, sans avoir à comparer des dates.
        date: `2024-${pad2(1 + ((i + k) % 12))}-${pad2(1 + ((i * 5 + k * 3) % 28))}`,
        // Livraison chez le client, sauf une commande sur sept expédiée
        // ailleurs — assez pour que la colonne ne soit pas une copie de
        // l'adresse du client sur toutes les cartes.
        shippingAddress: (i + k) % 7 === 0 ? addressOf(i + 13) : address,
      });
    }
  }
  return { categories, products, customers, orders };
}

export const bigShopData = bigShop(4000);
