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
  for the membership rule) and drawn as circular envelopes — the minimal
  enclosing circle of each aggregate's cards, plus a `hullPadding` margin.

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

**Dynamic import.** The first switch to `"graph"` dynamically imports the layout
engine, which is why `setView` returns a promise. That import is isolated behind
the dynamic `import()`: in a Vite production build (see
[`apps/demo`](../../apps/demo)) it lands in its own chunk — **1.77 kB gzip**,
3.75 kB raw, measured — and never enters the bundle of a consumer that only ever
uses the structure view. Two tests guard it, one per half of the chain:
`packages/core/test/bundle-purity.test.ts` walks the built chunk closure of the
core's main entry point, so a careless barrel export can't regress it, and
`packages/renderer/test/bundle-purity.test.ts` checks this package's sources for
any static *value* import of that entry point — turning `create.ts`'s
`import type` into a value import would pull the graph view into every consumer's
bundle while leaving the rest of the suite green.

That chunk used to weigh **180.28 kB gzip** (577.17 kB raw), essentially all of
it `cytoscape` and its `fcose` plugin, which the previous layout engine imported.
That engine has been removed and both dependencies with it — hence the factor of
102. Be clear about what this does to the guarantee above: in kilobytes, it now
guards almost nothing, and a regression would cost 1.77 kB. Both tests are kept
anyway, and their own comments say why: they hold the *shape* — the graph view
loads lazily by construction, so whatever weight this view acquires next is lazy
by default rather than by review.

**No folding.** `expand`/`collapse` are structure-view operations (see the
[root README's API table](https://github.com/defsquare/data-graph#public-api--datagraph));
they act on the containment tree and have no visible effect in the graph
view. The graph view itself folds nothing: every entity is always drawn,
aggregate cards carry no chevron, and a header click selects the card just
like a body click. An earlier version folded an aggregate onto its root card
from that chevron; it was removed.

**Two-level layout.** The graph view lays itself out in two stages, and the split
is what makes its guarantees structural rather than iterative. Each aggregate is
first packed on its own — root card first, then members by id, in centred rows
with a `cardGap` (**16 px** by default) already built into the packing. The
packed block then becomes a rigid disc, the minimal enclosing circle of its cards
plus `hullPadding`, which is exactly the shape this package paints; an entity in
no aggregate becomes a singleton disc. A small simulation places those discs —
cross-aggregate references pull as weighted springs — and a final hard pass
guarantees that any two discs end up at least `clusterGap` (**160 px** by
default) apart, edge to edge.

Two things follow that are worth relying on. Cards never need to be pushed apart
afterwards: two cards of one aggregate are packed with the margin, and two cards
of different aggregates cannot meet because their discs cannot. And the shape
that gets spaced is not merely equal to the shape you see — it is the same
circle, computed once from the packed block and translated with its cards.

Every aggregate gets its own block: membership is a partition, so no two
aggregates share a card and none are welded together. On
[`apps/demo`](../../apps/demo)'s two-root config that is 116 blocks over 350
cards — 78 `Customer` aggregates of 3 to 5 cards, 30 single-card `Product`
aggregates, and the 8 `Category` entities no aggregate claims — with zero
overlapping envelope pairs.

That used to read very differently, twice over. When an entity could belong to
several aggregates at once, two aggregates sharing a member were merged into one
rigid block rather than pulled apart (they can't be separated without tearing the
shared card), and on this same config the merge percolated: 108 aggregates
collapsed into a single block of 342 of 350 cards, and there was nothing left to
space out. The membership rule now arbitrates ties instead of sharing, which is
what brought the spacing back — see the
[core README's Aggregates section](https://github.com/defsquare/data-graph/tree/main/packages/core#aggregates)
for the rule and the measured before/after. And until recently the spacing itself
was done by two relaxation passes over the output of a global `fcose` layout
(`separateOverlaps`, then `separateClusters`); those passes and that engine have
since been **removed from the core** along with `cytoscape`. On the demo's
dataset the switch took `setView("graph")` from **4,310–4,484 ms to 220–252 ms**
(measured in Chromium, three isolated runs each) and the canvas from
18,714 × 19,984 to 8,083 × 8,437. The
[root README's graph-view budgets](https://github.com/defsquare/data-graph#graph-view)
carry the full before/after.

How wide the corridors should be is a matter of eye, screen size and data
density, so it is settable per instance rather than baked into core:

```ts
const graph = createDataGraph(container, {
  data,
  config,
  view: "graph",
  // Any TwoLevelLayoutOptions field: clusterGap, hullPadding, cardGap,
  // simIterations. Read once, when the graph view is first built.
  graphLayoutOptions: { clusterGap: 240 },
});
```

`TwoLevelLayoutOptions` is re-exported from this package, so you can type the
object without depending on `@defsquare/data-graph-core` directly.

> **API change (0.x, no compatibility shim).** `graphLayoutOptions` used to take
> `GraphLayoutOptions` — `{ hullPadding, separationMargin, separationIterations,
> clusterGap }`. It now takes `TwoLevelLayoutOptions` — `{ hullPadding, cardGap,
> clusterGap, simIterations }`, and this package no longer re-exports the old
> type. `hullPadding` and `clusterGap` keep their name, meaning and default, so
> the common case (`{ clusterGap: 240 }`) is unaffected. The other two are gone
> because the pass they tuned is gone: there is no card-separation pass to cap,
> and the inter-card margin is now placed by the packing (`cardGap`, 16 px —
> `separationMargin`'s old default) instead of being converged towards. Passing
> the retired keys is a type error, which is the intent: silently accepting and
> ignoring them would be worse.

**Selection carry-over.** The graph view only knows entities — a structure
node nested under one (e.g. an address object) has no counterpart there.
Switching views while such a node is selected reassigns the selection to its
nearest entity ancestor rather than dropping it.

**Determinism.** The graph-view layout is deterministic **bit for bit**: two runs
on identical input produce identical positions and identical envelopes, and the
result does not depend on the iteration order of the visible-node set. Positions
are seeded from node ids (FNV-1a) and there is no `Math.random` or `Date.now`
anywhere in the engine — nor, since the two-level switch, any randomized layout
library underneath it to override. Removing folding also removed the
pinned incremental relayout that used to bound drift on already-placed cards
when an aggregate was unfolded, along with the 0px-median-drift budget it
enforced — there is no longer any incremental relayout to stabilise. See the
[root README's performance budgets](https://github.com/defsquare/data-graph#performance-budgets)
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
