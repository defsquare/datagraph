import type { DataGraphConfig } from "@defsquare/datagraph";

// E-commerce demo dataset. Deliberately duplicated from
// `packages/core/test/fixtures.ts`: the demo is a consumer of the published
// packages and is not allowed to import the core's test files. The two fixtures
// diverged long ago — the core's is pinned by the exact counts in
// `build.test.ts` and `search.test.ts`, this one follows the demo's needs. Do
// not resynchronize them.
//
// NO RANDOMNESS here: every value comes out of small tables combined by index.
// The graph view layout is deterministic to the pixel and the e2e tests pin
// exact counts; a single `Math.random()` would take down both.

/** Flat accent table: just enough to derive an e-mail address from a French
 * name. No `normalize("NFD")` — the table is more readable and covers exactly
 * the characters of the tables below. */
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

/** Twenty real cities, each with a plausible postcode. */
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

/** Eight categories, whose prefix doubles as the product reference prefix.
 * `Category` is an entity but NOT an aggregate root, and it belongs to NO
 * aggregate: membership walks references up towards the root, and a product
 * points TO its category, never the other way round. The eight categories are
 * therefore drawn alone, without an envelope — this is the "entity outside every
 * aggregate" case the demo exercises for real. (The previous comment claimed
 * they were pulled into the aggregate of the products referencing them: that was
 * wrong, and backwards.) */
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

/** Hand-written catalogue: this is the table that carries the most credibility,
 * so it is enumerated rather than combined. `cat` indexes `CATEGORIES`, `price`
 * is in euros. */
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

/** Two decimals, through whole cents: `129.9 * 3` is 389.70000000000005 in
 * floating point, and a total trailing ten decimals gives the generation away as
 * surely as an inconsistent one. */
function euros(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Address {
  street: string;
  postcode: string;
  city: string;
}

function addressOf(seed: number): Address {
  // The city is NOT `seed % 20`. The customer's first name is also drawn modulo
  // 20 (`FIRST_NAMES` holds exactly that many), and two indices modulo the same
  // size lock onto each other: every Camille would live in Paris, every Julien
  // in Marseille, on cards that display both fields. And no mere factor
  // uncrosses them, since the result would still depend only on `seed % 20`. The
  // period has to be broken: a step of 7 sweeps the table, and the `+ seed / 20`
  // shifts it by one on every full pass over the first names, so a given first
  // name is seen with four different cities across the 78 customers.
  const place = CITIES[(seed * 7 + Math.floor(seed / CITIES.length)) % CITIES.length]!;
  return {
    street: `${1 + ((seed * 7) % 180)} ${STREETS[(seed * 5) % STREETS.length]!}`,
    postcode: place.postcode,
    city: place.city,
  };
}

// --- Small dataset, the one the demo loads on startup. Four entity types, one
// reference of each kind, and ONE broken reference (`o2.customerId` points at a
// customer that does not exist): it is the dataset's only diagnostic, and an e2e
// test counts on it.
//
// It also exercises BOTH array shapes, which no data in the small dataset used
// to produce: `p1.tags` (scalars) for the "items rendered as indexed rows of the
// array card, hence no badge" shape, and `p16.reviews` (objects) for the "one
// item = one child card, and the badge counts children" shape. Both are only
// visible in structure view, the graph view showing entities only.
//
// `reviews[*].customerId` is THE reference carried by a value object in this
// dataset: declared by relative path on `Product`, resolved on the
// `reviews[0]`/`reviews[1]` cards, hoisted onto `#p16` when the array is
// collapsed or in graph view. It RESOLVES (c1 and c2 exist), so the diagnostic
// count stays at 1 — `author`, for its part, remains free text.
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
      tags: ["mécanique", "rétroéclairé", "USB-C"],
    },
    {
      id: "p16",
      name: "Casque bluetooth",
      reference: "AUD-1555",
      price: 129,
      stock: 17,
      categoryId: "cat4",
      reviews: [
        {
          author: "Camille Dubois",
          customerId: "c1",
          rating: 5,
          comment: "Confortable sur une journée entière, autonomie tenue.",
        },
        {
          author: "Julien Martin",
          customerId: "c2",
          rating: 4,
          comment: "Bonne réduction de bruit, l'étui aurait pu être plus rigide.",
        },
      ],
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
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    Product: "$.products[*].id",
    Category: "$.categories[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId", to: "$.products[*].id" },
    { from: "$.products[*].categoryId", to: "$.categories[*].id" },
    { from: "$.products[*].reviews[*].customerId", to: "$.customers[*].id" },
  ],
  rootLabel: "Boutique",
  groups: ["Customer", "Product"],
};

