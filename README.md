# data-graph

**jsoncrack-style visualization for complex objects — but for keyed records and real reference edges.**

Most JSON visualizers draw a literal tree: every object and array becomes a
box, every key becomes an edge. That's fine for small documents, but it falls
apart on real domain data — records with hundreds of nested fields, foreign
keys that point across the document, collections with thousands of rows.

`data-graph` renders the same kind of interactive box-and-line canvas as
jsoncrack, but on top of a **domain model** instead of raw JSON structure:
you declare, in `ids`, which paths in your data are *keyed records* (e.g.
`Customer`, `Order`), and, in `refs`, which fields *join* them (e.g.
`Order.customerId → Customer`). It then builds a graph with two edge kinds —
containment (parent/child structure) and reference (real foreign keys) — and
renders only what's expanded, so a 10,000-node dataset stays smooth: pan,
zoom, expand/collapse, drag a card (or a whole aggregate, in the graph view)
out of the way, click a reference to jump to its target, and search across
every field.

Two views are built in. The default **structure view** lays out the
containment tree (parent/child, ELK layered). An optional **graph view**
switches the canvas to records-as-vertices, joins-as-edges, grouped
into DDD aggregates drawn as circular envelopes — see [`config.groups`](#config-ids-refs-groups),
[the renderer's graph view docs](./packages/renderer/README.md#graph-view)
and [`docs/graph-view.md`](./docs/graph-view.md).

## Packages

| Package | Description |
| --- | --- |
| [`@defsquare/data-graph-core`](./packages/core) | Headless: `buildGraph`, `CollapseState`, `buildSearchIndex`, `createStructureLayoutEngine`. No rendering, no DOM. |
| [`@defsquare/data-graph`](./packages/renderer) | Pixi.js renderer on top of core: `createDataGraph`, themes. |
| [`apps/demo`](./apps/demo) | Vite demo, Playwright e2e, and the Tauri desktop shell that doubles as the `datagraph` CLI. |

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
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    Product: "$.products[*].id",
    Category: "$.categories[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId", to: "$.products[*].id" },
    { from: "$.products[*].categoryId", to: "$.categories[*].id" },
  ],
  rootLabel: "Boutique",
  groups: ["Customer", "Product"],
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

## Config: ids, refs, groups

`config.ids` maps a name to a JSONPath-like selector (`$`, `.key`, `[index]`,
and `*` wildcards for either) that ends in the field holding its id — e.g.
`"$.customers[*].id"`. Any object matched by a selector (dropping the
trailing id-field segment) becomes an *entity* node instead of a plain object
node — entities are the only nodes that start collapsed, and the only
source/target of reference edges.

`config.refs` is an array of joins, `{ from, to }`: `from` is a selector for
a field whose value is meant to be read as a foreign key, and `to` is one of
the paths declared in `ids`. `data-graph` resolves `from`'s value against the
target's index at build time and draws a reference edge (dangling and
highlighted differently if the target id doesn't exist).

```json
{
  "ids": {
    "Customer": "$.customers[*].id",
    "Order": "$.orders[*].id"
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id" }
  ],
  "groups": ["Customer"],
  "maxNodes": 50000,
  "rootLabel": "$"
}
```

