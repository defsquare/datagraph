# Graph view and performance budgets

The **graph view** is `datagraph`'s second layout: instead of the containment
tree (the default *structure view*), it draws records as vertices and joins as
edges, grouping records into the DDD aggregates declared by
[`config.groups`](../README.md#config-ids-refs-groups) and painting each
aggregate as a circular envelope.

This document covers how that view lays itself out, what its guarantees are, and
which of them are actually enforced by a test. For the user-facing API —
`view`, `setView`, `currentView`, `graphLayoutOptions` — see the
[renderer package README](../packages/renderer/README.md#graph-view). For the
aggregate membership rule, see the
[core package README](../packages/core/README.md#aggregates).

## Performance budgets

| Operation | Budget |
| --- | --- |
| Parse + index 10,000 logical nodes (`buildGraph`) | < 1 s |
| Expand a node | < 300 ms |
| Pan/zoom frame rate at ~2,000 visible nodes | 60 fps |
| Search across the index | < 50 ms |

**Nothing enforces these.** `packages/core/bench/bench.ts` (run with
`pnpm bench`) measures the first and the last against a synthetic
`bigShop(10_000)` fixture and prints each step next to its budget, but it is
**non-blocking**: it always exits 0, no test asserts any of these numbers, and
the frame-rate and expand budgets are not measured at all. They are a stated
target and a sanity check, not a gate. The core package's README carries the
latest numbers a `pnpm bench` run printed.

## Semantic zoom: below LOD 2, aggregates *are* the nodes

Zoomed out, the graph view stops drawing cards and draws the **aggregates as
nodes**: one filled disc per aggregate — same centre, same radius as the
envelope the layout already computed — labelled with its root entity id and its
member count, plus **aggregated edges**: every reference mapped through
`aggregates.byNode` to its pair of aggregates, deduplicated with a weight,
intra-aggregate ones dropped. Entities in no aggregate keep their flat LOD 2
rectangle; nothing else represents them.

The threshold is **not a third setting**: it is exactly `lodForScale`'s LOD 2
(`scale < 0.15`), the scale at which a card is already nothing but a filled
rectangle and therefore carries no information at all. Replacing 6,251 mute
rectangles by 1,300 named discs there is a strict gain. A dedicated threshold
would have needed its own rebuild trigger, racing the LOD one, and would have
opened a band of scales where both regimes fight over the screen — the mixed
state this split rules out by construction.

Where each piece lives:

* the fold itself is `aggregateRefEdges` in `packages/renderer/src/graph-view.ts`
  — pure, computed **once per `compute()`** and published atomically with the
  index and the layout, never per frame;
* the branch is one `ViewPolicy` value pair in `create.ts`
  (`cards: "all" | "unclustered"`, `aggregates: "none" | "hull" | "disc"`).
  `cards: "unclustered"` filters `CardContext.drawable`, which is the single set
  both `syncCards` and `ensureCard` iterate — so no materialisation path can
  paint a card a disc already stands for;
* the painting is three pure functions in `draw.ts` (`drawSemanticDiscs`,
  `drawSemanticLabels`, `drawSemanticEdges`), each taking bare arrays and
  numbers, no graph and no state.

Clicking a disc selects its aggregate through the hit areas that already
existed (`drawClusterHitAreas` / `selection.kind === "cluster"`); hover, drag
and dimming are the envelope mechanics unchanged. `focus()` and search still
land on a card: they jump the camera to scale 1, which crosses the threshold,
rebuilds, and materialises the target.

### What it cost, measured

On the real dataset that motivated it (6,251 entity cards, 28,685 reference
edges, ~1,300 Package/Module aggregates), 1600×1000, headless Chromium — so a
*software* rasteriser, which is the point: it makes the geometry costs visible
rather than hiding them behind a GPU.

| Idle frame, whole graph framed | Before | After |
| --- | --- | --- |
| median | 503 ms | **203 ms** |

Two findings worth keeping, both from bisecting that number by layer:

1. **Dropping the cards is most of the win.** With no semantic layer painted at
   all the idle frame is 8 ms: the 6,251 card containers — all of them
   materialised, since framing the whole graph puts them all inside the paint
   window — were the bulk of the old 503 ms, not the envelope fills.
2. **`Graphics.circle()` picks its tessellation from the *world* radius.** A
   1,000 px-world envelope seen at scale 0.04 is 80 px on screen and still gets
   several hundred segments; over 1,300 discs that is hundreds of thousands of
   triangles per frame. Drawing each disc as a 36-sided polygon instead
   (`SEMANTIC_DISC_SEGMENTS`) took the disc layer from 494 ms to 77 ms, for a
   maximum deviation of `r × (1 − cos(π/36))` ≈ 0.4 % of the radius — under a
   third of a pixel on the largest disc of that dataset. The envelopes of
   `drawClusters` keep the true circle: the two are never on screen together.

A third, smaller one: the disc's accent is **pre-blended against the canvas
colour and painted opaque** (`blendOver`) rather than laid on as a translucent
fill over an opaque knockout. The opacity is needed anyway — aggregated edges
pass underneath, and a translucent disc fills with the network that skirts it —
and doing it in one fill rather than two halved that layer again (755 → 380 ms,
before the polygon change).

The zoom traversal is unaffected: the worst frame while crossing the thresholds
is ~1,320 ms both before and after, and it happens in the *card* regime
(LOD 0/1), which this change does not touch. Its mean improves 610 → 485 ms.
`setView("graph")` is unchanged at ~4.6 s on that dataset — it is layout-bound,
not paint-bound.

## Two levels, because membership is a partition

Every entity belongs to at most one aggregate (see
[the core README](../packages/core/README.md#aggregates)), so the layout problem
splits cleanly in two and neither half has to repair the other:

1. **Inside an aggregate**, cards are placed by one of two modes, chosen per
   aggregate. **Radially** — root at the centre, every other member on a
   concentric ring, one ring per reference distance from the root (a local BFS
   along intra-aggregate references, ties broken by id) — when the aggregate has
   *depth*; in **centred rows** otherwise. `cardGap` is built into both, so
   non-overlap is a property of the geometry rather than the result of a
   relaxation — for the radial mode the proof is two inequalities, written out
   above `packRadial` in `packages/core/src/graph-layout.ts`.
2. **Between aggregates**, each packed block becomes a rigid disc: the minimal
   enclosing circle of its cards plus `hullPadding`, which is exactly the shape
   the renderer paints. An entity in no aggregate is a singleton disc.
   Cross-aggregate references become weighted springs; a small simulation
   (springs, gravity, disc-disc collision, 400 iterations, FNV-1a seeding)
   places the discs, and a final hard pass makes
   `dist ≥ r₁ + r₂ + clusterGap` an output invariant.

Two consequences worth relying on. There is **no card separation pass at all** —
two cards of different aggregates cannot overlap because their discs cannot, and
two cards of one aggregate are packed with the margin already in place. And the
cost no longer follows the number of cards but the number of aggregates,
O(k² · iterations) on k discs plus a linear packing.

## What the tests actually hold

| Property | Guarantee | Enforced by |
| --- | --- | --- |
| Card overlap after layout | Zero overlapping pairs, **and** no pair closer than `cardGap` (16 px), at 334 cards. Both hold **by construction** rather than by relaxation: cards of one aggregate are packed with the margin already included, and two cards of different aggregates cannot come close because their discs are held apart. There is no iteration cap to run out of, so the margin does not degrade with scale. Asserted with a **1e-9 px** tolerance: the margin is exact in the packing's local frame, and the only thing applied afterwards is one translation per cluster | `packages/core/test/graph-layout.test.ts` |
| Determinism | **Bit-identical** positions *and* envelopes across two runs on the same input, including when the `visible` set is iterated in a different order. Seeded from node ids (FNV-1a); no `Math.random`, no `Date.now` | `packages/core/test/graph-layout.test.ts` |
| Aggregate envelope spacing after layout | Zero overlapping pairs at 167 aggregates, and every pair of discs at least `clusterGap` − 1e-6 apart edge to edge. This covers **painted envelopes and the singleton discs of entities in no aggregate alike** — the test builds the full disc set from the result, not just the emitted `clusters`. It is an output invariant of a final hard pass, not a convergence hope | `packages/core/test/graph-layout.test.ts` |
| Envelope fidelity | The disc that gets spaced is the disc that gets painted: each emitted `ClusterShape` matches the minimal enclosing circle recomputed from the final card positions to 1e-6, every member's corners lie inside it, and only real aggregates emit one | `packages/core/test/graph-layout.test.ts` |
| Jitter never weakens a guarantee | The virtual inflation applies to the simulation only: the final hard pass uses the true radius, and the emitted `ClusterShape` radii are **bit-identical** between `jitter: 0` and `jitter: 64` while the positions differ. Nearest-neighbour minimum stays at exactly `clusterGap` at every amplitude measured (0, 16, 32, 48, 64) | `packages/core/test/graph-layout.test.ts` |
| `setView("graph")` on the demo's 350-entity dataset | **Measured, not enforced.** 220–252 ms in Chromium over three isolated Playwright runs — in the **dev server**, unminified, against the workspace *sources* (see below), so it is not a figure for published, bundled code. The committed assertion is only a 30 s ceiling; the number is logged, not asserted, because a CI machine is not a developer's | `apps/demo/e2e/view.spec.ts` |
| `@defsquare/datagraph` bundle purity | The graph view never enters a consumer's bundle unless it calls `setView("graph")` — the structure view alone doesn't pull it in. **What this is worth in kilobytes has collapsed, and the tests say so**: the chunk it keeps out is **3.58 kB gzip** (7.80 kB raw), so a regression would now cost 3.58 kB on a 559 kB bundle. Both tests are kept for the *shape* they hold — the view loads lazily by construction, so whatever weight lands behind it next inherits that — not for the kilobytes | `packages/core/test/bundle-purity.test.ts` (core half) + `packages/renderer/test/bundle-purity.test.ts` (renderer half) |

**About the e2e numbers.** `apps/demo/playwright.config.ts` starts the app with
`pnpm dev`, and `apps/demo/vite.config.ts` aliases the workspace packages to
`packages/*/src` in `serve` mode. Every e2e figure quoted here was therefore
measured on unminified sources through Vite's dev pipeline, never on a published
bundle. That makes them useful as an order of magnitude and as a regression
tripwire, and useless as an absolute performance claim about the npm package.
The bundle *sizes* below are the opposite: they come from a Vite **production**
build of `apps/demo`, which is not aliased.

## Discs are virtually inflated during the simulation only

Gravity and collision acting on discs of *equal* radius converge on hexagonal
packing — it is the optimal packing of equal circles — and on a dataset of
uniform aggregates with no edges between them that produced a lattice whose
alignments ran across the whole canvas. Each cluster is therefore given a
deterministic `jitter` (default **32 px**, `0` disables it), derived from an
FNV-1a hash of its id, and the simulation works with `r + jitter`. The final hard
pass uses the **true** radius, so the guarantee is untouched — nearest-neighbour
minimum measured at exactly 160.00 px for every amplitude from 0 to 64 — and the
jitter never enters the enclosing circle or `ClusterShape`, so the painted shape
is never inflated. What it buys is *variance*: neighbours settle across
`[clusterGap, clusterGap + jitter₁ + jitter₂]` instead of all landing on
`clusterGap`, and discs that no longer ask for the same room cannot form a
lattice. This is the engine's only source of noise; there is still no
`Math.random` and no `Date.now`, and determinism stays bit-for-bit.

## Radial placement, and what it costs

The first level used to be a *shelf* packing — members laid out in centred rows
in id order, ignoring references entirely. On a deep aggregate that put the root
in a **corner** of the block, which is the farthest point from the enclosing
circle's centre: measured on a 41-card, four-level fixture (`deepAggregate()`),
the root ranked **40th of 41** by proximity to its own disc's centre, 597.7 px
away from it. Radial placement fixes what it was meant to fix — mean
intra-aggregate reference **591.4 → 363.0 px**, max **976.3 → 488.1 px**, root
centrality **597.7 → 16.4 px**, and the root now ranks 1st.

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

## The level-2 constants are calibrated

Spring force 0.15, weight cap `min(1, w/2)`, gravity 0.02 and 400 iterations were
originally the first set tried. A one-at-a-time sweep followed by a cross grid,
over three fixtures chosen to exhaust the regimes — `bigShop(3000)` with *zero*
inter-aggregate edges, the demo at mean degree 4.6, and a purpose-built
`denseRefs()` at degree 12.0 — kept all four. Spring 0.15 is the exact minimum of
mean inter-aggregate reference length on the dense fixture (1,554 px, against
1,618 at 0.10 and 1,611 at 0.25): past it the springs pull hard enough that the
hard pass must contradict them and references get *longer*. 400 iterations is the
knee — below it the layout has not converged, above it costs 2× for 3%.

The sweep also turned up an interaction nobody had looked for: **the level-2
constants and the jitter fight each other**. Strong springs (0.25, 0.40) or
ungraded weights (`N=1`) recompress the tiling and undo the noise — the
nearest-neighbour standard deviation on the dense fixture falls from 11.8 px to
4.1, which is most of what `jitter: 32` bought. The retained values are therefore
also the ones that *let the jitter work*, which was not a criterion when it was
set. The full tables live in `DEFAULTS` in
`packages/core/src/graph-layout.ts`, and the one genuine trade-off that was
declined — a config 11% better on the demo, at the cost of the tiling on the
other two fixtures — is stated there rather than buried.

## Envelopes are circles

That predates the current engine — it lives in `packages/core/src/hull.ts`, not
in the layout, and it survived the engine swap unchanged. An aggregate's envelope
is the **minimal enclosing circle** of its cards' corners (Welzl's algorithm),
its radius grown by `hullPadding`. The input is deliberately **not shuffled**:
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

## Corridor width: `clusterGap`

`clusterGap` defaults to **160 px**, chosen by measurement rather than taste, and
settable per instance via `graphLayoutOptions` (see the
[renderer README](../packages/renderer/README.md#graph-view)). The sweep behind
it was run on the retired engine — the current default is inherited from it, and
what the sweep establishes about *corridor width versus canvas* does not depend
on which engine opens the corridor. On `bigShop(3000)`, sweeping gap 0 / 80 /
160 / 240 / 320 / 400: correctness — zero overlapping envelope pairs — is already
reached at **80 px**, and everything above that buys corridor width, not
correctness. At 160 px the nearest-neighbour gap goes from −289.8 px (pass
disabled) to 160.0 px and overlapping pairs from 911 to 0. Going further costs
canvas faster than it buys legibility: 160 → 240 px was +38% area to move fill
from 6.2% to 4.5%.

The *area* figures from that sweep do **not** carry over, and are omitted for
that reason: they measured circles inflated by the old engine's scattering,
whereas the two-level engine's circles are minimal by construction — which is
exactly why the same 160 px now yields 15.1% fill on the demo dataset where it
yielded 2.8%. The value has deliberately **not** been re-swept on the new engine,
so that the comparison between the two could be made at equal guarantees;
re-running it is the obvious next measurement if the default becomes a question
again.

## Lazy import

Switching to the graph view for the first time dynamically imports the
`graph-layout` entry point, and a Vite production build of
[`apps/demo`](../apps/demo) emits it as its own chunk — **3.58 kB gzip**
(7.80 kB raw), against a 559.24 kB gzip main chunk.

The entry point stays separate, and the honest reason is not weight: 3.58 kB does
not justify an architecture. It stays because the laziness is then a property of
the shape rather than of a review — `setView` is async for that reason, and
whatever the graph view pulls in next is lazy by default — and because
`./graph-layout` is a published subpath export.

## The layout runs in a Web Worker

The engine is deterministic and synchronous, and on a real architecture audit —
6,251 entities, ~1,300 aggregates — it spends **~4.4 s** in `layout()`. Fast is
not the same as non-blocking: on the main thread those 4.4 s are one long task,
so nothing renders, nothing pans, nothing zooms, and the switch looks like a
hang.

The engine is therefore **split in two**, both exported from the `graph-layout`
entry point:

* `extractGraphLayoutInput(graph, aggregates, visible, metrics, options)` — the
  only part that reads the `Graph`. It reads exactly three things (the visible
  entity ids, `measureNode` on each, and `graph.refEdges`) and returns a **flat,
  structured-clonable** `GraphLayoutInput`. A `Graph` cannot cross a
  `postMessage`; this can.
* `layoutFromInput(input)` — everything else. Pure: no graph, no DOM, no
  environment. It runs on either side of the boundary.

`createTwoLevelLayoutEngine` is now their composition and keeps its exact
signature: it is still the in-process path and still the worker's fallback. The
split changes **no bit of the output** — that is asserted against digests
captured before the refactor, on three fixtures chosen to exercise shelves,
radial packing and inter-aggregate springs
(`packages/core/test/graph-layout-identity.test.ts`).

The renderer takes the worker's URL through
[`graphLayoutWorkerUrl`](../packages/renderer/README.md#off-main-thread-layout--graphlayoutworkerurl),
extracts on the main thread, and computes in the worker. Responses carry a
generation number and only settle the request that carries the same one; the
first failure of any kind warns once and falls back in-process for the rest of
the session; `destroy()` terminates the worker. Measured on the audit above,
`setView("graph")` went from a single **4,406–4,464 ms** main-thread long task
(5 frames rendered while waiting) to a longest long task of **356–364 ms** —
which is applying the result, not computing it — and 311–330 frames, for ~5 %
more wall-clock time.

## No folding

`expand`/`collapse` are structure-view operations; the graph view folds nothing,
so every entity is always visible there. An earlier version folded an aggregate
onto its root card and kept already-placed cards from drifting through an
incremental relayout with pinned nodes, guarded by a 0 px-median-drift budget.
All of it was removed with folding: there is no incremental relayout left to
stabilise, and a budget with no test behind it is worse than no budget.

## History

The graph view used to lay out through a global `fcose` layout (via `cytoscape`
and `cytoscape-fcose`) repaired by two relaxation passes, one for cards and one
for envelopes. That engine, its passes, its tests and both dependencies were
**removed from the repo**; the code is in git history, and the comparison that
retired it is in
[`superpowers/spikes/2026-09-01-two-level-layout.md`](./superpowers/spikes/2026-09-01-two-level-layout.md).
Run at equal guarantees (`clusterGap: 160`, `hullPadding: 18` on both sides), it
measured the two-level engine at 143 ms against 1,624 ms on a 334-card fixture
and 64 ms against 4,138 ms on the demo's, with fill going from 6.2% to 12.3% and
from 2.8% to 15.1% respectively — the density gain being structural: packing the
cards *before* the enclosing circle exists makes that circle minimal, so the
spacing budget is spent on corridors instead of on padding. Several defaults
documented above (`clusterGap`, the partition rule's measurements) were chosen
against that engine, which is why it is still named here.

`docs/superpowers/` is a historical journal of spikes and specs, kept as a
record of how decisions were reached. It is not maintained as current reference
documentation; where it disagrees with this file or with the code, the code wins.
