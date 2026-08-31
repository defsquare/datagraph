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
`setData`, `diagnostics`, `stats`, `refEdges`, `setTheme`, `setView`,
`currentView`, and `destroy` — full descriptions in the
[root README's API table](https://github.com/defsquare/data-graph#public-api--datagraph).

## Navigation

| Gesture | Action |
| --- | --- |
| Two-finger swipe (trackpad) | Pan |
| Pinch (trackpad) | Zoom at the cursor |
| Mouse wheel | Zoom at the cursor |
| <kbd>Ctrl</kbd> + wheel | Zoom at the cursor |
| Click and drag | Pan |

Trackpad pinch and <kbd>Ctrl</kbd>+wheel are the same browser event, so both
are always recognised as zoom. Telling a plain mouse wheel apart from a
two-finger swipe is a heuristic — a wheel arrives as large, whole-numbered,
purely vertical steps, a swipe as a stream of small and often fractional
deltas with some horizontal component. A very fast, perfectly vertical swipe
can therefore be read as a wheel and zoom instead of panning. The threshold is
deliberately set high so this stays rare.

Edges are drawn beneath the node cards. A reference often points back to the
left and crosses whatever cards sit between it and its target, so at rest it is
partly hidden — deliberately, since drawing every reference over every card it
crosses is noise most of the time. Selecting a node is what reveals its
references: `select()` redraws the selected node's outgoing references in the
selection colour on the topmost layer, where they run over everything.

Zoom is bounded to `[0.02, 3]`. `fit()` never scales past `1` — magnifying a
bitmap-font atlas baked at its nominal size is what made text look soft — so a
graph smaller than the viewport is centred rather than blown up.

## Graph view

`createDataGraph` supports two views, chosen with `DataGraphOptions.view?:
"structure" | "graph"` (default `"structure"`) and switched at runtime with
`setView(view): Promise<void>` / `currentView(): "structure" | "graph"`:

- **`"structure"`** (default) lays out the containment tree — parent/child
  structure, ELK layered. This is everything described above and elsewhere in
  this README.
- **`"graph"`** lays out entities as vertices and references as edges,
  grouped into the DDD aggregates declared in `config.aggregates` (see the
  [core package README](https://github.com/defsquare/data-graph/tree/main/packages/core#aggregates)
  for the membership rule) and drawn as convex envelopes around each
  aggregate's cards.

```ts
const graph = createDataGraph(container, {
  data: shopData,
  config: { ...shopConfig, aggregates: ["Customer"] },
  // Omit `view` to start in "structure" (the default) and switch later.
  view: "graph",
});

await graph.ready;
graph.currentView(); // -> "graph"

await graph.setView("structure"); // switch back at runtime
await graph.setView("graph");     // and switch again
```

**Dynamic import.** The first switch to `"graph"` dynamically imports the
organic layout engine (`cytoscape` + its `fcose` layout plugin), which is why
`setView` returns a promise. That import is isolated behind the dynamic
`import()`: in a Vite production build (see [`apps/demo`](../../apps/demo)),
it lands in its own chunk — roughly **178 kB gzip** — and never enters the
bundle of a consumer that only ever uses the structure view. A test walking
the built chunk closure (`packages/core/test/bundle-purity.test.ts`) guards
this so a careless barrel export can't regress it.

**Folding.** `expand`/`collapse` are structure-view operations (see the
[root README's API table](https://github.com/defsquare/data-graph#public-api--datagraph));
they act on the containment tree and have no visible effect in the graph
view. There is **no public API** to fold an aggregate. Instead, clicking an
aggregate root card's header chevron folds or unfolds that aggregate's
members directly on the canvas.

**Selection carry-over.** The graph view only knows entities — a structure
node nested under one (e.g. an address object) has no counterpart there.
Switching views while such a node is selected reassigns the selection to its
nearest entity ancestor rather than dropping it.

**Determinism.** The graph-view layout is deterministic to the pixel: two
runs on identical input produce identical positions (seeded from node ids,
not left to fcose's default randomization). Expanding an aggregate pins every
already-placed card so the rest of the layout doesn't drift — median drift on
unrelated cards is 0.00 px with pinning, versus 1084 px median without it.
See the [root README's performance budgets](https://github.com/defsquare/data-graph#performance-budgets)
for the full table.

## Themes

Ships four built-in themes — `defsquareLight` (default), `defsquareDark`,
`neutralLight`, `neutralDark` — plus `resolveTheme(partial?, base?)`,
`entityAccentMap(entityTypes, theme)`, and a `ThemeOverride` type for
per-instance customization.

```ts
import { createDataGraph, defsquareDark, resolveTheme } from "@defsquare/data-graph";

// Partial override: any token not mentioned comes from defsquareLight.
const graph = createDataGraph(container, {
  data: shopData,
  config: shopConfig,
  theme: {
    accent: { selection: "#0ea5e9" },
    byEntityType: { Customer: { accent: "#3dbf9e" } },
  },
});

// Full swap to the dark theme, live.
graph.setTheme(defsquareDark);

// Or a variant of the dark theme.
graph.setTheme(resolveTheme({ surface: { canvas: "#000000" } }, defsquareDark));
```

`Theme` is grouped by role rather than a flat color bag: `surface.{canvas,card,cardMuted}`,
`ink.{primary,muted,subtle}`, `accent.{entity,selection,match,matchStroke}`,
`edge.{contain,ref,dangling,hairline,border}`, `typography.{header,badge,key,value}`
(each a `{family,size,weight,tracking?}`), `radii.{card}`,
`strokes.{border,edge,selection,match,matchCurrent}`, `entityPalette: string[]`,
an optional `byEntityType: Record<string, { accent: string }>`, and `fonts.{body,mono}`.
`theme` in `createDataGraph`'s options is a `ThemeOverride` — any subset of
that shape. `resolveTheme(partial?, base?)` performs the merge (one level
deep per group, onto `base`, default `defsquareLight`); it's what
`createDataGraph` and `setTheme` call internally, and you can call it
yourself to build a variant of a specific built-in theme, as above.

`setTheme(theme)` swaps the theme on a live instance and redraws
immediately. It does **not** re-run layout or re-measure fonts — safe for
toggling between themes that share `typography`/`fonts` (any light/dark pair
shipped here), but not for changing those two groups themselves; that
requires a fresh `createDataGraph`. It merges through `resolveTheme` against
the theme currently in effect, so a `byEntityType` set earlier survives a
plain light/dark swap unless the new call overrides it.

See the [root README](https://github.com/defsquare/data-graph#themes) for
more on the theme/config relationship.

## License

MIT © 2026 Defsquare
