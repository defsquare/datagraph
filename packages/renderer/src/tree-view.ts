import {
  buildSearchIndex,
  buildTreeGraph,
  CollapseState,
  createTreeLayout,
  pageOf,
  validateConfig,
  type DataGraphConfig,
  type ElkFactory,
  type Graph,
  type LayoutResult,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
  type SearchIndex,
} from "@defsquare/datagraph-core";
import { REMAINDER_TOKEN_GAP } from "./draw.js";
import type { FoldedView, FoldStep, RemainderToken, ViewPolicy } from "./view.js";

/**
 * THE TREE VIEW's controller: a containment re-derived from the references
 * (ADR-0042), laid out top to bottom, with a machinery of its OWN (ADR-0043).
 *
 * The tree used to be the structure view's machinery parametrised seven ways —
 * transposed engine, elided-array anchor, edge flow, token placement,
 * `expandEntities`, and two swaps inside `create.ts`. Every tree adaptation then
 * rippled through code the structure view also ran on. Here nothing is
 * parametrised: the tree recomputes a GLOBAL layout on every fold gesture
 * (`createTreeLayout`), which it can afford because its visible set is bounded by
 * the same card budget and the same pagination as the structure view's. No
 * incremental deltas, therefore no delta memory to purge, therefore no `tidy`.
 *
 * No Pixi: this controller is a data machine, testable without a canvas. It
 * borrows one constant from `draw.ts` (`REMAINDER_TOKEN_GAP`) because a token's
 * placement has to agree with the size the token is drawn at, and there is one
 * owner of that number.
 */

/** Everything the tree renders, computed in one pass and published in one
 * gesture — the five members cannot be allowed to describe different graphs. */
export interface TreeViewState {
  graph: Graph;
  collapse: CollapseState;
  index: SearchIndex;
  layout: LayoutResult;
  /** The references the host draws, computed ONCE here: a filter over ~28,000
   * edges has no business running on every repaint. */
  refEdgesToDraw: RefEdge[];
  /** The metrics this state was laid out with, kept so a fold gesture lays the
   * tree out again at the same card sizes. They are measured once per instance
   * (see `create.ts`), so carrying them with the state rather than reading them
   * back through a hook costs nothing and removes one way for the two to
   * disagree. */
  metrics: NodeMetrics;
}

export interface TreeViewHooks {
  /** Injected the same way the structure engine's is, so the renderer can hand
   * over a worker-backed ELK and the tests an in-process one. */
  elkFactory?: ElkFactory;
}

/**
 * The tree's policy: the folded policy, with the one value that differs.
 *
 * `flow: "down"` is not an option — the tree view IS vertical (ADR-0042). The
 * LOD plays no part: unlike the graph view, the tree has no second regime.
 */
function treePolicy(): ViewPolicy {
  return {
    edgeMode: "contain",
    chevrons: true,
    foldable: true,
    tokenHover: true,
    expandedArrays: true,
    cards: "all",
    aggregates: "none",
    flow: "down",
  };
}

/**
 * The references the tree CONSUMED into its hierarchy: an entity re-parented
 * under the target of the reference that claimed it makes that reference the
 * containment edge itself. Drawing it as well would double every link of the
 * tree — a dashed overlay lying exactly on the solid stroke.
 *
 * `fromEntity` and not `from`: the reference may be carried by a value object
 * nested inside the entity, and it is the ENTITY that was re-parented.
 */
function refEdgesToDrawFor(graph: Graph): RefEdge[] {
  return graph.refEdges.filter((edge) => graph.nodes.get(edge.fromEntity)?.parentId !== edge.to);
}

