# @defsquare/data-graph

Interactive visualization for complex JSON documents — keyed records, with real
reference edges — rendered on a Pixi.js canvas. See the
[root README](https://github.com/defsquare/data-graph#readme) for the full
pitch and the ids/refs/groups config format, and
[`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
for the graph view's layout guarantees and performance budgets.

## Install

```bash
pnpm add @defsquare/data-graph
```

## Quickstart

This is the same fixture the root README and
[`apps/demo`](../../apps/demo) use — a small e-commerce shop with four entity
types, two aggregate roots, and one deliberate dangling reference:

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
      status: "livrée", payment: "carte bancaire", date: "2024-03-05" },
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
  elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
});

await graph.ready;
graph.fit();

graph.on("select", (node) => console.log("selected:", node.label));
```

## Public API — `DataGraph`

Returned by `createDataGraph(container, options)`.

| Member | Description |
| --- | --- |
| `ready: Promise<void>` | Resolves once Pixi has initialized, the graph has been built, and the initial layout has been rendered. Await before calling other methods. |
| `fit()` | Frames the camera to fit every currently laid-out node in the viewport. |
| `expand(id): Promise<void>` | **Structure-view operation.** Expands a node (reveals its children), re-lays-out, and animates the transition. In the graph view it updates the (invisible) containment state but has no visible effect — see [graph view](#graph-view). |
| `collapse(id): Promise<void>` | **Structure-view operation.** Collapses a node (hides its children) and animates the transition. Same graph-view caveat as `expand`. |
| `tidy(): Promise<void>` | **Structure-view operation.** Re-runs the *global* layout over everything currently visible, then reframes — the repair for the drift left behind by incremental expands, collapses and page reveals. Meant to be offered to the user (the demo's "Ranger" button), not triggered on its own: the layout moves under their eyes. No effect in the graph view, which has its own engine and does not drift — see [structure view](#structure-view). |
| `focus(id)` | Expands every collapsed ancestor of `id` as needed, revealing the page that holds each link of the chain, then centers the camera on it. |
| `select(id)` | Marks a node as selected (drawn with a selection overlay, everything unrelated dimmed — cards, edges, and the graph view's aggregate envelopes) and emits a `select` event. In the graph view a click on an aggregate's envelope selects that whole aggregate instead — same dimming, no event, and either selection replaces the other. Clicking the empty background or pressing <kbd>Esc</kbd> clears the selection — see [Navigation](#navigation). |
| `search(query): SearchResult[]` | Full-text search across every node label, entity id, and row key/value; returns all matches and resets the next/prev cursor. |
| `nextMatch(): SearchResult \| null` | Advances to the next search result (circular), auto-expanding and focusing it. |
| `prevMatch(): SearchResult \| null` | Same as `nextMatch`, in reverse. |
| `on(event, callback): () => void` | Subscribes to `"select"` (`GraphNode`) or `"followRef"` (`RefEdge`); returns an unsubscribe function. |
| `setData(data, config?): Promise<void>` | Rebuilds the whole graph against new data (and optionally a new config), resetting search/selection state. |
| `diagnostics(): Diagnostic[]` | Returns build-time diagnostics: dangling references, duplicate ids, missing id fields. |
| `stats(): { logicalNodeCount, visibleNodeCount }` | Counters for a host status bar: `logicalNodeCount` is every node in the built graph, `visibleNodeCount` is how many are currently expanded/rendered. |
| `refEdges(from): RefEdge[]` | The outgoing reference edges of node `from`, so a host can offer "follow reference" affordances without knowing graph internals. |
| `setTheme(theme)` | Replaces the theme and redraws, without rerunning layout or re-measuring fonts. Accepts a full `Theme` or a `ThemeOverride`, merged via `resolveTheme` against the theme currently in effect — a `byEntityType` set earlier survives a plain theme swap. Safe for toggling between themes that share the same `typography`/`fonts` (e.g. a light/dark pair); changing those two groups needs a fresh `createDataGraph`. |
| `setView(view): Promise<void>` | Switches between `"structure"` and `"graph"`. The first switch to `"graph"` dynamically imports the graph-view engine and computes aggregates, hence the promise — see [graph view](#graph-view). A card selection is carried over onto the nearest entity ancestor, since the graph view only knows entities; an *aggregate* selection is dropped on the way out, having no meaning outside the graph view. |
| `currentView(): DataGraphView` | Returns `"structure"` or `"graph"`, whichever is active. |
| `destroy()` | Tears down the Pixi application and releases all resources. |

`DataGraphOptions.view?: "structure" \| "graph"` (default `"structure"`) picks the initial view at
`createDataGraph` time; `setView`/`currentView` switch and query it afterwards. The graph view folds
nothing: every entity is always visible there, and a header click just selects the card. `expand`/
`collapse`/`tidy` remain structure-view-only. Cards can be dragged in both views; in the graph view,
dragging an aggregate's envelope moves the whole aggregate rigidly, and clicking it (below the same
4 px threshold) selects the whole aggregate. Neither drag is persisted — the next relayout
recomputes positions (see [Navigation](#navigation)).

`src/index.ts` is a **contract, not an index**: the package exports
`createDataGraph` and its types, the [theme block](#themes),
`arrayTokenTextFor`, and the core types you need to write your config and read
results — nothing else. The low-level drawing primitives of `draw.ts`, the
`Camera`, the `Emitter` and the font-metrics helpers are internals of
`createDataGraph`; they remain exported from their own modules for this
package's own tests, but they are not public API and may change without notice.
`test/api-surface.test.ts` pins the exact runtime export list, so any change to
it has to be deliberate.

## Navigation

| Gesture | Action |
| --- | --- |
| Two-finger swipe (trackpad) | Pan |
| Pinch (trackpad) | Zoom at the cursor |
| Mouse wheel | Zoom at the cursor |
| <kbd>Ctrl</kbd> + wheel | Zoom at the cursor |
| Click and drag on the background | Pan |
| Click and drag on a card | Move that card |
| Click and drag on an aggregate envelope (graph view) | Move the whole aggregate |
| Click on an aggregate envelope (graph view) | Select the whole aggregate |
| Click on the empty background | Clear the selection |
| <kbd>Esc</kbd> | Clear the selection |

Dragging a card works in both views. The gesture splits from a plain click at
4 px of pointer travel: below that the click still selects, folds or follows a
reference, above it the card follows the cursor (and the canvas stays put —
panning is inhibited for the duration). In the graph view the aggregate's
envelope is recomputed as the card moves, so it keeps enclosing every member.

Grabbing an envelope — anywhere inside the disc that isn't covered by a card or
a reference's click area — moves the whole aggregate **rigidly**: the circle is
translated, its radius untouched, and every member card goes with it. Hit
testing runs top-down, so cards and edges always win over the disc beneath
them; only the empty part of an envelope grabs it. The same 4 px threshold
applies: below it the gesture is a plain click, which **selects the whole
aggregate** — the envelope lights up to its full hover intensity (no extra
ring), and everything that has no link to the aggregate dims. Selecting an
aggregate and selecting a card are mutually exclusive; either replaces the
other, and both are cleared by the same gestures. A cluster selection is a
graph-view notion only, so `setView("structure")` drops it (a card selection is
still carried over onto its nearest entity ancestor). No event is emitted —
`select` carries a `GraphNode`, and an aggregate is not one.

**Moves are not persisted, by design.** They mutate the current layout only:
the next relayout — expand/collapse, `setData`, a view switch — recomputes
positions and wipes them. A drag is a reading gesture ("get this card out of my
way"), not an edit of the layout.

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

**Selecting also dims everything unrelated.** Cards and edges that have no link
to the selection drop to 25 % opacity, in both views, and so do the aggregate
envelopes of the graph view.

- **Selecting a card** keeps at full opacity: the card itself, the source *and*
  target of each of its references (a broken reference points at nobody, so it
  pulls in nothing), its containment parent and its direct children.
- **Selecting an aggregate** (graph view) keeps at full opacity: every member,
  plus every outside card that has a reference to or from a member. Edges are
  read against the *members*, so an aggregate's internal edges and the ones
  crossing its boundary stay full, while an edge between two outside neighbours
  recedes — it says nothing about the block you pointed at.
- **Envelopes** are read against the cards they hold: an envelope dims only when
  *none* of its members stayed full. One related member is enough to keep it
  lit, since the envelope is then the only thing showing where that member
  lives — and the selected aggregate stays lit for the same reason, without
  needing a rule of its own. Both of an envelope's alphas (fill and stroke) are
  multiplied by the same 25 %; its stroke *width* is not, since that says how
  big the disc is, not how much it matters. Hovering a dimmed envelope still
  brightens it, from the back: the hover intensity and the dimming multiply
  rather than override each other.

Cards are dimmed with a shared Pixi `AlphaFilter`, not with `container.alpha`. A
card is painted in layers inside a single `Graphics` (a full-card accent
background, then the body over it), and container alpha applies per primitive:
the now-translucent body let the accent show through, and a dimmed card rendered
as a flat slab of its accent colour. The filter flattens the card to a texture
first and applies the alpha to that, so a dimmed card looks exactly like a normal
one, only ghosted. Dimmed cards stay clickable either way — Pixi hit-tests
geometry, not opacity.

Clearing the selection restores everything: click the empty background (a real
click — a pan past the same 4 px threshold does not count — and not on a card, a
reference's click area or an envelope), or press <kbd>Esc</kbd>. Neither gesture
emits an event; selection state is read from `select`.

Zoom is bounded to `[0.02, 3]`. `fit()` never scales past `1` — magnifying a
bitmap-font atlas baked at its nominal size is what made text look soft — so a
graph smaller than the viewport is centred rather than blown up.

## Structure view

The default view lays out the containment tree, and what it puts on screen is
**bounded by construction**: opening a document, and every gesture that grows
what is shown, costs a fixed amount of layout regardless of how big the
document is. Three rules, and one repair.

**Opening is a preview.** The initial expansion walks the tree breadth-first
from the root and stops at the first of two limits: the entity boundary
(entities start collapsed, as they always did) or a budget of ~300 cards
(`INITIAL_CARD_BUDGET`, exported by the core package). The second limit is the
one that matters without a config: no `ids` means no entities, so the boundary
never fires and the walk would otherwise expand the whole file. A document that
fits under the budget opens exactly as before — nothing that used to be visible
is now hidden — and what the budget declines is still on screen, just collapsed.

**Expansions are paginated.** Expanding a node reveals one **aligned** page of
100 card children (`PAGE_SIZE`), not a prefix: page `p` is exactly
`[p × 100, (p + 1) × 100)`. Each contiguous run of unrevealed pages is drawn in
its place among the siblings as a clickable `+ n` token, and clicking it reveals
that run's first page. Alignment is what keeps search cheap: `search` +
`nextMatch` reaching `orders[47 312]` reveals *only* the page holding it, with a
`+ 47 300` token above and a `+ 600` token below, where a prefix-based
pagination would have had to materialize 47 313 cards to get there. Elided
children — the ones drawn as rows of their parent's card rather than as cards —
are never paginated; they are not cards, and counting them would shift every
card index.

**`tidy()` repairs the drift.** Expands, collapses and page reveals are
incremental: each inserts (or removes) its block inside the existing layout
instead of recomputing it, which is what makes them instant, and also what makes
the columns diverge, over a long session, from what a global layout would give.
`tidy()` re-runs the global layout over the currently visible set — bounded by
the rules above, hence cheap — drops the engine's memory of past incremental
offsets, and reframes. It is deliberately an offered action rather than an
automatic one: the layout moves under the reader's eyes, so it should be their
gesture. `apps/demo` wires it to a "Ranger" (tidy up) button in its chrome.

None of this touches the graph — `buildGraph` still builds every node, so
search, references and diagnostics never see a truncated document, and
`stats().logicalNodeCount` still counts the whole thing while
`visibleNodeCount` counts what these rules let through. The hard cap on the
document itself is `config.maxNodes` (default 1,000,000), a memory guard on
build + index; see the [root README](https://github.com/defsquare/data-graph#config-ids-refs-groups).

## Graph view

`createDataGraph` supports two views, chosen with `DataGraphOptions.view?:
"structure" | "graph"` (default `"structure"`) and switched at runtime with
`setView(view): Promise<void>` / `currentView(): "structure" | "graph"`:

- **`"structure"`** (default) lays out the containment tree — parent/child
  structure, ELK layered. This is everything described above and elsewhere in
  this README.
- **`"graph"`** lays out records as vertices and joins as edges, grouped
  as declared in `config.groups` (see the
  [core package README](https://github.com/defsquare/data-graph/tree/main/packages/core#aggregates)
  for the membership rule) and drawn as circular envelopes — the minimal
  enclosing circle of each aggregate's cards, plus a `hullPadding` margin.

```ts
const graph = createDataGraph(container, {
  data: shopData,
  config: { ...shopConfig, groups: ["Customer"] },
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
[`apps/demo`](../../apps/demo)) it lands in its own chunk — **3.58 kB gzip**,
7.80 kB raw, measured — and never enters the bundle of a consumer that only ever
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
68. Be clear about what this does to the guarantee above: in kilobytes, it now
guards almost nothing, and a regression would cost 3.58 kB. Both tests are kept
anyway, and their own comments say why: they hold the *shape* — the graph view
loads lazily by construction, so whatever weight this view acquires next is lazy
by default rather than by review.

**No folding.** `expand`/`collapse` are structure-view operations (see the
[API table above](#public-api--datagraph));
they act on the containment tree and have no visible effect in the graph
view. The graph view itself folds nothing: every entity is always drawn,
aggregate cards carry no chevron, and a header click selects the card just
like a body click. An earlier version folded an aggregate onto its root card
from that chevron; it was removed.

**Two-level layout.** The graph view lays itself out in two stages, and the split
is what makes its guarantees structural rather than iterative. Each aggregate is
first laid out on its own, in one of two modes: **radially** — root card at the
centre, every other member on a concentric ring, one ring per reference distance
from the root — when the aggregate has depth (some member at distance ≥ 2), and
in **centred rows** otherwise. Both build the `cardGap` (**16 px** by default)
into the placement. The packed block then becomes a rigid disc, the minimal
enclosing circle of its cards
plus `hullPadding`, which is exactly the shape this package paints; an entity in
no aggregate becomes a singleton disc. A small simulation places those discs —
cross-aggregate references pull as weighted springs — and a final hard pass
guarantees that any two discs end up at least `clusterGap` (**160 px** by
default) apart, edge to edge.

Two things follow that are worth relying on. Cards never need to be pushed apart
afterwards: two cards of one aggregate are placed with the margin, and two cards
of different aggregates cannot meet because their discs cannot. And the shape
that gets spaced is not merely equal to the shape you see — it is the same
circle, computed once from the packed block and translated with its cards.

Placing by reference distance rather than by id is what keeps a deep aggregate
readable: its root sits at the centre instead of in a corner, and chains of
references run outward instead of zigzagging. It costs density — a ring takes a
full card diameter of radius even when it holds one card — which is exactly why
it is not applied to flat aggregates: at depth ≤ 1 there is no depth to encode as
distance, so the mode would only cost. The criterion is depth, never card count.

**Envelopes are nudged out of a lattice.** Discs of equal radius under gravity
and collision settle into hexagonal packing, so a dataset of uniform aggregates
came out as a visible grid. Each cluster gets a deterministic `jitter` (default
**32 px**, `0` disables) that inflates its radius *during the simulation only*:
the guarantees and the painted circles are computed from the true radius and are
bit-identical whatever the amplitude.
[`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
carries the measured before/after on all of this.

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
was done by two relaxation passes over the output of a global `fcose` layout;
those passes and that engine have since been **removed from the core** along
with `cytoscape`. On the demo's dataset the switch took `setView("graph")` from
**4,310–4,484 ms to 220–252 ms** (measured in Chromium, three isolated runs
each, on a dev server serving unminified sources) and the canvas from
18,714 × 19,984 to 8,083 × 8,437.
[`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
carries the full before/after.

How wide the corridors should be is a matter of eye, screen size and data
density, so it is settable per instance rather than baked into core:

```ts
const graph = createDataGraph(container, {
  data,
  config,
  view: "graph",
  // Any TwoLevelLayoutOptions field: clusterGap, hullPadding, cardGap,
  // simIterations, jitter. Read once, when the graph view is first built.
  graphLayoutOptions: { clusterGap: 240 },
});
```

`TwoLevelLayoutOptions` is re-exported from this package, so you can type the
object without depending on `@defsquare/data-graph-core` directly.

> **API change (0.x, no compatibility shim).** `graphLayoutOptions` used to take
> `GraphLayoutOptions` — `{ hullPadding, separationMargin, separationIterations,
> clusterGap }`. It now takes `TwoLevelLayoutOptions` — `{ hullPadding, cardGap,
> clusterGap, simIterations, jitter }`, and this package no longer re-exports the old
> type. `hullPadding` and `clusterGap` keep their name, meaning and default, so
> the common case (`{ clusterGap: 240 }`) is unaffected. The other two are gone
> because the pass they tuned is gone: there is no card-separation pass to cap,
> and the inter-card margin is now placed by the packing (`cardGap`, 16 px —
> `separationMargin`'s old default) instead of being converged towards. Passing
> the retired keys is a type error, which is the intent: silently accepting and
> ignoring them would be worse.

### Off-main-thread layout — `graphLayoutWorkerUrl`

The two-level engine is fast, but it is *synchronous*: on a real architecture
audit — 6,251 entities, ~1,300 aggregates — it spends **~4.4 s** placing discs,
and on the main thread that is 4.4 s of frozen page. No rendering, no panning,
no zooming, no way to cancel. Point `graphLayoutWorkerUrl` at the worker this
package publishes and that computation moves to a Web Worker:

```ts
const graph = createDataGraph(container, {
  data,
  config,
  graphLayoutWorkerUrl: new URL("@defsquare/data-graph/graph-layout-worker", import.meta.url),
});
```

Measured on that audit, in Chromium, `setView("graph")` from the structure view
(median of three runs each):

| | in-process | worker |
| --- | --- | --- |
| total `setView` | 4,480–4,536 ms | 4,753–4,765 ms |
| longest main-thread long task | **4,406–4,464 ms** | **356–364 ms** (applying the result) |
| long tasks while the layout runs | that one | none, or one 57–62 ms extraction |
| frames rendered while waiting | 5 | 311–330 |

The total is ~5 % longer — the price of the structured clone and of starting the
worker — and the wall of frozen time is gone: what remains on the main thread is
the *extraction* (reading the graph into a flat, clonable input) and the
*application* (publishing, refitting, rebuilding the cards), both of which the
in-process path pays too. The structure view stays pannable and zoomable
throughout.

The option is safe to pass unconditionally. On the **first** failure — the URL
won't load, `Worker` doesn't exist, the layout throws — the instance warns once
and replays that layout in-process, permanently for the session. The worst case
is exactly the behaviour you get without the option; it is never a view that
fails to appear. `destroy()` terminates the worker.

The worker is a self-contained ES module (the pure layout core is bundled into
it), so it must be loaded with `{ type: "module" }` — which is what the renderer
does. Bundlers that understand `new URL(specifier, import.meta.url)` resolve it
through the package's `exports`; see `apps/demo/vite.config.ts` in this
repository for the dev/build/Tauri/headless breakdown.

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
enforced — there is no longer any incremental relayout to stabilise. See
[`docs/graph-view.md`](https://github.com/defsquare/data-graph/blob/main/docs/graph-view.md)
for the full table of guarantees and what enforces each one.

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
