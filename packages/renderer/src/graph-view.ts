import {
  buildAggregates,
  validateConfig,
  type Aggregate,
  type AggregateIndex,
  type DataGraphConfig,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
// `import type` ONLY: this entry point carries the graph view and
// must only enter the bundle of whoever actually switches to it. A
// type import produces no runtime code; the only runtime path to the
// engine is `ensureModule`'s dynamic `import()`, further down in THIS
// file. `test/bundle-purity.test.ts` (renderer side) guards these two
// lines: the core's own test only covers the core's `dist/`, not this
// file.
//
// What these two lines are worth has changed scale since the old engine was removed:
// 3.58 kB gzip instead of 180.28. They stay because they hold the SHAPE — the graph view
// loads on demand by construction — and no longer because they hold a weight. The full
// reasoning is in the two purity tests.
import type {
  ClusterShape,
  GraphLayoutEngine,
  GraphLayoutInput,
  GraphLayoutResult,
  TwoLevelLayoutOptions,
} from "@defsquare/data-graph-core/graph-layout";
import { clusterDimmed } from "./focus.js";

/**
 * THE LAYOUT WORKER'S PROTOCOL, declared here because this is where it is spoken: the
 * worker (`graph-layout-worker.ts`) imports only its types, through an `import type` the
 * bundler erases. No code therefore crosses in that direction — the worker pulls in
 * nothing but the pure layout core.
 *
 * `gen` is the REQUEST NUMBER, and the contract is that a response is only valid for the
 * request carrying the same one. A `setData`, a `setView` or a `destroy` can land during
 * the seconds a computation lasts; without that number, a late response would be
 * indistinguishable from the one being awaited and would publish positions computed on a
 * graph that no longer exists.
 */
export interface GraphLayoutWorkerRequest {
  gen: number;
  input: GraphLayoutInput;
}

/**
 * The response, in a shape chosen for STRUCTURED CLONING and not for reading
 * convenience.
 *
 * `positions` is an array of `[id, x, y, w, h]` tuples and not a `Map` of `Rect`: at
 * 6,251 cards, that is a flat array of numbers instead of 6,251 small objects to
 * allocate and clone on both sides of the boundary. The controller rehydrates them into
 * mutable `Rect`s (see `hydrateLayout`).
 *
 * Failure travels as a MESSAGE and not as an `Error`: an exception does not cross
 * `postMessage`, and what matters on the way back is knowing that a fallback is due —
 * the detail goes into the fallback's `console.warn`.
 */
export type GraphLayoutWorkerResponse =
  | {
      gen: number;
      ok: true;
      positions: [NodeId, number, number, number, number][];
      clusters: ClusterShape[];
    }
  | { gen: number; ok: false; message: string };

/** What the controller does with a worker: post it a request, and terminate
 * it. The rest — the construction, the URL, `new Worker` — belongs to the
 * orchestrator (`create.ts`), the only one that knows the DOM. */
export interface GraphLayoutWorkerHandle {
  post(request: GraphLayoutWorkerRequest): void;
  terminate(): void;
}

/**
 * The worker factory, injected by the caller.
 *
 * It is a FUNCTION and not a URL, so that this module stays what it has always been: a
 * data machine, with no `new Worker` and not the slightest environment assumption.
 * `create.ts` builds one from `DataGraphOptions.graphLayoutWorkerUrl`; the tests
 * inject one that returns a fake worker, which makes the protocol testable without a
 * browser.
 *
 * It is allowed to THROW (unplayable URL, `Worker` missing): the call is guarded, and
 * a construction failure triggers the same definitive fallback as a computation
 * failure.
 */
export type GraphLayoutWorkerSpawn = (
  onMessage: (data: unknown) => void,
  onError: (error: unknown) => void,
) => GraphLayoutWorkerHandle;

/**
 * The namespace of the `./graph-layout` entry point, as `ensureModule`'s dynamic
 * `import()` returns it.
 *
 * `typeof import(…)` is a TYPE position: it emits no code, so it does not reopen the
 * door the two purity tests close. It needs a name because the controller keeps that
 * namespace in a variable — the worker path takes `extractGraphLayoutInput` from it, the
 * in-process path `createTwoLevelLayoutEngine`, and both take
 * `TWO_LEVEL_LAYOUT_DEFAULTS`.
 */
type GraphLayoutModule = typeof import("@defsquare/data-graph-core/graph-layout");

/**
 * The link between TWO AGGREGATES, and the number of references it sums up.
 *
 * UNDIRECTED, `a` always being the smaller of the two ids: at the scale these edges are
 * painted — the semantic regime, below the LOD 2 threshold — an arrowhead would measure
 * a fraction of a pixel. Keeping the direction would therefore double the number of
 * strokes for a distinction nobody can see. What the zoomed-out view shows is a COUPLING
 * between blocks; the directed dependency reads by zooming in, where the cards and their
 * arrows come back.
 */
export interface AggregateEdge {
  a: string;
  b: string;
  weight: number;
}

/**
 * Folds the graph's references onto the aggregates: one edge per PAIR of linked
 * aggregates, weighted by the number of references it sums up.
 *
 * Pure, and that is what makes it testable without a layout or an instance. Called ONCE
 * per graph-view computation (`compute`), never per frame: its result depends only on
 * the graph and the index, neither of which moves between two publications. Only the
 * POSITIONS of the discs move — a drag mutates them in place — and they are resolved
 * only at painting time.
 *
 * Three exclusions, in this order:
 *  - a BROKEN reference, or one without a target, links nothing;
 *  - an entity outside an aggregate has no disc, hence no end to link — it
 *    keeps its card in the semantic regime, and its reference is not shown;
 *  - an INTRA-aggregate reference is already told by the disc itself: tracing
 *    it would amount to laying a loop in place.
 *
 * `fromEntity` and not `from`: a reference carried by a value object is the reference of
 * the entity that contains it — that is the level at which aggregate membership is
 * defined, and `byNode` only indexes entities.
 *
 * `byNode` is read at `[0]`, as the core's only other consumer already does:
 * membership is a PARTITION (see `AggregateIndex.byNode`), so each array holds exactly
 * one id.
 *
 * The order of the result is that of FIRST ENCOUNTER in `refEdges`, hence entirely
 * determined by the graph: two calls on the same graph return the same array in the
 * same order, which the stability of the tracing from one publication to the next
 * depends on.
 */
export function aggregateRefEdges(
  refEdges: readonly RefEdge[],
  byNode: ReadonlyMap<NodeId, string[]>,
): AggregateEdge[] {
  const out: AggregateEdge[] = [];
  const index = new Map<string, AggregateEdge>();
  for (const edge of refEdges) {
    if (edge.to === null || edge.dangling) continue;
    const from = byNode.get(edge.fromEntity)?.[0];
    const to = byNode.get(edge.to)?.[0];
    if (from === undefined || to === undefined) continue;
    if (from === to) continue;
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    // The separator is a control character: an aggregate id is
    // `${type}#${entityId}` and an entity id may contain any printable
    // character — a "#" or a "|" would make two distinct pairs
    // confusable.
    const key = `${a}\u0000${b}`;
    const known = index.get(key);
    if (known) {
      known.weight++;
      continue;
    }
    const created: AggregateEdge = { a, b, weight: 1 };
    index.set(key, created);
    out.push(created);
  }
  return out;
}

/**
 * The share of labels a prefix must cover to be stripped.
 *
 * A CLEAR majority and not unanimity, and it is the real data set that imposes it:
 * its 1,300 aggregates count 1,277 packages under `com.bnpparibas.bddf.fipro`, but
 * also 18 MODULES (`bddf-fipro-domain`, `arch-audit`…) and five foreign packages
 * (`com.axway.…`, an isolated `x`). Requiring that ALL of them carry it amounts to
 * stripping nothing as soon as a data set mixes two families of names — that is,
 * in the real case, where the configuration almost always groups by several types.
 * The threshold says "this prefix is noise" rather than "this prefix is
 * universal".
 *
 * The labels that do NOT carry it keep their whole name: they are the data set's
 * exceptions, and showing them in full is precisely what flags them.
 */
const DOMINANT_PREFIX_SHARE = 0.8;

/**
 * The longest prefix BY DOTTED SEGMENTS that the great majority of `labels`
 * shares, terminated by its dot, or the empty string when there is nothing to
 * strip.
 *
 * The problem is the real data set's: an application audit has only one package tree,
 * so its ~1,300 aggregates are almost all named
 * `com.bnpparibas.bddf.fipro.something`. Painted as is, each disc spends half its
 * character budget repeating what its 1,299 neighbours say too — the screen displays
 * the same thing a thousand times and never what distinguishes. Stripping the prefix
 * hands that budget back to the TAIL of the path, which is the only discriminating
 * part.
 *
 * By SEGMENTS and not by characters: a prefix cut in the middle of a segment
 * (`com.example.cre`) would leave labels that are no longer paths and no longer reattach
 * mentally to their root.
 *
 * Three cases return the empty string, and all of them say "show the whole
 * labels":
 *  - fewer than two aggregates — there is then no repetition to strip, and the
 *    single label present would lose its full name for nothing;
 *  - no prefix of at least TWO segments widespread enough — stripping `com.`
 *    would give back almost nothing and would cost the root of the path;
 *  - names without hierarchy (`k1`, `p1`), where there is no prefix at all.
 *
 * A prefix is only counted on the labels that STILL have a segment after it: that is
 * what guarantees no disc becomes anonymous — a set of `a.b.c` / `a.b.c.d` retains
 * `a.b.` and not `a.b.c.`. The longest wins, ties go to the most widespread, then to
 * alphabetical order: the result does not depend on the order in which the layout
 * returned its aggregates.
 */
export function dominantSegmentPrefix(labels: readonly string[]): string {
  if (labels.length < 2) return "";
  const needed = Math.ceil(labels.length * DOMINANT_PREFIX_SHARE);
  const counts = new Map<string, number>();
  for (const label of labels) {
    const segments = label.split(".");
    // `n < segments.length` and not `<=`: a prefix that covered the whole label would leave
    // nothing to paint on the disc.
    for (let n = 2; n < segments.length; n++) {
      const prefix = segments.slice(0, n).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  let best = "";
  let bestSegments = 0;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count < needed) continue;
    const segments = prefix.split(".").length;
    const better =
      segments > bestSegments ||
      (segments === bestSegments && (count > bestCount || (count === bestCount && prefix < best)));
    if (!better) continue;
    best = prefix;
    bestSegments = segments;
    bestCount = count;
  }
  return best === "" ? "" : `${best}.`;
}

/** The complete state of the graph view, computed in one block then published
 * in one block: the index, the layout and the aggregated edges must always
 * describe the same graph. */
export interface GraphViewState {
  index: AggregateIndex;
  layout: GraphLayoutResult;
  /** The references folded onto the aggregates. Computed HERE and not at draw
   * time: it is a sweep of the whole graph's references — 28,685 on the real
   * data set — which has no business inside a frame loop. */
  semanticEdges: AggregateEdge[];
  /**
   * The READY-TO-DISPLAY label of each disc, indexed by aggregate id.
   *
   * Here and not in `semanticNodesFor` for two reasons. The first has to do with the
   * NATURE of the computation: the common prefix stripped (see
   * `commonSegmentPrefix`) is a property of the SET of labels, not of each one —
   * resolving it in a pass that produces one disc at a time would mix two scopes.
   * The second is the rhythm: `semanticNodesFor` is called back on every frame of a
   * hover or of an aggregate drag (see `redrawClusters` at the caller's), and
   * redoing 1,300 string splits per frame for identical text would be paying for the
   * semantic regime permanently.
   *
   * The FULL id stays the aggregate's (`SemanticNodePaint.id`): the detail panel, the
   * selection and the search keep working on it — only what is PAINTED on the disc is
   * shortened.
   */
  semanticLabels: Map<string, string>;
}

/**
 * An envelope ready to paint: the BARE data `drawClusters` consumes.
 *
 * No aggregate, no index, no graph — color, dimming and hover are already resolved here.
 * That is what keeps `draw.ts` testable without an instance: the drawing function no
 * longer knows anything about what produced these values.
 */
export interface ClusterPaint {
  circle: { cx: number; cy: number; r: number };
  color: string;
  hover: number;
  dim: boolean;
}

/**
 * An aggregate ready to paint AS A NODE: the same envelope, plus what it takes to label
 * it.
 *
 * The semantic regime does not change the GEOMETRY of the aggregates — it is the same
 * `ClusterShape`, at the same place and the same radius, computed once by the layout. It
 * changes what gets painted on it: instead of a translucent region behind cards, a disc
 * that IS the object, with the name of its root and the count of its members. Hence the
 * extension rather than a parallel type: both regimes read the same data, the second
 * simply asks for more.
 */
export interface SemanticNodePaint extends ClusterPaint {
  /** The id of the AGGREGATE — the one for the click, the hover and the
   * selection. It is through it that the caller finds a grabbed disc's label. */
  id: string;
  /** The entity id of the root — the package name, not the JSON pointer, and
   * without the "#" the card puts in its header: this disc has no type pill
   * beside it to justify the prefix. */
  label: string;
  /** Number of members, root included. */
  count: number;
}

/**
 * An aggregated edge RESOLVED into geometry: the segment already clipped to the edges of
 * both discs, and the weight it carries.
 *
 * The ends are computed here, and not at draw time, because the clipping needs the RADII
 * — which only the controller knows. What reaches `draw.ts` is then four numbers and a
 * weight: bare data, without aggregate or shape.
 *
 * Recomputed on every repaint and not memoized: a card or aggregate drag mutates the
 * `ClusterShape`s in place, and a kept segment would describe the picture from before
 * the gesture.
 */
export interface SemanticEdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /** True when neither one end nor the other touches the selected aggregate.
   * Same role as an envelope's `dim`, and same default value: false when
   * nothing is selected, so the tracing at rest is the one from before
   * dimming. */
  dim: boolean;
}

