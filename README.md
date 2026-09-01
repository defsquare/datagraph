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
into DDD aggregates drawn as circular envelopes — see [`config.aggregates`](#entityreference-configuration)
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
- `aggregates` — entity type names that are DDD aggregate roots, in declaration order. That order
  is load-bearing: it decides which root claims an entity that reaches two of them at the same
  distance. See [the core package README](./packages/core/README.md#aggregates) for the membership
  rule and the [graph view](./packages/renderer/README.md#graph-view) it powers.
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

The graph view runs the **two-level layout engine** (`createTwoLevelLayoutEngine`,
`packages/core/src/layout-two-level.ts`), and it is now the only one. It replaced
a global fcose layout followed by two repair passes; that pipeline —
`layout-graph.ts`, `separate.ts`, `cluster-separate.ts`, plus the `cytoscape` and
`cytoscape-fcose` dependencies — has since been **removed from the repo**. What
it measured is kept below as a dated historical trace, because several current
defaults were chosen against it; the code itself lives in git history and in
`docs/superpowers/spikes/2026-09-01-two-level-layout.md`.

| Property | Budget | Enforced by |
| --- | --- | --- |
| Card overlap after layout | Zero overlapping pairs, **and** no pair closer than `cardGap` (16 px), at 334 cards. Both hold **by construction** rather than by relaxation: cards of one aggregate are packed with the margin already included, and two cards of different aggregates cannot come close because their discs are held apart. There is no iteration cap to run out of, so the margin no longer degrades with scale the way the retired pipeline's did. Asserted with a **1e-9 px** tolerance, which is also what remains of the retired "intra-aggregate geometry" budget: the margin is exact in the packing's local frame, and the only thing applied afterwards is one translation per cluster | `packages/core/test/layout-two-level.test.ts` |
| Determinism | **Bit-identical** positions *and* envelopes across two runs on the same input, including when the `visible` set is iterated in a different order. Seeded from node ids (FNV-1a); no `Math.random`, no `Date.now` | `packages/core/test/layout-two-level.test.ts` |
| Aggregate envelope spacing after layout | Zero overlapping pairs at 167 aggregates, and every pair of discs at least `clusterGap` − 1e-6 apart edge to edge. This covers **painted envelopes and the singleton discs of entities in no aggregate alike** — the test builds the full disc set from the result, not just the emitted `clusters`. It is an output invariant of a final hard pass, not a convergence hope | `packages/core/test/layout-two-level.test.ts` |
| Envelope fidelity | The disc that gets spaced is the disc that gets painted: each emitted `ClusterShape` matches the minimal enclosing circle recomputed from the final card positions to 1e-6, every member's corners lie inside it, and only real aggregates emit one | `packages/core/test/layout-two-level.test.ts` |
| `setView("graph")` on the demo's 350-entity dataset | **Measured, not enforced.** 220–252 ms in Chromium over three isolated Playwright runs, against **4,310–4,484 ms** for the retired pipeline on the same machine — about **×19**. The committed assertion is only a 30 s collapse ceiling; the number is logged, not asserted, because a CI machine is not a developer's | `apps/demo/e2e/view.spec.ts` |
| `@defsquare/data-graph` bundle purity | The graph view never enters a consumer's bundle unless it calls `setView("graph")` — the structure view alone doesn't pull it in. **What this is worth has collapsed, and the tests say so**: the chunk it keeps out went from **180.28 kB gzip to 2.59 kB** (5.67 kB raw) when `cytoscape` left, so a regression would now cost 2.59 kB on a 552 kB bundle. Both tests are kept for the *shape* they hold — the view loads lazily by construction, so whatever weight lands behind it next inherits that — not for the kilobytes | `packages/core/test/bundle-purity.test.ts` (core half) + `packages/renderer/test/bundle-purity.test.ts` (renderer half) |

**Two levels, because membership is a partition.** Every entity belongs to at
most one aggregate (see [the core README](./packages/core/README.md#aggregates)),
so the problem splits cleanly in two and neither half has to repair the other:

1. **Inside an aggregate**, cards are placed by one of two modes, chosen per
   aggregate. **Radially** — root at the centre, every other member on a
   concentric ring, one ring per reference distance from the root (a local BFS
   along intra-aggregate references, ties broken by id) — when the aggregate has
   *depth*; in **centred rows** otherwise. `cardGap` is built into both, so
   non-overlap is a property of the geometry rather than the result of a
   relaxation — for the radial mode the proof is two inequalities, written out
   above `packRadial`.
2. **Between aggregates**, each packed block becomes a rigid disc: the minimal
   enclosing circle of its cards plus `hullPadding`, which is exactly the shape
   the renderer paints. An entity in no aggregate is a singleton disc.
   Cross-aggregate references become weighted springs; a small simulation
   (springs, gravity, disc-disc collision, 400 iterations, FNV-1a seeding)
   places the discs, and a final hard pass makes
   `dist ≥ r₁ + r₂ + clusterGap` an output invariant.

**Radial placement, and what it costs.** The first level used to be a *shelf*
packing — members laid out in centred rows in id order, ignoring references
entirely. On a deep aggregate that put the root in a **corner** of the block,
which is the farthest point from the enclosing circle's centre: measured on a
41-card, four-level fixture (`deepAggregate()`), the root ranked **40th of 41**
by proximity to its own disc's centre, 597.7 px away from it. Radial placement
fixes what it was meant to fix — mean intra-aggregate reference **591.4 → 363.0
px**, max **976.3 → 488.1 px**, root centrality **597.7 → 16.4 px**, and the root
now ranks 1st.

It is also, uniformly, **less dense**, and that is structural rather than a
tuning miss: a ring costs a full card diameter of radius even when it carries one
card, so the disc grows with *depth* more than with card count. Disc radius, rows
→ radial: 2 cards 162 → 209 px, 5 cards over two rings 296 → 602, 10 cards over
three rings 350 → 899, 41 cards 712 → 1,044. Applied to every aggregate, that
dropped fill from 12.3% to 7.8% on the core fixture and 15.1% to 10.9% on the
demo's — for **no gain at all** on either, since their aggregates hold 1 to 5
cards and have no chain to straighten.

**So the mode is chosen per aggregate, by depth.** Radial if and only if some
member sits at reference distance **≥ 2** from the root; centred rows otherwise.
The reasoning is that the radial mode's whole mechanism is *encoding reference
depth as distance from the centre* — at depth ≤ 1 every non-root card is
equidistant, there is nothing to encode, and the mode only costs. Note what the
criterion does **not** mention: any card count. A size threshold was measured and
rejected, because the one that cancelled the cost on this repo's datasets was
exactly their largest aggregate — a number fitted to the fixtures rather than to
a reason. Depth is fitted to what the radial mode is *for*.

Orphans are excluded from the criterion: a member the local BFS cannot reach
(its intermediate hop is hidden) gets a synthetic outer ring in radial mode, and
that ring encodes missing information rather than depth — counting it would flip
a flat aggregate into radial for nothing.

The result is that both real datasets stay in rows and keep their density
exactly (**12.3%** and **15.1%**), while `deepAggregate()` keeps every radial
gain. The open case, recorded rather than guessed at: a **flat but wide** star —
depth 1, dozens of cards — stays in rows even though root centrality could be
argued for there. No real dataset has that shape; it will be decided if one
appears.

**What the two-level switch bought, measured.** The spike behind it
(`docs/superpowers/spikes/2026-09-01-two-level-layout.md`) ran both engines with
the same `clusterGap: 160` and `hullPadding: 18`, so the comparison is at equal
guarantees. Its fill figures below predate radial placement and were taken with
the shelf packing:

| | old (fcose + 2 passes) | two-level |
| --- | --- | --- |
| `bigShop(3000)`, 334 cards / 167 aggregates | 1,624 ms | **143 ms** |
| its bbox / fill | 8,370 × 8,418 — 6.2% | **6,026 × 5,929 — 12.3%** |
| card pairs under 16 px | 28 | **0** |
| demo dataset, 350 entities / 116 blocks | 4,138 ms | **64 ms** |
| its bbox / fill | 18,714 × 19,984 — 2.8% | **8,083 × 8,437 — 15.1%** |
| mean cross-aggregate reference length | 6,104 px | **1,364 px** |

Fill doubles to quintuples for a structural reason, not a tuning one: fcose
scattered an aggregate's members, so its enclosing circle inflated, so
`separateClusters` ended up spacing *large, nearly empty* circles apart. Packing
the cards **before** the circle exists makes the circle minimal, so the spacing
budget is spent on corridors instead of on padding.

Three things the spike did **not** settle, restated here because they are still
open: the intra-aggregate packing ignores edges (members are placed by id, which
is invisible at 2–5 cards per aggregate and would not be on aggregates of
dozens); the O(k²) simulation was measured at 3.6 s on 500 discs, so it needs a
spatial grid before that cardinality is real; and the level-2 constants (spring
force 0.15, weight capped at 2, gravity 0.02, 400 iterations) are the **first set
tried**, never swept — which says the architecture is robust to tuning, not that
these values are the right ones.

**Envelopes are circles**, and that predates the current engine — it lives in
`packages/core/src/hull.ts`, not in the layout, and it survived the engine swap
unchanged. An aggregate's envelope is the
**minimal enclosing circle** of its cards' corners (Welzl's algorithm), its
radius grown by `hullPadding`. The input is deliberately **not shuffled**:
Welzl's expected-linear bound relies on a random permutation, but this repo
requires pixel determinism, and the clusters here are tiny — 4 points for the
common single-card aggregate, 20 for the largest on the demo dataset. A fixed
order is the right trade at that size; it would stop being one on aggregates of
hundreds of cards. An earlier version drew a padded **convex hull** instead;
circles replaced it so that one single shape is both spaced and painted. The
two-level engine leans on that harder than its predecessor did: it computes the
circle *once*, from the packed block, and then translates it with its cards, so
the spaced shape and the painted shape are not merely equal — they are the same
object.

**Folding was removed from the graph view**, and with it the incremental
relayout that used to keep already-placed cards from drifting when an
aggregate was unfolded. That mechanism pinned every placed card through
fcose's `fixedNodeConstraint`, and a committed test measured its median drift
at 0px (against 1084px for an unpinned full relayout). Both the code and that
test are gone: everything is visible at all times, so there is no incremental
relayout left to stabilise, and a budget with no test behind it would be worse
than no budget. The history lives on in
`docs/superpowers/specs/2026-08-31-graph-view-aggregates-design.md`.

Switching to the graph view for the first time still dynamically imports the
`graph-layout` entry point, and a Vite production build of
[`apps/demo`](./apps/demo) still emits it as its own chunk. That chunk is now
**2.59 kB gzip** (5.67 kB raw), down from **180.28 kB** (577.17 kB) before
`cytoscape` and `cytoscape-fcose` were removed — a factor of 70 — while the main
chunk did not move (552.04 kB gzip either side, so nothing leaked into the
barrel on the way). Removing the four packages that went with them (`cytoscape`,
`cytoscape-fcose`, and their transitive `cose-base` and `layout-base`) is the
whole of that saving.

The entry point stays separate anyway, and the honest reason is no longer
weight: 2.59 kB does not justify an architecture. It stays because the laziness
is then a property of the shape rather than of a review — `setView` is async for
that reason, and whatever the graph view pulls in next is lazy by default — and
because `./graph-layout` is a published subpath export. Both bundle-purity tests
were kept and rewritten to say exactly that, rather than left asserting the
absence of a string that no longer occurs anywhere in the repo.

**What the partition rule bought, measured.** The demo's config declares two
roots (`aggregates: ["Customer", "Product"]`) over a dataset where every `Order`
references a `Customer` *and* a `Product`, so every order sits one hop from both.
Under the retired overlap rule it was a full member of both, and the merge
percolated. Measured on `bigShop(4000)` — 350 entities, 108 aggregates — with the
same layout and the same circular envelopes, the membership rule the only
difference:

| | overlap on ties (retired) | arbitration (current) |
| --- | --- | --- |
| super-clusters | 9 | **116** |
| largest block | 342 of 350 cards (97.7%) | **5 cards (1.4%)** |
| overlapping envelope pairs | 3,520 of 5,778 (61%) | **0** |
| canvas bbox | 7,199 × 4,588 | 18,714 × 19,984 |

The 116 blocks are 78 `Customer` aggregates (26 of 5 cards, 26 of 4, 26 of 3),
30 single-card `Product` aggregates, and the 8 `Category` entities no aggregate
claims — membership follows references *inbound* to the root, and products point
*at* categories. That block structure is a property of the membership rule and
still holds today; the bbox in the table above is not, being the old engine's.
The price it records — a canvas about **11× larger by area** — is what the
two-level engine mostly gave back: on the same data it lays those same 116 blocks
out in 8,083 × 8,437 instead of 18,714 × 19,984, about **5.5× less area**, at
15.1% fill instead of 2.8%.

`clusterGap` defaults to **160 px**, chosen by measurement rather than taste, and
settable per instance via `graphLayoutOptions` (see the renderer README). The
sweep behind it was run on the retired engine — it is kept here because the
current default is inherited from it, and because what it establishes about
*corridor width versus canvas* does not depend on which engine opens the
corridor. On `bigShop(3000)`, sweeping gap 0 / 80 / 160 / 240 / 320 / 400:
correctness — zero overlapping envelope pairs — is already reached at **80 px**,
and everything above that buys corridor width, not correctness. At 160 px the
nearest-neighbour gap goes from −289.8 px (pass disabled) to 160.0 px and
overlapping pairs from 911 to 0. Going further costs canvas faster than it buys
legibility: 160 → 240 px was +38% area to move fill from 6.2% to 4.5%.

The *area* figures from that sweep do **not** carry over, and are omitted here
for that reason: they measured circles inflated by fcose's scattering, whereas
the two-level engine's circles are minimal by construction — which is exactly
why the same 160 px now yields 15.1% fill on the demo dataset where it yielded
2.8%. The value has deliberately **not** been re-swept on the new engine, so that
the spike could compare the two at equal guarantees; re-running it is the
obvious next measurement if the default ever becomes a question again.

---

**Historical trace — the pipeline the graph view used until the two-level
switch, removed from the repo since.** `createGraphLayoutEngine`
(`layout-graph.ts`) asked fcose for a global layout of every card, then repaired
it with `separateOverlaps` (cards) and `separateClusters` (envelopes). All three
modules, their tests, and the `cytoscape` / `cytoscape-fcose` dependencies are
gone; the code is in git history and the comparison that retired it is in
`docs/superpowers/spikes/2026-09-01-two-level-layout.md`. What is kept here is
only what still explains a current choice — the `clusterGap` sweep above, the
partition-rule table above it — plus one lesson that outlived its code:

> **An early exit compared against zero never fires.** `separateOverlaps` tested
> residual penetration against `0` rather than an epsilon; a pair settled exactly
> at the margin keeps a residual of **1.84e-11 px** (measured, on 334 cards),
> which still reads positive, so the loop "moved" picometers until its cap every
> single time. That turned `separationIterations` from a ceiling into a fixed
> cost — cap 3,000 → 1.9 s, 10,000 → 6.3 s, 100,000 → 63.5 s, dead linear.
> Comparing against an epsilon instead recovered **−28%** on that fixture. The
> current engine's hard pass exits on the same principle, and its own tolerance
> is documented where it is set; the earlier notes in this repo guessed 1e-13 and
> 1e-14 for that residual, neither of which had ever been measured, which is the
> other half of the lesson.

Two dead ends recorded so they are not retried on a future engine: longer
`idealEdgeLength` on cross-aggregate edges did **not** open corridors under fcose
(it calibrates repulsion on the *average* ideal length across all edges, so
lengthening a subset inflates everything and destroys the clustering signal); and
a virtual centre node per aggregate pulled *disjoint components* together harder
than it pulled co-members, leaving them 2.2–2.4× further apart than with no
centre at all.

The retired engine seeded fcose deterministically from node ids rather than
leaving it to fcose's default randomization, which is what made its determinism
assertable at all. The two-level engine keeps the same FNV-1a hash for the same
purpose, but seeds *discs* rather than cards, and has no randomized library
underneath it to override — which is why its determinism budget above is stated
bit-for-bit rather than to the pixel.

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
