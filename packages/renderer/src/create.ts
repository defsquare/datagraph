import { Application, Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  buildGraph,
  buildSearchIndex,
  CollapseState,
  createLayoutEngine,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type Diagnostic,
  type Graph,
  type GraphNode,
  type LayoutEngine,
  type LayoutResult,
  type NodeId,
  type Rect,
  type RefEdge,
  type SearchIndex,
  type SearchResult,
} from "@defsquare/data-graph-core";
import { resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { Camera, type Size } from "./camera.js";
import {
  drawEdgeHitAreas,
  drawEdges,
  drawNode,
  drawSearchHighlights,
  drawSelectionOverlay,
  lodForScale,
  type Lod,
} from "./draw.js";
import { Emitter } from "./events.js";

export interface DataGraphOptions {
  data: unknown;
  config: DataGraphConfig;
  theme?: ThemeOverride;
  elkWorkerUrl?: string | URL;
}

export type DataGraphEvent = "select" | "followRef";

type DataGraphEvents = {
  select: GraphNode;
  followRef: RefEdge;
};

export interface DataGraph {
  ready: Promise<void>;
  fit(): void;
  expand(id: NodeId): Promise<void>;
  collapse(id: NodeId): Promise<void>;
  focus(id: NodeId): void;
  select(id: NodeId): void;
  search(query: string): SearchResult[];
  nextMatch(): SearchResult | null;
  prevMatch(): SearchResult | null;
  on(event: DataGraphEvent, callback: (payload: any) => void): () => void;
  setData(data: unknown, config?: DataGraphConfig): Promise<void>;
  diagnostics(): Diagnostic[];
  destroy(): void;
}

// Movement (in screen px) tolerated between pointerdown and pointertap before
// a gesture is treated as a drag/pan rather than a click.
const TAP_THRESHOLD = 4;
// Duration of the expand/collapse node-position transition.
const TRANSITION_MS = 200;

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

function buildLayoutEngine(elkWorkerUrl: string | URL | undefined): LayoutEngine {
  if (!elkWorkerUrl) return createLayoutEngine();
  // NOTE: elk.bundled.js's `workerUrl` path only spawns a real worker when
  // the optional `web-worker` package is present (it's a Node worker_threads
  // shim, not a browser API) — under Vite/browser it silently falls back to
  // elkjs's in-process "fake worker" instead of throwing, so this is safe to
  // always attempt; see task-11-report.md for details.
  return createLayoutEngine({ elkFactory: () => new ELK({ workerUrl: String(elkWorkerUrl) }) });
}

/**
 * Wires a display object for click interaction: `eventMode = "static"`,
 * a pointer cursor, and a `pointertap` handler gated by a `TAP_THRESHOLD`px
 * movement check against the matching `pointerdown` (so a drag-to-pan
 * gesture that starts/ends over the object never fires `onTap`).
 */
function attachTap(target: Container, onTap: (event: FederatedPointerEvent) => void): void {
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
 * Creates a DataGraph instance: builds the graph from `data`/`config`,
 * initializes Pixi (async), lays out the initially-visible nodes, and
 * renders them. Returns immediately; await `.ready` before calling `fit()`
 * or other methods that need the graph/layout to be available.
 */
export function createDataGraph(container: HTMLElement, options: DataGraphOptions): DataGraph {
  const theme: Theme = resolveTheme(options.theme);

  const app = new Application();
  const world = new Container();
  let edgesGraphics = new Graphics();
  const edgeHitLayer = new Container();
  const nodesLayer = new Container();
  let overlayGraphics = new Container();
  world.addChild(edgesGraphics, edgeHitLayer, nodesLayer, overlayGraphics);

  let camera: Camera | null = null;
  let graph: Graph | undefined;
  let collapseState: CollapseState | undefined;
  let layoutResult: LayoutResult | undefined;
  let engine: LayoutEngine | undefined;
  let searchIndex: SearchIndex | undefined;
  // The config currently in effect — `options.config` initially, replaced by
  // whatever setData() was last called with. setData(data) (config omitted)
  // reuses this rather than re-reading options.config, so a second setData
  // without a config keeps whatever the *previous* setData installed.
  let currentConfig: DataGraphConfig = options.config;
  let currentLod: Lod = 0;
  let selectedId: NodeId | null = null;
  // Current search() results, and the nextMatch/prevMatch cursor into them
  // (-1 = no current match, i.e. right after a fresh search() or before any
  // search has run). Reset to [] / -1 by search("") and by setData().
  let searchResults: SearchResult[] = [];
  let searchCursor = -1;
  let destroyed = false;
  // Bumped by every mutating operation (doExpand/doCollapse/focusOn's expand
  // cascade) before it awaits a layout; after each await the operation
  // compares its captured value against the current counter and bails if
  // some other operation ran (and thus already applied its own layout)
  // in the meantime — prevents a stale async result from clobbering
  // layoutResult/collapseState sync (see task-12 fix report).
  let opGen = 0;
  // The single in-flight position-transition ticker callback, if any —
  // only one expand/collapse animation runs at a time (see cancelAnimation).
  let activeAnimTick: (() => void) | null = null;
  // BitmapText's canvas-fallback rendering path is unreliable (see draw.ts);
  // use plain Text there instead. Resolved once renderer type is known.
  let useBitmapText = true;

  // Node id -> its currently rendered container, so an expand/collapse can
  // interpolate each surviving node from its old to its new position.
  const nodeViews = new Map<NodeId, Container>();

  const emitter = new Emitter<DataGraphEvents>();

  function viewport(): Size {
    return { width: app.renderer?.width ?? 0, height: app.renderer?.height ?? 0 };
  }

  /** Unregisters the currently in-flight animation tick (if any). Must be
   * called before any rebuild that may destroy the containers a running
   * animation is holding onto — otherwise the next tick would try to set
   * `.position` on a destroyed Container (whose `.position` is null,
   * per Container.destroy()) and throw every frame forever, since the throw
   * happens before the tick's own `app.ticker.remove(tick)` call. */
  function cancelAnimation(): void {
    if (activeAnimTick) {
      app.ticker.remove(activeAnimTick);
      activeAnimTick = null;
    }
  }

  /** Animates every node present in both `prevPositions` and `nextPositions`
   * (i.e. every node that survived the expand/collapse) from its old rect to
   * its new one over `TRANSITION_MS`, via the Pixi ticker. Nodes that are
   * newly visible or about to disappear are left at whatever `rebuild()`
   * already set (their final position, or removed entirely). Only one
   * animation is ever in flight: starting a new one cancels any previous. */
  function animatePositions(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
    cancelAnimation();

    const anims: { view: Container; fromX: number; fromY: number; toX: number; toY: number }[] = [];
    for (const [id, view] of nodeViews) {
      const from = prevPositions.get(id);
      const to = nextPositions.get(id);
      if (!from || !to) continue;
      if (from.x === to.x && from.y === to.y) continue;
      view.position.set(from.x, from.y);
      anims.push({ view, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
    }
    if (anims.length === 0) return;

    const start = performance.now();
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / TRANSITION_MS);
      const eased = 1 - (1 - t) * (1 - t); // ease-out quad
      for (const a of anims) {
        // Liveness guard: a straggler tick (one that survives despite
        // cancelAnimation()'s best effort, e.g. a re-entrant rebuild from
        // within a ticker callback) must self-skip destroyed containers
        // instead of throwing on a null `.position`.
        if (a.view.destroyed) continue;
        a.view.position.set(a.fromX + (a.toX - a.fromX) * eased, a.fromY + (a.toY - a.fromY) * eased);
      }
      if (t >= 1) {
        app.ticker.remove(tick);
        if (activeAnimTick === tick) activeAnimTick = null;
      }
    };
    activeAnimTick = tick;
    app.ticker.add(tick);
  }

  /** Node ids from `searchResults` that are currently visible — the set
   * `search()`/`nextMatch()`/`prevMatch()` highlight is drawn over. Recomputed
   * on every redraw (rather than cached) since visibility can change
   * independently of the search state, e.g. an expand/collapse elsewhere. */
  function visibleMatchIds(): NodeId[] {
    if (!collapseState || searchResults.length === 0) return [];
    const visible = collapseState.visibleNodeIds();
    return searchResults.map((r) => r.nodeId).filter((id) => visible.has(id));
  }

  function redrawOverlay(): void {
    overlayGraphics.destroy({ children: true });
    overlayGraphics = new Container();
    if (graph && layoutResult) {
      overlayGraphics.addChild(drawSelectionOverlay(graph, layoutResult.positions, theme, selectedId));
      const currentId = searchResults[searchCursor]?.nodeId ?? null;
      overlayGraphics.addChild(drawSearchHighlights(layoutResult.positions, theme, visibleMatchIds(), currentId));
    }
    world.addChild(overlayGraphics);
  }

  function rebuild(): void {
    if (!graph || !collapseState || !layoutResult) return;
    // Any in-flight position animation is about to have its containers
    // destroyed below — cancel it first so its next tick can't run against
    // stale/destroyed Containers.
    cancelAnimation();
    currentLod = lodForScale(camera ? camera.scale() : 1);

    for (const child of nodesLayer.removeChildren()) child.destroy({ children: true });
    nodeViews.clear();
    for (const child of edgeHitLayer.removeChildren()) child.destroy();

    edgesGraphics.destroy();
    edgesGraphics = drawEdges(graph, layoutResult.positions, theme, currentLod);
    world.addChildAt(edgesGraphics, 0);

    for (const hit of drawEdgeHitAreas(graph, layoutResult.positions)) {
      attachTap(hit.graphics, () => followRef(hit.edge));
      edgeHitLayer.addChild(hit.graphics);
    }

    const visible = collapseState.visibleNodeIds();
    for (const id of visible) {
      const node = graph.nodes.get(id);
      const rect = layoutResult.positions.get(id);
      if (!node || !rect) continue;
      const nodeView = drawNode(node, rect, theme, currentLod, useBitmapText);
      nodeView.position.set(rect.x, rect.y);
      attachTap(nodeView, (event) => handleNodeTap(node, nodeView, event));
      nodesLayer.addChild(nodeView);
      nodeViews.set(id, nodeView);
    }

    redrawOverlay();
  }

  function fitInternal(): void {
    if (!camera || !layoutResult) return;
    camera.fitTo(boundsOf(layoutResult.positions), viewport());
  }

  /** Header click on a node with children toggles expand/collapse; a header
   * click on a childless node, or a body click that isn't a ref-field row,
   * selects the node; a click on a row backed by an outgoing ref edge
   * follows that reference. Only meaningful at LOD 0 (the only LOD that
   * renders a header/rows distinction) — anywhere else, tapping the node
   * just selects it. */
  function handleNodeTap(node: GraphNode, view: Container, event: FederatedPointerEvent): void {
    if (!graph) return;
    if (currentLod === 0) {
      const local = view.toLocal(event.global);
      if (local.y < DEFAULT_METRICS.headerHeight) {
        if (node.childIds.length > 0) {
          toggleExpand(node.id);
          return;
        }
      } else {
        const rowIndex = Math.floor((local.y - DEFAULT_METRICS.headerHeight) / DEFAULT_METRICS.rowHeight);
        const row = node.rows[rowIndex];
        if (row) {
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
    if (!collapseState) return;
    if (collapseState.isExpanded(id)) doCollapse(id);
    else void doExpand(id);
  }

  async function doExpand(id: NodeId): Promise<void> {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!graph.nodes.has(id) || collapseState.isExpanded(id)) return;
    const gen = ++opGen;
    collapseState.expand(id);
    const visible = collapseState.visibleNodeIds();
    const prevPositions = new Map(layoutResult.positions);
    const next = await engine.layoutAfterExpand(layoutResult, graph, id, visible);
    // A concurrent doCollapse/doExpand/focusOn ran while we were awaiting
    // (bumping opGen) and already applied its own layoutResult — applying
    // this stale one now would silently revert that operation. Bail.
    if (destroyed || gen !== opGen) return;
    layoutResult = next;
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  function doCollapse(id: NodeId): void {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!collapseState.isExpanded(id)) return;
    // Synchronous, but still bumps the generation counter so any in-flight
    // async doExpand/focusOn awaiting a layout notices it's been superseded.
    ++opGen;
    collapseState.collapse(id);
    const visible = collapseState.visibleNodeIds();
    const prevPositions = new Map(layoutResult.positions);
    layoutResult = engine.layoutAfterCollapse(layoutResult, graph, id, visible);
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  function doSelect(id: NodeId): void {
    if (!graph) return;
    const node = graph.nodes.get(id);
    if (!node) return;
    selectedId = id;
    redrawOverlay();
    emitter.emit("select", node);
  }

  /** Always emits "followRef" (even for a dangling edge, so a host can show
   * feedback), but only selects+focuses the target when `edge.to` resolves —
   * a dangling edge never navigates anywhere. */
  function followRef(edge: RefEdge): void {
    emitter.emit("followRef", edge);
    if (edge.to !== null) {
      doSelect(edge.to);
      void focusOn(edge.to);
    }
  }

  async function focusOn(id: NodeId): Promise<void> {
    if (!graph || !collapseState || !layoutResult || !engine || !camera) return;
    if (!graph.nodes.has(id)) return;

    if (!collapseState.visibleNodeIds().has(id)) {
      // Collect the collapsed ancestors WITHOUT mutating collapseState yet
      // (unlike expandPathTo, which mutates the whole path upfront) —
      // mutation must happen one ancestor at a time, in lockstep with the
      // layout that actually gets applied for it. Otherwise an abort
      // mid-cascade (gen mismatch) leaves collapseState reporting nodes as
      // expanded/visible that have no entry in layoutResult.positions: they
      // silently never render, and that partially-merged layoutResult goes
      // on to corrupt the next operation as its `prev`.
      const ancestors: NodeId[] = [];
      let node = graph.nodes.get(id);
      let parentId = node?.parentId ?? null;
      while (parentId !== null) {
        if (!collapseState.isExpanded(parentId)) ancestors.push(parentId);
        node = graph.nodes.get(parentId);
        parentId = node?.parentId ?? null;
      }
      ancestors.reverse(); // root-first

      const gen = ++opGen;
      for (const ancestorId of ancestors) {
        if (destroyed || gen !== opGen) return;
        collapseState.expand(ancestorId);
        const next = await engine.layoutAfterExpand(layoutResult, graph, ancestorId, collapseState.visibleNodeIds());
        if (destroyed) return;
        if (gen !== opGen) {
          // Superseded mid-cascade: revert ONLY this not-yet-applied step so
          // collapseState never gets ahead of layoutResult by more than one
          // in-flight ancestor.
          collapseState.collapse(ancestorId);
          return;
        }
        layoutResult = next;
      }
      rebuild();
    }

    const rect = layoutResult.positions.get(id);
    if (rect) camera.centerOn(rect, viewport(), 1);
  }

  /** Queries `searchIndex`, resets the nextMatch/prevMatch cursor to -1, and
   * redraws the (visible-only) search highlight. `query === ""` yields an
   * empty result set (SearchIndex.search's own behavior), which clears the
   * highlight/state as a side effect of the same codepath. */
  function doSearch(query: string): SearchResult[] {
    searchResults = searchIndex ? searchIndex.search(query) : [];
    searchCursor = -1;
    redrawOverlay();
    return searchResults;
  }

  /** Shared by nextMatch (`direction: 1`) / prevMatch (`direction: -1`):
   * advances the circular cursor, focuses (auto-expand included) the
   * resulting match and reinforces its highlight; returns null without
   * moving the cursor when there are no results.
   *
   * The `-1` sentinel (no current match yet) is handled as a special case
   * rather than folded into the generic `(cursor + direction + count) %
   * count` wrap: that formula treats -1 as "already one step before 0", so
   * stepping -1 again would land on `count - 2`, not the last result — not
   * the intended "first prevMatch from a fresh search jumps to the last
   * match" behavior. From -1, next goes to the first match (0) and prev
   * goes to the last (`count - 1`); from any real cursor position the plain
   * modular wrap applies. */
  function stepMatch(direction: 1 | -1): SearchResult | null {
    const count = searchResults.length;
    if (count === 0) return null;
    searchCursor =
      searchCursor === -1 ? (direction === 1 ? 0 : count - 1) : (searchCursor + direction + count) % count;
    const result = searchResults[searchCursor]!;
    void focusOn(result.nodeId);
    redrawOverlay();
    return result;
  }

  const ready = (async () => {
    await app.init({
      background: theme.colors.background,
      resizeTo: container,
      antialias: true,
    });
    if (destroyed) return;

    // Pixi v8's BitmapText only rasterizes reliably on WebGL/WebGPU; its
    // software "canvas" fallback renderer (used when neither is available)
    // leaves BitmapText blank, so use plain Text there (see draw.ts).
    useBitmapText = app.renderer.name !== "canvas";

    container.appendChild(app.canvas);
    app.stage.addChild(world);
    camera = new Camera(world, app.canvas);

    currentConfig = options.config;
    graph = buildGraph(options.data, currentConfig);
    collapseState = new CollapseState(graph);
    searchIndex = buildSearchIndex(graph);

    engine = buildLayoutEngine(options.elkWorkerUrl);
    const visible = collapseState.visibleNodeIds();
    try {
      layoutResult = await engine.layout(graph, visible);
    } catch (err) {
      console.warn("[data-graph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
      engine = createLayoutEngine();
      layoutResult = await engine.layout(graph, visible);
    }
    if (destroyed) return;

    rebuild();
    fitInternal();
    // Force one immediate, synchronous frame so the first paint is
    // deterministic instead of waiting on the ticker's next scheduled tick.
    app.render();

    app.ticker.add(() => {
      if (destroyed || !camera) return;
      const lod = lodForScale(camera.scale());
      if (lod !== currentLod) rebuild();
    });
  })();

  /** Re-runs the full pipeline (buildGraph → CollapseState → SearchIndex →
   * initial layout → rebuild → fit) against new `data`, reusing
   * `currentConfig` when `configOverride` is omitted. Search/selection state
   * is reset. Uses a fresh LayoutEngine (rather than reusing `engine`) so the
   * new graph never inherits the old one's `expansionDeltas` bookkeeping,
   * which is keyed by NodeId (a JSON pointer) and could otherwise collide
   * with an unrelated node at the same path in the new dataset.
   *
   * Awaits `ready` first so a setData() called before initial init has
   * finished (camera/app not yet available) queues behind it instead of
   * being a silent no-op; guarded by the same opGen/destroyed machinery as
   * every other mutating operation so a concurrent setData/expand/collapse/
   * focus started after this one wins. */
  async function doSetData(data: unknown, configOverride?: DataGraphConfig): Promise<void> {
    await ready;
    if (destroyed) return;
    const gen = ++opGen;

    const config = configOverride ?? currentConfig;
    const newGraph = buildGraph(data, config);
    const newCollapseState = new CollapseState(newGraph);
    const newSearchIndex = buildSearchIndex(newGraph);
    const visible = newCollapseState.visibleNodeIds();

    let newEngine = buildLayoutEngine(options.elkWorkerUrl);
    let newLayout: LayoutResult;
    try {
      newLayout = await newEngine.layout(newGraph, visible);
    } catch (err) {
      console.warn("[data-graph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
      newEngine = createLayoutEngine();
      newLayout = await newEngine.layout(newGraph, visible);
    }
    // A concurrent setData/doExpand/doCollapse/focusOn ran while we were
    // awaiting the layout (bumping opGen) and already applied its own
    // state — applying this stale one now would silently revert it. Bail.
    if (destroyed || gen !== opGen) return;

    graph = newGraph;
    collapseState = newCollapseState;
    searchIndex = newSearchIndex;
    engine = newEngine;
    layoutResult = newLayout;
    currentConfig = config;
    selectedId = null;
    searchResults = [];
    searchCursor = -1;

    rebuild();
    fitInternal();
  }

  return {
    ready,

    fit(): void {
      fitInternal();
    },

    async expand(id: NodeId): Promise<void> {
      await doExpand(id);
    },

    async collapse(id: NodeId): Promise<void> {
      doCollapse(id);
    },

    focus(id: NodeId): void {
      void focusOn(id);
    },

    select(id: NodeId): void {
      doSelect(id);
    },

    search(query: string): SearchResult[] {
      return doSearch(query);
    },
    nextMatch(): SearchResult | null {
      return stepMatch(1);
    },
    prevMatch(): SearchResult | null {
      return stepMatch(-1);
    },

    on(event: DataGraphEvent, callback: (payload: any) => void): () => void {
      return emitter.on(event, callback);
    },

    async setData(data: unknown, config?: DataGraphConfig): Promise<void> {
      await doSetData(data, config);
    },

    diagnostics(): Diagnostic[] {
      return graph ? graph.diagnostics : [];
    },

    destroy(): void {
      destroyed = true;
      camera?.dispose();
      emitter.clear();
      // `ready` may still be in flight (destroy() called before app.init()
      // resolved); guard so we never throw on a half-initialized renderer.
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}
