import type {
  DataGraphConfig,
  Graph,
  NodeId,
  NodeMetrics,
  Rect,
  RefEdge,
  SearchIndex,
} from "@defsquare/datagraph-core";
import type { Lod } from "./draw.js";

/**
 * THE SEAM between the Pixi host (`create.ts`) and the three views.
 *
 * `create.ts` is the host and the orchestrator: cards, camera, hover, drag,
 * selection, search, the `opGen`/`destroyed` guards (ADR-0009) and the view
 * switch. Everything VIEW-SPECIFIC — which graph is rendered, where its nodes
 * sit, what a fold gesture does — is behind this interface, one controller per
 * view (ADR-0043). No `view === "structure"` / `"tree"` branch survives in the
 * host outside the switch itself.
 *
 * The three views do NOT share machinery: the structure view keeps its
 * incremental engine, the tree view has a global layout of its own, the graph
 * view folds nothing at all. What they share is the core's primitives
 * (`buildGraph`, `CollapseState`, `buildSearchIndex`, the layout engines,
 * `measureNode`) and `draw.ts`'s pure drawing functions (ADR-0006) — a card is a
 * card in all three, and edge geometry is a parameter of a pure function, never
 * view state.
 */

/** `"structure"` lays out the containment tree of the source document; `"tree"`
 * lays out a containment RE-DERIVED from the references — a top-level entity
 * hangs under the target of the reference it was claimed through
 * (`buildAggregates`' BFS forest, roots = `groups`); `"graph"` lays out the
 * entities and their references, grouped by aggregate. */
export type DataGraphView = "structure" | "tree" | "graph";

/**
 * What the current view allows cards and edges to do. Pure data, derived from
 * the view and the current LOD: computing it in one block replaces the ternaries
 * that would otherwise scatter through the host.
 *
 * The LOD is in it because the graph view's SEMANTIC regime is not a fourth view
 * but another regime of the same one: below the LOD 2 threshold it stops drawing
 * its cards and paints its aggregates as nodes. What that pair governs — which
 * cards exist, and what the aggregates paint — is exactly policy.
 *
 * Contains policy ONLY. Whatever reads state — positions, visible nodes,
 * `animatePositions`'s inertia, which is an orchestration decision — stays out.
 */
export interface ViewPolicy {
  /** `drawEdges`/`drawSelectionOverlay`: the graph view draws the references,
   * the folded views the containment. */
  edgeMode: "ref" | "contain";
  /** `rebuild`: a header chevron only makes sense where a click collapses
   * something — the containment tree, and NOTHING in graph view, which shows
   * everything and no longer collapses any aggregate. */
  chevrons: boolean;
  /** `rebuild`: the collapse state is read from the view when the view collapses,
   * otherwise everything is expanded outright. `handleNodeTap`: header and array
   * tokens collapse. Expanding in graph view would reveal nodes that are not
   * entities, and therefore that this view does not position. */
  foldable: boolean;
  /** `rebuild`: hover on array tokens, the collapse affordance. */
  tokenHover: boolean;
  /** `rebuild`: token chevrons oriented by the set of expanded arrays. Without it
   * the tokens stay readable but inert. */
  expandedArrays: boolean;
  /**
   * `rebuild`: WHICH cards exist.
   *
   * `"unclustered"` is the semantic regime — only entities outside any aggregate
   * keep a card, the others being already represented by their aggregate's disc.
   * The filter is set on `CardContext.drawable`, and that is the only place that
   * can hold it: `syncCards` and `ensureCard` both confine themselves to it, so no
   * path can materialize a card the disc replaces. This is the "never cards AND
   * discs together" invariant, obtained by construction rather than by a guard at
   * every site.
   */
  cards: "all" | "unclustered";
  /**
   * `redrawClusters`: what the aggregates paint.
   *
   * `"none"` in the folded views, which have none. `"hull"` is the translucent
   * region laid behind the cards; `"disc"` is the solid node that REPLACES them,
   * with its label and its aggregated edges. The three values are mutually
   * exclusive, and that is what forbids painting an envelope under a disc already
   * occupying the same circle.
   */
  aggregates: "none" | "hull" | "disc";
  /**
   * The direction the containment edges and the remainder tokens are laid along.
   *
   * `"down"` for the tree view, whose levels are rows: a containment edge leaves
   * the bottom of its source, and the token of a hidden page sits BESIDE its
   * anchor, the siblings being a row. `"right"` everywhere else — graph view
   * included, which draws no containment and pages nothing, so the value is moot
   * there.
   */
  flow: "right" | "down";
}

