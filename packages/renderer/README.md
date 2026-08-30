# @defsquare/data-graph

jsoncrack-style visualization for complex objects — aggregates and entities,
with real reference edges — rendered on a Pixi.js canvas. See the
[root README](https://github.com/defsquare/data-graph#readme) for the full
pitch, entity/reference config format, public API table, themes, and
performance budgets.

## Install

```bash
pnpm add @defsquare/data-graph
```

## Quickstart

```ts
import { createDataGraph } from "@defsquare/data-graph";

const shopData = {
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
};

const shopConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
};

const container = document.getElementById("app")!;

const graph = createDataGraph(container, {
  data: shopData,
  config: shopConfig,
  elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
});

await graph.ready;
graph.fit();

graph.on("select", (node) => console.log("selected:", node.label));
```

`createDataGraph` returns a `DataGraph` handle with `fit`, `expand`,
`collapse`, `focus`, `select`, `search`, `nextMatch`, `prevMatch`, `on`,
`setData`, `diagnostics`, and `destroy` — full descriptions in the
[root README's API table](https://github.com/defsquare/data-graph#public-api--datagraph).

## Themes

Ships `defsquareTheme` (default), `neutralLightTheme`, `neutralDarkTheme`,
and a `ThemeOverride` type for per-instance customization. See the
[root README](https://github.com/defsquare/data-graph#themes) for details.

## License

MIT © 2026 Defsquare