/** What the caller brings to `clustersFor`: the current graph, the palette, and
 * the two pieces of INTERFACE STATE the controller does not own — the selection
 * and the hover. */
export interface ClustersForArgs {
  graph: Graph;
  /** The accent color of a card's type, as for the cards themselves. Supplied
   * by the caller: it depends on the theme, not on the view. */
  accentFor(node: GraphNode): string;
  /** The color of an envelope whose root is missing from the graph. */
  fallbackColor: string;
  selectedAggregateId: string | null;
  /** The ids to keep full, or `null` if there is nothing to dim. */
  keep: Set<NodeId> | null;
  /** The current hover intensity of an envelope, from 0 to 1. */
  hoverOf(aggregateId: string): number;
}

export interface GraphViewHooks {
  /**
   * The settings passed to `createTwoLevelLayoutEngine` at the FIRST load of the engine. A
   * plain value and not an accessor: the public contract
   * (`DataGraphOptions.graphLayoutOptions`) already says these values are read on the
   * first switch to the graph view and that changing them requires recreating the
   * instance.
   */
  layoutOptions: TwoLevelLayoutOptions | undefined;
  /**
   * The CURRENT card metrics, re-read at every layout and not captured at
   * construction. It is a real constraint: the controller is built with the
   * instance, whereas the metrics are only measured after `fontsReady` in `ready`
   * — capturing them would freeze the default values for the whole session, and
   * the graph view would lay out cards of a different size from the ones being
   * painted.
   */
  getMetrics(): NodeMetrics;
  /**
   * What it takes to open the layout Web Worker, or `undefined` to stay
   * in-process.
   *
   * `undefined` is the DEFAULT and not a degraded mode: it is what vitest sees, what a
   * host without workers sees, and what any consumer that did not supply
   * `graphLayoutWorkerUrl` sees. The behaviour there is exactly the one from before the
   * worker — same engine, same output, same thread.
   */
  spawnLayoutWorker?: GraphLayoutWorkerSpawn | undefined;
}

