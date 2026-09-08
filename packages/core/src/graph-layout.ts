// The `./graph-layout` entry point: the whole graph view, engine and contract.
// It is deliberately kept OUT of the `index.ts` barrel so the chunk stays
// separate and the graph view's loading stays lazy by construction — the
// renderer only reaches it through a dynamic `import()`.
// `test/bundle-purity.test.ts`, here as in the renderer, guards that invariant.
//
// The TWO-LEVEL graph view layout engine, and the only one.
//
// IT IS SPLIT IN TWO, and that split is the structure of the file:
// `extractGraphLayoutInput` (the only function that reads the `Graph`) produces
// a FLAT `GraphLayoutInput`, `layoutFromInput` does all the computation without
// ever touching the graph or a DOM. `createTwoLevelLayoutEngine` is nothing but
// their composition, with an unchanged signature. The why fits in one
// measurement: on a real audit of 6,251 entities the computation takes ~4.4 s,
// which is only tolerable off the main thread — and a `Graph` does not cross a
// `postMessage`. The full contract sits above `GraphLayoutInput`, and the
// invariant "the split changes no bit" in
// `test/graph-layout-identity.test.ts`.
//
// It replaced a globally-then-repaired pipeline — `createGraphLayoutEngine`,
// which asked fcose for a layout of all the cards then patched it with two
// relaxation passes, `separateOverlaps` (cards) then `separateClusters`
// (envelopes). Those three modules were REMOVED from the repo along with
// `cytoscape` and `cytoscape-fcose`. The many references below still name them
// because that is what the choices here were measured against; their code lives
// in the git history, and the probe doc cited below keeps the measurements.
//
// Ported from the probe (`bench/layout-two-level.ts`, removed as well) — see
// `docs/superpowers/spikes/2026-09-01-two-level-layout.md` for the complete
// measurements. The algorithm is carried over identically in substance; the
// envelope changes (factory + async `layout()`, to honor `GraphLayoutEngine`,
// declared further down in this file), and two constants of the final hard pass
// are tightened — see the documentation of `hardSeparation`
// (`disc-simulation.ts`), which gives the measurements and what they cost. These
// two departures change nothing structurally; they make the invariant hold at
// every scale, where the probe only ensured it to within 1e-3 and silently broke
// it beyond ~200 discs.
//
// The principle rests on a property of the model: aggregate membership is a
// strict PARTITION (see `aggregate.ts`), so the problem decomposes with no
// overlap of responsibilities.
//
//   1. INTRA-aggregate — each aggregate is packed independently of the others,
//      RADIALLY (root at the center, one ring per reference distance) if it has
//      depth, in SHELVES (centered rows) otherwise; the switch and its
//      justification sit above `packCluster` (`graph-pack.ts`). In both cases the
//      `cardGap` margin is INCLUDED in the placement, so non-overlap of the cards
//      of one aggregate is acquired by construction and not by relaxation.
//   2. INTER-aggregate — each aggregate becomes a rigid disc: the minimal
//      enclosing circle of its cards plus `hullPadding`, that is, exactly the
//      shape the renderer paints. An entity outside any aggregate is a singleton
//      disc, as in the removed `separateClusters`. Inter-aggregate references are
//      aggregated into weighted springs; a small simulation places the discs, and
//      a final hard pass makes dist ≥ r₁ + r₂ + `clusterGap` an EXIT INVARIANT,
//      not a hope of convergence.
//
// Structural consequence: there is no card separation pass any more. Two cards
// of different aggregates cannot overlap since their discs do not touch, and two
// cards of the same aggregate are packed with a margin. The cost therefore no
// longer follows the number of CARDS but the number of AGGREGATES: k discs ×
// iterations, plus a linear packing. It was O(k² · iterations) until collision
// went through a spatial grid — see the caveat lifted at the bottom of this
// header.
//
// Measured by the probe (median of 3 runs, `clusterGap: 160` and
// `hullPadding: 18` on both sides, hence at equal guarantees):
//
//   the core's bigShop(3000) — 334 entities, 167 aggregates, 0 inter-agg. ref.
//     time         1,624 ms → 143 ms (×11)
//     bbox         8,370×8,418 → 6,026×5,929 (area ÷2.0)
//     fill rate    6.2% → 12.3%
//     card pairs under 16 px: 28 → 0
//
//   the demo's bigShop(4000) — 350 entities, 108 aggregates + 8 singletons,
//   264 inter-aggregate references (the dataset behind the ~4.2 s of
//   `setView("graph")`)
//     time         4,138 ms → 64 ms (×65)
//     bbox         18,714×19,984 → 8,083×8,437 (area ÷5.5)
//     fill rate    2.8% → 15.1%
//     average length of an inter-agg. ref.: 6,104 px → 1,364 px (÷4.5)
//
// Why the fill rate doubles to quintuples, and it is not a tuning knob: in the
// removed pipeline, fcose scattered an aggregate's members, so the enclosing
// circle inflated, so `separateClusters` pushed apart LARGE nearly empty circles.
// Here the circle is minimal by construction — the cards are packed BEFORE the
// circle exists — so all the separation is useful corridor.
//
// This engine imports NEITHER cytoscape NOR elkjs: it depends only on the pure
// core (`hull.ts`, `measure.ts`) and on its two levels, `graph-pack.ts`
// (intra-aggregate packing) and `disc-simulation.ts` (disc separation), which are
// imported from here alone. See the header above for the exposure channel.
//
// WHAT THIS ENGINE DOES NOT SETTLE (the probe's caveats; those lifted since say
// so, and say by what):
//
//   - CAVEAT LIFTED. Intra-aggregate packing ignored the edges; it now exists in
//     TWO MODES, and the choice is made per cluster on reference DEPTH — see the
//     exposition of the criterion above `packCluster` (`graph-pack.ts`), which is
//     where that story is told in full.
//
//     In two lines: radial (root at the center, one ring per distance) encodes
//     depth as distance to the center, which only makes sense if there is depth
//     to encode; shelves, denser, take everything else. Measured on
//     `deepAggregate()` — 41 cards, 4 levels: average intra-aggregate reference
//     591.4 → 363.0 px, max 976.3 → 488.1 px, root from 40th to 1st by proximity
//     to the center (597.7 → 16.4 px). And on the repo's two real datasets, whose
//     aggregates are all flat, the fill rate does not move by a tenth — 12.3%
//     (core) and 15.1% (demo) — because they stay in shelves.
//   - CAVEAT LIFTED. "O(k²) over the aggregates […] only worth doing if that
//     cardinality becomes real": it became real. A real architecture audit —
//     6,251 entities, ~1,300 aggregates — took **55.4 s** to lay out, and the same
//     configuration without groups, where each entity is its own disc (6,251
//     discs, a regime the engine legitimately serves), **23.5 minutes**. Collision
//     therefore goes through a uniform SPATIAL GRID, rebuilt on every pass; the
//     complete exposition — cell sizing, window exhaustiveness, determinism, and
//     above all why the exit invariant stays PROVED with an index that goes stale
//     mid-pass — sits above `collisionPass` (`disc-simulation.ts`), which is where
//     that story is told in full.
//
//     Measured on that audit, full `layout()`, before → after:
//
//       aggregates (the regime the graph view exercises)
//         774 entities / 197 discs         283 ms →   120 ms   (×2.4)
//       1,147 entities / 238 discs         448 ms →   184 ms   (×2.4)
//       1,955 entities / 372 discs       1,537 ms →   512 ms   (×3.0)
//       6,251 entities / 1,300 discs    55,410 ms → 6,065 ms   (×9.1)
//
//       without groups (one disc per entity)
//         774 discs                     14,053 ms →   653 ms   (×22)
//       1,147 discs                     39,606 ms → 1,639 ms   (×24)
//       1,955 discs                    141,633 ms → 3,738 ms   (×38)
//       6,251 discs                  1,411,453 ms → 21,037 ms  (×67)
//
//     The "after" column above dates from the BARE grid. It has been dug deeper
//     since by a cell-by-cell pruning — the window stays sized on the GLOBAL max
//     radius, but each visited cell is filtered on the max radius it ACTUALLY
//     hosts, which stops a single giant disc from imposing its reach on everyone.
//     The two re-measured lines (median of 3 runs, same machine, bare grid → grid
//     + pruning):
//
//       6,251 entities / 1,300 discs     6,096 ms → 4,224 ms   (−31%)
//       6,251 discs without groups      21,416 ms → 21,626 ms  (+1%)
//
//     The second regime, with near-uniform radii, has no giant to route around:
//     all we ask of it is to lose nothing. The other six lines were not
//     re-measured. Detail and exhaustiveness proof above `collisionPass`.
//
//     A lead was also tried and DROPPED — following, from one hard pass to the
//     next, only the pairs one end of which moved. The "dirty" set never empties
//     on a dense pile (~1,291 discs out of 1,300 during 90% of the passes), so the
//     alternation cost more than it returned; the quantified case sits above
//     `hardSeparation`.
//
//     The springs PART of the caveat falls for a different reason: it had no
//     grounds. Barnes-Hut accelerates an ALL-PAIRS repulsion, and this engine has
//     none — it has only collision (now indexed) and a gravity toward the origin,
//     linear by construction. The cost of the springs follows the number of
//     AGGREGATED springs, that is, the deduplicated inter-aggregate references:
//     linear, and it was not the hot spot to begin with.
//
//     What REMAINS quadratic, and becomes the next ceiling: the number of hard
//     passes needed grows linearly with the discs, so that `MAX_HARD_PASSES`
//     (5000) saturates beyond ~1,700 discs and the separation invariant then stops
//     being one. Measurements and trade-off above `hardSeparation`.
//   - The final hard pass can undo a spring: the separation guarantee takes
//     precedence over edge length. At 264 references over 116 discs it does not
//     show; a very dense inter-aggregate graph could degrade — not probed.
//   - The aesthetic is regular, not organic (near-hexagonal tiling on
//     aggregates without edges). Accepted, but it is a product choice.
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./structure-layout.js"
import { enclosingCircle } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
// The algorithm's two levels, each in its own module and imported HERE and
// nowhere else — this file remains the engine's only entry point.
import { packCluster } from "./graph-pack.js"
import { layoutDiscs, type Disc } from "./disc-simulation.js"

