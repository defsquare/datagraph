import {
  buildSearchIndex,
  CollapseState,
  createStructureLayoutEngine,
  pageOf,
  type DataGraphConfig,
  type ElkFactory,
  type Graph,
  type LayoutResult,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
  type SearchIndex,
  type StructureLayoutEngine,
} from "@defsquare/datagraph-core";
import { REMAINDER_TOKEN_GAP, REMAINDER_TOKEN_HEIGHT } from "./draw.js";
import type { FoldedView, FoldStep, RemainderToken, ViewPolicy } from "./view.js";

/**
 * THE STRUCTURE VIEW's controller: the containment the JSON document itself
 * carries, laid out left to right by the INCREMENTAL engine (ADR-0043).
 *
 * It is the default view, and the one the other two lean on: it is always laid
 * out (see `create.ts`'s `ready`), it is the fallback when another view fails to
 * build, and it owns the search index the graph view borrows.
 *
 * Its machinery is its own, and it is the incremental one: an expand pushes a
 * subtree beside its anchor, a reveal inserts a block into a column already
 * arranged, a collapse subtracts the delta it added. That arithmetic is what
 * makes a fold gesture cheap on a document ELK could not lay out whole — and
 * what makes `tidy()` necessary, since deltas accumulate a drift a global layout
 * repairs.
 *
 * No Pixi: this controller is a data machine, testable without a canvas. It
 * borrows two constants from `draw.ts` (`REMAINDER_TOKEN_GAP`,
 * `REMAINDER_TOKEN_HEIGHT`) because a token's placement has to agree with the
 * size the token is drawn at, and there is one owner of that number.
 */

/** Everything the structure view renders, computed in one pass and published in
 * one gesture — the five members cannot be allowed to describe different graphs.
 * The engine belongs to the state and not to the controller because the ELK
 * fallback REPLACES it (see `layoutStructure`): publishing the layout without it
 * would leave the following operations' `expansionDeltas` on an engine that did
 * not produce those positions. */
export interface StructureViewState {
  /** The DOCUMENT's graph, from `buildGraph`: this view lays out the containment
   * the JSON itself carries, so it renders the source as is. */
  graph: Graph;
  collapse: CollapseState;
  index: SearchIndex;
  engine: StructureLayoutEngine;
  layout: LayoutResult;
  /** The metrics this state was laid out with, kept so a fold gesture lays out
   * again at the same card sizes. They are measured once per instance (see
   * `create.ts`), so carrying them with the state rather than reading them back
   * through a hook costs nothing and removes one way for the two to disagree. */
  metrics: NodeMetrics;
}

export interface StructureViewHooks {
  /** Injected exactly like the tree's, so the renderer can hand over a
   * worker-backed ELK and the tests an in-process one. The worker is the HOST's
   * setting, not a view's — hence a factory handed in rather than a URL read
   * here. */
  elkFactory?: ElkFactory;
}

/**
 * One link of `revealPathTo`'s cascade: the path to a deep target is crossed with
 * TWO distinct gestures per level, an expansion and a page reveal, each having its
 * own incremental layout (`layoutAfterExpand` pushes a subtree beside its anchor,
 * `layoutAfterReveal` inserts a block into a column already arranged). Typing them
 * rather than lining up two lists keeps the execution order — and hence the
 * backtracking — in a single sequence.
 */
type FocusStep =
  | { kind: "expand"; id: NodeId }
  | { kind: "reveal"; parentId: NodeId; page: number };

/** The ids in `next` that `prev` did not carry. */
function difference(next: ReadonlySet<NodeId>, prev: ReadonlySet<NodeId>): NodeId[] {
  const out: NodeId[] = [];
  for (const id of next) if (!prev.has(id)) out.push(id);
  return out;
}

/**
 * The structure view's policy. The LOD plays no part here: only the graph view
 * has a second regime.
 */
function structurePolicy(): ViewPolicy {
  return {
    edgeMode: "contain",
    chevrons: true,
    foldable: true,
    tokenHover: true,
    expandedArrays: true,
    cards: "all",
    aggregates: "none",
    flow: "right",
  };
}

/**
 * Lays `target` out, with the ELK engine's fallback: the injected factory
 * designates a worker that may be unrunnable (missing chunk, different origin),
 * and its failure must not condemn the instance — we then replay the same layout
 * on an in-process engine.
 *
 * Returns the (engine, layout) pair without publishing anything: `compute` puts
 * both into the state it hands back, and the host publishes that state behind its
 * own generation guard. The engine is part of the result because the fallback
 * REPLACES it: publishing the layout without it would leave the following
 * operations' `expansionDeltas` on an engine that did not produce those positions.
 */