export interface GraphViewController {
  /**
   * Computes the graph view's state for `target` **without publishing
   * anything**: the caller keeps its generation guard between `compute` and
   * `publish`, which is exactly the discipline in force. Without that
   * separation, a computation started before a `setData` and finished after
   * it would overwrite the new graph's layout with positions computed on the
   * old one — or would even call `layout()` on a mismatched (graph, index)
   * pair.
   *
   * `reuse` keeps the index in place, which depends only on the (graph, config) couple and
   * therefore does not have to be recomputed from one view switch to the next; a change of
   * data passes `false`, the index being indexed by node id.
   */
  compute(target: Graph, config: DataGraphConfig, reuse: boolean): Promise<GraphViewState>;
  /**
   * `compute` with its fallback: a failure returns `null` instead of propagating.
   * The three callers share the same rule — the graph view's engine is loaded
   * dynamically, so an import that fails must never reject the enclosing
   * operation — but what they DO with the `null` differs (fall back to the
   * structure view, or give up on the switch) and therefore stays at the call
   * site, like the generation guards: the controller returns `null`, it does not
   * decide.
   *
   * `context` is only there for debugging: it keeps each site its original warning
   * message.
   */
  tryCompute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
    context: string,
  ): Promise<GraphViewState | null>;
  /** Publishes in a single gesture the state computed by `compute`. */
  publish(state: GraphViewState): void;
  /** Index and layout fall TOGETHER: they are indexed by node id and do not
   * survive a change of data. Invalidating them separately would leave a
   * mismatched couple for the span of one statement. */
  invalidate(): void;
  /**
   * Terminates the layout worker, if there is one, and fails the computations still in
   * flight.
   *
   * Distinct from `invalidate()`, which throws away the PUBLISHED state and leaves the
   * controller usable: this one is definitive, and it is what `destroy()` on the instance
   * side calls. Without it, a worker would outlive the instance that opened it and would
   * keep grinding through 4 s of layout for nobody.
   *
   * The in-flight requests are REJECTED rather than left hanging: a `setView` that
   * was waiting must terminate, not freeze its caller (and the button it put on
   * hold). The rejection does NOT trigger the in-process fallback — replaying 4 s of
   * computation for a destroyed instance would be exactly the freeze we have just
   * removed.
   */
  destroy(): void;

  /** The published positions, `undefined` as long as nothing has been. */
  positions(): Map<NodeId, Rect> | undefined;
  /** All the entities of `target`: that is exactly what the graph view shows,
   * which hides nothing. Depends on no published state — a caller can query it
   * even before the first computation. */
  entityIds(target: Graph): Set<NodeId>;
  /** The published envelopes, or an empty array. The array is the engine's own,
   * RETURNED AS IS and not copied: it is by mutating these shapes in place that
   * a card or aggregate drag updates the discs. */
  clusters(): ClusterShape[];
  /**
   * The aggregate for `aggregateId`, resolved against the CURRENT index, or
   * `undefined`.
   *
   * The resolution is redone on every read rather than kept at the caller's: a `setData`
   * or a graph-view failure can replace the index under a selection that designated it,
   * and an aggregate that no longer exists must read as "no selection" — which is what
   * `undefined` does at every caller — rather than letting the dimming run on a ghost.
   */
  aggregateOf(aggregateId: string): Aggregate | undefined;
  /**
   * The published envelope whose aggregate contains `id`, together with that aggregate's
   * members — what it takes to recompute the disc when one of its cards moves.
   *
   * `undefined` for a card outside any aggregate, or as long as nothing is published.
   */
  memberIdsContaining(id: NodeId): { cluster: ClusterShape; memberIds: Set<NodeId> } | undefined;
  /**
   * Extends `bounds` IN PLACE to all the published envelopes: the graph view's
   * contribution to the framing, which would clip the discs without it.
   *
   * Mutation in place and not a new rect: the caller composes the cards' bounds and then
   * these, and returning a copy would force it to reassign a `Rect` the camera consumes
   * right after.
   */
  extendBoundsToClusters(bounds: Rect): void;
  /**
   * The envelopes ready to paint, or an empty array as long as nothing is
   * published.
   *
   * The resolutions live here, and not in `drawClusters`: the drawing function
   * takes nothing but bare data, so it tests itself without a graph or an aggregate
   * index.
   */
  clustersFor(args: ClustersForArgs): ClusterPaint[];
  /**
   * The aggregates ready to paint AS NODES — the semantic regime.
   *
   * Same arguments and same resolutions as `clustersFor`, of which this is the
   * extension: the label and the member count come and add themselves to the
   * color, the dimming and the hover already resolved over there. Two methods
   * and not a single one that would always return the whole thing, because the
   * card regime calls this one once per frame of a hover: making it resolve
   * labels it does nothing with would be paying for the semantic regime
   * permanently.
   */
  semanticNodesFor(args: ClustersForArgs): SemanticNodePaint[];
  /**
   * The published aggregated edges, resolved against the CURRENT positions of the discs
   * and clipped to their edges.
   *
   * A pair one of whose discs has disappeared from the layout, or whose two
   * discs overlap to the point that no segment is left, is omitted: there is
   * nothing to trace, and a segment of zero or negative length would be a
   * reversed stroke.
   */
  semanticEdges(selectedAggregateId: string | null): SemanticEdgeSegment[];
  /**
   * The id of the aggregate that claims `id` according to the published index, or
   * `undefined` for an entity outside any aggregate.
   *
   * DIRECT read of `byNode`, at `[0]`: membership is a partition. Distinct from
   * `memberIdsContaining`, which sweeps the ENVELOPES to bring one back with its
   * members; this one answers the single question "is this card already
   * represented by a disc?", and the semantic regime asks it once per entity on
   * every rebuild.
   */
  aggregateIdOf(id: NodeId): string | undefined;
  /**
   * The EFFECTIVE hull padding — the one the engine computed the discs with, and
   * therefore the only one we are allowed to recompute them with when a card
   * moves.
   *
   * Worth 0 for as long as the engine has not been loaded, and that is without
   * consequence: there are discs to recompute only in the graph view, that is, exactly
   * when the engine is already there.
   */
  hullPadding(): number;
}