// The graph view's contract — the envelope, the result, the engine's interface —
// is declared HERE since the removal of `layout-graph.ts`, where it lived for as
// long as two engines shared it. Only one is left, and a types module whose sole
// content would be these three interfaces would need its own justification. What
// a consumer imports does not move for all that: this file IS the
// `./graph-layout` entry point, and exposes them under these names.
//
// These types stay named "Graph…" and not "TwoLevel…": they describe the VIEW,
// not the algorithm. A second graph-view engine would reimplement them as they
// stand — which is exactly what just happened in the other direction.

/** An aggregate's envelope: a disc, in `positions`' coordinate system. */
export interface ClusterShape {
  aggregateId: string
  rootId: NodeId
  cx: number
  cy: number
  r: number
}

export interface GraphLayoutResult extends LayoutResult {
  clusters: ClusterShape[]
}

/**
 * The graph view's layout engine.
 *
 * `layout()` is asynchronous by contract, not by necessity: the current
 * implementation is entirely synchronous (see `createTwoLevelLayoutEngine`), but
 * the one it replaces waited on a cytoscape `layoutstop`, and the renderer
 * already `await`s this result. Making the signature synchronous would buy
 * nothing and would close the door on an implementation that yields — a Web
 * Worker, for instance.
 */
export interface GraphLayoutEngine {
  layout(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<GraphLayoutResult>
}

export interface TwoLevelLayoutOptions {
  /** Margin between the card corner farthest from the envelope's centre and the
   * envelope's edge. Same meaning and same value as in the removed engine: it is
   * the radius of the disc the renderer paints. */
  hullPadding?: number
  /** Margin between two cards of the same aggregate, INCLUDED in the packing
   * (hence acquired by construction, where the removed engine's
   * `separationMargin` was the goal of a capped relaxation). */
  cardGap?: number
  /** Guaranteed edge-to-edge gap between two aggregate discs. */
  clusterGap?: number
  /** Iterations of level 2's spring simulation. */
  simIterations?: number
  /**
   * Amplitude, in pixels, of the discs' virtual inflation DURING the simulation
   * — the deterministic noise that breaks the tiling's regularity. `0` disables
   * it. See the comment above `virtualRadii` (`disc-simulation.ts`) for the
   * mechanism, and `TWO_LEVEL_LAYOUT_DEFAULTS` for the choice of amplitude.
   *
   * This setting cannot degrade a guarantee: the final hard pass ignores the
   * inflation, and the painted shape is never inflated.
   */
  jitter?: number
}

/**
 * The default values, EXPORTED — and not merely out of politeness. The renderer
 * needs `hullPadding` to recompute an aggregate's envelope when a card is
 * dragged with the mouse: without this constant it would keep a copy, and the
 * day the value moves here, envelopes painted after a drag would no longer
 * coincide with those the engine computes — a silent 18 px discrepancy, visible
 * only after a drag.
 *
 * It reads it through the NAMESPACE of the graph view's dynamic `import()`, the
 * one in `ensureGraphEngine`, and not through a static import: the two bundle
 * purity tests require that this module be reachable only that way. It is free —
 * the constant only means anything in the graph view, hence exactly when this
 * module is already loaded.
 */
export const TWO_LEVEL_LAYOUT_DEFAULTS: Required<TwoLevelLayoutOptions> = {
  // Carried over from the removed engine without re-judging them: these are the
  // same shapes drawn and the same visual contract. The probe measured both
  // engines with these values on both sides, to compare at equal guarantees.
  //
  // `clusterGap: 160` is not a matter of taste: it comes from a full sweep (gap
  // 0 / 80 / 160 / 240 / 320 / 400, measuring envelope overlaps, nearest
  // neighbour gap, bbox and fill rate) run on the removed engine. The table used
  // to live in its `DEFAULTS`; it is reproduced in the root README's "Graph
  // view" section, and its code lives in the git history. What it establishes,
  // and what still holds: CORRECTNESS — zero overlapping envelope pairs — is
  // already acquired at 80 px, and anything above buys corridor width. 160 px is
  // 10× `cardGap` and one and a half card heights: the gap is visible without
  // zooming.
  //
  // It has NOT been re-swept on this engine, and the result would differ: the
  // sweep measured circles inflated by fcose's scattering, where the ones here
  // are minimal by construction. To be re-measured if the value becomes a
  // question again; it has not.
  hullPadding: 18,
  cardGap: 16,
  clusterGap: 160,
  // CALIBRATED, and "calibrated" means MEASURED — not necessarily changed. These
  // four level-2 constants (400 iterations, spring force 0.15, weight cap
  // `min(1, w/2)`, gravity 0.02) were the FIRST set tried, which is what this
  // comment used to say without ceremony. The sweep has been run; it CONFIRMS
  // all four, and that is a result, not the absence of one.
  //
  // Three fixtures, chosen because they exhaust level 2's regimes: **A**
  // `bigShop(3000)` — 167 discs, ZERO edges, so only gravity and collision act;
  // **B** the demo's dataset — 116 discs, average degree 4.6; **D**
  // `denseRefs()` — 80 discs, degree 12.0 everywhere, the fixture for the caveat
  // "a very dense inter-aggregate graph could degrade". Quality metric: the
  // average length of an INTER-aggregate reference, the one the springs serve.
  // The engine being deterministic, one run per configuration is enough.
  //
  //   SPRING FORCE (avg. inter-agg. ref.)        B       D      sd nn on D
  //     0.05                                   2084    1699       13.1
  //     0.10                                   1557    1618       13.1
  //     0.15  ← chosen                         1439  **1554**     11.8
  //     0.25                                   1418    1611        7.9
  //     0.40                                   1398    1694        4.1
  //
  // 0.15 is the EXACT MINIMUM on D. Beyond it the springs pull so hard that the
  // hard pass has to contradict them, and the references GET LONGER instead of
  // shorter — precisely the probe's caveat #5, observed. On B, 0.40 gains 3% of
  // length, for a neighbourhood standard deviation divided by 3.
  //
  //   WEIGHT CAP min(1, w/N)                     B       D      sd nn on D
  //     N=1 (no grading)                        1341    1570        4.7
  //     N=2  ← chosen                           1439  **1554**     11.8
  //     N=4                                     1753    1589       11.7
  //     N=8                                     2155    1756       12.1
  //
  //   GRAVITY                              A fill      B       D
  //     0.005                                8.9%    1445    1543
  //     0.01                                 9.5%    1407    1614
  //     0.02  ← chosen                    **10.3%**  1439    1554
  //     0.04                                10.3%    1497    1572
  //     0.08                                10.7%    1687    1685   (339 hard passes)
  //
  //   ITERATIONS                           A fill      B       D      sd nn on D   ms (A/B/D)
  //     100                                  9.5%    1609    1742        4.1        66/45/39
  //     200                                 10.1%    1487    1647        4.4        53/36/23
  //     400  ← chosen                       10.3%    1439  **1554**     11.8        88/58/32
  //     800                                 10.7%    1392    1582       12.8       170/98/59
  //    1600                                  9.9%    1392    1560       13.0      342/187/117
  //
  // WHAT THE SWEEP TAUGHT, and what was not anticipated: **the level-2 constants
  // and the `jitter` interact**. A strong spring force (0.25, 0.40) or ungraded
  // weights (N=1) RECOMPRESS the tiling and undo the noise — the standard
  // deviation of the nearest-neighbour gap falls from 11.8 to 4.1 px on D, which
  // is most of what `jitter: 32` had bought. Too low a `simIterations` does the
  // same, for a different reason: at 100 or 200 the simulation has not converged
  // enough for the variance to express itself (4.1 and 4.4). The chosen values
  // are therefore also the ones that LET the jitter work, which was not a
  // criterion at the time it was tuned.
  //
  // THE ONE REAL TRADE-OFF, laid out rather than settled quietly: the crossed
  // grid gives `spring 0.15 / gravity 0.01 / N=1` better on B (reference 1282
  // against 1439, −11%). It is set aside because it costs D's standard deviation
  // (11.8 → 6.3) and 0.8 points of fill rate on A. B is one nominal case out of
  // three; sacrificing A's tiling and D's density for 11% on it alone is not a
  // good trade, and the measurement does not say so — that is a judgement, and
  // it is here to be contested.
  //
  // What these constants DO NOT BUY, at any value: correctness. The exit
  // guarantees (card non-overlap, disc separation) are carried by the packing
  // and by the final hard pass. `min nn = 160.00 px` in all 27 configurations
  // measured, without exception.
  simIterations: 400,
  // AN EYE SETTING, like `clusterGap`, and owned as such — but not chosen
  // without numbers. What the jitter fixes is a visual artefact: on discs of the
  // SAME radius, gravity + collision converge towards hexagonal packing, the
  // density optimum for equal circles. `bigShop(3000)` — 167 identical
  // aggregates, no edge between them — came out as a hexagonal tiling so regular
  // that the alignments ran across the whole canvas.
  //
  // The metric that makes this objective is the STANDARD DEVIATION of the
  // edge-to-edge nearest-neighbour gap between discs. At zero jitter it is
  // **0.00 px**: every neighbour exactly at `clusterGap`, which IS the
  // definition of a regular lattice. Full sweep, `bigShop(3000)`:
  //
  //   jitter | sd nn      | mean nn    | min nn | fill rate   |   bbox
  //        0 |    0.00 px |   160.0 px | 160.00 |    12.3%    | 6026×5929
  //       16 |    6.36 px |   166.1 px | 160.00 |    11.2%    | 6141×6397
  //       32 |   12.02 px |   177.9 px | 160.00 |    10.3%    | 6394×6692
  //       48 |   17.65 px |   189.2 px | 160.00 |     9.8%    | 6617×6806
  //       64 |   22.72 px |   201.5 px | 160.00 |     8.9%    | 6917×7142
  //
  // The column that matters most is `min nn`: **160.00 at every amplitude**. The
  // guarantee does not move by a hundredth, because the final hard pass ignores
  // the inflation. The jitter buys nothing but variance.
  //
  // 32 CHOSEN, on the renderings (the four SVGs are in section B of the probe
  // doc). At 16 the diagonal alignments survive in patches: the eye still reads
  // a lattice. At 32 no long alignment is left, while the field stays uniformly
  // dense — no hole, no clump. At 48 the variance starts to read as such, with
  // corridors distinctly wider than others, without the rendering being any more
  // "alive" than at 32; it costs 0.5 points of fill rate more for that.
  //
  // What 32 costs, precisely: on `bigShop(3000)`, fill rate 12.3 → 10.3%
  // (−2.0 points) and bbox 6026×5929 → 6394×6692, because the AVERAGE gap rises
  // from 160.0 to 177.9 px — inflating the discs during the simulation makes
  // them converge a little further apart. On the demo's dataset the cost is
  // within the noise and not monotone (15.1% at 0, 15.5% at 16, 13.7% at 32,
  // 14.8% at 48): its inter-aggregate springs reshuffle the layout at every
  // amplitude, so an amplitude-by-amplitude comparison has no fine meaning
  // there. It is the EDGELESS fixture that isolates the effect, and it is on
  // that one that the choice is made.
  jitter: 32,
}

/**
 * THE PURE CORE'S INPUT: everything the engine consumes, and nothing else.
 *
 * This type exists for a single, measured reason: on a real audit — 6,251
 * entities, ~1,300 aggregates — `layout()` spends ~4.4 s in an entirely
 * synchronous computation, which freezes the browser's main thread for the whole
 * view switch. The only remedy that keeps the total time is to move the
 * computation into a Web Worker; and a `Graph` does not cross a `postMessage` —
 * it carries `Map`s of nodes, indexed edges, and weighs several orders of
 * magnitude more than what the engine reads from it.
 *
 * Hence the split: `extractGraphLayoutInput` is the ONLY part that touches the
 * `Graph`, it runs on the main thread, and it returns this FLAT object — which
 * structured cloning carries as is. `layoutFromInput` is all the rest: pure, no
 * DOM, no graph, hence runnable on either side of the boundary. The invariant
 * that holds the whole together is written in
 * `test/graph-layout-identity.test.ts`: the split changes NO bit of the output,
 * it is the same code reordered.
 *
 * WHAT IS NOT IN IT, and why: the `NodeMetrics`. They only serve `measureNode`,
 * which the extraction has already called — each card's size is in `entities`.
 * Carrying them across as well would mean carrying the RECIPE for a result we
 * are already carrying.
 */
export interface GraphLayoutInput {
  /** The entities to place, sorted by id — the sort is a CONDITION of the
   * engine's determinism, not a reading convenience. `w`/`h` are the card's
   * size, already measured. */
  entities: { id: NodeId; w: number; h: number }[]
  /**
   * The references linking two placed entities, IN THE ORDER of
   * `graph.refEdges` and without deduplication: level 2 makes each spring's
   * weight out of the multiplicity, and level 1 deduplicates what it needs on
   * its own. The endpoints are `fromEntity` and `to` — it is the carrying entity
   * that is placed, never the value object that writes the field.
   */
  refs: { from: NodeId; to: NodeId }[]
  /**
   * The aggregates that claim at least one placed entity, with those entities as
   * members. This is the grouped form of the partition `AggregateIndex.byNode`
   * carries — an entity absent from all these lists is a singleton, exactly as
   * with an empty `byNode` on the caller's side.
   */
  aggregates: { id: string; rootId: NodeId; memberIds: NodeId[] }[]
  /** The RESOLVED settings: the extraction applies the defaults, and the pure
   * core never re-reads `TWO_LEVEL_LAYOUT_DEFAULTS`. */
  options: Required<TwoLevelLayoutOptions>
}

/**
 * A level-2 cluster: an aggregate, or a lone entity promoted to a disc.
 *
 * It EXTENDS `Disc`, which is the whole joint between the two levels: the
 * simulation sees only `id`, `r`, `x`, `y` and writes `x`/`y` in place, never
 * knowing anything about the members or the rects that same object carries.
 */
interface LocalCluster extends Disc {
  /** `null` for a singleton outside any aggregate — it will emit no envelope. */
  rootId: NodeId | null
  isAggregate: boolean
  /** Packing order: root first, then sorted ids. */
  memberIds: NodeId[]
  /** LOCAL rects, recentred so that the enclosing circle's centre sits at the
   * origin — that is what allows the cluster to be treated as a disc centred at
   * (x, y) at level 2. */
  local: Map<NodeId, Rect>
}

/**
 * THE EXTRACTION: the engine's only function that reads the `Graph`, and
 * everything it reads from it.
 *
 * Three reads, and not one more — that is what makes the worker boundary
 * checkable rather than taken on trust:
 *  1. the ids of the VISIBLE nodes of entity kind (structural nodes — root,
 *     arrays, objects — do not exist in this view);
 *  2. `measureNode` on each of them, for its card's size;
 *  3. `graph.refEdges`, filtered down to resolved references whose BOTH ends are
 *     placed entities.
 *
 * The rest comes from the `AggregateIndex`. `byNode[0]` is safe because
 * membership is a PARTITION — each array holds at most one id (see
 * `AggregateIndex`), and the index that produces it always fills `aggregates` at
 * the same time, which is what licenses the non-nullable `rootId` below.
 *
 * Exported because a caller wanting to run the core ELSEWHERE — a Web Worker,
 * typically — must be able to do this half on the thread that owns the graph.
 * `createTwoLevelLayoutEngine` is now nothing but the composition of the two.
 */
export function extractGraphLayoutInput(
  graph: Graph,
  aggregates: AggregateIndex,
  visible: Set<NodeId>,
  metrics: NodeMetrics = DEFAULT_METRICS,
  options: TwoLevelLayoutOptions = {},
): GraphLayoutInput {
  // The sort is a CONDITION of determinism, not a reading convenience:
  // `visible` is a `Set` built by the caller, whose iteration order is nobody's
  // contract.
  const entityIds: NodeId[] = []
  for (const id of visible) {
    const node = graph.nodes.get(id)
    if (node && node.kind === "entity") entityIds.push(id)
  }
  entityIds.sort()

  const entities: GraphLayoutInput["entities"] = []
  const entitySet = new Set<NodeId>()
  for (const id of entityIds) {
    const size = measureNode(graph.nodes.get(id)!, metrics)
    entities.push({ id, w: size.width, h: size.height })
    entitySet.add(id)
  }

  // The aggregates, grouped from `byNode`: the same partition, stated the other
  // way round. Only those claiming a PLACED entity are kept — an aggregate none
  // of whose members is visible has neither disc nor envelope.
  const memberIdsByAggregate = new Map<string, NodeId[]>()
  for (const id of entityIds) {
    const aggId = aggregates.byNode.get(id)?.[0]
    if (aggId === undefined) continue
    const list = memberIdsByAggregate.get(aggId)
    if (list) list.push(id)
    else memberIdsByAggregate.set(aggId, [id])
  }
  const inputAggregates: GraphLayoutInput["aggregates"] = []
  for (const [id, memberIds] of memberIdsByAggregate) {
    // An id from `byNode` missing from `aggregates` cannot happen — both tables
    // come out of the same `buildAggregates` — and skipping it rather than
    // carrying a nullable `rootId` in the public contract is the deliberate
    // choice: the only possible output for such a cluster would be a group with
    // no envelope to paint, indistinguishable from singletons.
    const rootId = aggregates.aggregates.get(id)?.rootId
    if (rootId === undefined) continue
    inputAggregates.push({ id, rootId, memberIds })
  }

  // One pair PER reference, duplicates included and in the graph's order:
  // multiplicity makes the weight of level 2's springs, and level 1 deduplicates
  // what it needs on its own. `fromEntity` and not `from`: it is the carrying
  // entity that is placed, a value object has no card.
  const refs: GraphLayoutInput["refs"] = []
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    if (!entitySet.has(edge.fromEntity) || !entitySet.has(edge.to)) continue
    refs.push({ from: edge.fromEntity, to: edge.to })
  }

