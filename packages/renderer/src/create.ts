import {
  AlphaFilter,
  Application,
  Container,
  Graphics,
  type BitmapText,
  type FederatedPointerEvent,
  type Rectangle,
  type Text,
} from "pixi.js";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  buildGraph,
  anchorRectFor,
  DEFAULT_METRICS,
  enclosingCircle,
  validateConfig,
  type Aggregate,
  type DataGraphConfig,
  type Diagnostic,
  type ElkFactory,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
  type SearchResult,
} from "@defsquare/datagraph-core";
// `import type` ONLY: this entry point carries the graph view and must enter only
// the bundle of whoever actually switches to it. A type import produces no runtime
// code; the only runtime path to the engine is `graph-view.ts`'s dynamic
// `import()`, which also owns the only `import type` this entry point requires at
// view runtime. THIS file keeps only a PUBLIC API use of it, the relay below.
// `test/bundle-purity.test.ts` (renderer side) guards this whole thread: the core's
// test only covers the core's `dist/`, not the renderer's sources.
//
// What this discipline is worth has changed scale since the old engine was
// removed: 3.58 kB gzip instead of 180.28. It stays because it holds the SHAPE —
// the graph view loads on demand by construction — and no longer because it holds a
// weight. The complete reasoning is in the two purity tests.
import type { TwoLevelLayoutOptions } from "@defsquare/datagraph-core/graph-layout";
// A relay and not a re-export: `export … from "<this specifier>"` is forbidden by
// `test/bundle-purity.test.ts`, type-only form included. Re-exporting the symbol
// already imported above gives consumers the same service without writing the
// forbidden form.
export type { TwoLevelLayoutOptions };
import { entityAccentMap, resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { pixiFontRegistry } from "./font-registry.js";
import { fontsReady, measureFontMetrics } from "./font-metrics.js";
import { Camera, revealPan, type Size } from "./camera.js";
import {
  cardLabelStepForScale,
  drawEdgeHitAreas,
  drawEdgeLabels,
  drawEdges,
  drawClusterHitAreas,
  drawClusters,
  drawNode,
  drawRemainderToken,
  drawSearchHighlights,
  drawSelectionOverlay,
  drawSemanticDiscs,
  drawSemanticEdges,
  drawSemanticLabels,
  edgeLabelPlacements,
  edgeLabelPosition,
  labelParamInView,
  lodForScale,
  semanticLabelGeometry,
  type EdgeLabelPlacement,
  type Lod,
  TOKEN_HOVER_SHIFT,
} from "./draw.js";
import { attachDrag, TAP_THRESHOLD } from "./drag.js";
import { clusterRelatedIds, DIM_ALPHA, relatedIds } from "./focus.js";
import { attachHover, type HoverHandle } from "./hover.js";
import { nearestInDirection } from "./keynav.js";
import { createPositionAnimator } from "./animate.js";
import { createSearchController } from "./search.js";
import {
  createGraphViewController,
  graphViewAsView,
  type ClusterPaint,
  type ClustersForArgs,
  type GraphLayoutWorkerSpawn,
  type SemanticNodePaint,
} from "./graph-view.js";
import { createStructureViewController } from "./structure-view.js";
import { createTreeViewController, type TreeViewState } from "./tree-view.js";
import type { DataGraphView, FoldStep, RemainderToken, View, ViewPolicy } from "./view.js";
import { Emitter } from "./events.js";

// `DataGraphView` and `ViewPolicy` now live in `view.ts`, with the rest of the
// seam this file reads the three views through (ADR-0043). Relayed here because
// `index.ts` publishes the view name from this module, and moving where a public
// type is re-exported from would be a break for no gain.
export type { DataGraphView } from "./view.js";

/**
 * What a rebuild computes ONCE for all its cards, and that a card materialized
 * later — as the camera moves, or at the request of a `select`/`focus` — must find
 * identical.
 *
 * The existence of this object IS the culling invariant: a card created outside
 * `rebuild()`'s loop must be indistinguishable from those it produced. Everything
 * governing a card's drawing that is neither in its node nor in its rect is
 * therefore here, frozen at rebuild time. What is missing from the call is instead
 * re-read live — the positions (which `dragCard` mutates in place) and the focus set
 * (which the selection changes) — because the card must then reflect the CURRENT
 * state, not the last rebuild's.
 */
interface CardContext {
  policy: ViewPolicy;
  /** Fields carrying an outgoing reference, per node. */
  refFieldsByNode: Map<NodeId, Set<string>>;
  /** Same, for the references that do not resolve. */
  danglingFieldsByNode: Map<NodeId, Set<string>>;
  /** Expanded arrays, to orient the tokens' chevron. */
  expandedArrays: Set<NodeId>;
  /** The ids that HAVE a card in this view: the visible, non-elided, positioned
   * nodes. This is the domain materialization sweeps — pre-filtering it here avoids
   * re-testing `elided`/`positions.has` on thousands of nodes every frame. */
  drawable: Set<NodeId>;
}

export interface DataGraphOptions {
  data: unknown;
  config: DataGraphConfig;
  theme?: ThemeOverride;
  elkWorkerUrl?: string | URL;
  /** Initial view. `"structure"` (the default) lays out the containment tree;
   * `"tree"` runs the same machinery over a containment re-derived from the
   * references — a top-level entity hangs under the target of the reference it was
   * claimed through (`buildAggregates`' BFS forest, roots = `groups`); `"graph"`
   * lays out the entities and their references, grouped by aggregate. */
  view?: DataGraphView;
  /**
   * Graph view layout settings, passed as is to `createTwoLevelLayoutEngine`. The
   * most useful remains `clusterGap` (160 px by default), the gap opened between
   * two aggregate envelopes: it is an eye-level setting, which depends on the data's
   * density and the screen's size, and it must be tunable without touching the core.
   * The values are read on the first switch to graph view; changing them afterwards
   * requires recreating the instance.
   *
   * API CHANGE (0.x, with no compatibility layer). This field used to carry
   * `GraphLayoutOptions` — `{ hullPadding, separationMargin, separationIterations,
   * clusterGap }` — and now carries `TwoLevelLayoutOptions` — `{ hullPadding,
   * cardGap, clusterGap, simIterations, jitter }`. `hullPadding` and `clusterGap`
   * keep their name, their meaning and their default. The other two disappear
   * because the pass they tuned no longer exists: the new engine has NO card
   * separation pass at all, hence no iteration cap to tune, and the margin between
   * cards is set by the packing (`cardGap`, 16 px, `separationMargin`'s former
   * value) instead of being aimed at through relaxation. Passing `separationMargin`
   * or `separationIterations` is now a type error: that is intended, the object
   * would otherwise have been accepted and silently ignored.
   *
   * `jitter` (32 px by default) is the second eye-level setting, added afterwards:
   * the amplitude of the deterministic noise that keeps the envelopes from settling
   * into a hexagonal tiling. `0` disables it. Like `clusterGap`, it cannot degrade
   * any guarantee — see its documentation on the core side.
   */
  graphLayoutOptions?: TwoLevelLayoutOptions;
  /**
   * The URL of the Web Worker that computes the graph view's layout. Absent, the
   * computation stays IN PROCESS, exactly as before this option existed.
   *
   * What it buys, measured: on a real audit of 6,251 entities and ~1,300
   * aggregates, `setView("graph")` spends ~4.4 s in an entirely synchronous
   * computation. On the main thread that is 4.4 s of frozen page — no rendering, no
   * pan, no zoom. Offloaded, the main thread does nothing but the extraction
   * (linear) and applying the result, and structure view stays usable throughout
   * the wait.
   *
   * The URL must designate the worker this package publishes,
   * `@defsquare/datagraph/graph-layout-worker` — a standalone ESM module, loaded
   * with `{ type: "module" }`. Under a bundler, the usual form is
   * `new URL("@defsquare/datagraph/graph-layout-worker", import.meta.url)`;
   * `apps/demo` does it that way, with `vite.config.ts`'s note on the four
   * execution modes.
   *
   * FALLBACK. The option is safe to pass: on the FIRST failure — construction
   * impossible, worker unrunnable, computation throwing — the instance warns once
   * and replays the layout in process, permanently for the session. The worst case
   * is therefore the pre-option behavior, never a view that fails to appear. Same
   * discipline as `elkWorkerUrl`'s fallback, stricter still: this one does not
   * retry on the next layout.
   */
  graphLayoutWorkerUrl?: string | URL;
}

export type DataGraphEvent = "select" | "followRef" | "deselect" | "statschange";

type DataGraphEvents = {
  select: GraphNode;
  followRef: RefEdge;
  /** The selection returned to rest. No payload: there is nothing left to
   * describe, and the host's own state is what it has to undo. */
  deselect: void;
  /** What `stats()` reports has changed. No payload either — the host re-reads
   * `stats()`, so a counter added there needs no new event shape. */
  statschange: void;
};

export interface DataGraph {
  ready: Promise<void>;
  fit(): void;
  /**
   * Recomputes the structure view's COMPLETE layout, then frames it.
   *
   * Structure view is built through incremental operations — expansions, collapses,
   * revealed pages — each inserting a block into an existing arrangement rather
   * than redoing it. That is what makes them instantaneous, and it is also what
   * makes the view drift: after a long exploration session, the columns are no
   * longer those a global tidy-up would give. `tidy()` is the repair action — the
   * host's "Tidy" — to be offered to the user rather than triggered on its own: the
   * arrangement changes before their eyes, it must be their gesture.
   *
   * Tree view drifts and is repaired the same way: it is the same machinery over
   * another containment. No effect in graph view, which has its own engine and
   * does not drift.
   */
  tidy(): Promise<void>;
  /** Expands a node of the containment tree — a STRUCTURE or TREE VIEW operation,
   * the two being the same machinery over two different containments. In graph
   * view it has no visible effect: the state is indeed updated, and will show on
   * returning to a folded view, but graph view does not show containment. Graph
   * view, for its part, collapses nothing: every entity is always visible there. */
  expand(id: NodeId): Promise<void>;
  /** Collapses a node of the containment tree. Same remark as `expand`. */
  collapse(id: NodeId): Promise<void>;
  focus(id: NodeId): void;
  select(id: NodeId): void;
  search(query: string): SearchResult[];
  nextMatch(): SearchResult | null;
  prevMatch(): SearchResult | null;
  on(event: DataGraphEvent, callback: (payload: any) => void): () => void;
  setData(data: unknown, config?: DataGraphConfig): Promise<void>;
  diagnostics(): Diagnostic[];
  /** Counters for a host status bar. */
  stats(): { logicalNodeCount: number; visibleNodeCount: number };
  /** A node's outgoing reference edges, so a host can offer "follow the reference"
   * without knowing the internals. */
  refEdges(from: NodeId): RefEdge[];
  /** Replaces the theme and redraws, without rerunning layout or remeasuring the
   * fonts. This is only safe if `typography` and `fonts` do not change — which is
   * the case for a light/dark theme pair, differing only in colors. The
   * `NodeMetrics` are measured once, at initialization; changing
   * `typography`/`fonts` here would desynchronize those metrics from the theme
   * actually drawn (glyphs resized without the cards' layout moving). There is
   * today no API to change the font afterwards: that requires recreating the
   * instance through `createDataGraph`. */
  setTheme(theme: Theme | ThemeOverride): void;
  /** View switch. The first switch to `"graph"` loads the organic engine on demand
   * (dynamic import) and computes the aggregates, hence the promise. The selection
   * is carried over to the nearest entity, since graph view only knows entities.
   * Switching between the two FOLDED views — `"structure"` and `"tree"` — rebuilds
   * the graph they render (the source document, or its reference-derived tree)
   * along with the collapse state, the search index and the layout, hence a promise
   * there too. A selection on a node the incoming graph does not hold — a
   * structural node the tree drops — is released. */
  setView(view: DataGraphView): Promise<void>;
  currentView(): DataGraphView;
  destroy(): void;
}

/**
 * How much a card grows on hover, as a fraction of its size: 2.5% at full
 * intensity.
 *
 * Deliberately at the edge of the perceptible. A card is typically 200 px wide, so
 * the lift makes it overflow by 2.5 px on each side — enough for the eye to see what
 * the pointer designates among dozens of neighbors, too little to cover the card
 * next to it (the engine separates cards by `cardGap`, 16 px) or to give the
 * impression that layout is moving. Hover is a landmark, not an event.
 */
const HOVER_LIFT = 0.025;

// The interaction's other eye-level setting, `DIM_ALPHA`, cannot live here: it is
// shared with `drawEdges`, and `draw.ts` importing this file would close a cycle.
// It is in `focus.ts`, along with the function that decides WHO gets dimmed.

/**
 * The filter that dims a card, SHARED by every card of every instance.
 *
 * A filter, and not `container.alpha`. A card is painted IN LAYERS inside a single
 * Graphics — an accent background covering the whole card, then the body on top (see
 * `drawNode`) — and `alpha` applies primitive by primitive: the body, turned
 * translucent, reveals the accent it was covering, and the dimmed card rendered as
 * a solid slab of its accent color. `AlphaFilter` first flattens the card into a
 * texture, THEN applies the alpha to it: the visual stays exactly that of a normal
 * card, simply ghostly. This is what Pixi's docs say ("use this instead of
 * Container's alpha property to avoid visual layering of individual elements").
 *
 * Instantiated LAZILY, and it has to be: a Pixi filter's constructor compiles its
 * `GlProgram`, which creates a test canvas and therefore requires a `document`.
 * Constructing it at module load would make importing this file fail under vitest's
 * Node environment, where several tests import it for
 * `attachTap`/`createBackgroundHit`/`recomputeClusterCircle`.
 *
 * A single, shared instance: a filter has no state but its alpha, which is a
 * constant here. It is never destroyed — `destroy()` has nothing to release from it
 * that another instance might still use.
 *
 * `padding` is 0 (`Filter`'s default), so the filter does not widen the card's
 * bounds and the `cullArea` `drawNode` sets stays exact.
 */
let sharedDimFilters: AlphaFilter[] | undefined;
function dimFilters(): AlphaFilter[] {
  sharedDimFilters ??= [new AlphaFilter({ alpha: DIM_ALPHA })];
  return sharedDimFilters;
}

/**
 * What the selection designates: a CARD or a whole AGGREGATE (graph view only, the
 * only view painting envelopes).
 *
 * A sum type rather than two fields that could be filled in together: the two
 * selections are mutually exclusive, and expressing that in the type saves having to
 * maintain it by hand at every gesture. The public API, for its part, still only
 * knows the NODE selection — `select(id)`, the `"select"` event and
 * `drawSelectionOverlay`'s ring see an id only when `kind === "node"`.
 */
type Selection = { kind: "node"; id: NodeId } | { kind: "cluster"; aggregateId: string };

/**
 * The three windows of card materialization, as SCREEN FRACTIONS added on each side
 * of the visible world rectangle.
 *
 * Only `PAINT` is a visual contract: every card intersecting it is drawn BEFORE the
 * next frame, with no budget and no deferral, so the screen shows exactly what it
 * showed back when all cards were created in one block. The 15% margin absorbs the
 * one-frame lag between the camera's movement and our pass — without it, a card
 * entering from the edge would appear a frame too late.
 *
 * `PREFETCH` is comfort only: one screen on each side, filled across frames within
 * a time budget, so a decisive move does not have to build its band of cards at the
 * exact moment it becomes visible.
 *
 * `RECLAIM` is the destruction threshold, deliberately far wider than `PREFETCH`:
 * this hysteresis is what keeps a camera moving back and forth from destroying then
 * recreating the same cards every frame.
 */
const PAINT_MARGIN = 0.15;
const PREFETCH_MARGIN = 1;
const RECLAIM_MARGIN = 2.5;

/**
 * The time, per frame, that COMFORT materialization is allowed to take.
 *
 * 4 ms out of a 16 ms frame budget: enough to make decisive progress without ever
 * being solely responsible for a dropped frame. The budget is in TIME and not in a
 * number of cards because a card's cost varies by a factor of ~100 between LOD 2 (a
 * solid rectangle) and LOD 0 (header, rows, text measurements): a fixed quota would
 * be either starved at the bottom or ruinous at the top.
 *
 * The `PAINT` window, for its part, is NOT budgeted. Trimming it would open holes on
 * screen, and it is bounded anyway by what the render has to paint regardless.
 */
const PREFETCH_BUDGET_MS = 4;

/**
 * Widens `rect` by `margin` times its size, on EACH side: `margin = 1` therefore
 * triples each dimension. Pure, and exported so it can be tested without an instance
 * — it is not a public API of the package, `index.ts` does not relay it.
 */
export function inflateRect(rect: Rect, margin: number): Rect {
  const dx = rect.width * margin;
  const dy = rect.height * margin;
  return { x: rect.x - dx, y: rect.y - dy, width: rect.width + dx * 2, height: rect.height + dy * 2 };
}

/**
 * Do two rectangles touch? Edge contact COUNTS as an intersection: a card sitting
 * exactly on the window's edge must be drawn, and excluding it would make it
 * flicker at the pixel.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/**
 * The three windows of one materialization pass, derived from the visible world
 * rectangle alone. `null` everywhere when there is no camera: no window means
 * anything then, and everything must be materialized — the pre-culling behavior,
 * kept as a fallback.
 */
export interface CardWindows {
  paint: Rect | null;
  prefetch: Rect | null;
  reclaim: Rect | null;
}

export function cardWindowsFor(worldView: Rect | null): CardWindows {
  if (!worldView) return { paint: null, prefetch: null, reclaim: null };
  return {
    paint: inflateRect(worldView, PAINT_MARGIN),
    prefetch: inflateRect(worldView, PREFETCH_MARGIN),
    reclaim: inflateRect(worldView, RECLAIM_MARGIN),
  };
}

/**
 * ONE card's fate during the materialization pass. All the culling policy lives
 * here, in pure data and with no scene — like `ViewPolicy` for the view, like
 * `focus.ts` for dimming: the decision is testable without an instance, and
 * `syncCards` has nothing left to do but execute it.
 *
 * `"defer"` differs from `"none"` and that is not cosmetic: the first says "it will
 * have to be done, but not in this frame", the second "there is nothing to do".
 * Conflating them would erase from the code the only trace of the budget.
 *
 * The order of the tests IS the policy:
 *  - on screen (`paint`), we create, budget or no budget — that is the visual
 *    contract;
 *  - around it (`prefetch`), we create if the frame's budget allows;
 *  - beyond that, nothing;
 *  - a pinned card (selected, or held by a gesture in flight) is never reclaimed,
 *    wherever it is;
 *  - a materialized card is reclaimed only OUTSIDE `reclaim`, far wider than
 *    `prefetch`: this is the hysteresis that keeps a camera moving back and forth
 *    from destroying and recreating the same cards frame after frame.
 */
export function cardFate(
  rect: Rect,
  windows: CardWindows,
  state: { materialized: boolean; pinned: boolean; budgetLeft: boolean },
): "create" | "defer" | "reclaim" | "none" {
  if (!state.materialized) {
    if (windows.paint === null || rectsOverlap(rect, windows.paint)) return "create";
    if (windows.prefetch !== null && rectsOverlap(rect, windows.prefetch)) {
      return state.budgetLeft ? "create" : "defer";
    }
    return "none";
  }
  if (state.pinned) return "none";
  if (windows.reclaim === null || rectsOverlap(rect, windows.reclaim)) return "none";
  return "reclaim";
}

/**
 * Does `outer` entirely contain `inner`? Serves as a STALENESS test for whatever is
 * built for a window wider than the screen: as long as the window to paint fits
 * inside the one used to build, there is nothing to redo.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function boundsOf(positions: Map<NodeId, Rect>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of positions.values()) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Walks up `parentId` until it finds an entity. Serves the selection carry-over
 * between the two views: graph view only knows entities, so leaving structure view
 * from a nested object must select the entity containing it rather than clear the
 * selection.
 */
export function nearestEntityAncestor(graph: Graph, id: NodeId): NodeId | null {
  let current = graph.nodes.get(id);
  while (current) {
    if (current.kind === "entity") return current.id;
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * Recomputes an aggregate's envelope IN PLACE from its members' current positions.
 *
 * This is exactly the engine's computation — `enclosingCircle` over the members'
 * rects, plus `hullPadding` — redone here while a card is being moved with the
 * mouse. Redoing it rather than translating the circle is what makes it correct:
 * pulling a card out of its aggregate must inflate the envelope, bringing it back
 * must tighten it, and a circle that merely followed would do neither.
 *
 * Mutating in place is not thrift: the `ClusterShape` passed here IS
 * `graphView.clusters()`'s, and that is how the next `clustersFor()` will see the
 * new shape. Members with no position (not visible) are ignored — the envelope
 * describes only what is painted.
 *
 * The parameter is typed structurally rather than as a `ClusterShape`: the function
 * only needs the disc, and sticking to that makes it testable without fabricating
 * an aggregate or touching the graph view's entry point.
 */
export function recomputeClusterCircle(
  cluster: { cx: number; cy: number; r: number },
  memberIds: Iterable<NodeId>,
  positions: Map<NodeId, Rect>,
  padding: number,
): void {
  const rects: Rect[] = [];
  for (const memberId of memberIds) {
    const rect = positions.get(memberId);
    if (rect) rects.push(rect);
  }
  const circle = enclosingCircle(rects, padding);
  cluster.cx = circle.cx;
  cluster.cy = circle.cy;
  cluster.r = circle.r;
}

/**
 * Translates a whole aggregate IN PLACE: its disc and the rects of every member
 * that has a position, by the same delta.
 *
 * Nothing is recomputed, and that is the difference in kind from
 * `recomputeClusterCircle`: moving an aggregate is a RIGID gesture. The disc was
 * the minimal enclosing circle of its cards before the gesture, and it still is
 * afterwards, since everything moved together — which is exactly what the engine
 * does, computing the envelope once on the packed block then translating it with
 * its cards. Recomputing here would change nothing in the result and would cost one
 * Welzl per frame.
 *
 * Members with no position (not visible) are ignored, as everywhere else: layout
 * describes only what is painted.
 */
export function translateCluster(
  cluster: { cx: number; cy: number; r: number },
  memberIds: Iterable<NodeId>,
  positions: Map<NodeId, Rect>,
  dx: number,
  dy: number,
): void {
  cluster.cx += dx;
  cluster.cy += dy;
  for (const memberId of memberIds) {
    const rect = positions.get(memberId);
    if (!rect) continue;
    rect.x += dx;
    rect.y += dy;
  }
}

/**
 * The ELK the layouts run on, or `undefined` when the host supplied no worker
 * URL — the layout engines then fall back to their own in-process bundle.
 *
 * NOTE: elk.bundled.js's `workerUrl` path only spawns a real worker when the
 * optional `web-worker` package is present (it's a Node worker_threads shim, not
 * a browser API) — under Vite/browser it silently falls back to elkjs's
 * in-process "fake worker" instead of throwing. Passing the option is therefore
 * always safe: the worst case is a layout that runs in-process, never a failed
 * construction, so there is nothing to guard or feature-detect.
 *
 * Shared by the structure engine and the tree's layout: the worker is the host's
 * setting, not a view's.
 */
function buildElkFactory(elkWorkerUrl: string | URL | undefined): ElkFactory | undefined {
  if (!elkWorkerUrl) return undefined;
  return () => new ELK({ workerUrl: String(elkWorkerUrl) });
}

/**
 * The factory for the graph view's layout worker, or `undefined` when the host has
 * not supplied its URL.
 *
 * This is the ONLY place in the repo where `new Worker` is written, and that is
 * intended: the graph view's controller (`graph-view.ts`) stays a data machine with
 * no environment assumption, and receives a function rather than a URL. The protocol
 * tests inject a different one, with no browser.
 *
 * `{ type: "module" }` is not negotiable: the published worker is an ESM module, and
 * in development the bundler serves its SOURCE, whose imports are rewritten as
 * module imports. A classic worker would refuse both.
 *
 * Nothing is guarded here: `new Worker` may throw (unrunnable URL, `Worker` absent
 * from the environment) and the controller is what treats that failure like all the
 * others — a warning, then the in-process engine for the session.
 */
function buildGraphLayoutWorkerSpawn(
  graphLayoutWorkerUrl: string | URL | undefined,
): GraphLayoutWorkerSpawn | undefined {
  if (!graphLayoutWorkerUrl) return undefined;
  return (onMessage, onError) => {
    const worker = new Worker(graphLayoutWorkerUrl, { type: "module" });
    worker.onmessage = (event: MessageEvent) => onMessage(event.data);
    // The two failures a worker signals outside the protocol: the script failing
    // to load or to run (`error`), and a message that could not be deserialized
    // (`messageerror`). Neither says which request it relates to, hence the global
    // handling on the controller's side.
    worker.onerror = (event) => onError(event);
    worker.onmessageerror = (event) => onError(event);
    return {
      post: (request) => worker.postMessage(request),
      terminate: () => worker.terminate(),
    };
  };
}

/**
 * Wires a display object for click interaction: `eventMode = "static"`,
 * a pointer cursor, and a `pointertap` handler gated by a `TAP_THRESHOLD`px
 * movement check against the matching `pointerdown` (so a drag-to-pan
 * gesture that starts/ends over the object never fires `onTap`).
 *
 * The threshold comes from `drag.ts`, which carries the other half of the same
 * split: what stops being a tap here is exactly what becomes a card move over
 * there. Exported so that split is testable end to end (`test/drag.test.ts`) — it is
 * not a public API of the package, `index.ts` does not relay it.
 */
export function attachTap(target: Container, onTap: (event: FederatedPointerEvent) => void): void {
  target.eventMode = "static";
  target.cursor = "pointer";
  let downX = 0;
  let downY = 0;
  target.on("pointerdown", (event: FederatedPointerEvent) => {
    downX = event.global.x;
    downY = event.global.y;
  });
  target.on("pointertap", (event: FederatedPointerEvent) => {
    const dx = event.global.x - downX;
    const dy = event.global.y - downY;
    if (Math.hypot(dx, dy) > TAP_THRESHOLD) return;
    onTap(event);
  });
}

/**
 * The canvas BACKGROUND as a click target: an empty, transparent container covering
 * `hitArea`, whose tap calls `onTap`. Meant to be inserted UNDER everything else,
 * where it is the only object the pointer can reach on the void.
 *
 * Why a dedicated layer and not `app.stage` itself, which one could simply switch to
 * `"static"` with a `hitArea`: because Pixi's hit-testing INHERITS the event mode on
 * the way down (`EventBoundary.hitTestRecursive` passes the parent's mode along as
 * soon as it is interactive). A `"static"` stage would therefore make all its
 * descendants interactive, decorative Graphics included — and the first of them hit
 * would SWALLOW the hit, the loop stopping at the first child that answers: the
 * selection ring or a search highlight would prevent clicking the card it covers. A
 * lower-level sibling has no such effect — it is consulted only if nothing above it
 * answered, that is, on the void.
 *
 * Two conditions for the tap, and both are needed. `event.target === background`: a
 * card's or an edge hit area's `pointertap` BUBBLES up to here, and without this
 * check every click would deselect right after selecting. The `TAP_THRESHOLD` px
 * threshold: the camera's pan starts from the same button on the same void and also
 * emits a `pointertap` on arrival. It is `attachTap`/`attachDrag`'s split, with the
 * same constant — but written here rather than delegated to `attachTap`, which would
 * set a `"pointer"` cursor over the entire canvas.
 *
 * Exported for the same reason as `attachTap`: the gesture is thereby testable
 * without canvas or WebGL. It is not a public API of the package, `index.ts` does
 * not relay it.
 */
export function createBackgroundHit(hitArea: Rectangle, onTap: () => void): Container {
  const background = new Container();
  background.eventMode = "static";
  background.hitArea = hitArea;
  let downX = 0;
  let downY = 0;
  background.on("pointerdown", (event: FederatedPointerEvent) => {
    downX = event.global.x;
    downY = event.global.y;
  });
  background.on("pointertap", (event: FederatedPointerEvent) => {
    if (event.target !== background) return;
    if (Math.hypot(event.global.x - downX, event.global.y - downY) > TAP_THRESHOLD) return;
    onTap();
  });
  return background;
}

/**
 * Creates a DataGraph instance: builds the graph from `data`/`config`,
 * initializes Pixi (async), lays out the initially-visible nodes, and
 * renders them. Returns immediately; await `.ready` before calling `fit()`
 * or other methods that need the graph/layout to be available.
 */
export function createDataGraph(container: HTMLElement, options: DataGraphOptions): DataGraph {
  // Fail fast: an invalid config must throw synchronously here, before the
  // Pixi Application is even created, rather than surfacing later as a
  // rejection of `ready`. validateConfig is idempotent — buildGraph (in the
  // `ready` IIFE below) calls it again on the same config.
  validateConfig(options.config);

  let theme: Theme = resolveTheme(options.theme);
  let metrics: NodeMetrics = DEFAULT_METRICS;
  let entityAccents = new Map<string, string>();

  const app = new Application();
  const world = new Container();
  // The semantic regime's AGGREGATED edges: the lowest layer of all, under the
  // discs they link — a stroke passing over would only thicken their outline from
  // below. Empty outside the semantic regime.
  //
  // A PERMANENT container whose children are replaced, and not a Graphics
  // reassigned like its two neighbors: it is remade on a rebuild or a change of
  // selection, never on a hover frame, so it does not need the `destroy()` +
  // `addChildAt` machinery — and avoiding it keeps the other layers' depths stable.
  const semanticEdgeLayer = new Container();
  // The aggregates: translucent envelopes behind the cards, or solid discs
  // replacing them under the semantic regime. Empty in structure view.
  let clustersGraphics = new Graphics();
  // The semantic discs' labels, ABOVE them. A separate layer and not children of
  // `clustersGraphics`: the latter is destroyed and repainted on every frame of an
  // aggregate hover, whereas a label depends on no intensity — merging them would
  // rebuild 1,300 texts per frame for an identical rendering. Same split as the
  // edges and their `edgeHitLayer`.
  const semanticLabelLayer = new Container();
  // The id -> circle lookup `rescaleSemanticLabels` needs on every scale-changed
  // frame, cached at the point `redrawSemanticLayers` already walks
  // `semanticNodesFor()` once. Rebuilding it per frame instead — the first cut of
  // this feature did, via `semanticNodesFor()` plus a fresh `Map` — means
  // reconstructing the full ~1,300-aggregate PAINT list (color/dim/hover per
  // aggregate, see `semanticNodesFor`'s doc) on essentially every tick of a
  // continuous wheel zoom, to keep three numbers. `null` outside the semantic
  // regime, where `rescaleSemanticLabels` has nothing to update anyway.
  let semanticLabelCircles: Map<string, { cx: number; cy: number; r: number }> | null = null;
  // The envelopes' grab targets, just ABOVE their visual and UNDER everything else.
  // Depth is what settles the arbitration between gestures: Pixi's hit-testing goes
  // top to bottom, so a card, an edge hit area or the overlay catches the pointer
  // before the disc, and only the void of an envelope lets it be grabbed. A layer
  // separate from the visual because the latter is destroyed and repainted on every
  // frame of a move — see `drawClusterHitAreas`.
  const clusterHitLayer = new Container();
  let edgesGraphics = new Graphics();
  // The labels of the selection's outgoing references. A SEPARATE layer and not
  // children of `edgesGraphics`: the latter is a Graphics, carrying geometry only,
  // whereas a label is a Text inside a pill. Rebuilt by `redrawEdges` — the same
  // data (the edges, the selection) governs both, and separating them would make
  // them diverge. `null` until a rebuild has happened, and at LOD 2 where there is
  // nothing to write.
  let edgeLabelsView: Container | null = null;
  // The placements that produced `edgeLabelsView`, paired with its children by
  // INDEX (`drawEdgeLabels`'s contract). Remembered because repositioning a label as
  // the camera moves requires its segment, which the rendered sub-container no
  // longer carries.
  let edgeLabels: EdgeLabelPlacement[] = [];
  const edgeHitLayer = new Container();
  const nodesLayer = new Container();
  // The remainder tokens: one per block of unrevealed card children, laid in the
  // column at the place those cards would occupy. They are renderer
  // PSEUDO-ELEMENTS — never graph nodes, never ELK boxes: letting them into layout
  // would make them take part in the very computation they exist to avoid.
  //
  // A separate layer, and ABOVE the cards: their position is arithmetic and nothing
  // guarantees no card covers them (moving one card is enough), and a covered token
  // would no longer catch the click that reveals it.
  const remainderLayer = new Container();
  // The edges stay UNDER the cards, at rest: a reference often runs back to the
  // left and would cross the cards separating it from its target, which would clutter
  // the reading for no gain most of the time. The selection is what reveals it —
  // `drawSelectionOverlay` redraws the selected node's outgoing references into
  // `overlayGraphics`, the topmost layer, where they therefore pass over everything.
  let overlayGraphics = new Container();
  world.addChild(
    semanticEdgeLayer,
    clustersGraphics,
    semanticLabelLayer,
    clusterHitLayer,
    edgesGraphics,
    edgeHitLayer,
    nodesLayer,
    remainderLayer,
    overlayGraphics,
  );

  // This instance's atlas lease. Pixi atlases are global by name, hence shared
  // between instances; the registry reference-counts them and only uninstalls when
  // the last holder leaves. Without it, `destroy()` could release nothing and
  // texture memory leaked on every mount.
  const fontLease = pixiFontRegistry.lease();

  let camera: Camera | null = null;
  // THE STRUCTURE VIEW's state lives ENTIRELY in there — graph, collapse state,
  // search index, incremental engine, layout — with the machinery that has always
  // been its own: an expand pushes a subtree beside its anchor, a reveal inserts a
  // block into a column, a collapse subtracts the delta (ADR-0043). Same
  // `compute`/`publish` discipline as the two other controllers, for the same
  // reason: `opGen` stays here.
  const structureView = createStructureViewController({
    elkFactory: buildElkFactory(options.elkWorkerUrl),
  });
  // The current view. Every piece of state SPECIFIC to a view lives in that
  // view's controller; `view` stays here because it belongs to the cross-view
  // orchestration, which this file alone carries.
  let view: DataGraphView = options.view ?? "structure";
  // What `buildGraph` produced: the DOCUMENT's graph. It is the structure and
  // graph views' own graph, and the tree view's input — never what the tree
  // renders, which is `treeView.graph()`. Everything that describes the document
  // rather than a view reads it: `diagnostics()`, `refEdges()`,
  // `logicalNodeCount`.
  let sourceGraph: Graph | undefined;
  // True between crossing the threshold and the release, while a card OR an
  // aggregate envelope is being moved — the two gestures are the same from the
  // camera's point of view. One single reader: the camera, whose pan it inhibits
  // (otherwise the grabbed content would flee under the cursor at twice the
  // pointer's speed). The rest goes through `dragCard`/`dragCluster`.
  let contentDragging = false;
  // Each envelope's hover intensity, indexed by aggregate. It lives HERE and not on
  // the grab container because the container is not what paints it: the envelopes'
  // visual is a single Graphics destroyed and repainted in one block
  // (`redrawClusters`), which therefore needs to read the state of ALL the envelopes
  // on every pass. Indexed by `aggregateId` and not by container for the same reason
  // — that is the key `clustersFor()` has at hand. Cleared by
  // `redrawClusterHitAreas`, which destroys the containers feeding it (see there).
  const clusterHover = new Map<string, number>();
  // The config currently in effect — `options.config` initially, replaced by
  // whatever setData() was last called with. setData(data) (config omitted)
  // reuses this rather than re-reading options.config, so a second setData
  // without a config keeps whatever the *previous* setData installed.
  let currentConfig: DataGraphConfig = options.config;
  let currentLod: Lod = 0;
  /**
   * The LOD 1 label magnification the drawn cards were built with — `currentLod`'s
   * companion, and a rebuild trigger on exactly the same footing: when it changes,
   * every card's label changes its wrap and its truncation, so the cards on screen
   * no longer describe the camera.
   *
   * `cardLabelStepForScale` pins it to 1 outside LOD 1, which is what keeps it
   * inert at the other two levels: it can then never provoke a rebuild there.
   */
  let currentLabelStep = 1;
  let selection: Selection | null = null;
  let destroyed = false;
  // The media query watching the device pixel ratio, and its handler. Both are
  // rebuilt on each change (the threshold depends on the current ratio) and both
  // must be released by `destroy()` — they are the only listeners the async
  // initialization installs.
  let dprQuery: MediaQueryList | null = null;
  let onDprChange: () => void = () => {};
  // Bumped by every mutating operation (doExpand/doCollapse/doFocus's expand
  // cascade) before it awaits a layout; after each await the operation
  // compares its captured value against the current counter and bails if
  // some other operation ran (and thus already applied its own layout)
  // in the meantime. Without that guard, a layout resolved late overwrites
  // the active view's layout after a newer operation already mutated its
  // collapse state: the two then describe different graphs, and the canvas shows
  // positions for nodes the collapse state no longer considers visible.
  let opGen = 0;
  // BitmapText's canvas-fallback rendering path is unreliable (see draw.ts);
  // use plain Text there instead. Resolved once renderer type is known.
  let useBitmapText = true;

  // Node id -> its currently rendered container, so an expand/collapse can
  // interpolate each surviving node from its old to its new position.
  //
  // Since creation-time culling, this table NO LONGER holds all the view's cards:
  // only those that are materialized, that is, in the screen's neighborhood. All
  // its readers already tolerated that, because they all kept a branch for the
  // absent node (`applyFocusDim` skips, `positionAnimator` skips, `dragCluster`
  // tests) — the only thing that changes is that this branch is now the COMMON case
  // rather than a precaution. Whatever must see the WHOLE view reads
  // `activeView().visible()` or the positions, never this table: that is the case for
  // `stats()`, the edges and the envelopes.
  const nodeViews = new Map<NodeId, Container>();

  // The current rebuild's context, or `null` until one has happened. It is what
  // makes a card materialized after the fact identical to those `rebuild()`
  // produced — see `CardContext`.
  let cardContext: CardContext | null = null;

  // The expand/collapse transition. The table is passed AS IS and not copied:
  // `rebuild()` clears and refills it in place, and the animator must see the last
  // rebuild's containers.
  // The ticker is passed as an ACCESSOR: `app.ticker` only exists after
  // `app.init()`, and this animator is built with the instance, before that.
  const positionAnimator = createPositionAnimator({ ticker: () => app.ticker, nodeViews });

  // The search state lives ENTIRELY in there (results + cursor); this file supplies
  // it only with its points of contact with the rest of the instance. The index
  // stays here: the data pipeline is what produces it.
  const searchController = createSearchController({
    // The active view's index, or — in graph view, which has none of its own —
    // the structure view's, which covers the same source document.
    getIndex: () => activeView().searchIndex() ?? structureView.searchIndex(),
    getActiveVisible: () => activeView().visible(),
    redrawOverlay: () => redrawOverlay(),
    // `void`: `nextMatch()`/`prevMatch()` return their result without waiting for
    // the framing, which may require a cascade of expansions.
    focus: (id) => void doFocus(id),
  });

  // The graph view's state lives ENTIRELY in there (aggregate index, layout, engine
  // loaded on demand, envelope padding); this file supplies it only with its two
  // points of contact with the instance. `opGen`, the generation guards and the
  // fallback policies stay here: the race spans both views, and the controller
  // separates `compute` from `publish` precisely so they can slot in between the
  // two.
  const graphView = createGraphViewController({
    layoutOptions: options.graphLayoutOptions,
    // An accessor and not a value: `metrics` is only measured after `fontsReady`,
    // well after the controller is built.
    getMetrics: () => metrics,
    // Built at creation but CALLED only on first need: the worker is opened only by
    // the graph view's first layout.
    spawnLayoutWorker: buildGraphLayoutWorkerSpawn(options.graphLayoutWorkerUrl),
  });
  // The graph view read through the host's seam. A thin adapter beside the
  // controller, which keeps its own rich surface for everything only this view
  // has (envelopes, semantic layers, hit areas).
  const graphViewView = graphViewAsView(graphView, () => sourceGraph);

  // THE TREE VIEW's state lives ENTIRELY in there — graph, collapse state, search
  // index, layout — with a machinery of its own: a GLOBAL layout recomputed on
  // every fold gesture, no incremental deltas (ADR-0043). Same `compute`/`publish`
  // discipline as the graph view's, for the same reason: `opGen` stays here.
  const treeView = createTreeViewController({
    elkFactory: buildElkFactory(options.elkWorkerUrl),
  });

  const emitter = new Emitter<DataGraphEvents>();

  /** Recomputes the entity type → rail color table. The order comes from
   * `config.ids`'s keys: deterministic and under the config author's control,
   * unlike the order of appearance in the data. */
  function refreshEntityAccents(config: DataGraphConfig): void {
    entityAccents = entityAccentMap(Object.keys(config.ids), theme);
  }

  function accentFor(node: GraphNode): string {
    if (node.kind !== "entity") return theme.edge.contain;
    return entityAccents.get(node.entityType) ?? theme.accent.entity;
  }

  /** The controller of a view by name — the ONE switch on the view left in this
   * file, and the reason no other place has to test `view` at all. */
  function viewFor(target: DataGraphView): View {
    if (target === "graph") return graphViewView;
    if (target === "tree") return treeView;
    return structureView;
  }

  /** The controller of the view currently on screen. */
  function activeView(): View {
    return viewFor(view);
  }

  /**
   * `treeView.compute` with its fallback, the exact shape of
   * `graphView.tryCompute`: a failure returns `null` instead of propagating, and
   * what to DO with that `null` stays at the call site (fall back to the structure
   * view, or give up on the switch) — like the generation guards.
   *
   * The tree's layout goes through the same ELK as the structure view's, worker
   * URL included, so it fails in the same ways: an unrunnable worker, a
   * computation throwing. It must never reject the operation that asked for it.
   */
  async function tryComputeTree(
    source: Graph,
    config: DataGraphConfig,
    context: string,
  ): Promise<TreeViewState | null> {
    try {
      return await treeView.compute(source, config, metrics);
    } catch (err) {
      console.warn(`[datagraph] ${context}`, err);
      return null;
    }
  }

  /**
   * Computes the state of a view OTHER than the structure one, and hands back the
   * closure that PUBLISHES it — or `null` when the computation failed.
   *
   * The publication is returned rather than performed, because its moment belongs
   * to the caller: `setView` publishes as soon as its generation guard clears,
   * `setData` publishes inside the synchronous block that swaps every piece of
   * state at once. That is `graph-view.ts`'s `compute`/`publish` split (ADR-0024),
   * extended to "which view" so the dispatch on the target lives at ONE site
   * instead of once per caller.
   *
   * `reuse` only concerns the graph view's aggregate index; the tree recomputes
   * everything from the source anyway.
   */
  async function computeViewState(
    target: "tree" | "graph",
    source: Graph,
    config: DataGraphConfig,
    reuse: boolean,
    context: string,
  ): Promise<(() => void) | null> {
    if (target === "graph") {
      const state = await graphView.tryCompute(source, config, reuse, context);
      return state === null ? null : (): void => graphView.publish(state);
    }
    const state = await tryComputeTree(source, config, context);
    return state === null ? null : (): void => treeView.publish(state);
  }

  /** The graph the current view RENDERS: the source document for the structure and
   * graph views, its reference-derived tree for the tree view. Distinct from
   * `sourceGraph`, which always describes the document. */
  function activeGraph(): Graph | undefined {
    return activeView().graph();
  }

  /**
   * The current view's graph AS THE EDGE LAYERS SEE IT: the same nodes and the
   * same containment, but only the references the view actually draws.
   *
   * `draw.ts` stays pure and keeps taking a graph-like object (ADR-0006) — it is
   * given one whose `refEdges` the VIEW chose, rather than being taught which
   * references to skip. That is what lets the tree view drop the references it
   * consumed into its own hierarchy (drawing them too would lay a dashed overlay
   * exactly on top of every containment stroke) without a single conditional in
   * the drawing code, and it keeps the edges' hit areas and labels in agreement
   * with the strokes by construction: nobody can point at, or read a label for,
   * an edge that is not painted.
   *
   * The spread is rebuilt on each call — seven property copies, on a path that
   * also walks thousands of edges — and it is skipped outright when the view
   * draws every reference, which is the case of two views out of three.
   */
  function drawnGraph(): Graph | undefined {
    const graph = activeGraph();
    if (!graph) return undefined;
    const refEdges = activeView().refEdgesToDraw();
    return refEdges === graph.refEdges ? graph : { ...graph, refEdges };
  }

  /** The current view's positions. */
  function activePositions(): Map<NodeId, Rect> | undefined {
    return activeView().positions();
  }

  /**
   * The CURRENT view's policy, recomputed on every read.
   *
   * No cache: `view` changes under `setView` and under `ready` / `doSetData`'s
   * fallbacks, and a policy kept in state would be one more thing to
   * resynchronize. The object is tiny and read once per repaint, not per card.
   */
  function viewPolicy(): ViewPolicy {
    return activeView().policy(currentLod);
  }

  /**
   * How many CARDS the current view draws. Two exclusions, and both say the same
   * thing — `stats()` reports what the user can COUNT ON SCREEN (ADR-0003):
   *
   *  - an ELIDED node is visible (its row is) but is not a card, so including it
   *    would bump the counter by one per array without a single extra card
   *    appearing;
   *  - a node with NO RECT is not drawn either. The tree view's synthetic root is
   *    exactly that case: it stays in the model, because the collapse state and the
   *    search index need a node to start from, and it is deliberately dropped from
   *    the layout so that nothing paints it.
   */
  function drawnVisibleCount(): number {
    const g = activeGraph();
    const positions = activePositions();
    if (!g || !positions) return 0;
    let count = 0;
    for (const id of activeView().visible()) {
      if (!g.nodes.get(id)?.elided && positions.has(id)) count++;
    }
    return count;
  }

  /** The selected NODE's id, or `null` — including when an aggregate is what is
   * selected. Everything that only knows the node selection goes through this
   * window: the public API, the `"select"` event and `drawSelectionOverlay`. */
  function selectedNodeId(): NodeId | null {
    return selection?.kind === "node" ? selection.id : null;
  }

  /**
   * The selected aggregate. Resolving against the current index — and the fact that
   * it is redone on every read — belongs to the controller; what stays here is the
   * one thing it does not know, the selection.
   */
  function selectedAggregate(): Aggregate | undefined {
    if (selection?.kind !== "cluster") return undefined;
    return graphView.aggregateOf(selection.aggregateId);
  }

  /**
   * The set of ids `drawEdges` keeps at full opacity.
   *
   * For a card, it is the SINGLETON of its id: the rendering is then exactly the
   * pre-aggregate-selection one, edge for edge. For an aggregate, it is its MEMBERS,
   * and not the wider set the cards use (`clusterRelatedIds`): an edge is full as
   * soon as it touches the block, so the internal and the crossing ones are, while
   * an edge between two outside neighbors recedes — it says nothing about the
   * designated block.
   */
  function edgeFocusIds(): ReadonlySet<NodeId> | null {
    if (selection === null) return null;
    if (selection.kind === "node") return new Set([selection.id]);
    return selectedAggregate()?.memberIds ?? null;
  }

  /**
   * The envelopes to paint: empty in structure view.
   *
   * Everything that resolves against layout and the index belongs to the
   * controller; what stays here is what it does not own — the current view, the
   * selection, the hover, and the theme's palette.
   */
  function clustersFor(): ClusterPaint[] {
    // The guard on layout holds in the controller, which returns an empty array
    // until something is published: only the current view is tested here.
    const graph = activeGraph();
    if (view !== "graph" || !graph) return [];
    return graphView.clustersFor(clustersForArgs(graph));
  }

  /** The aggregates ready to paint AS NODES. Same guard and same arguments as
   * `clustersFor`: it is the same object, seen under the other regime. */
  function semanticNodesFor(): SemanticNodePaint[] {
    const graph = activeGraph();
    if (view !== "graph" || !graph) return [];
    return graphView.semanticNodesFor(clustersForArgs(graph));
  }

  /** What the controller does not own and that both regimes bring it identically:
   * the theme's palette, the selection and the hover. */
  function clustersForArgs(target: Graph): ClustersForArgs {
    return {
      graph: target,
      accentFor,
      fallbackColor: theme.edge.border,
      selectedAggregateId: selection?.kind === "cluster" ? selection.aggregateId : null,
      // Computed ONCE for all the envelopes: `focusKeep()` sweeps every reference
      // in the graph, and calling it again per envelope would make the repaint
      // quadratic when it runs on every frame of a move.
      keep: focusKeep(),
      hoverOf: (aggregateId) => clusterHover.get(aggregateId) ?? 0,
    };
  }

  function viewport(): Size {
    // `screen` and `width`/`height` currently agree under `autoDensity` (the view
    // texture has its frame in logical pixels). We read `screen` anyway: it is the
    // API that explicitly means "CSS pixels", which is what the `stage` works in —
    // and therefore the one that stays correct if this Pixi implementation detail
    // changes.
    const screen = app.renderer?.screen;
    return { width: screen?.width ?? 0, height: screen?.height ?? 0 };
  }

  /**
   * The expand/collapse transition, with the one decision `positionAnimator` cannot
   * take: it is INERT in graph view.
   *
   * And that is essential: the two sets of rects passed here ALWAYS come from
   * structure view (`doExpand`/`doCollapse`), whereas `nodeViews` is then indexed by
   * entities placed at graph view's coordinates. Those ids also exist in structure
   * view's positions as soon as it has been expanded down to them: without this
   * guard, `expand()`/`collapse()` would teleport the cards into the other view's
   * frame, leaving envelopes, edges and hit areas where they are — an incoherent
   * render state until the next `rebuild()`.
   *
   * The guard stays HERE, and not in `animate.ts`: it speaks of VIEWS, which this
   * file alone knows about. The cancellation, for its part, happens in both
   * branches — an expansion requested in graph view must still cut a transition
   * still in flight, exactly as before the extraction.
   */
  function animatePositions(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
    if (view === "graph") {
      positionAnimator.cancel();
      return;
    }
    positionAnimator.animate(prevPositions, nextPositions);
  }

  function redrawOverlay(): void {
    overlayGraphics.destroy({ children: true });
    overlayGraphics = new Container();
    const graph = drawnGraph();
    const positions = activePositions();
    if (graph && positions) {
      // The NODE selection only: a selected aggregate flags itself through its
      // envelope (see `clustersFor`), not through a card's ring. Same mode
      // expression as `redrawEdges`: the highlight restyles the existing edge, so
      // it cannot ignore the style that edge has.
      overlayGraphics.addChild(
        drawSelectionOverlay(
          graph,
          positions,
          theme,
          selectedNodeId(),
          viewPolicy().edgeMode,
          viewPolicy().flow,
        ),
      );
      // Both reads of the search state go through the controller, its sole owner:
      // the visible ids to highlight, and the current result's, painted stronger
      // than the others.
      overlayGraphics.addChild(
        drawSearchHighlights(
          positions,
          theme,
          searchController.visibleMatchIds(),
          searchController.currentMatchId(),
        ),
      );
    }
    world.addChild(overlayGraphics);
  }

  /**
   * The set of cards to keep at full opacity, or `null` if there is nothing to dim.
   * A property of the GRAPH and not of layout, hence identical in both views.
   *
   * Two selection units, two rules, both delegated to `focus.ts` (pure, testable):
   * around a card, its distance-1 neighborhood; around an aggregate, its members
   * plus everything that speaks to them.
   */
  function focusKeep(): Set<NodeId> | null {
    const graph = activeGraph();
    const aggregate = selectedAggregate();
    if (aggregate) return clusterRelatedIds(graph?.refEdges ?? [], aggregate.memberIds);
    const id = selectedNodeId();
    const focused = id !== null ? graph?.nodes.get(id) : undefined;
    return relatedIds(
      graph?.refEdges ?? [],
      // The id of the NODE we found, and not the selection's: a selection that no
      // longer designates anything in the current graph has no neighborhood, hence
      // no dimming — rather than dimming everything except a ghost. Same reason for
      // the aggregate above, resolved against the current index.
      focused?.id ?? null,
      focused?.parentId ?? null,
      focused?.childIds ?? [],
    );
  }

  /**
   * Dims every card with no link to the selection, and clears the others.
   *
   * A SHARED `AlphaFilter` and not `container.alpha`: see `dimFilters()`, which
   * carries the why — a card is painted in layers, and container alpha applies layer
   * by layer, which reduced it to a slab of its accent color. The filter flattens
   * first, dims second.
   *
   * With no selection, `focusKeep()` returns `null` and everything ends up without a
   * filter — that is also the deselection path, which therefore has nothing special
   * to restore. The `filters?.length` test avoids putting a `FilterEffect` on the
   * cards that never had one, that is, on all of them, at rest.
   *
   * Nothing to do to keep dimmed cards clickable: Pixi's hit-testing is geometric
   * and ignores opacity, filters included.
   */
  function applyFocusDim(): void {
    const keep = focusKeep();
    for (const [id, nodeView] of nodeViews) {
      if (nodeView.destroyed) continue;
      if (keep !== null && !keep.has(id)) nodeView.filters = dimFilters();
      else if (nodeView.filters?.length) nodeView.filters = null;
    }
  }

  // The background layers are repainted in one block on every `rebuild()`, but ALSO,
  // for the envelopes and the edges, on every frame of a move: hence they are
  // extracted here rather than copied around. Each destroys itself before rebuilding
  // — `destroy()` detaches from the parent, hence the `addChildAt` that follows,
  // which reinserts at the intended depth. The indices are those of the world's
  // initial `addChild`, and only make sense with it in view.
  function redrawClusters(): void {
    clustersGraphics.destroy();
    const policy = viewPolicy();
    clustersGraphics =
      policy.aggregates === "disc"
        ? drawSemanticDiscs(semanticNodesFor(), theme)
        : drawClusters(clustersFor(), theme);
    // Index 1: the aggregated edges occupy the bottom (0).
    world.addChildAt(clustersGraphics, 1);
  }

  /**
   * The two semantic-regime layers that do NOT depend on hover: the aggregated
   * edges and the discs' labels.
   *
   * Separated from `redrawClusters` by their CADENCE and not by their nature: that
   * one is called again on every frame of an aggregate hover and on every frame of a
   * move, these only on a rebuild or a change of selection. Merging them would amount
   * to redoing 1,300 texts and a few thousand segments sixty times a second for an
   * identical rendering.
   *
   * Both are cleared outside the semantic regime, and not merely skipped: they are
   * what would stay painted under the cards after a zoom.
   */
  function redrawSemanticLayers(): void {
    redrawSemanticEdges();
    for (const child of semanticLabelLayer.removeChildren()) child.destroy({ children: true });
    if (viewPolicy().aggregates !== "disc") {
      semanticLabelCircles = null;
      return;
    }
    const nodes = semanticNodesFor();
    semanticLabelLayer.addChild(
      drawSemanticLabels(nodes, theme, useBitmapText, metrics, camera ? camera.scale() : 1),
    );
    // Built ONCE here, off the same `nodes` just walked to paint the labels —
    // `rescaleSemanticLabels` reads this instead of calling `semanticNodesFor()`
    // and rebuilding the Map itself on every scale-changed frame.
    semanticLabelCircles = new Map(nodes.map((n) => [n.id, n.circle]));
  }

  /**
   * Keeps every semantic label's scale and position in step with the LIVE camera,
   * without recreating anything.
   *
   * `SEMANTIC_LABEL_MIN_SCREEN_PX` (see `draw.ts`) is a SCREEN floor, so the world
   * size it demands keeps changing as the camera zooms — and LOD 2 (the semantic
   * regime) has no upper zoom-out bound: `refreshCards`'s `lodForScale(...) !==
   * currentLod` check never fires again once inside it, so nothing else
   * re-triggers `redrawSemanticLayers()` as the user keeps zooming further out.
   * Without this, a label sized right at the LOD 2 threshold would fall back
   * under the floor on any further zoom-out — reproducing exactly the smudge this
   * whole floor exists to prevent.
   *
   * Cheap by construction, the same discipline as `repositionEdgeLabels`: it
   * touches only `.scale`/`.position` on the Containers `drawSemanticLabels`
   * already created — never the text. The truncation stays the one decided at the
   * last rebuild's camera scale (rescaling only changes how BIG that surviving
   * text paints, not how much of it survives — see `semanticLabelScale`'s doc in
   * draw.ts for why the two must nonetheless agree at rebuild time) — nor the
   * aggregated edges, which stay governed by `redrawSemanticEdges`'s own cadence.
   *
   * Reads `semanticLabelCircles`, cached once per rebuild by
   * `redrawSemanticLayers`, instead of calling `semanticNodesFor()` and building a
   * fresh `Map` here: this runs on every scale-changed ticker frame during a
   * continuous wheel zoom, and `semanticNodesFor()` rebuilds the FULL paint list —
   * color, dim, hover, one new object per aggregate — for the ~1,300 aggregates of
   * the real dataset, to extract three numbers already sitting in the cache. See
   * `repositionEdgeLabels` for the same discipline applied to edge labels.
   */
  function rescaleSemanticLabels(cameraScale: number): void {
    // `children[0]`: the permanent layer holds a single child, the container
    // `drawSemanticLabels` returns, whose direct children are the labeled groups
    // (see `dragCluster`'s identical descent).
    const layer = semanticLabelLayer.children[0];
    if (!layer || !semanticLabelCircles) return;
    for (const group of layer.children) {
      const circle = semanticLabelCircles.get(group.label);
      if (!circle || !(circle.r > 0)) continue;
      const [label, badge] = group.children as [Text | BitmapText, Text | BitmapText];
      if (!label || !badge) continue;
      const geo = semanticLabelGeometry(circle, label.text, badge.text, theme, metrics, cameraScale);
      label.scale.set(geo.k);
      badge.scale.set(geo.kBadge);
      label.position.set(geo.labelX, geo.labelY);
      badge.position.set(geo.badgeX, geo.badgeY);
    }
  }

  /**
   * The aggregated edges alone, without the labels.
   *
   * Separated because moving an aggregate makes them stale on every frame — the
   * grabbed disc moves, so all its strokes change endpoint — whereas its label
   * merely follows as a block, which `dragCluster` does by translating the
   * sub-container labeled with its name. Redoing 1,300 texts per frame of the
   * gesture for the same rendering would be the regime's only real cost.
   */
  function redrawSemanticEdges(): void {
    for (const child of semanticEdgeLayer.removeChildren()) child.destroy({ children: true });
    if (viewPolicy().aggregates !== "disc") return;
    semanticEdgeLayer.addChild(
      drawSemanticEdges(
        graphView.semanticEdges(selection?.kind === "cluster" ? selection.aggregateId : null),
        theme,
        semanticEdgeUnit(),
      ),
    );
  }

  /**
   * The REFERENCE disc radius that aggregated edge widths are fractions of: the
   * MEDIAN of the painted radii.
   *
   * A quantity drawn from layout and not from the camera, and that is what avoids
   * redrawing the edges at every zoom notch: the discs grow with the view, so
   * strokes expressed as a fraction of their radius keep their RELATIVE width by
   * themselves. The median rather than the mean because the distribution of
   * aggregate sizes is very skewed — a single giant block would pull the mean up and
   * make every stroke enormous.
   */
  function semanticEdgeUnit(): number {
    // Read from the engine's SHAPES and not from the painted nodes: resolving
    // labels, colors and dimming only to keep the radii would charge a sweep over
    // the references on every frame of a move.
    const radii = graphView.clusters().map((cluster) => cluster.r).filter((r) => r > 0);
    if (radii.length === 0) return 0;
    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)]!;
  }

  function redrawEdges(): void {
    const graph = drawnGraph();
    const positions = activePositions();
    if (!graph || !positions) return;
    edgesGraphics.destroy();
    // Index 4: the bottom is taken by the aggregated edges (0), the aggregates'
    // visual (1), the semantic labels (2), then the aggregates' grab targets (3).
    // `drawEdges` dims the edges touching no id in the set, and `null` (nothing
    // selected) returns the bare drawing. At LOD 2 — hence under the semantic
    // regime — it returns an empty Graphics: references are shown there folded onto
    // the aggregates, by `redrawSemanticLayers`.
    edgesGraphics = drawEdges(
      graph,
      positions,
      theme,
      currentLod,
      viewPolicy().edgeMode,
      edgeFocusIds(),
      metrics,
      viewPolicy().flow,
    );
    world.addChildAt(edgesGraphics, 4);

    // ABOVE the cards, like the selection highlight: a label laid under the cards
    // vanished as soon as a neighbor overlapped its stretch of stroke (observed on
    // the demo), and that is precisely the information the selection is meant to
    // reveal. The reverse occlusion — the label over a card — stays rare (it lives a
    // third of the way along the link, between the cards) and transient: it leaves
    // with the selection.
    edgeLabelsView?.destroy({ children: true });
    edgeLabelsView = null;
    edgeLabels = [];
    // Nothing at LOD 2, like the edges: the text is neither legible nor worth its
    // cost there, and there is no stroke left to annotate.
    if (currentLod !== 2) {
      // `selectedNodeId()`: an AGGREGATE selection returns `null` through this
      // window, and therefore labels nothing — that is intended, an aggregate
      // designates no field a reference would leave from.
      edgeLabels = edgeLabelPlacements(graph, positions, selectedNodeId());
      edgeLabelsView = drawEdgeLabels(edgeLabels, theme, useBitmapText, metrics);
      world.addChild(edgeLabelsView);
      // Repositioned RIGHT AWAY, and not only on the ticker's next pass: otherwise
      // the first frame shows the labels at their resting fraction, even when the
      // camera is already zoomed on the target — a jump visible on every selection.
      repositionEdgeLabels();
    }
  }

  /**
   * The margin, in SCREEN pixels, between a label that has slid and the frame's
   * edge. Wide enough for the whole pill to fit inside with some air, and converted
   * to world units at the point of use: it is a perceived distance, it must not
   * dilate with zoom.
   */
  const EDGE_LABEL_VIEW_MARGIN = 48;

  /**
   * Slides each label along ITS stroke so it stays in frame — like a road name on a
   * map. Without it, zooming on a reference's target shows a stroke arriving without
   * saying which one.
   *
   * Recreates no object: only the sub-containers move. Recreating a `Text` per pan
   * frame would be this feature's real cost.
   */
  function repositionEdgeLabels(): void {
    if (!camera || !edgeLabelsView || edgeLabels.length === 0) return;
    const worldView = camera.worldViewport(viewport());
    const margin = EDGE_LABEL_VIEW_MARGIN / camera.scale();
    for (let i = 0; i < edgeLabels.length; i++) {
      const placement = edgeLabels[i]!;
      const item = edgeLabelsView.children[i];
      if (!item) continue;
      const t = labelParamInView(placement.start, placement.end, placement.fraction, worldView, margin);
      const at = edgeLabelPosition(placement.start, placement.end, t);
      item.position.set(at.x, at.y);
    }
  }

  /**
   * The envelopes' grab targets. Empty outside graph view, the only view that has
   * any.
   *
   * Unlike the envelopes' visual, this layer is NOT remade during a move: the grab
   * containers are moved (by `dragCluster`), not rebuilt — otherwise the gesture
   * would destroy the container carrying it on its first frame.
   */
  function redrawClusterHitAreas(): void {
    // The hover intensities are stored outside the containers, but they DEPEND on
    // them: the containers are what feed them, and those we destroy just below will
    // never emit the `pointerout` that would have returned their envelope to rest.
    // Without this reset, an envelope hovered at rebuild time — or on the release of
    // a card drag, which comes back through here — would stay lit forever. The
    // repaint only happens if something was actually lit: the common case pays
    // nothing.
    if (clusterHover.size > 0) {
      clusterHover.clear();
      redrawClusters();
    }
    for (const child of clusterHitLayer.removeChildren()) child.destroy();
    // `clusters()` returns an empty array until something is published: the loop
    // then does not run, and only the current view is left to test here.
    if (view !== "graph") return;
    for (const { cluster, container } of drawClusterHitAreas(graphView.clusters())) {
      const aggregate = graphView.aggregateOf(cluster.aggregateId);
      // An envelope with no aggregate has no members to carry along: painting it
      // stays correct, making it grabbable would not be. The case does not occur
      // today (the engine only publishes an envelope for an aggregate), hence
      // destroying the container rather than a guard further up.
      if (!aggregate) {
        container.destroy();
        continue;
      }
      attachDrag(container, {
        scale: () => camera?.scale() ?? 1,
        onStart: beginDrag,
        onMove: (dx, dy) =>
          dragCluster(cluster.aggregateId, cluster, aggregate.memberIds, container, dx, dy),
        // No refresh of the grab targets on release: `dragCluster` has already kept
        // this one up to date, and remaking it here would destroy the container
        // from within its own listener.
        onEnd: () => endDrag(false),
      });
      // Same complementarity as on the cards, with the same threshold: `attachTap`
      // only reacts below it, `attachDrag` only beyond. A clean click selects the
      // aggregate, a held click that moves drags it.
      //
      // An accepted consequence: a tap INSIDE an envelope but outside any card
      // already landed on this target and found nothing to do there; it now selects
      // the aggregate, which is the only thing it could mean.
      attachTap(container, () => doSelectCluster(cluster.aggregateId));
      // `attachTap` has just set `"pointer"`: we put back the open hand, which
      // states the disc's dominant gesture (see `drawClusterHitAreas`). The order
      // matters — setting it back before `attachTap` would achieve nothing.
      container.cursor = "grab";
      // Hover is set on the GRAB TARGET and not on the visual: this container
      // survives the envelope's repaints, which is precisely why it exists.
      // Listeners on the Graphics would die on the first frame of the hover they
      // just started.
      //
      // No `cancel()` at the start of an aggregate drag, unlike the cards: nothing
      // here is deformed by hover (it only changes colors), the pointer is still on
      // it during the gesture, and turning it off would falsely say we let go.
      attachHover(container, {
        ticker: app.ticker,
        isBlocked: () => contentDragging,
        onFrame: (t) => {
          clusterHover.set(cluster.aggregateId, t);
          redrawClusters();
        },
      });
      clusterHitLayer.addChild(container);
    }
  }

  /**
   * The world window the edge hit areas were built for, and the LOD they were built
   * under. `null` = nothing built. See `redrawEdgeHitAreas` and `syncEdgeHitAreas`.
   */
  let edgeHitWindow: Rect | null = null;
  let edgeHitLod: Lod | null = null;

  /** The edges' hit areas. Deliberately ABSENT from a card's move loop: they are
   * thick polygons, one per edge, and remaking them every frame would cost dearly
   * for a target that cannot be aimed at anyway while a button is held. They are
   * therefore brought up to date on release.
   *
   * THIS LAYER IS THE SCENE'S MOST EXPENSIVE, by far. Measured on 6,251 cards and
   * 28,685 references: removing it takes a resting frame in graph view from
   * ~1,850 ms to ~480 ms, where removing the edges' DRAWING (a single Graphics)
   * changes nothing. The reason is the number of objects — one interactive Graphics
   * PER edge, each a render batch and a hit-test candidate — and not the geometry.
   * Hence the two restrictions below, which change nothing about what is seen since
   * this layer is invisible:
   *
   *  1. NOTHING AT LOD 2. `drawEdges` draws no edge there (draw.ts): the targets
   *     would aim at strokes that do not exist, and nobody can point at what they
   *     cannot see.
   *  2. Only the edges whose segment can cross the widened window. A target off
   *     screen is unreachable. `syncEdgeHitAreas` remakes the layer when the camera
   *     leaves the window it was built for.
   */
  function redrawEdgeHitAreas(): void {
    for (const child of edgeHitLayer.removeChildren()) child.destroy();
    edgeHitWindow = null;
    edgeHitLod = currentLod;
    const graph = drawnGraph();
    const positions = activePositions();
    if (!graph || !positions) return;
    if (currentLod === 2) return;
    const built = camera ? inflateRect(camera.worldViewport(viewport()), PREFETCH_MARGIN) : null;
    for (const hit of drawEdgeHitAreas(graph, positions, built)) {
      attachTap(hit.graphics, () => followRef(hit.edge));
      edgeHitLayer.addChild(hit.graphics);
    }
    edgeHitWindow = built;
  }

  /**
   * Remakes the edge hit areas when the camera has left the window they were built
   * for.
   *
   * The trigger is CONTAINMENT and not a distance: as long as the window to paint
   * stays inside the last layer's, every reachable edge already has its target, and
   * there is nothing to redo. Since the built window is one screen wider on each
   * side, the camera has to move nearly a full screen to pay for a rebuild — the
   * everyday pan pays for none.
   */
  function syncEdgeHitAreas(paint: Rect | null): void {
    // LOD change: the previous LOD's targets no longer aim at the same strokes (and
    // at LOD 2, at none at all).
    if (edgeHitLod !== currentLod) {
      redrawEdgeHitAreas();
      return;
    }
    // At LOD 2 there is nothing to keep up to date, and a layer built WITHOUT a
    // camera already contains them all.
    if (currentLod === 2 || edgeHitWindow === null) return;
    if (paint !== null && rectContains(edgeHitWindow, paint)) return;
    redrawEdgeHitAreas();
  }

  /** The two ends common to every move, card or aggregate. */
  function beginDrag(): void {
    contentDragging = true;
    // An expansion transition still in flight would reposition the cards on every
    // frame, competing with the pointer: the user's gesture has the last word.
    positionAnimator.cancel();
  }

  /** `refreshClusterHits`: to pass when the gesture may have DEFORMED an envelope,
   * that is, after a card move, which recomputes its circle. An aggregate move, for
   * its part, translates its grab target as the gesture goes and must most
   * definitely not rebuild it from within its own listener. */
  function endDrag(refreshClusterHits: boolean): void {
    contentDragging = false;
    redrawEdgeHitAreas();
    if (refreshClusterHits && view === "graph") redrawClusterHitAreas();
  }

  /**
   * One frame of an aggregate move: the disc and all its cards follow the pointer
   * as a block, without deforming.
   *
   * The grab target is moved along with them rather than remade: it is what carries
   * the listeners of the gesture in flight, and rebuilding it would kill the gesture
   * outright. Same absence of persistence as for a card — the next re-layout
   * overwrites these coordinates.
   */
  function dragCluster(
    aggregateId: string,
    cluster: { cx: number; cy: number; r: number },
    memberIds: Set<NodeId>,
    hit: Container,
    dxWorld: number,
    dyWorld: number,
  ): void {
    const positions = activePositions();
    if (!positions) return;
    translateCluster(cluster, memberIds, positions, dxWorld, dyWorld);
    for (const memberId of memberIds) {
      const rect = positions.get(memberId);
      const nodeView = nodeViews.get(memberId);
      if (rect && nodeView) nodeView.position.set(rect.x, rect.y);
    }
    hit.position.set(cluster.cx, cluster.cy);
    redrawClusters();
    // Under the semantic regime, the grabbed disc's label FOLLOWS as a block rather
    // than being remade: the gesture is RIGID, so the text has neither to be
    // re-truncated nor to change scale — exactly the reasoning that translates the
    // envelope instead of recomputing it. The aggregated edges, for their part, all
    // change endpoints and do have to be redrawn. Both are no-ops outside the
    // semantic regime, where the layers are empty.
    // `children[0]`: the permanent layer holds a single child, the container
    // `drawSemanticLabels` returns, whose direct children are the labeled groups.
    // Searching from the layer itself would find nothing — Pixi's label search does
    // not descend a level by default.
    const labelGroup = semanticLabelLayer.children[0]?.getChildByLabel(aggregateId);
    if (labelGroup) labelGroup.position.set(labelGroup.x + dxWorld, labelGroup.y + dyWorld);
    redrawSemanticEdges();
    redrawEdges();
    redrawOverlay();
  }

  /**
   * One frame of a card move with the mouse: the card's position in the current
   * layout follows the pointer, and everything depending on it is repainted.
   *
   * The positions are mutated IN PLACE in the current layout — whichever view
   * controller published it — with no persistence at all: the next re-layout
   * (expand, collapse, `setData`, view switch) takes over and overwrites these
   * coordinates. That is a choice, not an oversight — a move here is a reading
   * gesture ("get this card out of my way"), not an edit of the layout.
   *
   * `rebuild()` is NOT called: it would destroy and recreate every card, hence the
   * container `attachDrag` is holding under the cursor. Only the position-dependent
   * layers are repainted.
   */
  function dragCard(id: NodeId, nodeView: Container, dxWorld: number, dyWorld: number): void {
    const positions = activePositions();
    const rect = positions?.get(id);
    if (!positions || !rect) return;
    rect.x += dxWorld;
    rect.y += dyWorld;
    nodeView.position.set(rect.x, rect.y);
    redrawEdges();
    // In graph view, the moved card carries its aggregate's envelope along: an
    // envelope that did not follow would leave the card floating outside, which
    // would say the opposite of what the view asserts. A card outside any aggregate
    // has no envelope — the controller simply finds none.
    if (view === "graph") {
      const owner = graphView.memberIdsContaining(id);
      if (owner) {
        recomputeClusterCircle(owner.cluster, owner.memberIds, positions, graphView.hullPadding());
        redrawClusters();
      }
    }
    redrawOverlay();
  }

  /**
   * The last counters announced through `"statschange"`, so a rebuild that
   * changes no count stays silent.
   *
   * `rebuild()` is the single emission point — every operation that changes the
   * visible set ends there, and an operation abandoned by the `opGen` guard never
   * reaches it, which is what keeps a cancelled expansion from announcing a
   * layout it rolled back. But `rebuild()` also runs on a LOD flip and on
   * `setTheme`, where nothing counted has moved: without this memo the host would
   * be woken on every zoom notch.
   *
   * `-1` is unreachable for both counters, so the FIRST rebuild always emits.
   */
  let announcedStats = { logicalNodeCount: -1, visibleNodeCount: -1 };

  function emitStatsIfChanged(): void {
    const next = {
      logicalNodeCount: sourceGraph?.logicalNodeCount ?? 0,
      visibleNodeCount: drawnVisibleCount(),
    };
    if (
      next.logicalNodeCount === announcedStats.logicalNodeCount &&
      next.visibleNodeCount === announcedStats.visibleNodeCount
    ) {
      return;
    }
    announcedStats = next;
    emitter.emit("statschange", undefined);
  }

  function rebuild(): void {
    const graph = activeGraph();
    const positions = activePositions();
    if (!graph || !positions) return;
    // Any in-flight position animation is about to have its containers
    // destroyed below — cancel it first so its next tick can't run against
    // stale/destroyed Containers.
    positionAnimator.cancel();
    // Same reasoning for a move in flight, card or aggregate: the containers
    // carrying its listeners are about to be destroyed, so its `onEnd` will never
    // come. Without this reset, a wheel zoom during a drag (the ticker rebuilds on a
    // LOD change) would leave the camera's pan inhibited for the rest of the
    // session.
    contentDragging = false;
    const scale = camera ? camera.scale() : 1;
    currentLod = lodForScale(scale);
    currentLabelStep = cardLabelStepForScale(scale, theme.typography.header.size);

    for (const child of nodesLayer.removeChildren()) child.destroy({ children: true });
    nodeViews.clear();

    // The atlases must exist before `drawNode` derives their names.
    if (useBitmapText) fontLease.sync(theme);

    redrawClusters();
    redrawSemanticLayers();
    redrawClusterHitAreas();
    redrawEdges();
    redrawEdgeHitAreas();

    // The fields carrying an outgoing reference, indexed ONCE per rebuild:
    // `drawNode` needs them card by card, and re-walking `refEdges` for each would
    // make the rebuild quadratic. Both indices are filled in the SAME loop, each
    // field going into one or the other depending on whether its edge resolves: it
    // is the same information read once, not two walks to keep in agreement.
    const refFieldsByNode = new Map<NodeId, Set<string>>();
    const danglingFieldsByNode = new Map<NodeId, Set<string>>();
    for (const edge of graph.refEdges) {
      const index = edge.dangling ? danglingFieldsByNode : refFieldsByNode;
      let fields = index.get(edge.from);
      if (!fields) {
        fields = new Set();
        index.set(edge.from, fields);
      }
      fields.add(edge.field);
    }

    const visible = activeView().visible();
    // Read ONCE for the whole rebuild: `view` cannot change during the loop (no
    // `await` inside it), and every card has to be drawn under the same policy
    // anyway.
    const policy = viewPolicy();

    // The expanded arrays, to orient each token's chevron. Built once per rebuild:
    // asking the view's collapse state row by row would redo the same work once
    // per drawn token.
    const expandedArrays = new Set<NodeId>();
    for (const id of visible) {
      const arrayNode = graph.nodes.get(id);
      if (arrayNode?.elided && activeView().isExpanded(id)) expandedArrays.add(id);
    }

    // The materialization's domain, filtered here once and for all.
    // An ELIDED node has no card: it is already drawn, inline, by its parent's card.
    // The test is explicit rather than left to the absence of a rect — that would
    // mean "not laid out yet", an entirely different case.
    //
    // Under the SEMANTIC regime, an entity an aggregate claims has no card at all:
    // its disc already states it, and drawing it on top would produce the mixed
    // state this regime exists to remove. The filter is here and nowhere else —
    // `syncCards` and `ensureCard` both sweep this set only, so no materialization
    // path can bypass it. Entities OUTSIDE any aggregate, for their part, keep their
    // solid rectangle: nothing else represents them.
    const drawable = new Set<NodeId>();
    for (const id of visible) {
      const node = graph.nodes.get(id);
      if (!node || node.elided) continue;
      if (!positions.has(id)) continue;
      if (policy.cards === "unclustered" && graphView.aggregateIdOf(id) !== undefined) continue;
      drawable.add(id);
    }

    cardContext = { policy, refFieldsByNode, danglingFieldsByNode, expandedArrays, drawable };

    // And that is all: the cards are no longer built in one block here, but by the
    // materialization pass, which only creates the screen's neighborhood. It is
    // called SYNCHRONOUSLY — its `PAINT` window is not budgeted — so the first frame
    // after this rebuild shows exactly what it showed back when the loop lived here.
    syncCards();

    redrawRemainderTokens();
    redrawOverlay();
    // `applyFocusDim()` no longer belongs here: every card gets its filter at
    // creation (`createCard`), which is the only way to hold dimming for a card
    // materialized later. The function stays, for changes of selection, which do
    // have to pass again over the cards ALREADY drawn.

    // The content's extent may have just moved (an expansion, a collapse, a
    // revealed page): the camera's zoom-out floor is derived from it, not from the
    // last framing.
    refreshZoomFloor();
    emitStatsIfChanged();
  }

  /**
   * Repaints the remainder token layer from what the CURRENT VIEW placed.
   *
   * The placement itself is the view's (see `RemainderToken`): it depends on the
   * flow — under the anchor where siblings are a column, beside it where they are
   * a row — and that is exactly the kind of decision this file no longer takes.
   * What stays here is the drawing and the wiring.
   *
   * The tokens deliberately do NOT follow a card moved by hand: they are placed
   * from the last `rebuild()`'s positions and wait for the next one, a move being
   * a local gesture that changes neither the revealed pages nor the column or row
   * the hidden block will slot into.
   */
  function redrawRemainderTokens(): void {
    for (const child of remainderLayer.removeChildren()) child.destroy({ children: true });
    for (const token of activeView().remainderTokens()) {
      const view = drawRemainderToken({
        count: token.count,
        width: token.width,
        theme,
        metrics,
        useBitmapText,
      });
      view.position.set(token.x, token.y);
      // `attachTap` and not a bare `pointertap`: it does set `eventMode` and the
      // cursor, but above all it adds the threshold `attachDrag` shares — without
      // it, a camera pan started on a token would reveal a page on release, when
      // the gesture asked for was a move.
      attachTap(view, () => void doReveal(token.parentId, token.page));
      remainderLayer.addChild(view);
    }
  }

  /**
   * Builds `id`'s card and wires it: click, hover, reference underline, move,
   * dimming.
   *
   * Extracted from `rebuild()`'s loop without changing anything it produced, because
   * a card is no longer created at a single moment: it is also created as the camera
   * moves and at the request of a `select`/`focus`. Anything that set these three
   * paths apart would be a visible discrepancy on screen, hence the `CardContext` —
   * it carries exactly what the rebuild had computed once and for all.
   *
   * `keep` is the focus set of the MOMENT (see `focusKeep`): the card is born dimmed
   * if the current selection excludes it, instead of being born at full opacity and
   * waiting for a repaint that would have no reason to come.
   */
  function createCard(
    id: NodeId,
    rect: Rect,
    ctx: CardContext,
    keep: ReadonlySet<NodeId> | null,
  ): void {
    const node = activeGraph()?.nodes.get(id);
    if (!node) return;
    const { policy, refFieldsByNode, danglingFieldsByNode, expandedArrays } = ctx;
    // Elided children are excluded from the chevron (`cardChildCount`): they are not
    // what it reveals. With no collapsing, everything is expanded outright — we do
    // not even read a collapse state, which then describes another view.
    const hasChevron = policy.chevrons && node.cardChildCount > 0;
    const expanded = policy.foldable ? activeView().isExpanded(id) : true;
    const nodeView = drawNode(
      node,
      rect,
      theme,
      currentLod,
      useBitmapText,
      accentFor(node),
      metrics,
      expanded,
      hasChevron,
      // `undefined` for a node with no outgoing reference: `drawNode` then falls
      // back to its shared empty set rather than allocating one per card.
      refFieldsByNode.get(id),
      danglingFieldsByNode.get(id),
      // `null` where the view collapses nothing: the tokens stay readable but inert
      // there, like the header chevron.
      policy.expandedArrays ? expandedArrays : null,
      currentLabelStep,
    );
    nodeView.position.set(rect.x, rect.y);
    attachTap(nodeView, (event) => handleNodeTap(node, nodeView, event));

    // An array row's token answers the pointer FOR ITSELF: it is a scene object, not
    // a computed band, so `attachHover` applies to it directly — same mechanics and
    // same curve as the cards' lift, without going back through `rowIndexAt`'s row
    // arithmetic.
    //
    // Hover, and not click, is what carries the collapse affordance, and that is a
    // real constraint rather than an aesthetic choice: a click triggers a `rebuild()`
    // that rebuilds the card views, so any animation started on click would be
    // destroyed before being seen. Hover, for its part, plays out entirely on the
    // existing card.
    const tokenHovers: HoverHandle[] = [];
    if (currentLod === 0 && policy.tokenHover) {
      node.rows.forEach((row, index) => {
        if (row.valueType !== "array") return;
        const token = nodeView.getChildByLabel(`array-token:${index}`);
        if (!token) return;
        const accent = token.getChildByLabel("hover");
        tokenHovers.push(
          attachHover(token, {
            ticker: app.ticker,
            isBlocked: () => contentDragging,
            onFrame: (t) => {
              token.x = TOKEN_HOVER_SHIFT * t;
              if (accent) {
                // Visibility follows alpha: a Graphics at zero alpha stays in the
                // render pass, and keeping it hidden while it paints nothing avoids
                // that cost on every card at rest.
                accent.visible = t > 0;
                accent.alpha = t;
              }
            },
          }),
        );
      });
    }

    // A referencing value's underline, revealed on hovering ITS row: the hyperlink
    // affordance, which the tint alone does not give — a color says "this one is
    // special", an underline following the pointer says "this one answers a click".
    // `drawNode` has prepared a hidden Graphics per row concerned; all that is left
    // here is a visibility to toggle.
    const refFields = refFieldsByNode.get(id);
    const danglingFields = danglingFieldsByNode.get(id);
    let underlined: number | null = null;
    // The current index is REMEMBERED: `pointermove` arrives on every pixel, and a
    // label lookup on every event would walk all the card's children only to find,
    // almost always, the same row. We touch the display graph only on an actual
    // change of row.
    const underline = (index: number | null): void => {
      if (index === underlined) return;
      if (underlined !== null) {
        const previous = nodeView.getChildByLabel(`ref-underline:${underlined}`);
        if (previous) previous.visible = false;
      }
      if (index !== null) {
        const next = nodeView.getChildByLabel(`ref-underline:${index}`);
        if (next) next.visible = true;
      }
      underlined = index;
    };
    // Nothing to wire on a card with no outgoing reference, nor outside LOD 0 where
    // no row is rendered: `underline` stays a no-op there, which leaves the move's
    // `onStart` below unconditional.
    if (refFields && currentLod === 0) {
      nodeView.on("pointermove", (event: FederatedPointerEvent) => {
        // During a move, the pointer no longer DESIGNATES a row, it holds the card:
        // underlining beneath it would promise a click the gesture in flight will
        // not perform.
        if (contentDragging) {
          underline(null);
          return;
        }
        const index = rowIndexAt(nodeView, node, event);
        const row = index === null ? undefined : node.rows[index];
        // A BROKEN reference is excluded explicitly, even though `drawNode` prepared
        // no Graphics for it: without this filter, the row would be remembered as
        // "underlined" and the next change of row would go and turn off an underline
        // that does not exist.
        const underlinable =
          row !== undefined && refFields.has(row.key) && !(danglingFields?.has(row.key) ?? false);
        underline(underlinable ? index : null);
      });
      nodeView.on("pointerout", () => underline(null));
    }
    // The hover "lift": the card grows by `HOVER_LIFT` AROUND ITS CENTER. Pixi puts
    // a container's origin at the top left, so a plain scale would push it towards
    // the bottom-right; the position is offset by half the growth to compensate.
    // That offset stays LOCAL to this callback: layout's rect keeps the top-left
    // convention `dragCard`, `dragCluster` and `animatePositions` follow.
    //
    // The rect is RE-READ every frame rather than captured: a move mutates it in
    // place, and a frozen copy would bring the card back to its starting point on
    // the first hover after the gesture.
    const hover = attachHover(nodeView, {
      ticker: app.ticker,
      // During a move, the grabbed card must stay exactly under the pointer:
      // growing it would make it come off the cursor.
      isBlocked: () => contentDragging,
      onFrame: (t) => {
        const live = activePositions()?.get(id);
        if (!live) return;
        const scale = 1 + HOVER_LIFT * t;
        nodeView.scale.set(scale);
        nodeView.position.set(
          live.x - ((scale - 1) * live.width) / 2,
          live.y - ((scale - 1) * live.height) / 2,
        );
      },
    });
    // The two wirings are complementary and not competing: they share the same
    // threshold, `attachTap` only reacts below it and `attachDrag` only beyond (see
    // `drag.ts`). A click selects, collapses or follows a reference; a held click
    // that moves drags the card.
    attachDrag(nodeView, {
      scale: () => camera?.scale() ?? 1,
      onStart: () => {
        // Hover is cancelled BEFORE the gesture takes over: otherwise it would leave
        // the card at a scale and an offset `dragCard` knows nothing about, and the
        // card would follow the pointer with a half-growth bias for the whole rest
        // of the gesture. `isBlocked` is not enough — it prevents a hover from
        // STARTING, not one already there from staying painted.
        hover.cancel();
        // Same reason, and same moment, for the underline and for the tokens:
        // another gesture takes over, and the affordance of a click that will not
        // happen must disappear WITH it, not at the next `pointermove`. A token left
        // shifted by 2 px would follow the card for the whole gesture.
        underline(null);
        for (const tokenHover of tokenHovers) tokenHover.cancel();
        beginDrag();
      },
      onMove: (dx, dy) => dragCard(id, nodeView, dx, dy),
      // `true`: moving a card has reshaped its aggregate's circle, so that
      // aggregate's grab area is stale. Remaking it here is safe — it does not touch
      // the card's container, which carries the gesture now ending.
      onEnd: () => endDrag(true),
    });
    // Dimming is set AT CREATION: a card born outside a rebuild's loop has no global
    // repaint behind it to give it one. `keep === null` means "nothing selected",
    // hence nothing to dim — that is also the resting state, where no card carries a
    // filter.
    if (keep !== null && !keep.has(id)) nodeView.filters = dimFilters();
    nodesLayer.addChild(nodeView);
    nodeViews.set(id, nodeView);
  }

  /**
   * Brings the card layer into agreement with the current window: builds the ones
   * that came in, reclaims the ones that went out WIDELY.
   *
   * This is culling's second half, and the reason the `container.cullable` that
   * `drawNode` sets was not enough — two reasons, in fact. It only speaks of
   * RENDERING, whereas the cost that hurt was CREATION: 6,251 cards built at every
   * LOD threshold crossing, only a few dozen of which were on screen. And it is INERT
   * anyway as long as `CullerPlugin` is not installed on the application, which no
   * site in this package does — the flag never culled anything.
   *
   * Called every frame. The sweep is one rectangle test per card of the view, that
   * is, a few tens of microseconds for 6,000 nodes: cheaper than a spatial index to
   * keep up to date under a `dragCard` that mutates positions in place. It runs
   * UNCONDITIONALLY and not only when the camera has moved, because the cards move
   * without it too — an aggregate move brings some in and out of frame.
   */
  function syncCards(): void {
    const ctx = cardContext;
    const positions = activePositions();
    if (!ctx || !positions) return;
    // An expansion transition is in flight: its containers are at INTERMEDIATE
    // positions, which say nothing about where they will land. Deciding from them
    // would make a card vanish mid-flight. 200 ms later, the next pass brings
    // everything back into agreement.
    if (positionAnimator.isRunning()) return;

    // With no camera (before init, or after `destroy`), no window means anything: we
    // fall back to the original behavior, everything is materialized.
    const windows = cardWindowsFor(camera ? camera.worldViewport(viewport()) : null);
    const deadline = performance.now() + PREFETCH_BUDGET_MS;
    // The selected card is NEVER reclaimed: the ring and the host's detail panel
    // designate it, and seeing it vanish as you move away would be a lie about what
    // is selected.
    const selected = selectedNodeId();

    // The edges' hit targets follow the same window, but at their own cadence: they
    // are only remade when the camera leaves the one they were built for (see
    // there).
    syncEdgeHitAreas(windows.paint);

    // `focusKeep()` sweeps every reference in the graph: computed at most once per
    // pass, and only if a card is actually created.
    let keep: ReadonlySet<NodeId> | null | undefined;

    for (const id of ctx.drawable) {
      const rect = positions.get(id);
      if (!rect) continue;
      const nodeView = nodeViews.get(id);
      const materialized = nodeView !== undefined;
      const fate = cardFate(rect, windows, {
        materialized,
        // Nothing is reclaimed during a move: the grabbed container carries the
        // listeners of the gesture in flight, and its `onEnd` would never come. It
        // is under the pointer anyway, hence inside `paint` — but the guard costs
        // nothing and depends on no geometric reasoning.
        pinned: contentDragging || id === selected,
        // The clock is only read when it can serve: an already materialized card
        // consumes no budget, and `performance.now()` costs more than the rectangle
        // test preceding it.
        budgetLeft: materialized ? false : performance.now() < deadline,
      });
      if (fate === "create") {
        if (keep === undefined) keep = focusKeep();
        createCard(id, rect, ctx, keep);
      } else if (fate === "reclaim" && nodeView) {
        nodeViews.delete(id);
        nodeView.destroy({ children: true });
      }
    }
  }

  /**
   * Materializes `id`'s card there and then, wherever it is.
   *
   * This is the escape hatch of the paths that DESIGNATE a card without going
   * through the pointer — `select()`, `focus()`, search, following a reference. They
   * may aim at a card outside the window, and the camera jumping to it must find it
   * drawn on arrival.
   *
   * No effect on an id already materialized, outside the current view, or not
   * positioned.
   */
  function ensureCard(id: NodeId): void {
    const ctx = cardContext;
    if (!ctx || nodeViews.has(id) || !ctx.drawable.has(id)) return;
    const rect = activePositions()?.get(id);
    if (!rect) return;
    createCard(id, rect, ctx, focusKeep());
  }

  /**
   * Brings the cards back into agreement with the camera: a COMPLETE rebuild if the
   * LOD changed — every card then changes shape — or if the LOD 1 label crossed a
   * magnification step, which rewraps and re-truncates every label. A mere window
   * update otherwise.
   *
   * The only place that decides between the two. Having it at a single point is what
   * guarantees a camera movement never produces more than ONE rebuild: the ticker,
   * `fit()` and `doFocus` all go through here.
   *
   * `theme` is read LIVE on each call rather than closed over: `setTheme` can
   * replace the typography (`ThemeOverride` reaches it), and a step computed from
   * a stale header size would fit the label to a font it is no longer drawn in.
   */
  function refreshCards(): void {
    if (!camera) return;
    const scale = camera.scale();
    const step = cardLabelStepForScale(scale, theme.typography.header.size);
    if (lodForScale(scale) !== currentLod || step !== currentLabelStep) rebuild();
    else syncCards();
  }

  /**
   * The content's WORLD extent, or `null` before anything is laid out.
   *
   * The envelopes overflow the cards: include them, otherwise a framing taken on
   * this box would clip them. The controller does nothing until something is
   * published, which is what the guard on layout used to say.
   */
  function contentBounds(): Rect | null {
    const positions = activePositions();
    if (!positions) return null;
    const bounds = boundsOf(positions);
    if (view === "graph") graphView.extendBoundsToClusters(bounds);
    return bounds;
  }

  function doFit(): void {
    const bounds = contentBounds();
    if (!camera || !bounds) return;
    camera.fitTo(bounds, viewport());
  }

  /**
   * Hands the camera the content's current extent so its zoom-out floor follows it.
   *
   * Called from `rebuild()`, and from there only: it is the single point every
   * operation changing the visible set ends on — the same argument ADR-0030 makes
   * for `statschange`. An expansion or a revealed page grows the content WITHOUT
   * reframing (they end on `rebuild()` + an animation, never on `doFit()`), so a
   * floor refreshed inside `fitTo` alone would go on forbidding the zoom-out that
   * shows what was just revealed.
   */
  function refreshZoomFloor(): void {
    const bounds = contentBounds();
    if (!camera || !bounds) return;
    camera.updateZoomOutFloor(bounds, viewport());
  }

  /**
   * Duration of the camera's follow. Deliberately longer than `TRANSITION_MS`
   * (200 ms, the cards' own move): the two run together, and a camera arriving
   * first would show an empty area for the rest of the cards' travel.
   */
  const REVEAL_PAN_MS = 320;
  /** How far inside the edge revealed content must land, in world units. */
  const REVEAL_MARGIN = 80;

  /**
   * Brings content that just appeared into frame — and only when NONE of it is
   * already there. `revealPan` carries the whole decision; this function only
   * gathers the rectangles, which it can do because the view's layout is already
   * published by the time it runs.
   */
  function followRevealed(newIds: Iterable<NodeId>): void {
    if (!camera) return;
    const positions = activePositions();
    if (!positions) return;
    const targets: Rect[] = [];
    for (const id of newIds) {
      const rect = positions.get(id);
      if (rect) targets.push(rect);
    }
    const pan = revealPan(camera.worldViewport(viewport()), targets, REVEAL_MARGIN);
    if (pan) camera.panByWorld(pan.dx, pan.dy, REVEAL_PAN_MS);
  }

  /**
   * The index of the row under the pointer, or `null` if the pointer is on none:
   * outside LOD 0 (the only LOD that renders rows), in the header, or in the bottom
   * padding — where the click lands below the last row.
   *
   * Shared by click and hover, and the sharing itself is the point: two copies of
   * this arithmetic would drift at the first change of metric, and the card would
   * then underline one row while the click followed another — the worst of the two
   * faults, since the affordance would lie about what the gesture will do.
   */
  function rowIndexAt(
    nodeView: Container,
    node: GraphNode,
    event: FederatedPointerEvent,
  ): number | null {
    if (currentLod !== 0) return null;
    const local = nodeView.toLocal(event.global);
    if (local.y < metrics.headerHeight) return null;
    const index = Math.floor((local.y - metrics.headerHeight) / metrics.rowHeight);
    return index < node.rows.length ? index : null;
  }

  /** Header click on a node with children toggles expand/collapse; a header
   * click on a childless node, or a body click that isn't a ref-field row,
   * selects the node; a click on a row backed by an outgoing ref edge
   * follows that reference. Only meaningful at LOD 0 (the only LOD that
   * renders a header/rows distinction) — anywhere else, tapping the node
   * just selects it.
   *
   * In graph view, no header click collapses anything: everything is always visible
   * there, so the header selects just like the body. The rest (rows, references) is
   * identical. */
  function handleNodeTap(node: GraphNode, nodeView: Container, event: FederatedPointerEvent): void {
    const graph = activeGraph();
    if (!graph) return;
    if (currentLod === 0) {
      const policy = viewPolicy();
      const local = nodeView.toLocal(event.global);
      if (local.y < metrics.headerHeight) {
        if (policy.foldable && node.cardChildCount > 0) {
          toggleExpand(node.id);
          return;
        }
      } else {
        const rowIndex = rowIndexAt(nodeView, node, event);
        const row = rowIndex === null ? undefined : node.rows[rowIndex];
        if (row) {
          // An array row's token collapses the node it represents, never the one
          // carrying it. No collision possible with following a reference: a
          // referencing row is scalar by construction. Where the view collapses
          // nothing, the click falls back to selection, as the header already does.
          if (row.valueType === "array" && policy.foldable) {
            toggleExpand(row.arrayId);
            return;
          }
          const edge = graph.refEdges.find((e) => e.from === node.id && e.field === row.key);
          if (edge) {
            followRef(edge);
            return;
          }
        }
      }
    }
    doSelect(node.id);
  }

  function toggleExpand(id: NodeId): void {
    if (activeView().isExpanded(id)) void doCollapse(id);
    else void doExpand(id);
  }

  /**
   * The generation guard, as the views see it (`View`'s `stale`).
   *
   * `opGen` stays HERE, with the orchestrator (ADR-0009/0024): the race spans the
   * views — a `setView` bumps the counter under an `expand()` in flight — so no
   * view can own the counter. What a view does own is the ROLLBACK, because it is
   * the only thing that knows what it mutated. Hence this closure, handed over at
   * each gesture: the host says "you have been superseded", the view decides what
   * to undo.
   */
  function staleSince(gen: number): () => boolean {
    return () => destroyed || gen !== opGen;
  }

  /**
   * Everything a fold gesture ends on, once the view has published: the cards are
   * rebuilt, the surviving ones interpolated from their old positions, and the
   * camera brings what just appeared into frame.
   *
   * A `null` step means the view did nothing — it was already in that state, or
   * the gesture was superseded and rolled back. Nothing to repaint either way.
   */
  function applyFoldStep(step: FoldStep | null): void {
    if (!step) return;
    rebuild();
    const positions = activePositions();
    if (positions) animatePositions(step.prevPositions, positions);
    followRevealed(step.revealed);
  }

  async function doExpand(id: NodeId): Promise<void> {
    // Bumped BEFORE the gesture, like every mutating operation: an async path
    // already awaiting a layout must notice it has been superseded.
    const gen = ++opGen;
    applyFoldStep(await activeView().expand(id, staleSince(gen)));
  }

  /** Reveals a page of `parentId`'s card children: the remainder token's gesture. */
  async function doReveal(parentId: NodeId, page: number): Promise<void> {
    const gen = ++opGen;
    applyFoldStep(await activeView().reveal(parentId, page, staleSince(gen)));
  }

  async function doCollapse(id: NodeId): Promise<void> {
    // Bumped BEFORE the gesture, like every mutating operation: the tree view's
    // collapse awaits a global layout, so it must both notice it has been
    // superseded and supersede whatever else was in flight. The structure view's
    // collapse never suspends and can therefore never be stale.
    const gen = ++opGen;
    applyFoldStep(await activeView().collapse(id, staleSince(gen)));
  }

  /** Everything a change of selection repaints. The envelopes are part of it only in
   * graph view, the only view that has any: elsewhere `clustersFor()` returns an
   * empty array and the repaint would be a detour with no effect.
   *
   * `rebuild()` does NOT go through here and only ends on `redrawOverlay()` +
   * `applyFocusDim()`: it has just repainted envelopes and edges (along with their
   * grab areas, which THIS function does not touch) in the middle of its own pass.
   * Merging them would replay those two repaints on every rebuild. */
  function redrawSelection(): void {
    if (view === "graph") {
      redrawClusters();
      // The aggregated edges carry dimming too: without this pass, selecting an
      // aggregate would light its disc while leaving its neighbors' edges at full
      // intensity. No effect outside the semantic regime, where the layer is empty.
      //
      // `redrawSemanticEdges()` ALONE, deliberately NOT the combined
      // `redrawSemanticLayers()`: `drawSemanticLabels` never reads `dim`/`hover`
      // (see `SemanticNode`'s doc in draw.ts — labels stay in `theme.ink.primary`
      // regardless of selection), so rebuilding them here paints the exact same
      // pixels as before, at the cost of RE-TRUNCATING every label from scratch at
      // the CURRENT `camera.scale()`. That silently breaks the invariant Fix 1
      // restored the moment the current scale has drifted from the scale
      // `redrawSemanticLayers` last ran at (LOD-2 entry): `rescaleSemanticLabels`
      // had been carrying the ORIGINAL (entry-scale) text at a CONTINUOUSLY
      // rescaled size ever since, so a selection-triggered redraw here would
      // recompute a DIFFERENT budget and hand back shorter or longer text for
      // labels having nothing to do with the selection — a visible flicker on
      // every click/Escape, confirmed by screenshot diff. Since labels render
      // identically either way, skipping their rebuild here removes the only
      // other caller of `redrawSemanticLayers()` besides `rebuild()` itself
      // (a real LOD transition, where the entry scale IS the current scale by
      // construction) — the source of the drift, not a workaround for it.
      redrawSemanticEdges();
    }
    redrawOverlay();
    // The edges carry half of the dimming: they are repainted with the new
    // selection, the cards receive their filter.
    redrawEdges();
    applyFocusDim();
  }

  function doSelect(id: NodeId): void {
    const graph = activeGraph();
    if (!graph) return;
    const node = graph.nodes.get(id);
    if (!node) return;
    // Replaces any aggregate selection: the two are mutually exclusive, which the
    // type already carries.
    selection = { kind: "node", id };
    // The selection may aim at a card outside the window (public API, search,
    // following a reference): we materialize it BEFORE repainting, otherwise
    // `applyFocusDim` would find nothing to leave undimmed and the selected card
    // would stay absent until the camera reaches it. `syncCards` then keeps it
    // alive as long as it is selected.
    ensureCard(id);
    redrawSelection();
    emitter.emit("select", node);
  }

  /**
   * Selects a whole AGGREGATE: its envelope lights up and everything that does not
   * speak to it dims.
   *
   * No public event, unlike `doSelect`. `"select"` carries a `GraphNode` and an
   * aggregate is not one; emitting one on its root would lie to the host about what
   * was designated, and inventing an aggregate event would grow the API for a gesture
   * nobody has yet asked to be notified of.
   *
   * An aggregate unknown to the current index is not selectable: the guard avoids
   * installing a selection that every reader would then treat as absent.
   */
  function doSelectCluster(aggregateId: string): void {
    if (view !== "graph" || !graphView.aggregateOf(aggregateId)) return;
    selection = { kind: "cluster", aggregateId };
    redrawSelection();
  }

  /**
   * Clears the selection and undoes everything it had set: the overlay's ring and
   * highlighted references, the cards' dimming, the edges', the lit envelope.
   *
   * Emits `"deselect"` — the host has a panel open on the node that was selected,
   * and `"select"` alone never tells it when to close. The early return is what
   * keeps that event honest: with no selection there is nothing to undo, so a
   * host wiring a panel onto it never sees a phantom event at boot or on an
   * Escape pressed into the void.
   */
  function doDeselect(): void {
    if (selection === null) return;
    selection = null;
    redrawSelection();
    emitter.emit("deselect", undefined);
  }

  /** Always emits "followRef" (even for a dangling edge, so a host can show
   * feedback), but only selects+focuses the target when `edge.to` resolves —
   * a dangling edge never navigates anywhere. */
  function followRef(edge: RefEdge): void {
    emitter.emit("followRef", edge);
    if (edge.to !== null) {
      doSelect(edge.to);
      void doFocus(edge.to);
    }
  }

  /**
   * Brings `id` into frame, opening whatever the current view needs opening to
   * show it.
   *
   * `revealPathTo` carries the opening — one gesture, one generation guard, one
   * rollback — and what it opens is the view's business: a cascade of incremental
   * layouts in structure view, one global re-layout in tree view, nothing at all
   * in graph view, which hides nothing.
   *
   * Deliberately NOT `applyFoldStep`: focusing does not animate and does not
   * follow. The camera is about to jump straight onto the target
   * (`camera.centerOn`), and a `revealPan` fired just before would fight it for
   * the same viewport — so a non-null step only rebuilds.
   */
  async function doFocus(id: NodeId): Promise<void> {
    const graph = activeGraph();
    if (!graph || !camera) return;
    if (!graph.nodes.has(id)) return;

    const gen = ++opGen;
    const step = await activeView().revealPathTo(id, staleSince(gen));
    if (destroyed) return;
    if (step) rebuild();

    const positions = activePositions();
    if (!positions) return;
    // `anchorRectFor` and not `positions.get`: a host may call `focus()` on an
    // array, which has no card. Centering on its row's band does bring its token on
    // screen; `positions.get` alone would return `undefined` and the call would do
    // nothing at all, without saying so.
    const rect = anchorRectFor(graph, positions, id, metrics);
    if (rect) {
      camera.centerOn(rect, viewport(), 1);
      // The camera has just jumped: the cards must follow RIGHT AWAY, without
      // waiting for the ticker's next pass. `refreshCards` first (the jump pins the
      // scale to 1, which may change the LOD and therefore rebuild everything),
      // `ensureCard` second — in that order, otherwise the rebuild would throw away
      // the card we just guaranteed. `ensureCard` has no effect on a node with no
      // card (an array, which `anchorRectFor` can nonetheless frame through its
      // row's band).
      refreshCards();
      ensureCard(id);
    }
  }

  /** The clickable background, slipped under the world. The `hitArea` is
   * `app.renderer.screen`, which Pixi mutates IN PLACE on every resize: the area
   * therefore follows the canvas without our having to refresh it. The container
   * stays at the stage's origin, outside the world, so its local coordinates are
   * already the screen's, whatever the zoom. */
  function attachBackgroundDeselect(): void {
    // Index 0: under the world, hence consulted last by hit-testing, which walks the
    // children from topmost to bottommost.
    app.stage.addChildAt(createBackgroundHit(app.renderer.screen, doDeselect), 0);
  }

  /**
   * Is this key aimed at the GRAPH, or at something the host has focused?
   *
   * Enter on a focused `<button>` IS the browser's activation gesture: the
   * `preventDefault()` further down cancels it, and with it the keyboard
   * activation of every control of a host's chrome — in the demo `#fit`, `#tidy`,
   * `#toggle-view`, the menu and its items, `#detail-close`, the panel's reference
   * buttons, the diagnostics rows. That is the regression this predicate exists
   * for. The guard it completes enumerated `INPUT|TEXTAREA|SELECT`, and
   * enumerating tag names is precisely what let `<button>` through: the list can
   * only ever run behind the host's markup.
   *
   * Hence an ALLOWLIST on the only DOM this instance owns, `container` — which
   * holds nothing but the canvas — plus `document.body`, the target when nothing
   * is focused, the normal case for someone driving the canvas. Everything else on
   * the page belongs to the host, present or future, without this file knowing its
   * markup. The walk then covers the host that overlays its own controls INSIDE
   * the container: a focused control owns its keys wherever it sits. That walk
   * STOPS at the container instead of using `closest()`, so a host that makes the
   * container itself focusable (`tabindex`, a legitimate a11y move) does not
   * thereby kill every key of the graph.
   *
   * Escape is deliberately NOT subjected to this: it is the cascade's last level
   * (see below) and must still clear the selection from wherever focus happens to
   * be — the demo's own Escape handler moves focus onto a toolbar button before
   * the next Escape reaches here.
   */
  const INTERACTIVE_SELECTOR = "button, a[href], input, textarea, select, [tabindex], [contenteditable]";

  function keyAimedAtGraph(target: HTMLElement | null): boolean {
    if (!target) return true;
    if (target === document.body || target === container) return true;
    if (!container.contains(target)) return false;
    for (let el: HTMLElement | null = target; el !== null && el !== container; el = el.parentElement) {
      if (el.matches(INTERACTIVE_SELECTOR)) return false;
    }
    return true;
  }

  /**
   * The keyboard on the graph: Escape deselects, the arrows move the selection
   * to the nearest visible neighbour, Enter folds or unfolds the selected card.
   *
   * The listener is set on `window` and not on the canvas: the canvas does not
   * hold keyboard focus (it is not focusable), so a local listener would never
   * see the key. That also makes it the LAST link in the chain — a host chrome
   * handling Escape for its own overlays stops the event before it gets here
   * (see the demo's `chrome.ts`), which is what gives the cascade "one level at
   * a time".
   *
   * A key aimed at a text field is left alone: the arrows belong to the caret
   * whenever one is where the user is typing.
   *
   * Set SYNCHRONOUSLY, at creation, and removed by `destroy()`: setting it in the
   * async initialization would let a `destroy()` called during that initialization
   * register the listener AFTER its own removal, and leak for the rest of the
   * session. The `destroyed` guard covers the rest.
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (destroyed) return;

    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }

    if (event.key === "Escape") {
      doDeselect();
      return;
    }

    // Enter and the arrows, from here on: keys the focused element may already
    // own. See `keyAimedAtGraph`.
    if (!keyAimedAtGraph(target)) return;

    const selected = selectedNodeId();
    if (selected === null) return;

    if (event.key === "Enter") {
      // Structure view only: graph view collapses nothing, so the key would
      // promise a gesture with no effect — the same policy the chevrons follow.
      if (viewPolicy().foldable) {
        event.preventDefault();
        toggleExpand(selected);
      }
      return;
    }

    const direction =
      event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
          ? "down"
          : event.key === "ArrowLeft"
            ? "left"
            : event.key === "ArrowRight"
              ? "right"
              : null;
    if (direction === null) return;

    const positions = activePositions();
    const from = positions?.get(selected);
    if (!positions || !from) return;
    const visible = activeView().visible();
    // Only what is BOTH laid out and visible is a candidate: a position left
    // over from a collapsed subtree would move the selection onto a card that
    // is not drawn.
    const graph = activeGraph();
    const candidates: [NodeId, Rect][] = [];
    for (const [id, rect] of positions) {
      if (id !== selected && visible.has(id) && !graph?.nodes.get(id)?.elided) {
        candidates.push([id, rect]);
      }
    }
    const next = nearestInDirection(from, candidates, direction);
    if (next === null) return;
    event.preventDefault();
    doSelect(next);
    void doFocus(next);
  };
  window.addEventListener("keydown", handleKeyDown);

  const ready = (async () => {
    await app.init({
      background: theme.surface.canvas,
      resizeTo: container,
      antialias: true,
      // Without these two options, the canvas is rendered at 1x then stretched by
      // CSS on any high-density screen — the main cause of blurriness.
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    });
    if (destroyed) {
      // destroy() may have run while app.init() was still in flight — at
      // that point app.renderer didn't exist yet, so destroy()'s own
      // `if (app.renderer) app.destroy(...)` guard skipped it, leaving this
      // now-initialized Application (and its renderer/canvas) never torn
      // down. Finish the job here instead of silently leaking it.
      app.destroy(true, { children: true });
      return;
    }

    // `resolution` is decided once, at init — and `devicePixelRatio` is not a
    // constant: a browser zoom, or a window dragged onto a screen of a different
    // density, changes it under a canvas that keeps rendering at the old one.
    // The result is a permanently soft render that nothing in the app explains.
    //
    // `matchMedia` on `resolution` and not a `resize` listener: the query fires
    // exactly on the transition we care about, and it re-arms itself because the
    // threshold is rebuilt from the NEW ratio each time.
    const watchDpr = (): void => {
      if (destroyed || !app.renderer) return;
      const dpr = globalThis.devicePixelRatio ?? 1;
      const query = globalThis.matchMedia?.(`(resolution: ${dpr}dppx)`);
      if (!query) return;
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = query;
      dprQuery.addEventListener("change", onDprChange, { once: true });
    };
    onDprChange = (): void => {
      if (destroyed || !app.renderer) return;
      app.renderer.resolution = Math.min(globalThis.devicePixelRatio ?? 1, 2);
      // Pixi's `resolution` setter already cascades into a full backing-store
      // resize (ViewSystem's setter calls into CanvasSource.resize with the
      // CURRENT screen size, which rewrites canvas.width/height at the NEW
      // resolution — traced through pixi.js's ViewSystem/CanvasSource/
      // TextureSource). This call is belt-and-suspenders: it re-asserts the
      // current screen size explicitly, so the backing store keeps following
      // even if a future Pixi release stops cascading it from a bare
      // `resolution` assignment.
      app.renderer.resize(app.renderer.screen.width, app.renderer.screen.height);
      rebuild();
      watchDpr();
    };
    watchDpr();

    // `setTheme` may have run while `app.init()` was in flight: at that moment
    // `app.renderer` did not exist yet, so its background assignment was skipped (it
    // is guarded by `if (app.renderer)`). Re-applying here honors a theme installed
    // during init.
    app.renderer.background.color = theme.surface.canvas;

    // Pixi v8's BitmapText only rasterizes reliably on WebGL/WebGPU; its
    // software "canvas" fallback renderer (used when neither is available)
    // leaves BitmapText blank, so use plain Text there (see draw.ts).
    useBitmapText = app.renderer.name !== "canvas";

    container.appendChild(app.canvas);
    app.stage.addChild(world);
    attachBackgroundDeselect();
    // Panning the canvas, moving a card and moving an envelope all start from the
    // same button: only WHAT IS PRESSED separates them, and the camera has no way of
    // knowing that from its native listeners. So the renderer tells it, through this
    // predicate re-read on every movement.
    camera = new Camera(world, app.canvas, { isBlocked: () => contentDragging });

    currentConfig = options.config;
    sourceGraph = buildGraph(options.data, currentConfig);
    // The advances are measured only once. Measuring before the web font is ready
    // would freeze the fallback stack's for the whole session, and card widths would
    // vary from one load to the next. The timeout bounds the wait: a slow font
    // service must not block rendering.
    await fontsReady(theme, 1500);
    if (destroyed) return;
    metrics = measureFontMetrics(theme, DEFAULT_METRICS);
    refreshEntityAccents(currentConfig);
    // Computed then published, the same discipline as the two other controllers
    // (ADR-0024): the collapse state, the search index and the first layout appear
    // together or not at all. They used to be published as they came — the collapse
    // state and the index before awaiting the layout — so that `search()` and the
    // fold guards could read them during the initial ELK round trip; nothing can
    // be drawn in that window anyway (no positions, no `rebuild()` yet), and one
    // publication point per view is what the seam is for.
    const structureState = await structureView.compute(sourceGraph, currentConfig, metrics);
    if (destroyed) return;
    structureView.publish(structureState);

    // The structure view is ALWAYS laid out, even if the host starts in another
    // view: it is the fallback, it owns the search index the graph view borrows,
    // and it is already paid for here. The other two are only built if asked for —
    // and their failure must not reject `ready`, which would condemn every method
    // awaiting it. We fall back to the structure view, as the ELK fallback above
    // falls back to an in-process engine.
    if (view !== "structure") {
      const publish = await computeViewState(
        view,
        sourceGraph,
        currentConfig,
        true,
        `the ${view} view failed to build, falling back to the structure view`,
      );
      if (destroyed) return;
      if (publish) publish();
      else view = "structure";
    }
    if (destroyed) return;

    // FRAME BEFORE BUILDING, and the order is what matters: `doFit` reads only
    // layout's positions, never the scene, whereas `rebuild()` reads the camera's
    // scale to choose its LOD. Building first therefore drew every card at the
    // OUTGOING scale's LOD (1, hence LOD 0: full text), then the framing changed the
    // scale and the ticker noticed the LOD change and rebuilt everything — the first
    // pass entirely thrown away. The same reversal is applied in `doSetData` and in
    // `setView`.
    doFit();
    rebuild();
    // Force one immediate, synchronous frame so the first paint is
    // deterministic instead of waiting on the ticker's next scheduled tick.
    app.render();

    // The camera transform seen on the last pass. The camera emits no event (its
    // gestures are native DOM listeners), so the ticker is what notices the
    // movement — and it only works if there is something to reposition.
    let lastCameraScale = Number.NaN;
    let lastCameraX = Number.NaN;
    let lastCameraY = Number.NaN;
    // Tracked SEPARATELY from `lastCameraScale` above: that one gates on position
    // too (edge labels slide along their stroke), this one only cares about scale
    // (see `rescaleSemanticLabels`), and the two features are independently
    // absent/present (no aggregates vs. no outgoing reference on the selection).
    let lastSemanticLabelScale = Number.NaN;

    app.ticker.add(() => {
      if (destroyed || !camera) return;
      // Rebuilds on a LOD change, materializes/reclaims otherwise. This is where
      // culling follows the camera, frame by frame.
      refreshCards();

      // Outside the semantic regime the layer is empty (see `redrawSemanticLayers`)
      // and this is a no-op; inside it, a continued zoom-out never crosses another
      // LOD boundary, so THIS is what keeps the legibility floor honest past the
      // first crossing (see `rescaleSemanticLabels`).
      if (viewPolicy().aggregates === "disc") {
        const scale = camera.scale();
        if (scale !== lastSemanticLabelScale) {
          lastSemanticLabelScale = scale;
          rescaleSemanticLabels(scale);
        }
      }

      // No labels: no cost at rest, which is the most frequent state (nothing
      // selected, or a selection with no outgoing reference).
      if (!edgeLabelsView || edgeLabels.length === 0) return;
      const scale = camera.scale();
      if (scale === lastCameraScale && world.x === lastCameraX && world.y === lastCameraY) return;
      lastCameraScale = scale;
      lastCameraX = world.x;
      lastCameraY = world.y;
      repositionEdgeLabels();
    });
  })();

  /** Re-runs the full pipeline (buildGraph → `structureView.compute` → publish →
   * rebuild → fit) against new `data`, reusing
   * `currentConfig` when `configOverride` is omitted. Search/selection state
   * is reset. `structureView.compute` builds a fresh layout engine (rather than
   * reusing the published state's) so the new graph never inherits the old one's
   * `expansionDeltas`, which is keyed by NodeId (a JSON pointer) and could
   * otherwise collide with an unrelated node at the same path in the new dataset.
   *
   * Awaits `ready` first so a setData() called before initial init has
   * finished (camera/app not yet available) queues behind it instead of
   * being a silent no-op; guarded by the same opGen/destroyed machinery as
   * every other mutating operation so a concurrent setData/expand/collapse/
   * focus started after this one wins. */
  async function doSetData(data: unknown, configOverride?: DataGraphConfig): Promise<void> {
    // Fail fast, same as createDataGraph: validate a newly-passed config
    // before touching any state (including `await ready` and `opGen`) so an
    // invalid config rejects immediately instead of after a wasted
    // build/layout pass. validateConfig is idempotent — buildGraph below
    // calls it again on the same config.
    if (configOverride) validateConfig(configOverride);

    await ready;
    if (destroyed) return;
    const gen = ++opGen;

    const config = configOverride ?? currentConfig;
    const newSource = buildGraph(data, config);
    const structureState = await structureView.compute(newSource, config, metrics);

    // The CURRENT view is recomputed on the NEW graph, before publication and
    // without reusing anything indexed by node id, which describes the old one. A
    // failure here must not reject `setData` while leaving the instance half
    // replaced: we fall back to the structure view, whose layout is already ready.
    let publishActiveView: (() => void) | null = null;
    let activeViewFailed = false;
    if (view !== "structure") {
      publishActiveView = await computeViewState(
        view,
        newSource,
        config,
        // `false`: the aggregate index is keyed by node id and does not survive a
        // change of data.
        false,
        `the ${view} view failed to rebuild, falling back to the structure view`,
      );
      activeViewFailed = publishActiveView === null;
    }

    // A concurrent setData/doExpand/doCollapse/doFocus ran while we were
    // awaiting the layout (bumping opGen) and already applied its own
    // state — applying this stale one now would silently revert it. Bail.
    if (destroyed || gen !== opGen) return;

    sourceGraph = newSource;
    structureView.publish(structureState);
    currentConfig = config;
    refreshEntityAccents(config);
    // Node as well as aggregate: both are indexed by a key of the replaced graph.
    selection = null;
    // Same reason: the results in place point at nodes of the replaced graph. No
    // repaint — the `rebuild()` that closes this function takes care of it (see
    // `SearchController.reset`).
    searchController.reset();

    // The other views' states are indexed by node id: neither survives a change of
    // data. We invalidate both, then publish the one computed above — otherwise
    // `rebuild()` would paint the old graph's positions. The steps stay a
    // SYNCHRONOUS block after the generation guard, and in that order: nothing must
    // be able to slot in between the invalidation and the republication.
    graphView.invalidate();
    treeView.invalidate();
    if (activeViewFailed) view = "structure";
    publishActiveView?.();

    // Framing BEFORE rebuilding: see `ready`'s note. The new data has its own extent,
    // hence its own framing scale, hence potentially a different LOD from the
    // replaced data's.
    doFit();
    rebuild();
  }

  // After `destroy()`, every public method must be a safe no-op rather than a
  // throw: a host unmounting its component has no way of cancelling a callback
  // already scheduled, and `camera`/`app.stage` are destroyed by then.
  return {
    ready,

    fit(): void {
      if (destroyed) return;
      doFit();
      // Framing changes the scale, hence possibly the LOD and certainly the window:
      // the cards follow immediately rather than on the next frame. One rebuild at
      // worst, `refreshCards` being the sole arbiter.
      refreshCards();
    },

    async tidy(): Promise<void> {
      // A view that does not DRIFT has nothing to repair and returns `null`: the
      // graph view rearranges everything on each computation, and the tree lays
      // itself out globally on every gesture. Only the structure view, built
      // incrementally, can come out of a long session with columns a global
      // tidy-up would not have given.
      if (destroyed) return;
      const gen = ++opGen;
      const step = await activeView().tidy(staleSince(gen));
      if (!step) return;
      rebuild();
      const positions = activePositions();
      if (positions) animatePositions(step.prevPositions, positions);
      doFit();
      // Same reason as in `fit()`: the framing just changed the scale, and the
      // global arrangement does not have the same extent as the one it replaces —
      // so the LOD may flip. `refreshCards` is the sole arbiter, one rebuild at
      // worst.
      refreshCards();
    },

    async expand(id: NodeId): Promise<void> {
      if (destroyed) return;
      await doExpand(id);
    },

    async collapse(id: NodeId): Promise<void> {
      if (destroyed) return;
      await doCollapse(id);
    },

    focus(id: NodeId): void {
      if (destroyed) return;
      void doFocus(id);
    },

    select(id: NodeId): void {
      if (destroyed) return;
      doSelect(id);
    },

    search(query: string): SearchResult[] {
      if (destroyed) return [];
      return searchController.search(query);
    },
    nextMatch(): SearchResult | null {
      if (destroyed) return null;
      return searchController.step(1);
    },
    prevMatch(): SearchResult | null {
      if (destroyed) return null;
      return searchController.step(-1);
    },

    on(event: DataGraphEvent, callback: (payload: any) => void): () => void {
      if (destroyed) return () => {};
      return emitter.on(event, callback);
    },

    async setData(data: unknown, config?: DataGraphConfig): Promise<void> {
      await doSetData(data, config);
    },

    diagnostics(): Diagnostic[] {
      return sourceGraph ? sourceGraph.diagnostics : [];
    },

    stats(): { logicalNodeCount: number; visibleNodeCount: number } {
      return {
        // The DOCUMENT's node count, whatever the view: it describes the data,
        // not the folding.
        logicalNodeCount: sourceGraph?.logicalNodeCount ?? 0,
        // The count for the displayed view: entities in graph view, the drawn
        // nodes of the containment in the two folded ones.
        visibleNodeCount: drawnVisibleCount(),
      };
    },

    refEdges(from: NodeId): RefEdge[] {
      // The DOCUMENT's relations, whatever the current view draws: a host asking
      // "where does this node point" is asking about the data, not about the
      // hierarchy the tree view folded some of those references into.
      return sourceGraph ? sourceGraph.refEdges.filter((e) => e.from === from) : [];
    },

    setTheme(next: Theme | ThemeOverride): void {
      if (destroyed) return;
      // A complete `Theme` is also structurally valid as a `ThemeOverride` (every
      // `DeepPartial` group is optional, so no field can serve as a safe
      // discriminant — an override setting `entityPalette` is perfectly legal and
      // must not be mistaken for a complete theme). `resolveTheme` is idempotent on
      // a complete `Theme`: each group spreads `base` then `partial`, so passing a
      // whole `Theme` reproduces exactly that `Theme`. An accepted consequence: a
      // `byEntityType` already in place survives a theme change, since
      // `resolveTheme` carries it over from `base` when `partial` supplies none —
      // that is the intended behavior for a light/dark switch.
      theme = resolveTheme(next as ThemeOverride, theme);
      refreshEntityAccents(currentConfig);
      if (app.renderer) app.renderer.background.color = theme.surface.canvas;
      rebuild();
    },

    async setView(next: DataGraphView): Promise<void> {
      await ready;
      if (destroyed || next === view || !sourceGraph) return;

      // The index the search results in place were built on. Read BEFORE the
      // switch and compared after: the two folded views do not index the same
      // nodes — the tree drops the document's structural ones — so results
      // carried across would point at cards that no longer exist. A trip through
      // the graph view changes nothing, it borrows the structure view's index.
      const indexBefore = activeView().searchIndex() ?? structureView.searchIndex();

      // A view with nothing published has to be computed before it can be shown.
      // Same generation discipline as every other async operation in this file:
      // the computation is a dynamic import and/or an ELK layout, during which a
      // `setData` may very well land, so `view` only moves once that race is
      // settled. The structure view is always published (see `ready`), and a view
      // already published keeps its state — which is what makes a round trip
      // through the graph view leave a folded view's exploration intact.
      if (next !== "structure" && viewFor(next).positions() === undefined) {
        const gen = ++opGen;
        const publish = await computeViewState(
          next,
          sourceGraph,
          currentConfig,
          true,
          `switching to the ${next} view failed`,
        );
        // The only site that GIVES UP on failure instead of falling back to the
        // structure view: a failing computation must not leave the instance in a
        // view it cannot paint, and `view` has not moved yet.
        if (!publish) return;
        if (destroyed || gen !== opGen) return;
        publish();
      }

      view = next;
      // Re-read AFTER the switch, and through the seam: this is the incoming
      // view's graph, which is not the outgoing one's.
      const current = activeGraph();
      if (!current) return;

      if ((activeView().searchIndex() ?? structureView.searchIndex()) !== indexBefore) {
        // No repaint here: the `rebuild()` that closes this method takes care of it
        // (see `SearchController.reset`).
        searchController.reset();
      }

      if (selection?.kind === "node") {
        const from = selection.id;
        // What the INCOMING view can designate. The graph view knows only
        // entities; the tree drops the document's structural nodes; the structure
        // view holds everything. `nearestEntityAncestor` covers all three — it
        // walks up to the enclosing entity, and returns `null` when the lineage
        // holds none, which is exactly "this view cannot show what you selected".
        const kept =
          view !== "graph" && current.nodes.has(from) ? from : nearestEntityAncestor(current, from);
        // BOTH outcomes are announced, because both change what the canvas
        // designates and the host's panel has to follow either way.
        //
        // Nothing to carry over to: the selection is GONE, not carried — same
        // event as a background click, so the host's panel stops describing a card
        // that no longer exists. Carried over to another node: `select` on THAT
        // node, otherwise the panel goes on describing the node the user chose
        // while the canvas rings the entity that encloses it.
        //
        // `kept === from` emits nothing: nothing moved, and re-announcing it would
        // wake the host on every toggle.
        if (kept !== from) {
          selection = kept === null ? null : { kind: "node", id: kept };
          if (kept === null) emitter.emit("deselect", undefined);
          else {
            const node = current.nodes.get(kept);
            if (node) emitter.emit("select", node);
          }
        }
      } else if (selection?.kind === "cluster" && view !== "graph") {
        // Symmetric, and with no carry-over possible: an aggregate selection only
        // makes sense where envelopes are painted. Carrying it over to the
        // aggregate's root would designate a card the user did not choose.
        selection = null;
      }

      // Reframing is legitimate here: the views share no common frame. And it
      // happens BEFORE the rebuild — see `ready`'s note: they do not have the same
      // extent, hence not the same framing scale, hence rarely the same LOD.
      // Framing afterwards drew the 6,251 cards at the outgoing view's scale
      // before throwing it all away on the ticker's first pass.
      doFit();
      rebuild();
      app.render();
    },

    currentView(): DataGraphView {
      return view;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      camera?.dispose();
      camera = null;
      // The only global listener carried neither by the camera nor by the stage
      // (which `app.destroy` takes away): it has to be removed by hand.
      window.removeEventListener("keydown", handleKeyDown);
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = null;
      // Graph view's worker does not die with the canvas: it would outlive the
      // instance and keep grinding through seconds of layout for nobody.
      // `graphView.destroy()` terminates it and settles the computations in flight.
      graphView.destroy();
      // Releases this instance's share in the shared atlases: they are only
      // uninstalled once no other instance holds them.
      fontLease.dispose();
      emitter.clear();
      // `ready` may still be in flight (destroy() called before app.init()
      // resolved); guard so we never throw on a half-initialized renderer.
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}
