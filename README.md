# data-graph

**jsoncrack-style visualization for complex objects — but for aggregates and entities, with real reference edges.**

Most JSON visualizers draw a literal tree: every object and array becomes a
box, every key becomes an edge. That's fine for small documents, but it falls
apart on real domain data — aggregates with hundreds of nested fields,
foreign keys that point across the document, collections with thousands of
rows.

`data-graph` renders the same kind of interactive box-and-line canvas as
jsoncrack, but on top of a **domain model** instead of raw JSON structure:
you tell it which paths in your data are *entities* (e.g. `Customer`,
`Order`) and which fields are *references* between them (e.g.
`Order.customerId → Customer`). It then builds a graph with two edge kinds —
containment (parent/child structure) and reference (real foreign keys) — and
renders only what's expanded, so a 10,000-node dataset stays smooth: pan,
zoom, expand/collapse, click a reference to jump to its target, and search
across every field.

Two views are built in. The default **structure view** lays out the
containment tree (parent/child, ELK layered). An optional **graph view**
switches the canvas to entities-as-vertices, references-as-edges, grouped
into DDD aggregates drawn as convex envelopes — see [`config.aggregates`](#entityreference-configuration)
and [the renderer's graph view docs](./packages/renderer/README.md#graph-view).

<!-- demo GIF placeholder: replace this comment with an actual GIF/screen
     recording of apps/demo (pan/zoom, expand/collapse, search, follow-ref)
     before publishing, e.g. ![data-graph demo](./docs/demo.gif) -->

## Packages

| Package | Description |
| --- | --- |
| [`@defsquare/data-graph-core`](./packages/core) | Headless: `buildGraph`, `CollapseState`, `buildSearchIndex`, `createLayoutEngine`. No rendering, no DOM. |
| [`@defsquare/data-graph`](./packages/renderer) | Pixi.js renderer on top of core: `createDataGraph`, themes. |

## Quickstart

```bash
pnpm add @defsquare/data-graph
```

`@defsquare/data-graph` depends on `@defsquare/data-graph-core` and `pixi.js`
directly (they're installed automatically), and on `elkjs` for layout.

This is the exact bootstrap used by [`apps/demo`](./apps/demo/src/main.ts),
whose small fixture is a four-entity-type e-commerce shop:

```ts
import { createDataGraph } from "@defsquare/data-graph";

const shopData = {
  categories: [
    { id: "cat1", name: "Informatique" },
    { id: "cat4", name: "Audio" },
  ],
  products: [
    { id: "p1", name: "Clavier mécanique", reference: "INF-1000",
      price: 89.9, stock: 42, categoryId: "cat1" },
    { id: "p16", name: "Casque bluetooth", reference: "AUD-1555",
      price: 129, stock: 17, categoryId: "cat4" },
  ],
  customers: [
    { id: "c1", name: "Camille Dubois", email: "camille.dubois@example.fr",
      address: { street: "1 rue de la Paix", postcode: "75002", city: "Paris" },
      segment: "VIP", signupDate: "2023-04-12" },
    { id: "c2", name: "Julien Martin", email: "julien.martin@example.fr",
      segment: "nouveau", signupDate: "2024-01-08" },
  ],
  orders: [
    { id: "o1", customerId: "c1", productId: "p1", quantity: 2, total: 179.8,
      status: "livrée", payment: "carte bancaire", date: "2024-03-05",
      shippingAddress: { street: "1 rue de la Paix", postcode: "75002", city: "Paris" } },
    // `GHOST` doesn't exist: a deliberate dangling reference.
    { id: "o2", customerId: "GHOST", productId: "p16", quantity: 1, total: 129,
      status: "en attente", payment: "PayPal", date: "2024-03-11" },
  ],
};

const shopConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    Product: { match: "$.products[*]", id: "id" },
    Category: { match: "$.categories[*]", id: "id" },
  },
  references: {
    Order: { customerId: "Customer", productId: "Product" },
    Product: { categoryId: "Category" },
  },
  rootLabel: "Boutique",
  aggregates: ["Customer", "Product"],
};

const container = document.getElementById("app")!;

const graph = createDataGraph(container, {
  data: shopData,
  config: shopConfig,
  // Best-effort Web Worker offload for the ELK layout pass; falls back
  // in-process automatically if the worker can't be spun up.
  elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
});

await graph.ready;
graph.fit();

graph.on("select", (node) => console.log("selected:", node.label));
graph.on("followRef", (edge) => console.log("followed ref:", edge.field));
```

## Entity/reference configuration

`config.entities` maps an entity type name to a JSONPath-like `match`
selector (`$`, `.key`, `[index]`, and `*` wildcards for either) plus the
field that holds its id. Any object matched by a selector becomes an
*entity* node instead of a plain object node — entities are the only nodes
that start collapsed, and the only source/target of reference edges.

`config.references` maps `EntityType.fieldName → TargetEntityType`: a field
on an entity whose value is meant to be read as a foreign key. `data-graph`
resolves it against the target entity's index at build time and draws a
reference edge (dangling and highlighted differently if the target id
doesn't exist).

```json
{
  "entities": {
    "Customer": { "match": "$.customers[*]", "id": "id" },
    "Order": { "match": "$.orders[*]", "id": "id" }
  },
  "references": {
    "Order": { "customerId": "Customer" }
  },
  "maxNodes": 50000,
  "rootLabel": "$"
}
```

- `entities.<Type>.match` — selector for where instances of `<Type>` live in the document.
- `entities.<Type>.id` — the field on each matched object that holds its unique id.
- `references.<Type>.<field>` — declares `<Type>.<field>` as a foreign key pointing at another configured entity type.
- `aggregates` — entity type names that are DDD aggregate roots, in declaration order. See
  [the core package README](./packages/core/README.md#aggregates) for the membership rule and the
  [graph view](./packages/renderer/README.md#graph-view) it powers.
- `maxNodes` — optional safety cap (default `50000`); `buildGraph` throws `GraphTooLargeError` past it.
- `rootLabel` — label shown on the root node (default `"$"`, the root symbol of
  the same selector syntax `match` uses). Set it to something your users
  recognise — `"Shop"`, `"Invoice"` — when the graph is customer-facing. An
  empty string is honoured rather than falling back to the default.

## Public API — `DataGraph`

Returned by `createDataGraph(container, options)`.

| Member | Description |
| --- | --- |
| `ready: Promise<void>` | Resolves once Pixi has initialized, the graph has been built, and the initial layout has been rendered. Await before calling other methods. |
| `fit()` | Frames the camera to fit every currently laid-out node in the viewport. |
| `expand(id): Promise<void>` | **Structure-view operation.** Expands a node (reveals its children), re-lays-out, and animates the transition. In the graph view it updates the (invisible) containment state but has no visible effect — see [graph view](./packages/renderer/README.md#graph-view). |
| `collapse(id): Promise<void>` | **Structure-view operation.** Collapses a node (hides its children) and animates the transition. Same graph-view caveat as `expand`. |
| `focus(id)` | Expands every collapsed ancestor of `id` as needed, then centers the camera on it. |
| `select(id)` | Marks a node as selected (drawn with a selection overlay) and emits a `select` event. |
| `search(query): SearchResult[]` | Full-text search across every node label, entity id, and row key/value; returns all matches and resets the next/prev cursor. |
| `nextMatch(): SearchResult \| null` | Advances to the next search result (circular), auto-expanding and focusing it. |
| `prevMatch(): SearchResult \| null` | Same as `nextMatch`, in reverse. |
| `on(event, callback): () => void` | Subscribes to `"select"` (`GraphNode`) or `"followRef"` (`RefEdge`); returns an unsubscribe function. |
| `setData(data, config?): Promise<void>` | Rebuilds the whole graph against new data (and optionally a new config), resetting search/selection state. |
| `diagnostics(): Diagnostic[]` | Returns build-time diagnostics: dangling references, duplicate ids, missing id fields. |
| `stats(): { logicalNodeCount, visibleNodeCount }` | Counters for a host status bar: `logicalNodeCount` is every node in the built graph, `visibleNodeCount` is how many are currently expanded/rendered. |
| `refEdges(from): RefEdge[]` | The outgoing reference edges of node `from`, so a host can offer "follow reference" affordances without knowing graph internals. |
| `setTheme(theme)` | Replaces the theme and redraws, without rerunning layout or re-measuring fonts. Accepts a full `Theme` or a `ThemeOverride`, merged via `resolveTheme` against the theme currently in effect — a `byEntityType` set earlier survives a plain theme swap. Safe for toggling between themes that share the same `typography`/`fonts` (e.g. a light/dark pair); changing those two groups needs a fresh `createDataGraph`. |
| `setView(view): Promise<void>` | Switches between `"structure"` and `"graph"`. The first switch to `"graph"` dynamically imports the graph-view engine and computes aggregates, hence the promise — see [performance budgets](#performance-budgets) and the [renderer's graph view docs](./packages/renderer/README.md#graph-view). The current selection is carried over onto the nearest entity ancestor, since the graph view only knows entities. |
| `currentView(): DataGraphView` | Returns `"structure"` or `"graph"`, whichever is active. |
| `destroy()` | Tears down the Pixi application and releases all resources. |

`DataGraphOptions.view?: "structure" \| "graph"` (default `"structure"`) picks the initial view at
`createDataGraph` time; `setView`/`currentView` switch and query it afterwards. The graph view folds
nothing: every entity is always visible there, and a header click just selects the card. `expand`/
`collapse` remain structure-view-only.

## Themes

`@defsquare/data-graph` ships four built-in themes and lets you override any
subset of theme tokens per instance:

| Theme | Description |
| --- | --- |
| `defsquareLight` | Default — light background, Defsquare brand colors. Used automatically when no `theme` option is passed. |
| `defsquareDark` | Defsquare brand colors on a dark background. |
| `neutralLight` | Generic light theme with no brand styling. |
| `neutralDark` | Generic dark theme. |

```ts
import { createDataGraph, defsquareDark } from "@defsquare/data-graph";

const graph = createDataGraph(container, {
  data,
  config,
  theme: {
    accent: { selection: "#0ea5e9" },
    byEntityType: { Order: { accent: "#f59e0b" } },
  },
});

// Swap to the dark theme at runtime, in place — no relayout, no re-measuring
// fonts, so this is safe for a light/dark toggle.
graph.setTheme(defsquareDark);
```

A `Theme` is grouped by role rather than a flat color bag: `surface`,
`ink`, `accent`, `edge`, `typography`, `radii`, `strokes`, `entityPalette`,
an optional `byEntityType`, and `fonts` — see
[`packages/renderer/src/theme.ts`](./packages/renderer/src/theme.ts) for the
full shape. `theme` in `createDataGraph`'s options is a `ThemeOverride`: any
subset of that shape, deep-merged one level per group onto `defsquareLight`.
That merge is `resolveTheme(partial?, base?)`, exported alongside the themes
so you can build your own variant of any built-in theme (`resolveTheme(partial,
defsquareDark)`) or call it yourself before passing the result to `setTheme`.
See the [renderer package README](./packages/renderer/README.md#themes) for
the full token list and more examples.

## Performance budgets

| Operation | Budget |
| --- | --- |
| Parse + index 10,000 logical nodes (`buildGraph`) | < 1 s |
| Expand a node | < 300 ms |
| Pan/zoom frame rate at ~2,000 visible nodes | 60 fps |
| Search across the index | < 50 ms |

These are the budgets `packages/core/bench/bench.ts` checks on every run
(via `pnpm bench`) against a synthetic `bigShop(10_000)` fixture — see that
package's README for the latest numbers and any documented deviation.

### Graph view

| Property | Budget | Enforced by |
| --- | --- | --- |
| Card overlap after layout | Zero overlapping pairs, always. The stronger `separationMargin` gap between every pair is measured and asserted at 334 cards; past ~450 the iteration cap can leave a few pairs closer than the margin (still never overlapping) — see the note below | `packages/core/test/layout-graph.test.ts` |
| Determinism | Pixel-identical positions across two runs on the same input | `packages/core/test/layout-graph.test.ts` |
| Aggregate envelope overlap after layout | Zero overlapping pairs at 167 aggregates. Aggregates that genuinely share a member entity are merged into one rigid block instead of being separated, so their envelopes still cross — that is the intended behavior, not an exception to the budget | `packages/core/test/layout-graph.test.ts` ("leaves no two aggregate envelopes overlapping" / "merges two aggregates that share a member entity into one rigid block") |
| Intra-aggregate geometry under cluster separation | Exact to floating-point representation — a uniform per-cluster translation, asserted with strict equality rather than a tolerance | `packages/core/test/cluster-separate.test.ts` |
| `@defsquare/data-graph` bundle purity | `cytoscape` (~178 kB gzip) never enters a consumer's bundle unless it calls `setView("graph")` — the structure view alone doesn't pull it in | `packages/core/test/bundle-purity.test.ts` (core half) + `packages/renderer/test/bundle-purity.test.ts` (renderer half) |

**Separation, measured.** After fcose runs, a relaxation pass (`separateOverlaps`)
pushes cards apart until no two are closer than `separationMargin` (16 px by
default), capped at `separationIterations` (3,000). The pass is load-bearing:
fcose's raw output leaves 160 overlapping pairs at 334 cards (worst card 40.5%
covered) and 448 pairs at 450 cards (worst card 90.8% covered). Zero *overlap*
after the pass is robust and asserted at scale. The stronger *margin* guarantee is not unconditional: on this
repo's fixtures the pass leaves **0** pairs under the margin at 334 cards (the
scale the committed test asserts), **47** at 450 cards, and **289** at 900 —
none of them overlapping, merely closer to each other than 16 px. Raising the
cap to 10,000 clears all of them, at roughly 3× the pass's cost, so this is a
tuning ceiling rather than a defect in the algorithm.

Historical note: this pass used to compare penetration against zero, which
kept its "nothing moved" early exit from ever firing — a pair settled exactly
at the margin retains ~1e-14 of residual penetration, which still reads
positive, so the loop kept "moving" picometers until the cap regardless of
whether it had actually converged. That made the cost proportional to
`separationIterations` even on an easy input (measured then on 334 already-
separated cards: cap 3,000 → 1.9 s, 10,000 → 6.3 s, 100,000 → 63.5 s). Fixed:
the comparison is now against an epsilon (`packages/core/src/separate.ts`),
so the early exit fires for real — measured at pass 1998 of 3,000 on that same
fixture — and the cap is a true ceiling again, not a fixed cost.

**Cluster spacing, measured.** `separateOverlaps` keeps *cards* apart; it says
nothing about *aggregates*, and without a second pass the envelopes end up
touching — 310 of the 13,861 envelope pairs on `bigShop(3000)` are frankly
superimposed, and the mean gap to a cluster's nearest neighbour is **0.7 px**.
So a second relaxation (`separateClusters`) runs after it, at cluster
granularity: it computes each aggregate's bounding box, pushes boxes closer
than `clusterGap` apart along their axis of least penetration, and then
translates each cluster's members **rigidly** by its box's total displacement.
That rigidity is what makes it safe: intra-aggregate geometry comes through
untouched, and since nothing re-runs `separateOverlaps` afterwards, it is also
what guarantees the pass introduces no card overlap. An entity in no aggregate
is its own singleton cluster, so it is pushed out of a neighbour's envelope
instead of being left inside it. Unlike `separateOverlaps`, its early exit
compares against an epsilon rather than zero, so it actually converges and stops.

**Aggregates that share an entity are merged** into a single rigid super-cluster
(union-find) before the relaxation, rather than being separated. A shared entity
is a full member of each of its aggregates, so giving it a displacement of its
own — the average of its aggregates', in an earlier version — detaches it from
its co-members as soon as a *third* cluster pushes one of them harder than the
other; that version measurably broke rigidity (intra-aggregate distances 120 →
62.5 px) and produced card overlaps. Merging removes the case rather than
patching it. The merge is transitive, and on hub-shaped data it can swallow the
graph: with a shared catalogue of 3 products across 167 customers, 170
aggregates collapse into 3 super-clusters (the largest 33% of all cards), and
with a single shared product into one, where the pass has nothing left to
separate. That is semantically right — those aggregates cannot be pulled apart
without tearing a card — but it does mean cluster spacing is a no-op on such
data. Single-root configurations (this repo's core fixtures) share nothing and
are unaffected.

**The demo now shows exactly that percolation**, deliberately. Its config
declares two roots (`aggregates: ["Customer", "Product"]`) over a dataset where
every `Order` references a `Customer` *and* a `Product`, so every order is one
hop from both roots and is a full member of both aggregates. Measured on
`bigShop(4000)` — 350 entities, 108 aggregates: the union-find collapses those
108 aggregates into **9 super-clusters, the largest holding 342 of the 350
cards (97.7%)**. The eight remaining singletons are the `Category` entities,
which no aggregate claims (membership follows references *inbound* to the root,
and products point *at* categories). `separateClusters` therefore has nothing
left to space out inside the blob: it only pushes those eight categories away.
Dropping back to `aggregates: ["Customer"]` on the same data gives **116
super-clusters, the largest 5 cards (1.4%)** — 26 of 5, 26 of 4, 26 of 3 and 38
singletons — and the pass does real work again, at the cost of an 18× larger
canvas (17,367×21,849 px versus 4,816×6,752 px, since 116 blocks each claim a
160 px corridor). Two roots one hop apart is the configuration that turns
cluster spacing off; it is not a defect, it is what the merge rule means.

`clusterGap` defaults to **160 px**, chosen by measurement rather than taste —
the sweep is recorded in `DEFAULTS` in `packages/core/src/layout-graph.ts`, and
the value is settable per instance via `graphLayoutOptions` (see the renderer
README). Correctness — zero overlapping envelope pairs — is already reached at
80 px; everything above that buys corridor width, not correctness. On
`bigShop(3000)` at 160 px: nearest-neighbour gap 0.7 px → 160.0 px, overlapping
envelope pairs 310 → 0, overall bbox 3494×2969 → 6778×8171 (5.3× the area),
fill 42.4% → 7.9%. Card overlap stays at zero at every value tested. Going
further costs canvas faster than it buys legibility: 160 → 240 px is +42% area
to move fill from 7.9% to 5.6%, and forces `fit()` to zoom out ~2.8×, so cards
render around a third of their former size at overview and drop to a coarser
LOD sooner.

Note what this pass is **not**: it is not longer `idealEdgeLength` on
cross-aggregate edges. That was tried and failed — fcose calibrates its
internal repulsion scale on the *average* ideal edge length across all edges,
so lengthening a subset inflates the whole layout instead of opening the gaps,
and destroys the clustering signal. The comment at the `idealEdgeLength` call
site records it.

The graph view's organic layout (fcose) is seeded deterministically from node
ids rather than left to its default randomization, which is what makes the
determinism row above assertable.

**Folding was removed from the graph view**, and with it the incremental
relayout that used to keep already-placed cards from drifting when an
aggregate was unfolded. That mechanism pinned every placed card through
fcose's `fixedNodeConstraint`, and a committed test measured its median drift
at 0px (against 1084px for an unpinned full relayout). Both the code and that
test are gone: everything is visible at all times, so there is no incremental
relayout left to stabilise, and a budget with no test behind it would be worse
than no budget. The history lives on in
`docs/superpowers/specs/2026-08-31-graph-view-aggregates-design.md`.

Switching to the graph view for the first time dynamically imports
`cytoscape` and its `fcose` layout plugin; a Vite production build of
[`apps/demo`](./apps/demo) emits that as its own ~178 kB gzip chunk
(`graph-layout-*.js`), separate from the main bundle, so a consumer who only
ever uses the structure view never downloads it.

## Monorepo layout

```
data-graph/
├── packages/
│   ├── core/      @defsquare/data-graph-core — graph model, layout, search
│   └── renderer/  @defsquare/data-graph — Pixi.js renderer, themes
├── apps/
│   └── demo/      Vite app demonstrating the renderer + Playwright e2e
├── LICENSE
└── README.md
```

## Development

```bash
pnpm install

pnpm typecheck      # tsc --noEmit across every package
pnpm build          # tsup build across every package
pnpm test           # vitest across every package — run `pnpm build` FIRST
pnpm bench          # non-blocking perf bench (packages/core/bench/bench.ts)

pnpm --filter demo dev   # run the demo app locally
pnpm --filter demo e2e   # Playwright e2e — build the renderer FIRST
```

**Build before test.** Two suites read build output, and `dist/` is gitignored,
so on a fresh clone both fail until something has been built:

- `pnpm build` must precede `pnpm test` — `packages/core/test/bundle-purity.test.ts`
  walks `packages/core/dist/index.js` to prove `cytoscape` stays out of the main
  entry point's transitive closure. It fails with an actionable message rather
  than skipping: a silent skip would give false assurance on a bundle budget.
- `pnpm --filter @defsquare/data-graph build` must precede
  `pnpm --filter demo e2e` — the demo imports the renderer's `dist/`, so the e2e
  run otherwise exercises a stale (or missing) build.

## License

[MIT](./LICENSE) © 2026 Defsquare
