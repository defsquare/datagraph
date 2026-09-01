import type { DataGraphConfig } from "../src/config.js"

export const shopData = {
  customers: [
    { id: "c1", name: "Dupont", email: "dupont@example.com",
      address: { street: "1 rue de la Paix", city: "Paris" } },
    { id: "c2", name: "Martin", email: "martin@example.com" },
  ],
  orders: [
    { id: "o1", customerId: "c1", total: 99.5,
      lines: [{ sku: "A-1", qty: 2 }, { sku: "B-7", qty: 1 }] },
    { id: "o2", customerId: "GHOST", total: 12 },
  ],
}

export const shopConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
}

/**
 * Un Order référence à la fois un Customer et un Product, les deux racines :
 * égalité de distance, donc ARBITRAGE. Ce fixture existait pour produire un
 * chevauchement ; il produit maintenant le cas limite de la règle de partition,
 * et c'est le même graphe qui sert : `Customer` est déclaré avant `Product`,
 * donc la commande lui revient et l'agrégat Product se réduit à sa racine.
 */
export const twoRootsData = {
  customers: [{ id: "c1", name: "Dupont" }],
  products: [{ id: "p9", name: "Vis" }],
  orders: [{ id: "o3", customerId: "c1", productId: "p9" }],
}

export const twoRootsConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Product: { match: "$.products[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer", productId: "Product" } },
  aggregates: ["Customer", "Product"],
}

/** Chaîne LineItem -> Order -> Customer : appartenance transitive à 2 sauts.
 * Et Customer -> Country, Country racine elle aussi : c'est le cas « hub »,
 * qui doit rester borné. */
export const chainData = {
  countries: [{ id: "fr", name: "France" }],
  customers: [{ id: "c1", name: "Dupont", countryId: "fr" }],
  orders: [{ id: "o1", customerId: "c1" }],
  lines: [{ id: "l1", orderId: "o1" }],
}

export const chainConfig: DataGraphConfig = {
  entities: {
    Country: { match: "$.countries[*]", id: "id" },
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    LineItem: { match: "$.lines[*]", id: "id" },
  },
  references: {
    Customer: { countryId: "Country" },
    Order: { customerId: "Customer" },
    LineItem: { orderId: "Order" },
  },
  aggregates: ["Customer", "Country"],
}

/** Génère ~`n` nœuds logiques pour les tests de perf/échelle. */
export function bigShop(n: number) {
  const customers = [], orders = []
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" } })
    orders.push({ id: `o${i}`, customerId: `c${i}`, total: i,
      lines: [{ sku: `S${i}`, qty: 1 }, { sku: `T${i}`, qty: 3 }] })
  }
  return { customers, orders }
}

/**
 * N triplets indépendants customer_i / order_i / review_i : order_i et
 * review_i référencent tous deux customer_i, mais AUCUNE arête ne les relie
 * l'un à l'autre — ce sont des frères, pas une chaîne. Sert à vérifier que le
 * regroupement visuel d'un agrégat n'a besoin d'aucun montage particulier :
 * order_i et review_i se rapprochent simplement parce qu'ils sont tous deux
 * tirés vers le même voisin partagé, customer_i, par leur propre arête de
 * référence.
 */
export function bigShopWithReviews(n: number) {
  const customers = [], orders = [], reviews = []
  for (let i = 0; customers.length * 8 + orders.length * 6 + reviews.length * 6 < n; i++) {
    customers.push({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" } })
    orders.push({ id: `o${i}`, customerId: `c${i}`, total: i })
    reviews.push({ id: `r${i}`, customerId: `c${i}`, stars: (i % 5) + 1 })
  }
  return { customers, orders, reviews }
}

export const bigShopReviewsConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    Review: { match: "$.reviews[*]", id: "id" },
  },
  references: {
    Order: { customerId: "Customer" },
    Review: { customerId: "Customer" },
  },
  aggregates: ["Customer"],
}

