import type { DataGraphConfig } from "@defsquare/data-graph-core";

// Deliberately duplicates `packages/core/test/fixtures.ts`: the renderer is a
// consumer of the published package and must import only its public API, never
// its test files. That is the convention the demo already follows.

export const shopData = {
  customers: [
    {
      id: "c1",
      name: "Dupont",
      email: "dupont@example.com",
      address: { street: "1 rue de la Paix", city: "Paris" },
    },
    { id: "c2", name: "Martin", email: "martin@example.com" },
  ],
  orders: [
    { id: "o1", customerId: "c1", total: 99.5, lines: [{ sku: "A-1", qty: 2 }, { sku: "B-7", qty: 1 }] },
    { id: "o2", customerId: "GHOST", total: 12 },
  ],
};

export const shopConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
};

// A reference carried by a VALUE OBJECT: `CartLine` has no identity, hence no
// entity and no card in graph view, yet it carries `productRef`. This is the
// case whose stroke must be LIFTED up to a visible ancestor.
export const cartData = {
  carts: [{ id: "k1", lines: [{ sku: "A-1", productRef: "p1" }] }],
  products: [{ id: "p1", name: "Clavier" }],
};

export const cartConfig: DataGraphConfig = {
  ids: {
    Cart: "$.carts[*].id",
    Product: "$.products[*].id",
  },
  refs: [{ from: "$.carts[*].lines[*].productRef", to: "$.products[*].id" }],
};
