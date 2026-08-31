import type { DataGraphConfig } from "@defsquare/data-graph";

// Duplicated from packages/core/test/fixtures.ts on purpose: the demo is a
// consumer of the published packages and must not import core's test files.
// `bigShop` here has deliberately diverged from core's version since the
// graph view was added: it gives 2 to 4 orders per customer so aggregate
// grouping is visible, instead of core's fixed 1:1 pairing. Don't resync it.

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
    {
      id: "o1",
      customerId: "c1",
      total: 99.5,
      lines: [
        { sku: "A-1", qty: 2 },
        { sku: "B-7", qty: 1 },
      ],
    },
    { id: "o2", customerId: "GHOST", total: 12 },
  ],
};

export const shopConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
  rootLabel: "Boutique",
  aggregates: ["Customer"],
};

/** Génère ~`n` nœuds logiques, avec 2 à 4 commandes par client pour que le
 * regroupement par agrégat soit visible. Diverge volontairement de
 * `packages/core/test/fixtures.ts`, dont `build.test.ts` et `search.test.ts`
 * dépendent des comptes exacts : ne pas resynchroniser ces deux-là. */
export function bigShop(n: number) {
  const customers = [];
  const orders = [];
  let orderSeq = 0;
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({
      id: `c${i}`,
      name: `Client ${i}`,
      email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" },
    });
    const count = 2 + (i % 3);
    for (let k = 0; k < count; k++) {
      orders.push({
        id: `o${orderSeq++}`,
        customerId: `c${i}`,
        total: i * 10 + k,
        lines: [{ sku: `S${i}-${k}`, qty: 1 }],
      });
    }
  }
  return { customers, orders };
}

export const bigShopData = bigShop(2000);