/**
 * Longueurs de valeur du champ `note`, en nombre de caractères. La table sert à
 * faire VARIER LA LARGEUR des cartes — `measureNode` dérive la largeur de la
 * ligne la plus longue —, et sa taille (7) est choisie **première avec les
 * arités** de l'arbre de `deepAggregate` (4, 3, 2, dont le PPCM est 12).
 *
 * PIÈGE DE PÉRIODICITÉ, et c'est la raison d'être de ce commentaire : indexer
 * cette table par un compteur dont la période divise une arité donnerait à
 * toutes les cartes d'un même anneau exactement la même largeur. Le placement
 * radial deviendrait alors un cas parfaitement régulier — anneaux de cartes
 * identiques —, et un test de non-recouvrement y passerait sans jamais exercer
 * le calcul de circonférence sur des largeurs hétérogènes, qui est précisément
 * ce que ce calcul doit gérer. 7 contre 12 garantit qu'un anneau mélange des
 * largeurs, et que deux anneaux consécutifs n'ont pas le même motif.
 */
const NOTE_LENGTHS = [3, 17, 8, 29, 5, 22, 11]

function noteOf(counter: number): string {
  return "x".repeat(NOTE_LENGTHS[counter % NOTE_LENGTHS.length]!)
}

/**
 * UN SEUL agrégat, gros et PROFOND — le cas qu'aucun autre fixture de ce
 * fichier ne produit. `bigShop` fait des agrégats de 2 cartes et le jeu de la
 * démo monte à 5 ; ici la chaîne de références descend sur quatre niveaux :
 *
 *   Customer  ←  Order  ←  OrderLine  ←  Serial
 *   distance 0    dist. 1    dist. 2      dist. 3
 *
 * Le sens est celui de l'appartenance (`buildAggregates` remonte les références
 * de la cible vers la source) : une commande *pointe vers* son client, une
 * ligne *pointe vers* sa commande. La distance d'appartenance est donc bien la
 * profondeur dans cet arbre, et c'est elle que le placement radial traduit en
 * anneaux.
 *
 * Par défaut : 1 + 4 + 12 + 24 = **41 cartes en un seul agrégat**. Les trois
 * arités sont paramétrables pour pousser plus haut (5, 3, 3 → 66 cartes) sans
 * toucher aux tests qui dépendent du défaut.
 *
 * L'arbre est volontairement DÉSÉQUILIBRÉ en largeur de carte (voir
 * `NOTE_LENGTHS`) et parfaitement équilibré en structure : le déséquilibre
 * qu'on veut mesurer est celui des tailles, pas celui des degrés, sans quoi on
 * ne saurait pas lequel des deux explique un résultat.
 */
export function deepAggregate(orders = 4, linesPerOrder = 3, serialsPerLine = 2) {
  const customers = [{ id: "c0", name: "Client profond", email: "c0@x.fr", segment: "grand compte" }]
  const orderRows = []
  const lines = []
  const serials = []

  // Un compteur unique pour tout l'arbre, et non un par niveau : deux cartes de
  // niveaux différents ne doivent pas hériter de la même largeur par accident
  // de synchronisation des compteurs.
  let counter = 0
  for (let i = 0; i < orders; i++) {
    orderRows.push({ id: `o${i}`, customerId: "c0", total: 100 + i, note: noteOf(counter++) })
    for (let j = 0; j < linesPerOrder; j++) {
      const lineId = `l${i}_${j}`
      lines.push({ id: lineId, orderId: `o${i}`, sku: `SKU-${i}-${j}`, note: noteOf(counter++) })
      for (let k = 0; k < serialsPerLine; k++) {
        serials.push({ id: `s${i}_${j}_${k}`, lineId, note: noteOf(counter++) })
      }
    }
  }
  return { customers, orders: orderRows, lines, serials }
}

export const deepAggregateConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    OrderLine: { match: "$.lines[*]", id: "id" },
    Serial: { match: "$.serials[*]", id: "id" },
  },
  references: {
    Order: { customerId: "Customer" },
    OrderLine: { orderId: "Order" },
    Serial: { lineId: "OrderLine" },
  },
  aggregates: ["Customer"],
}