/**
 * An instance's GRAPH VIEW state, and its life cycle: the aggregate index, the layout,
 * the engine loaded on demand and the hull padding that comes out of it. The controller
 * is its sole owner.
 *
 * No Pixi import, here or transitively: it is a data machine, testable without a
 * canvas or an instance — same shape as `search.ts` and `animate.ts`, and for the same
 * reason.
 *
 * What stays at the caller's, deliberately: `opGen` and every generation
 * guard (the race spans both views, the counter belongs to the
 * orchestrator — the `compute`/`publish` split is precisely what allows
 * it), the three fallback policies on a `null`, and the current view
 * itself.
 */
export function createGraphViewController(hooks: GraphViewHooks): GraphViewController {
  // Everything stays `undefined` until the graph view has been switched to at least once:
  // a consumer of the structure view alone pays for neither the aggregate computation nor
  // the engine load.
  let aggregateIndex: AggregateIndex | undefined;
  let graphLayout: GraphLayoutResult | undefined;
  // The NAMESPACE of the `./graph-layout` entry point, kept rather than the engine alone:
  // the worker path also takes `extractGraphLayoutInput` out of it, and the in-process
  // path stays built from it.
  let graphModule: GraphLayoutModule | undefined;
  let graphEngine: GraphLayoutEngine | undefined;
  // Filled in at the same time as the module, which it comes out of: the default comes
  // from the core (see `ensureModule`), never from a local copy of the number.
  let graphHullPadding = 0;

  // --- The layout worker, and the little state it demands.
  let workerHandle: GraphLayoutWorkerHandle | null = null;
  // True from the first failure, and for the whole session: see `retireWorker`.
  let workerRetired = false;
  let controllerDestroyed = false;
  // The number of the next request. Monotonic and never reset, including
  // after an `invalidate()`: two requests of the same session must never
  // share a number, failing which one's response could resolve the
  // other.
  let workerGen = 0;
  const pendingByGen = new Map<
    number,
    { resolve: (result: GraphLayoutResult) => void; reject: (error: unknown) => void }
  >();
  // The references folded onto the aggregates, published with the rest.
  let semanticEdgeList: AggregateEdge[] = [];
  // The labels ready to paint, published with the rest: common prefix already stripped,
  // hence identical from one frame to the next until something is republished.
  let semanticLabelById = new Map<string, string>();
  // The published envelopes, indexed by aggregate: that is how an aggregated edge finds
  // its two ends. Built at PUBLICATION time and not on every repaint — the
  // `ClusterShape`s are mutated in place by drags, so the table stays right without being
  // redone.
  let clusterById = new Map<string, ClusterShape>();

  // Shared rather than allocated on every read: `clusters()` is called on every repaint,
  // hence on every frame of a drag, and the "nothing published" case has nothing to tell
  // apart from one call to the next.
  const NO_CLUSTERS: ClusterShape[] = [];

  /**
   * Loads the graph view's ENTRY POINT on demand — the namespace, not just the
   * engine.
   *
   * The namespace, because there are now two paths taking different things out of
   * it: the in-process path takes `createTwoLevelLayoutEngine` (see
   * `ensureEngine`), the worker path takes `extractGraphLayoutInput` to do, here,
   * the one half of the computation that needs the `Graph`. Both take
   * `TWO_LEVEL_LAYOUT_DEFAULTS`.
   *
   * The engine itself is `createTwoLevelLayoutEngine` — shelf packing inside each
   * aggregate, then a simulation over the aggregates turned into rigid discs —,
   * and it is the only one since `createGraphLayoutEngine` (fcose +
   * `separateOverlaps` + `separateClusters`) was removed, and `cytoscape` with it.
   * The spike that motivated the switch measured it ×11 to ×65 faster and ×2 to
   * ×5.4 denser, at equal guarantees:
   * `docs/superpowers/spikes/2026-09-01-two-level-layout.md`. Measured in Chromium
   * through the e2e, on the demo's extended data set: `setView("graph")` went from
   * 4,310–4,484 ms to 220–252 ms.
   *
   * The `import()` stays dynamic. The chunk `apps/demo`'s production Vite build emits
   * now weighs no more than **3.58 kB gzip** (7.80 kB raw, against 180.28 / 577.17
   * before the removal), so it is no longer the weight that justifies the laziness:
   * it is that laziness is this view's default shape, and that `setView` is
   * asynchronous for that reason. The two bundle purity tests carry the full
   * reasoning.
   */
  async function ensureModule(): Promise<GraphLayoutModule> {
    if (!graphModule) {
      graphModule = await import("@defsquare/data-graph-core/graph-layout");
      // It is here, and NOWHERE else, that we learn the default hull padding: the
      // loaded module's namespace carries it, so the renderer knows it without
      // keeping a copy of it and without statically importing that entry point —
      // which the two purity tests forbid. Dragging a card needs it in order to
      // recompute the discs the way the engine computed them, and there are discs
      // only in the graph view, that is, exactly when this module is already
      // loaded.
      graphHullPadding =
        hooks.layoutOptions?.hullPadding ?? graphModule.TWO_LEVEL_LAYOUT_DEFAULTS.hullPadding;
    }
    return graphModule;
  }

  /**
   * The IN-PROCESS engine, built once on the already loaded module.
   *
   * It remains the default path (no worker URL: vitest, headless, host without
   * workers) AND the worker's fallback. Building it lazily here rather than at module
   * load avoids allocating it in the session that only uses the worker and never
   * fails.
   */
  async function ensureEngine(): Promise<GraphLayoutEngine> {
    const mod = await ensureModule();
    if (!graphEngine) graphEngine = mod.createTwoLevelLayoutEngine(hooks.layoutOptions);
    return graphEngine;
  }

  /**
   * Opens the worker at FIRST need, and keeps it for the session.
   *
   * A single worker, reused: starting it costs a module load, and a view
   * switch can repeat. It is opened at the first layout and not at
   * controller construction, for the reason that already holds for the
   * engine — a consumer of the structure view alone pays nothing of the
   * graph view.
   *
   * Returns `null` as soon as the worker is out of the game: no URL supplied, or
   * definitive fallback already triggered.
   */
  function ensureWorker(): GraphLayoutWorkerHandle | null {
    if (workerRetired || !hooks.spawnLayoutWorker) return null;
    if (workerHandle) return workerHandle;
    try {
      workerHandle = hooks.spawnLayoutWorker(onWorkerMessage, onWorkerError);
    } catch (err) {
      // A construction that throws (unplayable URL, missing chunk, missing `Worker`) is
      // handled exactly like a computation that fails.
      retireWorker(err);
      return null;
    }
    return workerHandle;
  }

  /**
   * THE FALLBACK, and it is DEFINITIVE for the session.
   *
   * Same discipline as `elkWorkerUrl`'s fallback on the structure view side:
   * at the first failure, we warn once and replay in-process, forever. No
   * second chance and no arbitrary timeout — the two real causes (a URL that
   * does not load, an environment without a usable worker) do not repair
   * themselves from one attempt to the next, and a `setTimeout` on a
   * computation known to last seconds would only measure an opinion about the
   * machine's speed.
   *
   * The requests still in flight are rejected: their callers will each fall back on
   * their own side, which is exactly the right thing — they carry potentially different
   * graphs.
   */
  function retireWorker(reason: unknown): void {
    if (!workerRetired) {
      workerRetired = true;
      console.warn("[data-graph] graph layout via graphLayoutWorkerUrl failed, falling back to in-process layout", reason);
    }
    closeWorker(new Error("[data-graph] graph layout worker retired"));
  }

  /** Terminates the worker and settles the in-flight requests with `reason`. */
  function closeWorker(reason: Error): void {
    workerHandle?.terminate();
    workerHandle = null;
    const inFlight = [...pendingByGen.values()];
    pendingByGen.clear();
    for (const entry of inFlight) entry.reject(reason);
  }

  /**
   * The arrival of a response. The whole generation guard fits inside the lookup: a
   * response whose generation no longer has a request in flight is DROPPED silently — that
   * is the case of a worker just retired or terminated, whose already posted messages keep
   * arriving.
   */
  function onWorkerMessage(data: unknown): void {
    const response = data as GraphLayoutWorkerResponse;
    const entry = pendingByGen.get(response.gen);
    if (!entry) return;
    pendingByGen.delete(response.gen);
    if (!response.ok) {
      entry.reject(new Error(response.message));
      return;
    }
    entry.resolve(hydrateLayout(response));
  }

  /** An error from the worker itself (and not from a computation): nothing says
   * which request it concerns, so it condemns the worker. */
  function onWorkerError(error: unknown): void {
    retireWorker(error);
  }

  /**
   * Rebuilds the layout from the response.
   *
   * The `Rect`s are allocated here and the `ClusterShape`s come from the
   * structured cloning: in both cases these are ORDINARY, MUTABLE OBJECTS, and
   * that is not a detail. Dragging a card or an aggregate mutates the envelopes
   * and the rects IN PLACE (`translateCluster`, `recomputeClusterCircle` at the
   * caller's), and the semantic layers re-read those very objects on every frame.
   * A frozen structure or an `Object.freeze` for comfort would break dragging, and
   * only dragging.
   */
  function hydrateLayout(response: GraphLayoutWorkerResponse & { ok: true }): GraphLayoutResult {
    const positions = new Map<NodeId, Rect>();
    for (const [id, x, y, width, height] of response.positions) {
      positions.set(id, { x, y, width, height });
    }
    return { positions, clusters: response.clusters };
  }

  /** Posts a request and returns the promise of ITS response. */
  function postToWorker(
    worker: GraphLayoutWorkerHandle,
    input: GraphLayoutInput,
  ): Promise<GraphLayoutResult> {
    const gen = ++workerGen;
    return new Promise<GraphLayoutResult>((resolve, reject) => {
      pendingByGen.set(gen, { resolve, reject });
      try {
        worker.post({ gen, input });
      } catch (err) {
        // A `postMessage` that throws (non-cloneable input) will never produce a response:
        // without this catch the promise would hang for life.
        pendingByGen.delete(gen);
        reject(err);
      }
    });
  }

  /**
   * The layout, by the worker if the host supplied one, in-process otherwise — and
   * in-process ALSO at the worker's first failure.
   *
   * The EXTRACTION stays here, on the main thread, and that is structural: it is
   * the only part that reads the `Graph`, which does not cross a `postMessage`.
   * What it costs is linear (one card measurement per entity, one sweep of the
   * references); what it saves is the simulation, which is all of the measured
   * time.
   */
  async function layoutOf(target: Graph, index: AggregateIndex): Promise<GraphLayoutResult> {
    const mod = await ensureModule();
    const visible = entityIdsOf(target);
    const metrics = hooks.getMetrics();

    const worker = ensureWorker();
    if (worker) {
      const input = mod.extractGraphLayoutInput(target, index, visible, metrics, hooks.layoutOptions);
      try {
        return await postToWorker(worker, input);
      } catch (err) {
        // A destroyed instance does not fall back: replaying in-process the multi-second
        // computation we have just abandoned is the opposite of what `destroy()` asks
        // for.
        if (controllerDestroyed) throw err;
        retireWorker(err);
      }
    }

    return (await ensureEngine()).layout(target, index, visible, metrics);
  }

  /** Aggregate index for `target`. */
  function buildAggregateState(target: Graph, config: DataGraphConfig): { index: AggregateIndex } {
    return { index: buildAggregates(target, validateConfig(config)) };
  }

  /**
   * The disc labels, resolved and then STRIPPED of their common prefix.
   *
   * The ENTITY id and not the JSON pointer: it is the name the user recognizes
   * ("com.example.credit.domain"), where `rootId` is a path inside the document.
   * And without the "#" the card puts in its header: this disc has no type pill
   * beside it to justify the prefix. A root missing from the graph keeps its
   * aggregate id rather than an empty slot — better a technical label than an
   * anonymous disc.
   *
   * The prefix stripping is done on the complete set, these fallback labels included: they
   * are what will be displayed, so they count towards what is widespread. The `startsWith`
   * is not a precaution but the RULE: the prefix is dominant and not universal (see
   * `dominantSegmentPrefix`), so the labels of another family keep their whole name. A
   * `slice` is enough for the others — the prefix is only retained if it leaves them a
   * segment.
   */
  function semanticLabelsOf(target: Graph, clusters: readonly ClusterShape[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const cluster of clusters) {
      const root = target.nodes.get(cluster.rootId);
      labels.set(
        cluster.aggregateId,
        root?.kind === "entity" ? root.entityId : (root?.label ?? cluster.aggregateId),
      );
    }
    const prefix = dominantSegmentPrefix([...labels.values()]);
    if (prefix.length === 0) return labels;
    for (const [aggregateId, label] of labels) {
      if (label.startsWith(prefix)) labels.set(aggregateId, label.slice(prefix.length));
    }
    return labels;
  }

  function entityIdsOf(target: Graph): Set<NodeId> {
    const ids = new Set<NodeId>();
    for (const node of target.nodes.values()) {
      if (node.kind === "entity") ids.add(node.id);
    }
    return ids;
  }

  // Named rather than a method of the returned object, and called as such by
  // `tryCompute`: going through `this` would make the fallback depend on how the caller
  // obtained the method (a `const { tryCompute } = controller` would be enough to break
  // it).
  async function compute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
  ): Promise<GraphViewState> {
    const base = reuse && aggregateIndex ? { index: aggregateIndex } : buildAggregateState(target, config);
    // `layoutOf` decides worker vs in-process and carries the fallback: see there.
    const layout = await layoutOf(target, base.index);
    // Recomputed even when the index is reused: it is a single sweep of the
    // references, out of all proportion with the layout we have just awaited, and
    // memoizing it would require knowing which graph it was computed against —
    // exactly the pairing that publishing in one block exists to make impossible to
    // get wrong.
    const semanticEdges = aggregateRefEdges(target.refEdges, base.index.byNode);
    return {
      ...base,
      layout,
      semanticEdges,
      semanticLabels: semanticLabelsOf(target, layout.clusters),
    };
  }

  return {
    compute,

    async tryCompute(
      target: Graph,
      config: DataGraphConfig,
      reuse: boolean,
      context: string,
    ): Promise<GraphViewState | null> {
      try {
        return await compute(target, config, reuse);
      } catch (err) {
        console.warn(`[data-graph] ${context}`, err);
        return null;
      }
    },

    publish(state: GraphViewState): void {
      aggregateIndex = state.index;
      graphLayout = state.layout;
      semanticEdgeList = state.semanticEdges;
      semanticLabelById = state.semanticLabels;
      // Rebuilt here and nowhere else: it indexes THE engine's objects, the very ones drags
      // mutate in place.
      clusterById = new Map(state.layout.clusters.map((cluster) => [cluster.aggregateId, cluster]));
    },

    invalidate(): void {
      aggregateIndex = undefined;
      graphLayout = undefined;
      // All five fall TOGETHER, for the reason that already holds for the first two:
      // they are indexed by node and aggregate id, and make no sense on another
      // graph. The labels doubly so: the prefix stripped from them is THIS aggregate
      // set's.
      semanticEdgeList = [];
      semanticLabelById = new Map();
      clusterById = new Map();
    },

    destroy(): void {
      if (controllerDestroyed) return;
      controllerDestroyed = true;
      closeWorker(new Error("[data-graph] instance destroyed while the graph layout was in flight"));
    },

    positions(): Map<NodeId, Rect> | undefined {
      return graphLayout?.positions;
    },

    // The aggregate index only knows the entities attached to an aggregate, so we sweep the
    // graph and not the index — failing which an isolated entity would disappear from the
    // view.
    entityIds: entityIdsOf,

    clusters(): ClusterShape[] {
      return graphLayout?.clusters ?? NO_CLUSTERS;
    },

    aggregateOf(aggregateId: string): Aggregate | undefined {
      return aggregateIndex?.aggregates.get(aggregateId);
    },

    memberIdsContaining(id: NodeId): { cluster: ClusterShape; memberIds: Set<NodeId> } | undefined {
      const aggregates = aggregateIndex?.aggregates;
      if (!aggregates || !graphLayout) return undefined;
      for (const cluster of graphLayout.clusters) {
        const aggregate = aggregates.get(cluster.aggregateId);
        if (!aggregate?.memberIds.has(id)) continue;
        // Aggregates are a PARTITION: a card belongs to only one of them, there is nothing left
        // to look for past this one.
        return { cluster, memberIds: aggregate.memberIds };
      }
      return undefined;
    },

    extendBoundsToClusters(bounds: Rect): void {
      // The disc overflows the cards by its padding; its bounding box is `cx ± r`, `cy ± r`,
      // and it is that box we union with the cards' bounds.
      for (const cluster of graphLayout?.clusters ?? NO_CLUSTERS) {
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        bounds.x = Math.min(bounds.x, cluster.cx - cluster.r);
        bounds.y = Math.min(bounds.y, cluster.cy - cluster.r);
        bounds.width = Math.max(right, cluster.cx + cluster.r) - bounds.x;
        bounds.height = Math.max(bottom, cluster.cy + cluster.r) - bounds.y;
      }
    },

    clustersFor(args: ClustersForArgs): ClusterPaint[] {
      return (graphLayout?.clusters ?? NO_CLUSTERS).map((cluster) => paintOf(cluster, args));
    },

    semanticNodesFor(args: ClustersForArgs): SemanticNodePaint[] {
      const aggregates = aggregateIndex?.aggregates;
      return (graphLayout?.clusters ?? NO_CLUSTERS).map((cluster) => {
        return {
          ...paintOf(cluster, args),
          id: cluster.aggregateId,
          // A plain read: the label was resolved and shortened at publication time (see
          // `semanticLabelsOf`), because it depends only on the (graph, layout) couple
          // and because this method here runs on every frame of a hover. The fallback on
          // the aggregate id covers state published by hand by a test, without a label
          // table.
          label: semanticLabelById.get(cluster.aggregateId) ?? cluster.aggregateId,
          // The count of MEMBERS, not of children: that is what the disc replaces — the cards we
          // no longer draw.
          count: aggregates?.get(cluster.aggregateId)?.memberIds.size ?? 0,
        };
      });
    },

    semanticEdges(selectedAggregateId: string | null): SemanticEdgeSegment[] {
      const out: SemanticEdgeSegment[] = [];
      for (const edge of semanticEdgeList) {
        const a = clusterById.get(edge.a);
        const b = clusterById.get(edge.b);
        if (!a || !b) continue;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const len = Math.hypot(dx, dy);
        // Two concentric (or coincident) discs have no direction: there is then no segment to
        // clip, and dividing by `len` would return NaNs that the renderer would propagate
        // through its geometry.
        if (len === 0) continue;
        const ux = dx / len;
        const uy = dy / len;
        // The stroke starts from the EDGE of each disc and not from its center:
        // the discs of the semantic regime are opaque and paint themselves on
        // top, so a stroke crossing them would only serve to thicken their
        // outline from underneath. Two discs too close to leave a segment produce
        // none.
        if (len <= a.r + b.r) continue;
        out.push({
          x1: a.cx + ux * a.r,
          y1: a.cy + uy * a.r,
          x2: b.cx - ux * b.r,
          y2: b.cy - uy * b.r,
          weight: edge.weight,
          // An edge stays full as soon as it TOUCHES the selected aggregate: same rule as
          // `edgeFocusIds` on the card side, where an edge crossing the block counts for
          // it.
          dim: selectedAggregateId !== null && edge.a !== selectedAggregateId && edge.b !== selectedAggregateId,
        });
      }
      return out;
    },

    aggregateIdOf(id: NodeId): string | undefined {
      return aggregateIndex?.byNode.get(id)?.[0];
    },

    hullPadding(): number {
      return graphHullPadding;
    },
  };

  /**
   * What both regimes resolve the SAME way on an envelope: color,
   * dimming, intensity. The semantic regime only adds a label and a count
   * to it — it redefines nothing —, and it is this shared function that
   * guarantees a disc and the envelope it replaces dim and light up
   * together.
   */
  function paintOf(cluster: ClusterShape, args: ClustersForArgs): ClusterPaint {
    const root = args.graph.nodes.get(cluster.rootId);
    const members = aggregateIndex?.aggregates.get(cluster.aggregateId)?.memberIds;
    return {
      circle: { cx: cluster.cx, cy: cluster.cy, r: cluster.r },
      color: root ? args.accentFor(root) : args.fallbackColor,
      // An envelope recedes when NONE of its members is linked to the selection; the one
      // that is selected therefore stays full without a special case (see
      // `clusterDimmed`).
      //
      // An envelope whose aggregate is missing from the index stays FULL
      // rather than dimming by default: we then know nothing of its members,
      // and the same reasoning holds here as for `focusKeep()`'s ghost
      // selection — better to dim nothing than to dim on information we do not
      // have.
      dim: members ? clusterDimmed(args.keep, members) : false,
      // Relayed and not stored in the shape: `clusters()` is the engine's output, and grafting
      // interface state onto it would make it depend on who is hovering it.
      //
      // Selecting an aggregate paints it at its FULL hover intensity,
      // and not with one more ring: the envelope already has a "lit"
      // state that hover makes known, and reusing it says "this one"
      // without adding visual vocabulary. The `max` is what stops the
      // hover from BRINGING DOWN the selected envelope when the pointer
      // leaves it (`attachHover` then writes decreasing values into it,
      // down to 0).
      hover: Math.max(
        args.hoverOf(cluster.aggregateId),
        cluster.aggregateId === args.selectedAggregateId ? 1 : 0,
      ),
    };
  }
}