/**
 * What a fold gesture hands back to the host, which animates and frames it.
 *
 * The view has already published its own new positions by then: this only
 * carries what the host needs and the view has no business doing —
 * `prevPositions` for the interpolation, `revealed` for the camera follow.
 */
export interface FoldStep {
  prevPositions: Map<NodeId, Rect>;
  /** Ids that became visible (for the camera follow). Empty on a collapse. */
  revealed: NodeId[];
}

/**
 * A "+ n" token of unrevealed card children, FULLY PLACED by the view.
 *
 * The placement is arithmetic and never ELK's — a laid-out token would be one
 * more box in the computation it exists to avoid — and it depends on the flow,
 * which is exactly why it belongs to the view rather than to the host: the
 * structure view stacks its tokens under their anchor, the tree view puts them
 * beside it. The host draws them and wires the tap.
 */
export interface RemainderToken {
  parentId: NodeId;
  page: number;
  count: number;
  x: number;
  y: number;
  width: number;
}

export interface View {
  readonly kind: DataGraphView;
  /** The graph this view renders — nodes and rows for the cards. `undefined`
   * before publish. */
  graph(): Graph | undefined;
  positions(): Map<NodeId, Rect> | undefined;
  visible(): Set<NodeId>;
  policy(lod: Lod): ViewPolicy;
  /** The references the host DRAWS. The tree excludes the ones it turned into
   * parent links: their stroke is already the containment edge, and drawing both
   * would double every link of the hierarchy. */
  refEdgesToDraw(): RefEdge[];
  /** Graph view: always true (it folds nothing). */
  isExpanded(id: NodeId): boolean;
  /** Graph view: `[]`. */
  remainderTokens(): RemainderToken[];
  /** Graph view: `undefined` — the host falls back to the structure view's index,
   * which covers the same source document. */
  searchIndex(): SearchIndex | undefined;

  // The fold gestures. `stale()` is the HOST's generation guard
  // (`destroyed || gen !== opGen`): the view mutates, awaits its layout, and if
  // `stale()` is true afterwards it ROLLS BACK its own mutation and returns null;
  // otherwise it publishes and returns the step. That split is what keeps `opGen`
  // with the host (ADR-0009/0024) and the rollback with the state's owner — the
  // view is the only thing that knows what it mutated.
  //
  // Graph view: every one of them resolves to null without touching anything.
  expand(id: NodeId, stale: () => boolean): Promise<FoldStep | null>;
  /** A promise, but not for the same reason in both folded views: the structure
   * view's collapse is an INCREMENTAL undo with no `await` inside, so it can never
   * be stale and resolves on the spot; the tree view's re-lays the whole visible
   * set out and therefore obeys the same rollback rule as `expand` — if the
   * host's generation moved during the layout, undo the mutation and publish
   * nothing. */
  collapse(id: NodeId, stale: () => boolean): Promise<FoldStep | null>;
  reveal(parentId: NodeId, page: number, stale: () => boolean): Promise<FoldStep | null>;
  /** Makes `id` visible: expands its collapsed ancestors and reveals the pages on
   * the path. Resolves null when nothing needed doing OR when stale. Used by
   * focus and by search. */
  revealPathTo(id: NodeId, stale: () => boolean): Promise<FoldStep | null>;
  /** Structure view: the global re-layout of the visible set, the repair for
   * incremental drift. Tree and graph views: null — neither drifts. */
  tidy(stale: () => boolean): Promise<FoldStep | null>;
}

/**
 * The two FOLDED views compute before they publish, exactly like
 * `graph-view.ts` (ADR-0024): the host keeps its generation guard between the
 * two, so a computation started before a `setData` and finished after it can be
 * dropped instead of overwriting the new state.
 */
export interface FoldedView<State> extends View {
  /** Never publishes. `source` is the document's graph, from `buildGraph`. */
  compute(source: Graph, config: DataGraphConfig, metrics: NodeMetrics): Promise<State>;
  publish(state: State): void;
  invalidate(): void;
}
