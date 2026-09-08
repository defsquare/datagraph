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
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
}

/**
 * An Order references both a Customer and a Product, both roots: a distance tie,
 * hence a TIE-BREAK. This fixture used to exist to produce an overlap; it now
 * produces the edge case of the partition rule, and the same graph serves:
 * `Customer` is declared before `Product`, so the order goes to it and the
 * Product aggregate reduces to its root.
 */
export const twoRootsData = {
  customers: [{ id: "c1", name: "Dupont" }],
  products: [{ id: "p9", name: "Vis" }],
  orders: [{ id: "o3", customerId: "c1", productId: "p9" }],
}

export const twoRootsConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Product: "$.products[*].id",
    Order: "$.orders[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId", to: "$.products[*].id" },
  ],
  groups: ["Customer", "Product"],
}

/** Chain LineItem -> Order -> Customer: transitive membership over 2 hops.
 * And Customer -> Country, with Country a root too: the "hub" case, which must
 * stay bounded. */
export const chainData = {
  countries: [{ id: "fr", name: "France" }],
  customers: [{ id: "c1", name: "Dupont", countryId: "fr" }],
  orders: [{ id: "o1", customerId: "c1" }],
  lines: [{ id: "l1", orderId: "o1" }],
}

export const chainConfig: DataGraphConfig = {
  ids: {
    Country: "$.countries[*].id",
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    LineItem: "$.lines[*].id",
  },
  refs: [
    { from: "$.customers[*].countryId", to: "$.countries[*].id" },
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.lines[*].orderId", to: "$.orders[*].id" },
  ],
  groups: ["Customer", "Country"],
}

/** Generates ~`n` logical nodes for the perf/scale tests. */
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
 * N independent triples customer_i / order_i / review_i: order_i and review_i
 * both reference customer_i, but NO edge links them to each other — they are
 * siblings, not a chain. Used to check that an aggregate's visual grouping needs
 * no special rigging: order_i and review_i simply move closer because both are
 * pulled towards the same shared neighbour, customer_i, by their own reference
 * edge.
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
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    Review: "$.reviews[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.reviews[*].customerId", to: "$.customers[*].id" },
  ],
  groups: ["Customer"],
}

/**
 * Value lengths for the `note` field, in characters. The table exists to VARY
 * THE WIDTH of the cards — `measureNode` derives the width from the longest row
 * — and its size (7) is chosen **coprime with the arities** of `deepAggregate`'s
 * tree (4, 3, 2, whose LCM is 12).
 *
 * PERIODICITY TRAP, and this is the reason this comment exists: indexing this
 * table by a counter whose period divides an arity would give every card of the
 * same ring exactly the same width. Radial placement would then become a
 * perfectly regular case — rings of identical cards — and a non-overlap test
 * would pass without ever exercising the circumference computation on
 * heterogeneous widths, which is precisely what that computation must handle. 7
 * against 12 guarantees that a ring mixes widths, and that two consecutive rings
 * do not share a pattern.
 */
const NOTE_LENGTHS = [3, 17, 8, 29, 5, 22, 11]

function noteOf(counter: number): string {
  return "x".repeat(NOTE_LENGTHS[counter % NOTE_LENGTHS.length]!)
}

/**
 * ONE aggregate, big and DEEP — the case no other fixture in this file produces.
 * `bigShop` makes 2-card aggregates and the demo data set reaches 5; here the
 * reference chain runs down four levels:
 *
 *   Customer  ←  Order  ←  OrderLine  ←  Serial
 *   distance 0    dist. 1    dist. 2      dist. 3
 *
 * The direction is that of membership (`buildAggregates` walks references back
 * from target to source): an order *points at* its customer, a line *points at*
 * its order. Membership distance is therefore the depth in this tree, and that
 * is what radial placement translates into rings.
 *
 * By default: 1 + 4 + 12 + 24 = **41 cards in a single aggregate**. The three
 * arities are parameterizable to push higher (5, 3, 3 → 66 cards) without
 * touching the tests that depend on the default.
 *
 * The tree is deliberately UNBALANCED in card width (see `NOTE_LENGTHS`) and
 * perfectly balanced in structure: the imbalance we want to measure is the one
 * in sizes, not the one in degrees, otherwise we could not tell which of the two
 * explains a result.
 */
