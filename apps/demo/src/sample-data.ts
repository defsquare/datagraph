import type { DataGraphConfig } from "@defsquare/data-graph";

// Duplicated from packages/core/test/fixtures.ts on purpose: the demo is a
// consumer of the published packages and must not import core's test files.

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
};

/** Generates ~`n` logical nodes worth of shop data, for scale testing. */
export function bigShop(n: number) {
  const customers = [];
  const orders = [];
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({
      id: `c${i}`,
      name: `Client ${i}`,
      email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" },
    });
    orders.push({
      id: `o${i}`,
      customerId: `c${i}`,
      total: i,
      lines: [
        { sku: `S${i}`, qty: 1 },
        { sku: `T${i}`, qty: 3 },
      ],
    });
  }
  return { customers, orders };
}

export const bigShopData = bigShop(2000);