async function layoutStructure(
  elkFactory: ElkFactory | undefined,
  target: Graph,
  visible: Set<NodeId>,
  metrics: NodeMetrics,
): Promise<{ engine: StructureLayoutEngine; layout: LayoutResult }> {
  const primary = createStructureLayoutEngine({ elkFactory });
  try {
    return { engine: primary, layout: await primary.layout(target, visible, metrics) };
  } catch (err) {
    console.warn("[datagraph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
    const fallback = createStructureLayoutEngine();
    return { engine: fallback, layout: await fallback.layout(target, visible, metrics) };
  }
}

export function createStructureViewController(
  hooks: StructureViewHooks = {},
): FoldedView<StructureViewState> {
  let state: StructureViewState | null = null;

  return {
    kind: "structure",

    /** `config` is unused: unlike the tree, this view does not re-derive a graph
     * — it renders `source` itself. The parameter stays for the seam's sake. */
    async compute(
      source: Graph,
      _config: DataGraphConfig,
      metrics: NodeMetrics,
    ): Promise<StructureViewState> {
      const collapse = new CollapseState(source);
      const index = buildSearchIndex(source);
      const { engine, layout } = await layoutStructure(
        hooks.elkFactory,
        source,
        collapse.visibleNodeIds(),
        metrics,
      );
      return { graph: source, collapse, index, engine, layout, metrics };
    },

    publish(next: StructureViewState): void {
      state = next;
    },

    invalidate(): void {
      state = null;
    },

    // The document's graph IS what this view renders: it lays out the containment
    // the JSON itself carries.
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
      return structurePolicy();
    },

    /** Every reference of the document: this view consumes none into its
     * hierarchy, which is the JSON's own nesting. */
    refEdgesToDraw(): RefEdge[] {
      return state?.graph.refEdges ?? [];
    },

    isExpanded(id: NodeId): boolean {
      return state?.collapse.isExpanded(id) ?? false;
    },

    searchIndex(): SearchIndex | undefined {
      return state?.index;
    },

    /**
     * The "+ n" tokens, one per block of unrevealed card children, at the place
     * those cards would occupy in the sibling COLUMN.
     *
     * The position is ARITHMETIC and does not come from ELK, and that is the heart
     * of the device: a laid-out token would be one more box in the computation, and
     * it exists precisely so the 47,300 cards it replaces do not enter it. It
     * therefore hooks onto a neighboring card already placed — the one before if
     * the preceding block is there (the token extends the column), otherwise the
     * one after (the token precedes it).
     *
     * The token borrows that neighbor's WIDTH: its size says "here, cards like
     * those", which a width of its own would not.
     */
    remainderTokens(): RemainderToken[] {
      if (!state) return [];
      const { graph: g, collapse, layout } = state;
      const positions = layout.positions;
      const tokens: RemainderToken[] = [];
      for (const id of collapse.visibleNodeIds()) {
        // `hiddenGaps` looks at the pages ONLY: it reports the same gaps for a
        // COLLAPSED node, none of whose children are on screen. Collapse is
        // therefore tested here, and it has no other site to be tested at: a token
        // placed under a collapsed card would dangle in the void, next to a column
        // of children that does not exist.
        if (!collapse.isExpanded(id)) continue;
        const gaps = collapse.hiddenGaps(id);
        if (gaps.length === 0) continue;
        const node = g.nodes.get(id);
        if (!node) continue;
        // The CARD children, in `childIds` order: this is the indexing the gaps
        // speak of. The elided ones are rows of `id`'s own card, so counting them
        // would shift every index from one token to the next.
        const cards = node.childIds.filter((childId) => g.nodes.get(childId)?.elided === false);

        for (const gap of gaps) {
          let anchor: Rect | undefined;
          let below = true;
          for (let i = gap.fromIndex - 1; i >= 0 && !anchor; i--) anchor = positions.get(cards[i]!);
          if (!anchor) {
            below = false;
            for (let i = gap.fromIndex + gap.count; i < cards.length && !anchor; i++) {
              anchor = positions.get(cards[i]!);
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
            width: anchor.width,
            x: anchor.x,
            y: below
              ? anchor.y + anchor.height + REMAINDER_TOKEN_GAP
              : anchor.y - REMAINDER_TOKEN_HEIGHT - REMAINDER_TOKEN_GAP,
          });
        }
      }
      return tokens;
    },

    async expand(id: NodeId, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      const { graph: g, collapse: cs, engine: eng } = current;
      if (!g.nodes.has(id) || cs.isExpanded(id)) return null;
      // Captured BEFORE the mutation: the diff against the post-layout set is what
      // names the cards that appeared, and it is the only thing the camera follow
      // needs to know.
      const beforeVisible = cs.visibleNodeIds();
      cs.expand(id);
      const visible = cs.visibleNodeIds();
      const prevPositions = new Map(current.layout.positions);
      const next = await eng.layoutAfterExpand(current.layout, g, id, visible, current.metrics);
      if (stale()) {
        // A concurrent operation ran while we were awaiting and already applied its
        // own layout — applying this stale one now would silently revert it. We bail
        // AND undo the mutation made above: without this rollback, the collapse
        // state stays ahead of the layout, declaring `id` expanded (hence its
        // children visible) when none of them has a position in what is published.
        // They are never drawn, and that half-merged layout goes on to corrupt the
        // next operation by serving as its `prev`.
        //
        // `opGen` is SHARED with the other views: `setView` bumps it too. A view
        // switch can therefore short-circuit an `expand()` in flight — the race
        // spans the views, and the damage only shows on coming back.
        cs.collapse(id);
        return null;
      }
      current.layout = next;
      return { prevPositions, revealed: difference(cs.visibleNodeIds(), beforeVisible) };
    },

    collapse(id: NodeId): Promise<FoldStep | null> {
      const current = state;
      if (!current) return Promise.resolve(null);
      const { graph: g, collapse: cs, engine: eng } = current;
      if (!cs.isExpanded(id)) return Promise.resolve(null);
      // A promise for the seam's sake only — the body below has no `await`, and so
      // no rollback to plan for, unlike `expand`: `layoutAfterCollapse` is
      // synchronous, so there is no suspension between mutating the collapse state
      // and publishing the layout. The two cannot desynchronize, and no concurrent
      // operation can slot in between them. `stale` is therefore never consulted.
      cs.collapse(id);
      const visible = cs.visibleNodeIds();
      const prevPositions = new Map(current.layout.positions);
      current.layout = eng.layoutAfterCollapse(current.layout, g, id, visible);
      return Promise.resolve({ prevPositions, revealed: [] });
    },

    /**
     * Reveals a page of `parentId`'s card children: the remainder token's gesture.
     *
     * Sibling of `expand`, and distinct from it for a LAYOUT reason and not a state
     * one: expanding opens a subtree BESIDE its anchor, revealing inserts a block
     * INTO a column already arranged and pushes what is below. Hence
     * `layoutAfterReveal`, and hence the fact that a token is not a chevron.
     */
    async reveal(parentId: NodeId, page: number, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      const { graph: g, collapse: cs, engine: eng } = current;
      if (!g.nodes.has(parentId) || cs.revealedPages(parentId).has(page)) return null;
      const beforeVisible = cs.visibleNodeIds();
      cs.revealPage(parentId, page);
      const visible = cs.visibleNodeIds();
      const prevPositions = new Map(current.layout.positions);
      const next = await eng.layoutAfterReveal(
        current.layout,
        g,
        parentId,
        visible,
        current.metrics,
      );
      if (stale()) {
        // Same rollback as `expand`, and for the same reason.
        //
        // AN ACCEPTED APPROXIMATION: the engine, for its part, has already
        // accumulated this block's offset in its private memory (`expansionDeltas`),
        // and nothing here takes it back from it — this page, revealed then
        // discarded, therefore leaves a trace, and the next placements under
        // `parentId` will be offset by that much. It is tolerated: the race is rare
        // (it takes a second operation during the layout's round trip) and the next
        // `tidy()` or the next global layout repairs it. It is not an oversight.
        cs.unrevealPage(parentId, page);
        return null;
      }
      current.layout = next;
      return { prevPositions, revealed: difference(cs.visibleNodeIds(), beforeVisible) };
    },

    /**
     * Opens the path down to `id`, ONE LEVEL AT A TIME.
     *
     * The steps are collected WITHOUT mutating the collapse state yet: mutation
     * happens one step at a time, in lockstep with the layout actually applied for
     * it. Otherwise an abort mid-cascade leaves the collapse state reporting nodes
     * as expanded/visible that have no entry in the published positions: they
     * silently never render, and that partially-merged layout goes on to corrupt
     * the next operation as its `prev`.
     *
     * Since pagination, the cascade opens PAGES as much as ancestors: expanding a
     * parent is no longer enough to make the target visible if it lives on an
     * unrevealed page. So we walk the COMPLETE parent chain (not just the collapsed
     * ones), and we reveal only the page of the child on the path — never the whole
     * prefix, otherwise reaching the 47,312th child would pay for 47,313 cards.
     */
    async revealPathTo(id: NodeId, stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      const { graph: g, collapse: cs, engine: eng } = current;
      if (!g.nodes.has(id) || cs.visibleNodeIds().has(id)) return null;

      const steps: FocusStep[] = [];
      let childOnPath: NodeId = id;
      let node = g.nodes.get(id);
      let parentId = node?.parentId ?? null;
      while (parentId !== null) {
        // `reverse()` ALSO reverses the within-level order: to run expand BEFORE
        // reveal at each level (revealing a page of a still-collapsed node shows
        // nothing), we push reveal first here.
        //
        // An ELIDED child on the path (`cardIndexOf` < 0) is a row of its parent's
        // card: it has no page to reveal.
        const cardIndex = cs.cardIndexOf(parentId, childOnPath);
        if (cardIndex >= 0 && !cs.revealedPages(parentId).has(pageOf(cardIndex))) {
          steps.push({ kind: "reveal", parentId, page: pageOf(cardIndex) });
        }
        if (!cs.isExpanded(parentId)) steps.push({ kind: "expand", id: parentId });
        childOnPath = parentId;
        node = g.nodes.get(parentId);
        parentId = node?.parentId ?? null;
      }
      steps.reverse(); // root-first, and expand before reveal at each level
      if (steps.length === 0) return null;

      const beforeVisible = cs.visibleNodeIds();
      const prevPositions = new Map(current.layout.positions);
      for (const step of steps) {
        if (stale()) return null;
        if (step.kind === "expand") cs.expand(step.id);
        else cs.revealPage(step.parentId, step.page);
        const prev = current.layout;
        const visible = cs.visibleNodeIds();
        // An explicit annotation: without it, `current.layout = next` below makes
        // `next`'s inference circular (it would depend on `current.layout`'s type,
        // which would depend on it).
        const next: LayoutResult =
          step.kind === "expand"
            ? await eng.layoutAfterExpand(prev, g, step.id, visible, current.metrics)
            : await eng.layoutAfterReveal(prev, g, step.parentId, visible, current.metrics);
        if (stale()) {
          // Superseded mid-cascade: revert ONLY this not-yet-applied step so the
          // collapse state never gets ahead of the layout by more than one in-flight
          // step.
          //
          // On a reveal step, the engine keeps the offset already accumulated for
          // this block: the same accepted approximation as `reveal`, whose comment
          // carries the complete reasoning.
          if (step.kind === "expand") cs.collapse(step.id);
          else cs.unrevealPage(step.parentId, step.page);
          return null;
        }
        current.layout = next;
      }
      return { prevPositions, revealed: difference(cs.visibleNodeIds(), beforeVisible) };
    },

    async tidy(stale: () => boolean): Promise<FoldStep | null> {
      const current = state;
      if (!current) return null;
      const { graph: g, collapse: cs, engine: eng } = current;
      const prevPositions = new Map(current.layout.positions);
      const visible = cs.visibleNodeIds();
      // The GLOBAL path, the initial layout's. It is affordable because the visible
      // set is bounded — card budget and sibling pages — and that is precisely what
      // makes this button possible.
      //
      // `layout()` also purges the engine's delta memory along the way: this global
      // arrangement becomes the new truth, and the offsets accumulated by past
      // expansions have nothing left to cancel. That is what makes `tidy` the repair
      // for incremental drift, and not merely a reframing.
      const next = await eng.layout(g, visible, current.metrics);
      // A concurrent operation published its own arrangement during the wait:
      // applying this one would overwrite it. No rollback to do, unlike `expand` —
      // nothing was mutated before the `await`.
      //
      // AN ACCEPTED APPROXIMATION: the delta purge already happened inside
      // `layout()`, synchronously with the call — a collapse from here to the next
      // tidy-up will undo too little. Same family of approximation as `reveal`'s
      // rollback above: Tidy repairs it.
      if (stale()) return null;
      current.layout = next;
      return { prevPositions, revealed: [] };
    },
  };
}
