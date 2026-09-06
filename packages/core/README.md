# @defsquare/data-graph-core

Headless graph engine for [`data-graph`](https://github.com/defsquare/data-graph)
(see the [root README](https://github.com/defsquare/data-graph#readme) for the
full pitch and the ids/refs/groups config, and
[`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
for the graph view's layout engine and its measurements).

This package has no rendering dependency: it builds a graph from arbitrary
JSON plus an ids/refs/groups config, tracks expand/collapse state, indexes
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
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
};

const graph = buildGraph(data, config);
const collapseState = new CollapseState(graph);
const searchIndex = buildSearchIndex(graph);

const engine = createLayoutEngine();
const layout = await engine.layout(graph, collapseState.visibleNodeIds());

searchIndex.search("dupont"); // -> SearchResult[]
```

## Aggregates

`config.groups` names the `ids` entries that are DDD aggregate roots, in
declaration order:

```ts
const config = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
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
  // Membership is a partition, so every array holds exactly one id.
  byNode: Map<NodeId, string[]>;
}
```

**The membership rule:** an entity `E` belongs to the aggregate rooted at `R`
iff `R` is the **winner** among the roots at distance `dmin(E)` from `E`, where
`d` is the minimal number of outgoing references leading from `E` to `R`, and
`dmin(E)` is the minimum of `d` over every root `E` can reach. A root is at
distance `0` from itself, so it always wins its own aggregate. Ties are broken
by **declaration order of the root's name in `config.groups`**, then
by aggregate id.

**Membership is a partition:** every entity that reaches at least one root
belongs to exactly one aggregate.

This has three consequences worth knowing:

- **A distance tie is arbitrated, not shared.** An entity that reaches two
  roots at the same minimal distance joins the one whose type is declared
  first. Given both `Customer` and `Product` declared as roots, and an `Order`
  referencing one of each:

  ```ts
  const data = {
    customers: [{ id: "c1", name: "Dupont" }],
    products: [{ id: "p9", name: "Vis" }],
    orders: [{ id: "o3", customerId: "c1", productId: "p9" }],
  };
  const config = {
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
  };
  // "Customer" is declared first, so it wins:
  // -> byNode.get("/orders/0")  === ["Customer#c1"]
  // -> Product#p9.memberIds     === Set(["/products/0"])
  //
  // Swap the declaration order to ["Product", "Customer"] and the same data
  // gives byNode.get("/orders/0") === ["Product#p9"] instead.
  ```

  Two roots of the *same* type at the same distance are separated by
  aggregate id (`"Customer#c1"` before `"Customer#c2"`), so the result never
  depends on JSON order or on graph traversal order.

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
`config.groups` is therefore **load-bearing**: it decides who wins a
distance tie, and so which aggregate an entity ends up in. It also orders
`byNode`'s entries and, in `@defsquare/data-graph`, the paint order of
envelopes.

**Why the rule arbitrates instead of sharing.** An earlier version let an
entity belong to *every* root it reached at the minimal distance — overlap was
presented as a feature. It cost the graph view its cluster spacing: the
envelope-spacing pass of the day could not pull two aggregates apart without
tearing their shared member out of one of them, so it merged every aggregate
connected by a shared member into one rigid block. With overlap, that merge
percolated across the whole dataset. That pass — `separateClusters`, and the
`fcose`-based engine around it — has since been **removed from the repo**; the
code lives in git history.

The graph view now lays out on `createTwoLevelLayoutEngine`
([`src/layout-two-level.ts`](./src/layout-two-level.ts)), which packs each
aggregate independently and then spaces the resulting discs. That makes the
partition rule *more* load-bearing, not less: the two-level split is only sound
because each entity belongs to exactly one block.

Under the current rule, on the demo dataset (`bigShop(4000)`, 350 entities,
`groups: ["Customer", "Product"]`, where every `Order` references a `Customer`
*and* a `Product` one hop away), the partition yields **116 blocks**: 78
`Customer` aggregates of 3 to 5 cards each (26 of each size), 30 single-card
`Product` aggregates, and the 8 `Category` entities no aggregate claims. Every
one of them is actually spaced apart — zero overlapping envelope pairs. That
block structure is a property of the membership rule and holds whatever the
layout engine is.

> **Historical measurement**, taken on the retired `fcose`-based engine, kept
> because it is what motivated the rule (which is itself unchanged). Same data,
> same layout, same geometry, only the membership rule differing:
>
> | | overlap on ties (retired) | arbitration (current) |
> | --- | --- | --- |
> | blocks after merging | 9 | **116** |
> | largest block | 342 of 350 cards (97.7%) | **5 cards (1.4%)** |
> | overlapping envelope pairs | 3520 of 5778 (61%) | **0** |
> | canvas bbox | 7199 × 4588 | 18714 × 19984 |
>
> The bbox figures belong to that engine and no longer describe the current one;
> see [`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
> for what the two-level engine lays those same 116 blocks out in.

The union-find that carried the merge went with the pass when it was removed. It
had already been inert for a while, a partition giving it nothing to merge; it
was kept as long as the pass existed because the guarantee it encoded (one card,
one translation) belonged to the pass rather than to a membership rule that
could be relaxed again. Nothing replaces it, because nothing needs to: the
current engine packs each aggregate independently and never moves a card
relative to its co-members at all.

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
