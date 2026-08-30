import { Application, Container, Graphics } from "pixi.js";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  buildGraph,
  CollapseState,
  createLayoutEngine,
  type DataGraphConfig,
  type Diagnostic,
  type Graph,
  type LayoutEngine,
  type LayoutResult,
  type NodeId,
  type Rect,
  type SearchResult,
} from "@defsquare/data-graph-core";
import { resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { Camera, type Size } from "./camera.js";
import { drawEdges, drawNode, lodForScale, type Lod } from "./draw.js";

export interface DataGraphOptions {
  data: unknown;
  config: DataGraphConfig;
  theme?: ThemeOverride;
  elkWorkerUrl?: string | URL;
}

export type DataGraphEvent = "select" | "followRef";

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
  const nodesLayer = new Container();
  world.addChild(edgesGraphics, nodesLayer);

  let camera: Camera | null = null;
  let graph: Graph | undefined;
  let collapseState: CollapseState | undefined;
  let layoutResult: LayoutResult | undefined;
  let currentLod: Lod = 0;
  let destroyed = false;
  // BitmapText's canvas-fallback rendering path is unreliable (see draw.ts);
  // use plain Text there instead. Resolved once renderer type is known.
  let useBitmapText = true;

  const listeners = new Map<DataGraphEvent, Set<(payload: any) => void>>();

  function viewport(): Size {
    return { width: app.renderer?.width ?? 0, height: app.renderer?.height ?? 0 };
  }

  function rebuild(): void {
    if (!graph || !collapseState || !layoutResult) return;
    currentLod = lodForScale(camera ? camera.scale() : 1);

    for (const child of nodesLayer.removeChildren()) child.destroy({ children: true });
    edgesGraphics.destroy();
    edgesGraphics = drawEdges(graph, layoutResult.positions, theme, currentLod);
    world.addChildAt(edgesGraphics, 0);

    const visible = collapseState.visibleNodeIds();
    for (const id of visible) {
      const node = graph.nodes.get(id);
      const rect = layoutResult.positions.get(id);
      if (!node || !rect) continue;
      const nodeView = drawNode(node, rect, theme, currentLod, useBitmapText);
      nodeView.position.set(rect.x, rect.y);
      nodesLayer.addChild(nodeView);
    }
  }

  function fitInternal(): void {
    if (!camera || !layoutResult) return;
    camera.fitTo(boundsOf(layoutResult.positions), viewport());
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

    graph = buildGraph(options.data, options.config);
    collapseState = new CollapseState(graph);

    let engine = buildLayoutEngine(options.elkWorkerUrl);
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

  return {
    ready,

    fit(): void {
      fitInternal();
    },

    // Stubbed pending Task 12 (expand/collapse) and Task 13 (search/select/focus).
    async expand(_id: NodeId): Promise<void> {},
    async collapse(_id: NodeId): Promise<void> {},
    focus(_id: NodeId): void {},
    select(_id: NodeId): void {},
    search(_query: string): SearchResult[] {
      return [];
    },
    nextMatch(): SearchResult | null {
      return null;
    },
    prevMatch(): SearchResult | null {
      return null;
    },

    on(event: DataGraphEvent, callback: (payload: any) => void): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    },

    async setData(_data: unknown, _config?: DataGraphConfig): Promise<void> {},

    diagnostics(): Diagnostic[] {
      return graph ? graph.diagnostics : [];
    },

    destroy(): void {
      destroyed = true;
      camera?.dispose();
      listeners.clear();
      // `ready` may still be in flight (destroy() called before app.init()
      // resolved); guard so we never throw on a half-initialized renderer.
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}
