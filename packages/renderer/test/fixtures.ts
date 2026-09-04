import type { DataGraphConfig } from "@defsquare/data-graph-core";

// Duplique volontairement `packages/core/test/fixtures.ts` : le renderer est un
// consommateur du paquet publié et ne doit importer que son API publique,
// jamais ses fichiers de test. C'est la convention déjà suivie par la démo.

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

// Une référence portée par un VALUE OBJECT : `CartLine` n'a pas d'identité,
// donc pas d'entité ni de carte en vue graphe, mais elle porte `productRef`.
// C'est le cas dont le tracé doit être HISSÉ jusqu'à un ancêtre visible.
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
