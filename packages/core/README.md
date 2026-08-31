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

## Aggregates

`config.aggregates` names the entity types that are DDD aggregate roots, in
declaration order:

```ts
const config = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
  aggregates: ["Customer"],
};
```

`buildAggregates(graph, config): AggregateIndex` computes membership from a
built `Graph`:

```ts
interface Aggregate {
  id: string; // `${rootType}#${rootEntityId}`
  rootId: NodeId;
  rootType: string;
  memberIds: Set<NodeId>; // includes rootId
}

interface AggregateIndex {
  aggregates: Map<string, Aggregate>;
  byNode: Map<NodeId, string[]>; // several entries for one node = overlap
}
```

**The membership rule:** an entity `E` belongs to the aggregate rooted at `R`
iff `d(E, R) = dmin(E)`, where `d` is the minimal number of outgoing
references leading from `E` to `R`, and `dmin(E)` is the minimum of `d` over
every root `E` can reach. A root is at distance `0` from itself.

This has three consequences worth knowing:

- **Overlap when distances tie.** An entity that reaches two roots at the
  same minimal distance belongs to both. Given both `Customer` and `Product`
  declared as roots, and an `Order` referencing one of each:

  ```ts
  const data = {
    customers: [{ id: "c1", name: "Dupont" }],
    products: [{ id: "p9", name: "Vis" }],
    orders: [{ id: "o3", customerId: "c1", productId: "p9" }],
  };
  const config = {
    entities: {
      Customer: { match: "$.customers[*]", id: "id" },
      Product: { match: "$.products[*]", id: "id" },
      Order: { match: "$.orders[*]", id: "id" },
    },
    references: { Order: { customerId: "Customer", productId: "Product" } },
    aggregates: ["Customer", "Product"],
  };
  // -> byNode.get("/orders/0") === ["Customer#c1", "Product#p9"]
  ```

- **Transitivity.** Membership isn't limited to direct references: a
  `LineItem` two hops from a `Customer` (`LineItem -> Order -> Customer`)
  joins the `Customer` aggregate, as long as `Customer` is the nearest root
  it can reach.

- **Hub-boundedness, with no depth knob.** There's no "max depth" setting to
  tune — the minimal-distance rule bounds a hub root on its own. Given
  `Customer -> Country` and `Country` also declared a root:

  ```ts
  const data = {
    countries: [{ id: "fr", name: "France" }],
    customers: [{ id: "c1", name: "Dupont", countryId: "fr" }],
    orders: [{ id: "o1", customerId: "c1" }],
    lines: [{ id: "l1", orderId: "o1" }],
  };
  const config = {
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
  };
  // Order reaches Customer at 1 hop and Country at 2: it stays with Customer.
  // -> byNode.get("/orders/0") === ["Customer#c1"]
  // Country's aggregate does NOT absorb the rest of the graph:
  // -> aggregates.get("Country#fr").memberIds === Set(["/countries/0"])
  ```

  And a root is never absorbed into another aggregate — `Customer#c1`
  references `Country#fr`, but `Customer#c1` is itself a root, at distance 0
  from itself, so `byNode.get("/customers/0")` stays `["Customer#c1"]`.

A dangling reference propagates nothing: an entity reachable only through a
broken reference is left out of every aggregate. Declaration order in
`config.aggregates` plays no role in membership (overlap is allowed, so
there's nothing to arbitrate) — it only orders `byNode`'s entries and, in
`@defsquare/data-graph`, the paint order of overlapping envelopes.

`aggregates` is what powers the renderer's **graph view** — see the
[renderer package README](https://github.com/defsquare/data-graph/tree/main/packages/renderer#graph-view)
for `view`/`setView`/`currentView` and how aggregates are drawn.

## Benchmark

`pnpm bench` (or `pnpm --filter @defsquare/data-graph-core bench`) runs
`bench/bench.ts` against a synthetic `bigShop(10_000)` fixture and prints
each step's time against its budget; it never fails the build (non-blocking,
always exits 0). Latest measured numbers:

| Step | Measured | Budget |
| --- | --- | --- |
| `buildGraph` (parse+index 10k) | ≈ 10ms | 1000ms |
| `buildSearchIndex` | ≈ 3ms | — |
| `search("client 42")` | ≈ 1ms | 50ms |
| Initial layout of the ~1,115 default-visible nodes | ≈ 650ms | — |

These come from a single `pnpm bench` run and will vary by machine — treat
them as a sanity check against the budgets, not a strict benchmark.

## API surface

`buildGraph`, `CollapseState`, `buildSearchIndex` / `SearchIndex`,
`createLayoutEngine`, `measureNode`, `validateConfig`, `buildAggregates`,
plus the `Graph`, `GraphNode`, `RefEdge`, `Diagnostic`, `DataGraphConfig`,
`Aggregate`, `AggregateIndex` types. See the
[root README](https://github.com/defsquare/data-graph#readme) for the config
shape and `packages/core/src/index.ts` for the full export list.

## License

MIT © 2026 Defsquare