// The large dataset has NO reviews: keeping the `reviews[*].customerId`
// declaration on it would raise a perfectly legitimate `unresolved-reference` —
// no Product instance carries that row — but the demo's status bar would then
// display a diagnostic that reads as a bug. Hence a config of its own for the
// large dataset, identical bar one removal.
export const bigShopConfig: DataGraphConfig = {
  ...shopConfig,
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId", to: "$.products[*].id" },
    { from: "$.products[*].categoryId", to: "$.categories[*].id" },
  ],
};

// An entity's cost in logical nodes, as `buildGraph` counts them: the node
// itself, plus one per scalar row, plus nested objects and their rows. A
// customer is worth 10 (1 + 5 rows + 1 address object + 3 rows), an order 13
// (1 + 8 rows + 1 address object + 3 rows), a product 7 and a category 3. The
// skeleton — root plus four arrays — is worth 5. These figures drive the loop
// below; should they drift from the real fields, `bigShop(n)` no longer returns
// ~`n` nodes.
const COST_CUSTOMER = 10;
const COST_ORDER = 13;
const COST_PRODUCT = 7;
const COST_CATEGORY = 3;
const COST_SKELETON = 5;

/**
 * Generates ~`n` logical nodes of an e-commerce dataset: a fixed catalogue (8
 * categories, 30 products), then as many customers as needed, with 2 to 4 orders
 * each so that aggregate grouping is visible.
 *
 * Values are drawn from tables combined by index, with steps coprime to the size
 * of the table they walk: two neighbouring cards share neither first name, nor
 * last name, nor city, nor signup date, nor ordered product. And an order's
 * `total` is EXACTLY the referenced product's price times the quantity — an
 * inconsistent total is what gives fabricated data away fastest.
 *
 * Two periodicity traps, both fallen into once in this file and fixed, not to be
 * reintroduced:
 *
 * 1. **A step not coprime to the table size** only walks part of it. `(i * 5) %
 *    30` over the catalogue served only 24 products out of 30 and gave customer
 *    `i` and customer `i+6` the same basket; `(i * 7) % 28` over the day of the
 *    month only ever returned the 1st, the 8th, the 15th and the 22nd.
 * 2. **Two fields drawn modulo the SAME size lock onto each other**, even with
 *    different steps: first name and city, both modulo 20, gave one city per
 *    first name. The period has to be broken, not merely the factor changed (see
 *    `addressOf`).
 *
 * Measured over the 78 customers produced: 78 distinct names, 78 distinct
 * e-mails, 78 distinct signup dates, 78 distinct streets, 78 distinct
 * (first name, city) pairs, every first name seen with 3 or 4 cities, and 0
 * inconsistent totals across the 234 orders.
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
    // The (first name, last name) pair is unique as long as i < 400: the first
    // name advances by one per customer, the last name by seven — coprime with
    // 20, so it sweeps the whole table — plus one more on every full pass over
    // the first names.
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
      // Day with a step of 11, COPRIME with 28. The step of 7 written here at
      // first only ever returned {0, 7, 14, 21} — every customer signed up on a
      // 1st, 8th, 15th or 22nd — and, crossed with a month of period 12, left
      // only lcm(12, 4) = 12 distinct dates for 78 customers. With 11: period
      // lcm(12, 28) = 84, hence 78 all-different dates.
      signupDate: `2023-${pad2(1 + (i % 12))}-${pad2(1 + ((i * 11) % 28))}`,
    });

    const count = 2 + (i % 3);
    for (let k = 0; k < count; k++) {
      // 7 and 11 are coprime with the catalogue size (30): the basket sweeps the
      // whole catalogue as `i` advances, and two neighbouring customers do not
      // buy the same products. A step not coprime with 30 — the first one
      // written here was 5 — cuts the catalogue into residue classes: customer
      // `i` and customer `i+6` then ordered exactly the same basket, and six
      // products were never sold.
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
        // Every order falls in 2024, every signup in 2023: an order is always
        // later than the signup of the customer placing it, with no date
        // comparison needed.
        date: `2024-${pad2(1 + ((i + k) % 12))}-${pad2(1 + ((i * 5 + k * 3) % 28))}`,
        // Delivery to the customer, except for one order in seven shipped
        // elsewhere — enough for the column not to be a copy of the customer's
        // address on every card.
        shippingAddress: (i + k) % 7 === 0 ? addressOf(i + 13) : address,
      });
    }
  }
  return { categories, products, customers, orders };
}

// NO `export const bigShopData = bigShop(4000)` here: a top-level call runs at
// module load, hence on every demo startup — and, as long as this file was
// statically imported by `main.ts`, all the way into the CLI's file mode, which
// has no use for a sample dataset. Generation is triggered on demand by
// `demo-mode.ts`.