export function deepAggregate(orders = 4, linesPerOrder = 3, serialsPerLine = 2) {
  const customers = [{ id: "c0", name: "Client profond", email: "c0@x.fr", segment: "grand compte" }]
  const orderRows = []
  const lines = []
  const serials = []

  // A single counter for the whole tree, not one per level: two cards from
  // different levels must not inherit the same width by an accident of counter
  // synchronization.
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

/**
 * A dense INTER-CLUSTER graph — the adversity no other fixture in the repo
 * produces, and reservation #5 from the two-level engine's probe ("the final
 * hard pass can undo a spring; a very dense inter-aggregate graph could degrade
 * — not probed").
 *
 * **The shape of adversity encoded here.** Two roots are declared, `Customer`
 * and `Product`. Every order references its customer AND four products; by
 * tie-break (`Customer` declared first) it belongs to the customer's aggregate,
 * so its four product references are all INTER-cluster. Every product, being a
 * root, is a single-card cluster with many references.
 *
 * At the default values (40 customers, 40 products, 3 orders of 4 products):
 * **200 cards, 80 clusters, 480 inter-cluster edges**, i.e. an average degree of
 * **12.0** and a max degree of **12** — against 4.6 on average for the demo data
 * set, the densest we had, and 0 on `bigShop`.
 *
 * The graph is therefore **REGULAR**: each customer touches exactly 12 products
 * and each product exactly 12 customers, by construction. That is deliberate and
 * is what makes it a good calibration fixture — the spring load is the same
 * everywhere, so what we measure is the effect of a constant and not that of a
 * degree heterogeneity. Put differently: it encodes PURE density, without
 * confounding it with shape.
 *
 * **The "hub" adversity is reachable by parameter**, and is not the default:
 * reducing the number of products concentrates references on fewer roots.
 * Measured — `denseRefs(40, 12)` gives 52 clusters, average degree 15.4 and
 * **max 34**; `denseRefs(40, 8)` gives 48 clusters, average 13.3 and **max 40**.
 * These are two different adversities: the first (default) loads every edge
 * equally, the second pulls a small number of clusters in all directions at
 * once. Calibration is done on the first; the second stays available to probe
 * the reservation "does a heavily referenced hub degrade?" without having to
 * write yet another fixture.
 *
 * **Choice of products, and why those three numbers.** The product index is
 * `(7·i + 13·j + 17·k) mod P` — customer i, order j, position k. 7, 13 and 17
 * are coprime with P = 40, hence: two positions of the same order never land on
 * the same product (the four values of `17k mod 40` are distinct), two orders of
 * the same customer do not fully overlap, and two customers do not draw the same
 * bundle. A step sharing a factor with P would fold everyone onto a subset of
 * the products: the graph would look dense in edge count while having only a
 * handful of hubs, and the fixture would measure something other than what it
 * advertises.
 */
export function denseRefs(customers = 40, products = 40, orders = 3, perOrder = 4) {
  const customerRows = []
  const productRows = []
  const orderRows = []

  for (let p = 0; p < products; p++) {
    productRows.push({ id: `p${p}`, name: `Produit ${p}`, price: 10 + p })
  }
  for (let i = 0; i < customers; i++) {
    customerRows.push({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@x.fr` })
    for (let j = 0; j < orders; j++) {
      const order: Record<string, unknown> = { id: `o${i}_${j}`, customerId: `c${i}`, total: i + j }
      for (let k = 0; k < perOrder; k++) {
        order[`productId${k}`] = `p${(7 * i + 13 * j + 17 * k) % products}`
      }
      orderRows.push(order)
    }
  }
  return { customers: customerRows, products: productRows, orders: orderRows }
}

export const denseRefsConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Product: "$.products[*].id",
    Order: "$.orders[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId0", to: "$.products[*].id" },
    { from: "$.orders[*].productId1", to: "$.products[*].id" },
    { from: "$.orders[*].productId2", to: "$.products[*].id" },
    { from: "$.orders[*].productId3", to: "$.products[*].id" },
  ],
  // `Customer` first: the tie-break gives it the orders, and the product
  // references all become inter-cluster. Reversing the order would give the
  // orders to the products and change the shape entirely.
  groups: ["Customer", "Product"],
}

export const deepAggregateConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    OrderLine: "$.lines[*].id",
    Serial: "$.serials[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.lines[*].orderId", to: "$.orders[*].id" },
    { from: "$.serials[*].lineId", to: "$.lines[*].id" },
  ],
  groups: ["Customer"],
}