- `ids.<Name>` — selector for where instances of `<Name>` live in the document, ending in the id field.
- `refs[].from` — selector for a field whose value is a foreign key.
- `refs[].to` — the `ids` path it must resolve against.
- `groups` — names from `ids` that are DDD aggregate roots, in declaration order. That order
  is load-bearing: it decides which root claims a record that reaches two of them at the same
  distance. See [the core package README](./packages/core/README.md#aggregates) for the membership
  rule and the [graph view](./packages/renderer/README.md#graph-view) it powers.
- `maxNodes` — optional safety cap (default `50000`); `buildGraph` throws `GraphTooLargeError` past it.
- `rootLabel` — label shown on the root node (default `"$"`, the root symbol of
  the same selector syntax `ids` uses). Set it to something your users
  recognise — `"Shop"`, `"Invoice"` — when the graph is customer-facing. An
  empty string is honoured rather than falling back to the default.

**Limitation:** field keys that don't match the selector token grammar (e.g.
`@odata:id`) can no longer be declared as reference fields.

## API

`createDataGraph(container, options)` returns a `DataGraph` handle:

- **Camera and navigation** — `ready`, `fit()`, `focus(id)`, `destroy()`.
- **Structure view only** — `expand(id)`, `collapse(id)`.
- **Selection and events** — `select(id)`, `on("select" | "followRef", cb)`, `refEdges(from)`.
- **Search** — `search(query)`, `nextMatch()`, `prevMatch()`.
- **Data, views, theme** — `setData(data, config?)`, `setView("structure" | "graph")`,
  `currentView()`, `setTheme(theme)`.
- **Introspection** — `diagnostics()`, `stats()`.

The full reference table — every member, its exact semantics, and its
view-specific caveats — lives in the published package's README:
[**Public API — `DataGraph`**](./packages/renderer/README.md#public-api--datagraph).
Gestures, dimming rules and the graph view are documented there too.

## Themes

`@defsquare/data-graph` ships four built-in themes — `defsquareLight` (the
default), `defsquareDark`, `neutralLight`, `neutralDark` — and lets you
override any subset of theme tokens per instance:

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

A `Theme` is grouped by role rather than a flat color bag: `surface`, `ink`,
`accent`, `edge`, `typography`, `radii`, `strokes`, `entityPalette`, an
optional `byEntityType`, and `fonts`. `theme` in `createDataGraph`'s options is
a `ThemeOverride` — any subset of that shape, deep-merged one level per group
via the exported `resolveTheme(partial?, base?)`. See the
[renderer package README](./packages/renderer/README.md#themes) for the full
token list and more examples, and
[`packages/renderer/src/theme.ts`](./packages/renderer/src/theme.ts) for the
exact shape.

## Monorepo layout

```
data-graph/
├── packages/
│   ├── core/      @defsquare/data-graph-core — graph model, layout, search
│   └── renderer/  @defsquare/data-graph — Pixi.js renderer, themes
├── apps/
│   └── demo/      Vite app demonstrating the renderer + Playwright e2e
│       └── src-tauri/  Tauri v2 desktop shell + `datagraph` CLI (Rust)
├── docs/
│   ├── graph-view.md   graph-view layout, guarantees and measurements
│   └── superpowers/    historical journal of spikes, specs and plans
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
pnpm --filter demo e2e   # Playwright e2e (starts `pnpm dev` itself)

pnpm --filter demo tauri dev    # demo as a desktop app (Tauri v2) — needs a Rust toolchain
pnpm --filter demo tauri build  # standalone binary: apps/demo/src-tauri/target/release/datagraph
```

**`pnpm build` must precede `pnpm test`.** `packages/core/test/bundle-purity.test.ts`
walks `packages/core/dist/index.js` to prove the graph-view chunk stays out of
the main entry point's transitive closure, and `dist/` is gitignored, so on a
fresh clone it fails until something has been built. It fails with an actionable
message rather than skipping: a silent skip would give false assurance on a
bundle budget.

**The e2e do not need a build.** `apps/demo/playwright.config.ts` starts the app
with `pnpm dev`, and `apps/demo/vite.config.ts` aliases the workspace packages
to `packages/*/src` in `serve` mode — so the Playwright suite always exercises
the *sources*, through Vite's dev pipeline, and never the published bundle. Any
timing it reports is a dev-mode, unminified figure (see
[`docs/graph-view.md`](./docs/graph-view.md#what-the-tests-actually-hold)).

**Rust tests.** The CLI parser in `apps/demo/src-tauri/src/cli.rs` has its own
unit tests, run with `cargo test` from `apps/demo/src-tauri`. They are not wired
into `pnpm test`.

**Desktop app and CLI.** The demo doubles as a Tauri v2 desktop app whose binary
is also the end-user CLI (`datagraph <data.json> [-c <config.json>]`). See
[`apps/demo/README.md`](./apps/demo/README.md).

## License

[MIT](./LICENSE) © 2026 Defsquare
