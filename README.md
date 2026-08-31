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

This is the exact bootstrap used by [`apps/demo`](./apps/demo/src/main.ts):

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
`createDataGraph` time; `setView`/`currentView` switch and query it afterwards. Folding an aggregate
in the graph view is done by clicking its root card's header chevron — there is no public API for it,
unlike `expand`/`collapse` which are structure-view-only.

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
| Card overlap after layout | Zero — every pair of cards separated by at least `separationMargin` | `packages/core/test/layout-graph.test.ts` |
| Determinism | Pixel-identical positions across two runs on the same input | `packages/core/test/layout-graph.test.ts` |
| Position drift on already-placed cards when expanding an aggregate | 0.00 px median (was 1084 px median before pinning) | `packages/core/test/layout-graph.test.ts` (pinning) |
| `@defsquare/data-graph` bundle purity | `cytoscape` (~178 kB gzip) never enters a consumer's bundle unless it calls `setView("graph")` — the structure view alone doesn't pull it in | `packages/core/test/bundle-purity.test.ts` |

The graph view's organic layout (fcose) is seeded deterministically from node
ids rather than left to its default randomization, and cards already placed
before an `expand()` are pinned in place during relayout — that pinning is
what took the median drift on unrelated cards from 1084 px down to 0.00 px.
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
pnpm test           # vitest across every package
pnpm bench          # non-blocking perf bench (packages/core/bench/bench.ts)

pnpm --filter demo dev   # run the demo app locally
pnpm --filter demo e2e   # Playwright end-to-end tests against the demo
```

## License

[MIT](./LICENSE) © 2026 Defsquare
