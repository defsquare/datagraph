import { Application, Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  buildAggregates,
  buildGraph,
  buildSearchIndex,
  CollapseState,
  createLayoutEngine,
  DEFAULT_METRICS,
  validateConfig,
  type AggregateIndex,
  type DataGraphConfig,
  type Diagnostic,
  type Graph,
  type GraphNode,
  type LayoutEngine,
  type LayoutResult,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
  type SearchIndex,
  type SearchResult,
} from "@defsquare/data-graph-core";
// `import type` UNIQUEMENT : ce point d'entrée porte la vue graphe et ne doit
// entrer dans le bundle que de qui y bascule réellement. Un import de type ne
// produit aucun code à l'exécution ; le seul chemin d'exécution vers le moteur
// est l'`import()` dynamique de `ensureGraphEngine`.
// `test/bundle-purity.test.ts` (côté renderer) garde ces deux lignes : le test
// du cœur ne couvre que le `dist/` du cœur, pas ce fichier-ci.
//
// Ce que ces deux lignes valent a changé d'échelle depuis le retrait de
// l'ancien moteur : 1,77 ko gzip au lieu de 180,28. Elles restent parce
// qu'elles tiennent la FORME — la vue graphe se charge à la demande par
// construction — et non plus parce qu'elles tiennent un poids. Le raisonnement
// complet est dans les deux tests de pureté.
import type {
  GraphLayoutEngine,
  GraphLayoutResult,
  TwoLevelLayoutOptions,
} from "@defsquare/data-graph-core/graph-layout";
// Relais et non réexport : `export … from "<ce specifier>"` est interdit par
// `test/bundle-purity.test.ts`, y compris sous forme type-only. Réexporter le
// symbole déjà importé ci-dessus donne le même service aux consommateurs sans
// écrire la forme interdite.
export type { TwoLevelLayoutOptions };
import { entityAccentMap, resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { pixiFontRegistry } from "./font-registry.js";
import { fontsReady, measureFontMetrics } from "./font-metrics.js";
import { Camera, type Size } from "./camera.js";
import {
  drawEdgeHitAreas,
  drawEdges,
  drawClusters,
  drawNode,
  drawSearchHighlights,
  drawSelectionOverlay,
  lodForScale,
  type Lod,
} from "./draw.js";
import { Emitter } from "./events.js";

/** `"structure"` met en page l'arbre de containment ; `"graph"` met en page les
 * entités et leurs références, groupées par agrégat. */
export type DataGraphView = "structure" | "graph";

/** L'état complet de la vue graphe, calculé d'un bloc puis publié d'un bloc :
 * l'index et la mise en page doivent toujours décrire le même graphe. */
interface GraphViewState {
  index: AggregateIndex;
  layout: GraphLayoutResult;
}

export interface DataGraphOptions {
  data: unknown;
  config: DataGraphConfig;
  theme?: ThemeOverride;
  elkWorkerUrl?: string | URL;
  /** Vue initiale. `"structure"` (défaut) met en page l'arbre de containment ;
   * `"graph"` met en page les entités et leurs références, groupées par
   * agrégat. */
  view?: DataGraphView;
  /**
   * Réglages de la mise en page de la vue graphe, passés tels quels à
   * `createTwoLevelLayoutEngine`. Le plus utile reste `clusterGap` (160 px par
   * défaut), l'écart ouvert entre deux enveloppes d'agrégats : c'est un réglage
   * d'œil, qui dépend de la densité des données et de la taille de l'écran, et
   * il doit pouvoir se régler sans toucher au cœur. Les valeurs sont lues au
   * premier passage en vue graphe ; les changer après coup demande de recréer
   * l'instance.
   *
   * CHANGEMENT D'API (0.x, sans couche de compatibilité). Ce champ portait des
   * `GraphLayoutOptions` — `{ hullPadding, separationMargin,
   * separationIterations, clusterGap }` —, il porte des `TwoLevelLayoutOptions`
   * — `{ hullPadding, cardGap, clusterGap, simIterations }`. `hullPadding` et
   * `clusterGap` gardent leur nom, leur sens et leur défaut. Les deux autres
   * disparaissent parce que la passe qu'elles réglaient n'existe plus : le
   * nouveau moteur n'a AUCUNE passe de séparation de cartes, donc pas de
   * plafond d'itérations à régler, et la marge entre cartes est posée par le
   * packing (`cardGap`, 16 px, l'ancienne valeur de `separationMargin`) au lieu
   * d'être visée par une relaxation. Passer `separationMargin` ou
   * `separationIterations` est désormais une erreur de type : c'est voulu,
   * l'objet aurait été accepté et ignoré en silence.
   */
  graphLayoutOptions?: TwoLevelLayoutOptions;
}

export type DataGraphEvent = "select" | "followRef";

type DataGraphEvents = {
  select: GraphNode;
  followRef: RefEdge;
};

export interface DataGraph {
  ready: Promise<void>;
  fit(): void;
  /** Déplie un nœud de l'arbre de containment — une opération de la VUE
   * STRUCTURE. En vue graphe elle reste sans effet visible : l'état est bien
   * mis à jour, et se verra au retour dans la vue structure, mais la vue graphe
   * ne montre pas le containment. La vue graphe, elle, ne plie rien : toutes
   * les entités y sont toujours visibles. */
  expand(id: NodeId): Promise<void>;
  /** Replie un nœud de l'arbre de containment. Même remarque que `expand`. */
  collapse(id: NodeId): Promise<void>;
  focus(id: NodeId): void;
  select(id: NodeId): void;
  search(query: string): SearchResult[];
  nextMatch(): SearchResult | null;
  prevMatch(): SearchResult | null;
  on(event: DataGraphEvent, callback: (payload: any) => void): () => void;
  setData(data: unknown, config?: DataGraphConfig): Promise<void>;
  diagnostics(): Diagnostic[];
  /** Compteurs pour une barre d'état hôte. */
  stats(): { logicalNodeCount: number; visibleNodeCount: number };
  /** Les arêtes de référence sortantes d'un nœud, pour qu'un hôte puisse
   * proposer « suivre la référence » sans connaître les internes. */
  refEdges(from: NodeId): RefEdge[];
  /** Remplace le thème et redessine, sans relancer le layout ni remesurer les
   * polices. Ceci n'est sûr que si `typography` et `fonts` ne changent pas —
   * c'est le cas pour un couple de thèmes clair/sombre, qui ne diffèrent que
   * par les couleurs. Les `NodeMetrics` sont mesurées une seule fois, à
   * l'initialisation ; changer `typography`/`fonts` ici désynchroniserait
   * ces métriques du thème effectivement dessiné (glyphes redimensionnés
   * sans que la mise en page des cartes ne bouge). Il n'existe aujourd'hui
   * aucune API pour changer la police après coup : cela demande de recréer
   * l'instance via `createDataGraph`. */
  setTheme(theme: Theme | ThemeOverride): void;
  /** Bascule de vue. Le premier passage en `"graph"` charge le moteur organique
   * à la demande (import dynamique) et calcule les agrégats, d'où la promesse.
   * La sélection est reportée sur l'entité la plus proche, car la vue graphe ne
   * connaît que des entités. */
  setView(view: DataGraphView): Promise<void>;
  currentView(): DataGraphView;
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

/**
 * Remonte `parentId` jusqu'à trouver une entité. Sert au report de sélection
 * entre les deux vues : la vue graphe ne connaît que des entités, donc quitter
 * la vue structure depuis un objet imbriqué doit sélectionner l'entité qui le
 * contient plutôt que de vider la sélection.
 */
export function nearestEntityAncestor(graph: Graph, id: NodeId): NodeId | null {
  let current = graph.nodes.get(id);
  while (current) {
    if (current.kind === "entity") return current.id;
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined;
  }
  return null;
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
  // Les enveloppes d'agrégats forment le calque le plus bas : elles passent
  // derrière les arêtes et les cartes. Vide en vue structure.
  let clustersGraphics = new Graphics();
  let edgesGraphics = new Graphics();
  const edgeHitLayer = new Container();
  const nodesLayer = new Container();
  // Les arêtes restent SOUS les cartes, au repos : une référence remonte
  // souvent vers la gauche et traverserait les cartes qui la séparent de sa
  // cible, ce qui surchargerait la lecture pour un gain nul la plupart du
  // temps. C'est la sélection qui la révèle — `drawSelectionOverlay` redessine
  // les références sortantes du nœud sélectionné dans `overlayGraphics`, le
  // calque le plus haut, où elles passent donc par-dessus tout.
  let overlayGraphics = new Container();
  world.addChild(clustersGraphics, edgesGraphics, edgeHitLayer, nodesLayer, overlayGraphics);

  // Le bail d'atlas de cette instance. Les atlas Pixi sont globaux par nom,
  // donc partagés entre instances ; le registre les compte par référence et ne
  // désinstalle qu'au départ du dernier porteur. Sans lui, `destroy()` ne
  // pouvait rien libérer et la mémoire de texture fuyait à chaque montage.
  const fontLease = pixiFontRegistry.lease();

  let camera: Camera | null = null;
  let graph: Graph | undefined;
  let collapseState: CollapseState | undefined;
  let layoutResult: LayoutResult | undefined;
  let engine: LayoutEngine | undefined;
  let searchIndex: SearchIndex | undefined;
  // Vue courante et état propre à la vue graphe. Tout reste `undefined` tant
  // qu'on n'y a pas basculé au moins une fois : un consommateur de la seule vue
  // structure ne paie ni le calcul des agrégats ni le chargement du moteur.
  let view: DataGraphView = options.view ?? "structure";
  let aggregateIndex: AggregateIndex | undefined;
  let graphLayout: GraphLayoutResult | undefined;
  let graphEngine: GraphLayoutEngine | undefined;
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

  /** Recalcule la table type d'entité → couleur de rail. L'ordre vient des
   * clés de `config.entities` : déterministe et sous contrôle de l'auteur de
   * la config, contrairement à l'ordre d'apparition dans les données. */
  function refreshEntityAccents(config: DataGraphConfig): void {
    entityAccents = entityAccentMap(Object.keys(config.entities), theme);
  }

  function accentFor(node: GraphNode): string {
    if (node.kind !== "entity") return theme.edge.contain;
    return entityAccents.get(node.entityType) ?? theme.accent.entity;
  }

  /**
   * Charge le moteur de la vue graphe à la demande.
   *
   * C'est `createTwoLevelLayoutEngine` — packing en étagères intra-agrégat,
   * puis simulation sur les agrégats devenus disques rigides —, et c'est le
   * seul depuis le retrait de `createGraphLayoutEngine` (fcose +
   * `separateOverlaps` + `separateClusters`) et de `cytoscape` avec lui. La
   * sonde qui a motivé la bascule le mesurait ×11 à ×65 plus rapide et ×2 à
   * ×5,4 plus dense, à garanties égales :
   * `docs/superpowers/spikes/2026-09-01-two-level-layout.md`. Mesuré ici, dans
   * Chromium via l'e2e, sur le jeu étendu de la démo : `setView("graph")` est
   * passé de 4 310–4 484 ms à 220–252 ms.
   *
   * L'`import()` reste dynamique. Le chunk qu'émet le build Vite de production
   * d'`apps/demo` ne pèse plus que **1,77 ko gzip** (3,75 ko bruts, contre
   * 180,28 / 577,17 avant le retrait), donc ce n'est plus le poids qui justifie
   * la paresse : c'est qu'elle est la forme par défaut de cette vue, et que
   * `setView` est asynchrone pour cette raison. Les deux tests de pureté de
   * bundle portent le raisonnement complet.
   */
  async function ensureGraphEngine(): Promise<GraphLayoutEngine> {
    if (!graphEngine) {
      const mod = await import("@defsquare/data-graph-core/graph-layout");
      graphEngine = mod.createTwoLevelLayoutEngine(options.graphLayoutOptions);
    }
    return graphEngine;
  }

  /** Index d'agrégats pour `target`. */
  function buildAggregateState(target: Graph, config: DataGraphConfig): { index: AggregateIndex } {
    return { index: buildAggregates(target, validateConfig(config)) };
  }

  /** Toutes les entités de `target` : c'est exactement ce que montre la vue
   * graphe, qui ne cache rien. L'index d'agrégats ne connaît que les entités
   * rattachées à un agrégat, donc on balaie le graphe et pas l'index — sans
   * quoi une entité isolée disparaîtrait de la vue. */
  function entityIdsOf(target: Graph): Set<NodeId> {
    const ids = new Set<NodeId>();
    for (const node of target.nodes.values()) {
      if (node.kind === "entity") ids.add(node.id);
    }
    return ids;
  }

  /**
   * Calcule l'état de la vue graphe pour `target` **sans rien publier**. Tout
   * l'état de closure dont il dépend est lu AVANT le premier `await`, et le
   * résultat n'est assigné que par `publishGraphView`, que l'appelant n'appelle
   * qu'après sa propre vérification de génération. Sans cette séparation, un
   * calcul lancé avant un `setData` et terminé après lui écraserait la mise en
   * page du nouveau graphe par des positions calculées sur l'ancien — voire
   * appellerait `layout()` sur une paire (graphe, index) dépareillée.
   *
   * `reuse` conserve l'index en place, qui ne dépend que du couple (graphe,
   * config) et n'a donc pas à être recalculé d'une bascule de vue à l'autre ;
   * un changement de données passe `false`, l'index étant indexé par id de
   * nœud.
   */
  async function computeGraphView(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
  ): Promise<GraphViewState> {
    const base = reuse && aggregateIndex ? { index: aggregateIndex } : buildAggregateState(target, config);
    const engine = await ensureGraphEngine();
    const layout = await engine.layout(target, base.index, entityIdsOf(target), metrics);
    return { ...base, layout };
  }

  /** Publie en un seul geste l'état calculé par `computeGraphView`. */
  function publishGraphView(state: GraphViewState): void {
    aggregateIndex = state.index;
    graphLayout = state.layout;
  }

  /** Les positions de la vue courante. */
  function activePositions(): Map<NodeId, Rect> | undefined {
    return view === "graph" ? graphLayout?.positions : layoutResult?.positions;
  }

  /** Les nœuds visibles de la vue courante : TOUTES les entités en vue graphe,
   * qui ne plie rien, et les nœuds dépliés de l'arbre de containment en vue
   * structure. */
  function activeVisible(): Set<NodeId> {
    if (view === "graph") return graph ? entityIdsOf(graph) : new Set();
    return collapseState?.visibleNodeIds() ?? new Set();
  }

  /** Les enveloppes à peindre : vide en vue structure. La couleur vient de
   * l'accent du type de la racine, comme pour les cartes. Cette résolution
   * reste ici, et pas dans `drawClusters` : la fonction de dessin ne prend que
   * de la donnée nue, donc elle se teste sans graphe ni index d'agrégats. */
  function clustersFor(): { circle: { cx: number; cy: number; r: number }; color: string }[] {
    if (view !== "graph" || !graph || !graphLayout) return [];
    const current = graph;
    return graphLayout.clusters.map((cluster) => {
      const root = current.nodes.get(cluster.rootId);
      return {
        circle: { cx: cluster.cx, cy: cluster.cy, r: cluster.r },
        color: root ? accentFor(root) : theme.edge.border,
      };
    });
  }

  function viewport(): Size {
    // `screen` et `width`/`height` sont actuellement d'accord sous
    // `autoDensity` (le view texture a son frame en pixels logiques). On lit
    // `screen` quand même : c'est l'API qui signifie explicitement "pixels
    // CSS", ce sur quoi travaille le `stage` — et donc celle qui reste
    // correcte si ce détail d'implémentation de Pixi change.
    const screen = app.renderer?.screen;
    return { width: screen?.width ?? 0, height: screen?.height ?? 0 };
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
   * animation is ever in flight: starting a new one cancels any previous.
   *
   * Inerte en vue graphe, et c'est essentiel : les deux jeux de rects passés
   * ici viennent TOUJOURS de la vue structure (`doExpand`/`doCollapse`), alors
   * que `nodeViews` est alors indexée par des entités posées aux coordonnées de
   * la vue graphe. Ces ids existent aussi dans les positions de la vue
   * structure dès qu'elle a été dépliée jusqu'à eux : sans cette garde,
   * `expand()`/`collapse()` téléporteraient les cartes vers le repère de
   * l'autre vue, en laissant enveloppes, arêtes et zones de clic là où elles
   * sont — un état de rendu incohérent jusqu'au prochain `rebuild()`. */
  function animatePositions(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
    cancelAnimation();
    if (view === "graph") return;

    // `nodeView`, et non `view` : ce nom désigne désormais la vue courante dans
    // tout le closure, et le masquer ici rendrait la garde ci-dessus illisible.
    const anims: { nodeView: Container; fromX: number; fromY: number; toX: number; toY: number }[] = [];
    for (const [id, nodeView] of nodeViews) {
      const from = prevPositions.get(id);
      const to = nextPositions.get(id);
      if (!from || !to) continue;
      if (from.x === to.x && from.y === to.y) continue;
      nodeView.position.set(from.x, from.y);
      anims.push({ nodeView, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
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
        if (a.nodeView.destroyed) continue;
        a.nodeView.position.set(a.fromX + (a.toX - a.fromX) * eased, a.fromY + (a.toY - a.fromY) * eased);
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
    if (searchResults.length === 0) return [];
    const visible = activeVisible();
    return searchResults.map((r) => r.nodeId).filter((id) => visible.has(id));
  }

  function redrawOverlay(): void {
    overlayGraphics.destroy({ children: true });
    overlayGraphics = new Container();
    const positions = activePositions();
    if (graph && positions) {
      overlayGraphics.addChild(drawSelectionOverlay(graph, positions, theme, selectedId));
      const currentId = searchResults[searchCursor]?.nodeId ?? null;
      overlayGraphics.addChild(drawSearchHighlights(positions, theme, visibleMatchIds(), currentId));
    }
    world.addChild(overlayGraphics);
  }

  function rebuild(): void {
    const positions = activePositions();
    if (!graph || !positions) return;
    // Any in-flight position animation is about to have its containers
    // destroyed below — cancel it first so its next tick can't run against
    // stale/destroyed Containers.
    cancelAnimation();
    currentLod = lodForScale(camera ? camera.scale() : 1);

    for (const child of nodesLayer.removeChildren()) child.destroy({ children: true });
    nodeViews.clear();
    for (const child of edgeHitLayer.removeChildren()) child.destroy();

    // Les atlas doivent exister avant que `drawNode` n'en dérive les noms.
    if (useBitmapText) fontLease.sync(theme);

    clustersGraphics.destroy();
    clustersGraphics = drawClusters(clustersFor(), theme);
    world.addChildAt(clustersGraphics, 0);

    edgesGraphics.destroy();
    // Index 1, et non 0 : le calque des enveloppes occupe désormais le fond.
    edgesGraphics = drawEdges(graph, positions, theme, currentLod, view === "graph" ? "ref" : "contain");
    world.addChildAt(edgesGraphics, 1);

    for (const hit of drawEdgeHitAreas(graph, positions)) {
      attachTap(hit.graphics, () => followRef(hit.edge));
      edgeHitLayer.addChild(hit.graphics);
    }

    const visible = activeVisible();
    for (const id of visible) {
      const node = graph.nodes.get(id);
      const rect = positions.get(id);
      if (!node || !rect) continue;
      // Le chevron n'a de sens que là où un clic d'en-tête plie quelque chose :
      // l'arbre de containment en vue structure, et RIEN en vue graphe, qui
      // montre tout et ne plie plus aucun agrégat.
      const hasChevron = view === "graph" ? false : node.childIds.length > 0;
      const expanded = view === "graph" ? true : (collapseState?.isExpanded(id) ?? false);
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
      );
      nodeView.position.set(rect.x, rect.y);
      attachTap(nodeView, (event) => handleNodeTap(node, nodeView, event));
      nodesLayer.addChild(nodeView);
      nodeViews.set(id, nodeView);
    }

    redrawOverlay();
  }

  function fitInternal(): void {
    const positions = activePositions();
    if (!camera || !positions) return;
    const bounds = boundsOf(positions);
    // Les enveloppes débordent des cartes : les inclure, sans quoi le cadrage
    // les rognerait.
    if (view === "graph" && graphLayout) {
      // Le disque déborde des cartes de sa marge ; sa boîte englobante est
      // `cx ± r`, `cy ± r`, et c'est elle qu'on unit aux bornes des cartes.
      for (const cluster of graphLayout.clusters) {
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        bounds.x = Math.min(bounds.x, cluster.cx - cluster.r);
        bounds.y = Math.min(bounds.y, cluster.cy - cluster.r);
        bounds.width = Math.max(right, cluster.cx + cluster.r) - bounds.x;
        bounds.height = Math.max(bottom, cluster.cy + cluster.r) - bounds.y;
      }
    }
    camera.fitTo(bounds, viewport());
  }

  /** Header click on a node with children toggles expand/collapse; a header
   * click on a childless node, or a body click that isn't a ref-field row,
   * selects the node; a click on a row backed by an outgoing ref edge
   * follows that reference. Only meaningful at LOD 0 (the only LOD that
   * renders a header/rows distinction) — anywhere else, tapping the node
   * just selects it.
   *
   * En vue graphe, aucun clic d'en-tête ne plie quoi que ce soit : tout y est
   * toujours visible, donc l'en-tête sélectionne comme le corps. Le reste
   * (lignes, références) est identique. */
  function handleNodeTap(node: GraphNode, nodeView: Container, event: FederatedPointerEvent): void {
    if (!graph) return;
    if (currentLod === 0) {
      const local = nodeView.toLocal(event.global);
      if (local.y < metrics.headerHeight) {
        if (view !== "graph" && node.childIds.length > 0) {
          toggleExpand(node.id);
          return;
        }
      } else {
        const rowIndex = Math.floor((local.y - metrics.headerHeight) / metrics.rowHeight);
        // Un clic dans le padding bas ne tombe sur aucune ligne.
        const row = rowIndex < node.rows.length ? node.rows[rowIndex] : undefined;
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
    const next = await engine.layoutAfterExpand(layoutResult, graph, id, visible, metrics);
    // A concurrent doCollapse/doExpand/focusOn ran while we were awaiting
    // (bumping opGen) and already applied its own layoutResult — applying
    // this stale one now would silently revert that operation. Bail.
    if (destroyed || gen !== opGen) {
      // ...mais en ANNULANT d'abord la mutation faite plus haut, comme le font
      // déjà `toggleAggregate` et `focusOn`. Sans ce retour arrière,
      // `collapseState` reste en avance sur `layoutResult` : il déclare
      // `id` déplié, donc ses enfants visibles, alors qu'aucun d'eux n'a de
      // position dans le `layoutResult` publié. Ils ne sont jamais dessinés,
      // et ce `layoutResult` à moitié fusionné corrompt l'opération suivante
      // en lui servant de `prev`.
      //
      // `opGen` est PARTAGÉ avec la vue graphe : `setView` l'incrémente
      // aussi. Une bascule de vue peut donc court-circuiter un `expand()` en
      // vol — et le symétrique est immédiat, un `collapse()` appelé par
      // l'hôte (sans effet visible en vue graphe, par contrat) incrémentant
      // `opGen` de façon synchrone. La course ne demande plus deux opérations
      // de la vue structure : elle traverse les vues, et le dégât ne se voit
      // qu'au retour en vue structure.
      collapseState.collapse(id);
      return;
    }
    layoutResult = next;
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  function doCollapse(id: NodeId): void {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!collapseState.isExpanded(id)) return;
    // Synchronous, but still bumps the generation counter so any in-flight
    // async doExpand/focusOn awaiting a layout notices it's been superseded.
    //
    // Pas de retour arrière à prévoir ici, contrairement à `doExpand` :
    // `layoutAfterCollapse` est synchrone, donc il n'existe aucun `await`
    // entre la mutation de `collapseState` et la publication de
    // `layoutResult`. Les deux ne peuvent pas se désynchroniser, et aucune
    // opération concurrente ne peut s'intercaler entre elles.
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
    if (!graph || !camera) return;
    if (!graph.nodes.has(id)) return;

    // La vue graphe n'a pas d'arbre à déplier : elle n'a que des entités, et
    // elles y sont toutes visibles — aucun chemin d'ancêtres à ouvrir.
    // On centre donc sur la carte si elle est là, et rien d'autre — surtout pas
    // la cascade d'expansion ci-dessous, qui mettrait l'état de la vue
    // structure au travail sans rien montrer.
    if (view === "graph") {
      const rect = graphLayout?.positions.get(id);
      if (rect) camera.centerOn(rect, viewport(), 1);
      return;
    }

    if (!collapseState || !layoutResult || !engine) return;

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
        const next = await engine.layoutAfterExpand(
          layoutResult,
          graph,
          ancestorId,
          collapseState.visibleNodeIds(),
          metrics,
        );
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
      background: theme.surface.canvas,
      resizeTo: container,
      antialias: true,
      // Sans ces deux options, le canvas est rendu en 1x puis étiré par le CSS
      // sur tout écran à forte densité — la cause principale du flou.
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

    // `setTheme` a pu tourner pendant que `app.init()` était en vol : à ce
    // moment `app.renderer` n'existait pas encore, donc son assignation de
    // fond a été sautée (elle est gardée par `if (app.renderer)`). Ré-appliquer
    // ici honore un thème installé pendant l'init.
    app.renderer.background.color = theme.surface.canvas;

    // Pixi v8's BitmapText only rasterizes reliably on WebGL/WebGPU; its
    // software "canvas" fallback renderer (used when neither is available)
    // leaves BitmapText blank, so use plain Text there (see draw.ts).
    useBitmapText = app.renderer.name !== "canvas";

    container.appendChild(app.canvas);
    app.stage.addChild(world);
    camera = new Camera(world, app.canvas);

    currentConfig = options.config;
    graph = buildGraph(options.data, currentConfig);
    // Les avances ne sont mesurées qu'une fois. Mesurer avant que la police web
    // soit prête figerait celles de la pile de repli pour toute la session, et
    // les largeurs de cartes varieraient d'un chargement à l'autre. Le timeout
    // borne l'attente : un service de polices lent ne doit pas bloquer le rendu.
    await fontsReady(theme, 1500);
    if (destroyed) return;
    metrics = measureFontMetrics(theme, DEFAULT_METRICS);
    refreshEntityAccents(currentConfig);
    collapseState = new CollapseState(graph);
    searchIndex = buildSearchIndex(graph);

    engine = buildLayoutEngine(options.elkWorkerUrl);
    const visible = collapseState.visibleNodeIds();
    try {
      layoutResult = await engine.layout(graph, visible, metrics);
    } catch (err) {
      console.warn("[data-graph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
      engine = createLayoutEngine();
      layoutResult = await engine.layout(graph, visible, metrics);
    }
    if (destroyed) return;

    // La vue structure est toujours mise en page, même si l'hôte démarre en vue
    // graphe : c'est elle qui sert de repli et elle est déjà payée ici. La vue
    // graphe, elle, ne se construit que si on la demande — et son échec ne doit
    // pas rejeter `ready`, ce qui condamnerait toutes les méthodes qui
    // l'attendent. On retombe sur la vue structure, comme le repli ELK
    // ci-dessus retombe sur un moteur en processus.
    if (view === "graph") {
      try {
        const state = await computeGraphView(graph, currentConfig, true);
        if (destroyed) return;
        publishGraphView(state);
      } catch (err) {
        console.warn("[data-graph] the graph view failed to build, falling back to the structure view", err);
        view = "structure";
      }
      if (destroyed) return;
    }

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
    const newGraph = buildGraph(data, config);
    const newCollapseState = new CollapseState(newGraph);
    const newSearchIndex = buildSearchIndex(newGraph);
    const visible = newCollapseState.visibleNodeIds();

    let newEngine = buildLayoutEngine(options.elkWorkerUrl);
    let newLayout: LayoutResult;
    try {
      newLayout = await newEngine.layout(newGraph, visible, metrics);
    } catch (err) {
      console.warn("[data-graph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
      newEngine = createLayoutEngine();
      newLayout = await newEngine.layout(newGraph, visible, metrics);
    }

    // La vue graphe se recalcule sur le NOUVEAU graphe, avant publication et
    // sans réutiliser l'index en place, qui décrit l'ancien. Un échec ici ne
    // doit pas rejeter `setData` en laissant l'instance à moitié remplacée : on
    // retombe sur la vue structure, dont la mise en page est déjà prête.
    let newGraphView: GraphViewState | undefined;
    let graphViewFailed = false;
    if (view === "graph") {
      try {
        newGraphView = await computeGraphView(newGraph, config, false);
      } catch (err) {
        console.warn("[data-graph] the graph view failed to rebuild, falling back to the structure view", err);
        graphViewFailed = true;
      }
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
    refreshEntityAccents(config);
    selectedId = null;
    searchResults = [];
    searchCursor = -1;

    // L'état de la vue graphe est indexé par id de nœud : il ne survit pas à un
    // changement de données. On l'invalide, puis on publie celui calculé plus
    // haut — sinon `rebuild()` peindrait les positions de l'ancien graphe.
    aggregateIndex = undefined;
    graphLayout = undefined;
    if (graphViewFailed) view = "structure";
    if (newGraphView) publishGraphView(newGraphView);

    rebuild();
    fitInternal();
  }

  // Après `destroy()`, chaque méthode publique doit être un no-op sûr plutôt
  // qu'un throw : un hôte qui démonte son composant n'a aucun moyen d'annuler
  // un callback déjà planifié, et `camera`/`app.stage` sont alors détruits.
  return {
    ready,

    fit(): void {
      if (destroyed) return;
      fitInternal();
    },

    async expand(id: NodeId): Promise<void> {
      if (destroyed) return;
      await doExpand(id);
    },

    async collapse(id: NodeId): Promise<void> {
      if (destroyed) return;
      doCollapse(id);
    },

    focus(id: NodeId): void {
      if (destroyed) return;
      void focusOn(id);
    },

    select(id: NodeId): void {
      if (destroyed) return;
      doSelect(id);
    },

    search(query: string): SearchResult[] {
      if (destroyed) return [];
      return doSearch(query);
    },
    nextMatch(): SearchResult | null {
      if (destroyed) return null;
      return stepMatch(1);
    },
    prevMatch(): SearchResult | null {
      if (destroyed) return null;
      return stepMatch(-1);
    },

    on(event: DataGraphEvent, callback: (payload: any) => void): () => void {
      if (destroyed) return () => {};
      return emitter.on(event, callback);
    },

    async setData(data: unknown, config?: DataGraphConfig): Promise<void> {
      await doSetData(data, config);
    },

    diagnostics(): Diagnostic[] {
      return graph ? graph.diagnostics : [];
    },

    stats(): { logicalNodeCount: number; visibleNodeCount: number } {
      return {
        logicalNodeCount: graph?.logicalNodeCount ?? 0,
        // Le compte de la vue affichée : des entités en vue graphe, des nœuds
        // de l'arbre en vue structure.
        visibleNodeCount: activeVisible().size,
      };
    },

    refEdges(from: NodeId): RefEdge[] {
      return graph ? graph.refEdges.filter((e) => e.from === from) : [];
    },

    setTheme(next: Theme | ThemeOverride): void {
      if (destroyed) return;
      // Un `Theme` complet est aussi structurellement valide comme
      // `ThemeOverride` (chaque groupe de `DeepPartial` est optionnel, donc
      // aucun champ ne peut servir de discriminant sûr — un override qui
      // fixe `entityPalette` est parfaitement légal et ne doit pas être
      // confondu avec un thème complet). `resolveTheme` est idempotente sur
      // un `Theme` complet : chaque groupe étale `base` puis `partial`, donc
      // passer un `Theme` entier reproduit exactement ce `Theme`.
      // Conséquence assumée : un `byEntityType` déjà en place survit à un
      // changement de thème, puisque `resolveTheme` le reporte depuis
      // `base` quand `partial` n'en fournit pas — c'est le comportement
      // voulu pour un bascule clair/sombre.
      theme = resolveTheme(next as ThemeOverride, theme);
      refreshEntityAccents(currentConfig);
      if (app.renderer) app.renderer.background.color = theme.surface.canvas;
      rebuild();
    },

    async setView(next: DataGraphView): Promise<void> {
      await ready;
      if (destroyed || next === view || !graph) return;

      if (next === "graph") {
        // Même discipline de génération que toutes les autres opérations
        // asynchrones du fichier : le calcul dure le temps d'un import
        // dynamique plus une passe de force, pendant lesquels un `setData` peut
        // très bien atterrir. `view` n'est donc basculée, et l'état publié,
        // qu'une fois cette course tranchée.
        const gen = ++opGen;
        let state: GraphViewState;
        try {
          state = await computeGraphView(graph, currentConfig, true);
        } catch (err) {
          // Le moteur organique est chargé dynamiquement : un import qui échoue
          // (réseau, chunk absent) ne doit pas laisser l'instance dans une vue
          // qu'elle ne sait pas peindre. `view` n'a pas encore bougé.
          console.warn("[data-graph] switching to the graph view failed", err);
          return;
        }
        if (destroyed || gen !== opGen) return;
        publishGraphView(state);
      }

      // `graph` a pu être remplacé pendant l'attente ; la garde de génération
      // ci-dessus l'exclut, mais on le relit plutôt que de faire confiance à un
      // narrowing d'avant l'`await`.
      const current = graph;
      if (!current) return;
      view = next;

      // La vue graphe ne connaît que des entités : reporter la sélection sur
      // l'entité englobante plutôt que de la perdre.
      if (view === "graph" && selectedId) selectedId = nearestEntityAncestor(current, selectedId);

      rebuild();
      // Recadrer ICI est légitime : les deux vues n'ont aucun repère commun.
      fitInternal();
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
      // Libère la part de cette instance dans les atlas partagés : ils ne sont
      // désinstallés que si plus aucune autre instance ne les porte.
      fontLease.dispose();
      emitter.clear();
      // `ready` may still be in flight (destroy() called before app.init()
      // resolved); guard so we never throw on a half-initialized renderer.
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}