  return {
    entities,
    refs,
    aggregates: inputAggregates,
    options: { ...TWO_LEVEL_LAYOUT_DEFAULTS, ...options },
  }
}

/**
 * THE PURE CORE: the two levels, with no graph, no DOM, no state.
 *
 * This is exactly the old `run` minus its reads of the `Graph`, which moved into
 * `extractGraphLayoutInput`. The move is textual and the identity of the output
 * is asserted down to the bit (`test/graph-layout-identity.test.ts`).
 *
 * "Pure" has an operational meaning here: this function can run inside a Web
 * Worker, where there is no `document`, no `window`, and no main-thread `Graph`.
 * Adding the slightest environment read to it would break the renderer's worker
 * (`packages/renderer/src/graph-layout-worker.ts`) without breaking a single
 * test in this folder — hence this warning rather than an illusory guard.
 */
export function layoutFromInput(input: GraphLayoutInput): GraphLayoutResult {
  const o = input.options

  const sizes = new Map<NodeId, { width: number; height: number }>()
  for (const entity of input.entities) sizes.set(entity.id, { width: entity.w, height: entity.h })

  // Partition into clusters: the aggregate if there is one, a singleton
  // otherwise.
  const clusterOf = new Map<NodeId, string>()
  const rootOf = new Map<string, NodeId>()
  for (const agg of input.aggregates) {
    rootOf.set(agg.id, agg.rootId)
    for (const memberId of agg.memberIds) clusterOf.set(memberId, agg.id)
  }
  const members = new Map<string, NodeId[]>()
  for (const entity of input.entities) {
    let cid = clusterOf.get(entity.id)
    if (cid === undefined) {
      cid = `single:${entity.id}`
      clusterOf.set(entity.id, cid)
    }
    const list = members.get(cid)
    if (list) list.push(entity.id)
    else members.set(cid, [entity.id])
  }

  // INTRA-cluster reverse adjacency: target → the sources that reference it,
  // both ends in the same cluster. This is what gives radial placement its
  // reference distance; level 2 ignores those edges and uses the INTER-cluster
  // ones (`refPairs`, below), which are exactly the others.
  //
  // The direction is that of `buildAggregates` — we walk back from target to
  // source — otherwise the ring distance would not coincide with the membership
  // distance that formed the cluster.
  const childrenOf = new Map<NodeId, NodeId[]>()
  for (const ref of input.refs) {
    if (clusterOf.get(ref.from) !== clusterOf.get(ref.to)) continue
    const list = childrenOf.get(ref.to)
    if (list) list.push(ref.from)
    else childrenOf.set(ref.to, [ref.from])
  }
  // Sorting the adjacency lists: the order of the graph's references must not
  // show through in the output. Deduplication along the way — two fields of the
  // same card may reference the same target, which would make it count twice in
  // a ring.
  for (const [key, list] of childrenOf) {
    list.sort()
    childrenOf.set(
      key,
      list.filter((id, i) => i === 0 || id !== list[i - 1]),
    )
  }

  // LEVEL 1: local packing of each cluster, root at the centre.
  const clusters: LocalCluster[] = []
  for (const cid of [...members.keys()].sort()) {
    const rootId = rootOf.get(cid)
    const ids = members.get(cid)!
    ids.sort()
    if (rootId !== undefined) {
      const i = ids.indexOf(rootId)
      if (i > 0) {
        ids.splice(i, 1)
        ids.unshift(rootId)
      }
    }
    const local = packCluster(ids, sizes, o.cardGap, childrenOf)
    const circle = enclosingCircle([...local.values()], o.hullPadding)
    for (const rect of local.values()) {
      rect.x -= circle.cx
      rect.y -= circle.cy
    }
    clusters.push({
      id: cid,
      rootId: rootId ?? null,
      isAggregate: rootId !== undefined,
      memberIds: ids,
      local,
      r: circle.r,
      x: 0,
      y: 0,
    })
  }

  // The cluster pairs linked by a reference, in the order of the graph's
  // references: one pair PER reference, the duplicates making the spring's
  // weight and the intra-cluster pairs being discarded by `aggregateSprings`.
  // This is all level 2 learns of the graph.
  const refPairs: [string, string][] = []
  for (const ref of input.refs) {
    refPairs.push([clusterOf.get(ref.from)!, clusterOf.get(ref.to)!])
  }

  // LEVEL 2: seeding, springs, gravity, collision, then the hard pass that
  // carries the exit invariant. It writes `x`/`y` in place on the clusters;
  // their content — local rects and radius — has been frozen since level 1.
  layoutDiscs(clusters, refPairs, o)

  // Carrying the local positions into the global frame, then normalizing: the
  // bbox's top-left corner at the origin, as in the removed engine.
  const positions = new Map<NodeId, Rect>()
  for (const c of clusters) {
    for (const id of c.memberIds) {
      const rect = c.local.get(id)!
      positions.set(id, { x: rect.x + c.x, y: rect.y + c.y, width: rect.width, height: rect.height })
    }
  }
  let minX = Infinity
  let minY = Infinity
  for (const rect of positions.values()) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
  }
  if (Number.isFinite(minX)) {
    for (const rect of positions.values()) {
      rect.x -= minX
      rect.y -= minY
    }
  }

  // Envelopes: only REAL aggregates emit one. A singleton was indeed treated as
  // a disc at level 2 — that is what keeps it from landing inside a neighbour's
  // envelope — but it has no envelope to paint.
  //
  // The centre is translated by the same amount as the positions: it is the SAME
  // disc, at the same padding, as the one the simulation pushed apart. No
  // recomputation after the fact, hence no possible drift between the separated
  // shape and the drawn one.
  const shapes: ClusterShape[] = []
  for (const c of clusters) {
    if (!c.isAggregate) continue
    shapes.push({ aggregateId: c.id, rootId: c.rootId!, cx: c.x - minX, cy: c.y - minY, r: c.r })
  }

  return { positions, clusters: shapes }
}

/**
 * The two-level layout engine, and the only one since the removal of
 * `createGraphLayoutEngine`. It keeps the `GraphLayoutEngine` interface the two
 * shared for as long as the old one existed, which made the switch transparent
 * at the call site.
 *
 * `layout()` is `async` out of interface conformance only: this computation is
 * entirely synchronous and never yields (~64–143 ms on the measured datasets,
 * against 1.6–4.2 s for the old engine, which did wait on a cytoscape
 * `layoutstop`; ~4.4 s on the real 6,251-entity audit, the measurement that
 * motivated the split above).
 *
 * This engine remains the IN-PROCESS path, and it does not become an
 * implementation detail of the worker: it is what the renderer runs when no
 * worker URL is provided (vitest, headless, a host without workers) and it is
 * what it falls back to PERMANENTLY at the worker's first failure. Its signature
 * therefore does not move an inch.
 */
export function createTwoLevelLayoutEngine(opts: TwoLevelLayoutOptions = {}): GraphLayoutEngine {
  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return layoutFromInput(extractGraphLayoutInput(graph, aggregates, visible, metrics, opts))
    },
  }
}
