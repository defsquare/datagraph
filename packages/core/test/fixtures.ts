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

/** Un Order référence à la fois un Customer et un Product, les deux racines :
 * égalité de distance, donc chevauchement. */
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
 * l'un à l'autre — ce sont des frères, pas une chaîne. Sert à isoler
 * l'attraction du centre virtuel d'agrégat (qui relie chaque membre au même
 * centre) de la simple attraction par arête de référence directe : sans
 * centre, order_i et review_i ne se rapprocheraient que par le
 * voisin partagé customer_i, un effet transitif bien plus faible.
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