export function createTreeViewController(hooks: TreeViewHooks = {}): FoldedView<TreeViewState> {
  const layoutEngine = createTreeLayout({ elkFactory: hooks.elkFactory });
  let state: TreeViewState | null = null;

  /** The ids in `next` that `prev` did not carry. */
  const difference = (next: ReadonlySet<NodeId>, prev: ReadonlySet<NodeId>): NodeId[] => {
    const out: NodeId[] = [];
    for (const id of next) if (!prev.has(id)) out.push(id);
    return out;
  };

  /**
   * One fold gesture, from mutation to publication.
   *
   * The whole async discipline of this file is here, once: mutate, lay the WHOLE
   * visible set out again, and if the host's generation moved during the await,
   * undo the mutation and publish nothing. Writing it per gesture is what made
   * the structure view's four paths drift apart; here `expand`, `collapse`,
   * `reveal` and `revealPathTo` differ only by their `mutate`/`undo` pair.
   */
  const gesture = async (
    current: TreeViewState,
    mutate: () => void,
    undo: () => void,
    stale: () => boolean,
  ): Promise<FoldStep | null> => {
    const beforeVisible = current.collapse.visibleNodeIds();
    const prevPositions = new Map(current.layout.positions);
    mutate();
    const visible = current.collapse.visibleNodeIds();
    const layout = await layoutEngine.layout(current.graph, visible, current.metrics);
    if (stale()) {
      // The host published something else while we were in ELK. Undoing is the
      // view's job and not the host's: the host does not know what was mutated,
      // and a collapse state left ahead of its layout declares visible cards that
      // no position carries.
      undo();
      return null;
    }
    current.layout = layout;
    return { prevPositions, revealed: difference(visible, beforeVisible) };
  };

  return {
    kind: "tree",

    async compute(
      source: Graph,
      config: DataGraphConfig,
      metrics: NodeMetrics,
    ): Promise<TreeViewState> {
      const graph = buildTreeGraph(source, validateConfig(config));
      // `expandEntities`: every node below a tree graph's root is an entity, so
      // the default entity boundary would show nothing but the roots — and the
      // hierarchy is exactly what the reader picked this view to see. The card
      // budget still applies, top levels first.
      const collapse = new CollapseState(graph, { expandEntities: true });
      const layout = await layoutEngine.layout(graph, collapse.visibleNodeIds(), metrics);
      return {
        graph,
        collapse,
        index: buildSearchIndex(graph),
        layout,
        refEdgesToDraw: refEdgesToDrawFor(graph),
        metrics,
      };
    },

    publish(next: TreeViewState): void {
      state = next;
    },

    invalidate(): void {
      state = null;
    },

    graph(): Graph | undefined {
      return state?.graph;
    },

    positions(): Map<NodeId, Rect> | undefined {
      return state?.layout.positions;
    },

    visible(): Set<NodeId> {
      return state?.collapse.visibleNodeIds() ?? new Set();
    },

    policy(): ViewPolicy {
      return treePolicy();
    },

    refEdgesToDraw(): RefEdge[] {
      return state?.refEdgesToDraw ?? [];
    },

    isExpanded(id: NodeId): boolean {
      return state?.collapse.isExpanded(id) ?? false;
    },

    searchIndex(): SearchIndex | undefined {
      return state?.index;
    },

    /**
     * The "+ n" tokens, one per block of unrevealed card children.
     *
     * In this view the siblings are a ROW, so the token sits BESIDE its anchor,
     * on the side of the gap it stands for, and borrows that neighbour's width —
     * its size says "here, cards like those", which a width of its own would not.
     * It hooks onto a card already placed: the one before the gap if there is one
     * (the token extends the row), otherwise the one after (the token precedes
     * it).
     */
    remainderTokens(): RemainderToken[] {
      if (!state) return [];
      const { graph, collapse, layout } = state;
      const tokens: RemainderToken[] = [];
      for (const id of collapse.visibleNodeIds()) {
        // `hiddenGaps` looks at the PAGES only: it reports the same gaps for a
        // collapsed node, none of whose children are on screen. A token placed
        // beside a collapsed card would dangle in the void.
        if (!collapse.isExpanded(id)) continue;
        const gaps = collapse.hiddenGaps(id);
        if (gaps.length === 0) continue;
        const node = graph.nodes.get(id);
        if (!node) continue;
        // The CARD children, in `childIds` order: this is the indexing the gaps
        // speak of. The elided ones are rows of `id`'s own card, so counting them
        // would shift every index from one token to the next.
        const cards = node.childIds.filter((childId) => graph.nodes.get(childId)?.elided === false);

        for (const gap of gaps) {
          let anchor: Rect | undefined;
          let after = true;
          for (let i = gap.fromIndex - 1; i >= 0 && !anchor; i--) {
            anchor = layout.positions.get(cards[i]!);
          }
          if (!anchor) {
            after = false;
            for (let i = gap.fromIndex + gap.count; i < cards.length && !anchor; i++) {
              anchor = layout.positions.get(cards[i]!);
            }
          }
          // No card placed on either side of the gap. Should not happen for an
          // expanded, visible node — it has at least one revealed page — but
          // drawing without an anchor would amount to inventing a position.
          if (!anchor) continue;
          tokens.push({
            parentId: id,
            page: gap.nextPage,
            count: gap.count,
            x: after
              ? anchor.x + anchor.width + REMAINDER_TOKEN_GAP
              : anchor.x - anchor.width - REMAINDER_TOKEN_GAP,
            y: anchor.y,
            width: anchor.width,
          });
        }
      }
      return tokens;
    },

    async expand(id: NodeId, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      if (!current.graph.nodes.has(id) || current.collapse.isExpanded(id)) return null;
      return gesture(
        current,
        () => current.collapse.expand(id),
        () => current.collapse.collapse(id),
        stale,
      );
    },

    /**
     * A collapse is a fold gesture like any other here: the whole visible set is
     * laid out again. Dropping the subtree's rects in place would leave the
     * surviving cards spread over the width the tree had before, holes and all,
     * and `fit()` would frame that emptiness.
     */
    async collapse(id: NodeId, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      if (!current.collapse.isExpanded(id)) return null;
      return gesture(
        current,
        () => current.collapse.collapse(id),
        () => current.collapse.expand(id),
        stale,
      );
    },

    async reveal(parentId: NodeId, page: number, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      if (!current.graph.nodes.has(parentId)) return null;
      if (current.collapse.revealedPages(parentId).has(page)) return null;
      return gesture(
        current,
        () => current.collapse.revealPage(parentId, page),
        () => current.collapse.unrevealPage(parentId, page),
        stale,
      );
    },

    /**
     * Opens the path down to `id`: every collapsed ancestor, plus the PAGE of
     * each child on the path — since pagination, an expanded ancestor no longer
     * guarantees its descendants are visible. Only the page of the path's child
     * is revealed, never the whole prefix, or reaching the 47,312th child would
     * pay for 47,313 cards.
     *
     * Everything is marked, then ONE global layout — unlike the structure view,
     * which lays out once per level because each of its steps is an incremental
     * insertion. Hence a single rollback too, instead of a cascade that can abort
     * halfway.
     */
    async revealPathTo(id: NodeId, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      if (!current.graph.nodes.has(id)) return null;
      if (current.collapse.visibleNodeIds().has(id)) return null;

      const expands: NodeId[] = [];
      const reveals: { parentId: NodeId; page: number }[] = [];
      let childOnPath: NodeId = id;
      let parentId = current.graph.nodes.get(id)?.parentId ?? null;
      while (parentId !== null) {
        // An ELIDED child on the path (`cardIndexOf` < 0) is a row of its parent's
        // card: it has no page to reveal.
        const cardIndex = current.collapse.cardIndexOf(parentId, childOnPath);
        const page = pageOf(cardIndex);
        if (cardIndex >= 0 && !current.collapse.revealedPages(parentId).has(page)) {
          reveals.push({ parentId, page });
        }
        if (!current.collapse.isExpanded(parentId)) expands.push(parentId);
        childOnPath = parentId;
        parentId = current.graph.nodes.get(parentId)?.parentId ?? null;
      }
      if (expands.length === 0 && reveals.length === 0) return null;

      return gesture(
        current,
        () => {
          for (const ancestorId of expands) current.collapse.expand(ancestorId);
          for (const step of reveals) current.collapse.revealPage(step.parentId, step.page);
        },
        () => {
          for (const ancestorId of expands) current.collapse.collapse(ancestorId);
          for (const step of reveals) current.collapse.unrevealPage(step.parentId, step.page);
        },
        stale,
      );
    },

    /** Nothing to repair: every gesture re-lays the whole tree out, so it cannot
     * drift the way an incrementally built arrangement does. */
    async tidy(): Promise<FoldStep | null> {
      return null;
    },
  };
}
