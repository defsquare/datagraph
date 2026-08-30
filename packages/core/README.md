# @defsquare/data-graph-core

Headless graph engine for [`data-graph`](https://github.com/defsquare/data-graph)
(see the [root README](https://github.com/defsquare/data-graph#readme) for
the full pitch, entity/reference config, and performance budgets).

This package has no rendering dependency: it builds a graph from arbitrary
JSON plus an entity/reference config, tracks expand/collapse state, indexes
it for search, and lays it out via [elkjs](https://github.com/kieler/elkjs).
If you want the interactive Pixi.js canvas, use
[`@defsquare/data-graph`](https://www.npmjs.com/package/@defsquare/data-graph)
instead — it depends on this package.

## Install

```bash
pnpm add @defsquare/data-graph-core
```

## Quickstart

```ts
import { buildGraph, buildSearchIndex, CollapseState, createLayoutEngine } from "@defsquare/data-graph-core";

const data = {
  customers: [{ id: "c1", name: "Dupont" }],
  orders: [{ id: "o1", customerId: "c1", total: 99.5 }],
};

const config = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
};

const graph = buildGraph(data, config);
const collapseState = new CollapseState(graph);
const searchIndex = buildSearchIndex(graph);

const engine = createLayoutEngine();
const layout = await engine.layout(graph, collapseState.visibleNodeIds());

searchIndex.search("dupont"); // -> SearchResult[]
```

## API surface

`buildGraph`, `CollapseState`, `buildSearchIndex` / `SearchIndex`,
`createLayoutEngine`, `measureNode`, `validateConfig`, plus the `Graph`,
`GraphNode`, `RefEdge`, `Diagnostic`, `DataGraphConfig` types. See the
[root README](https://github.com/defsquare/data-graph#readme) for the config
shape and `packages/core/src/index.ts` for the full export list.

## License

MIT © 2026 Defsquare
