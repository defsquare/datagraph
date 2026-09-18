import type { Graph, NodeId } from "./model.js"

/**
 * Number of card children revealed at once. Pagination exists because a single
 * node can carry hundreds of thousands of children: measuring, laying out and
 * drawing all that costs more than a screen can show.
 */
export const PAGE_SIZE = 100

/**
 * The ALIGNED page containing the given card index: page `p` covers exactly
 * `[p * PAGE_SIZE, (p + 1) * PAGE_SIZE)`. That alignment is what makes a page
 * identifiable by a single integer, hence revealable, undoable and comparable
 * without memorizing bounds.
 */
export function pageOf(cardIndex: number): number {
  return Math.floor(cardIndex / PAGE_SIZE)
}

/**
 * Number of cards the initial expansion allows itself to "buy". This is not a
 * rendering limit but a PREVIEW limit: beyond it, what opens is no longer
 * readable and the layout cost becomes that of the whole document.
 */
export const INITIAL_CARD_BUDGET = 300

/**
 * A CONTIGUOUS range of unrevealed card children: enough to draw a "… n more"
 * token at its place in the child order, and to know which page to reveal when
 * it is clicked.
 */
export interface HiddenGap {
  fromIndex: number
  count: number
  nextPage: number
}

/**
 * Tracks which nodes of a Graph are expanded vs collapsed, and derives
 * visibility from that state.
 *
 * Initial state (constructor): BFS from the root, marking every
 * non-entity node encountered as expanded; descent stops at the first
 * entity node on each branch (entities start collapsed) — unless
 * `expandEntities` lifts that boundary.
 *
 * This expansion is further BOUNDED by a card budget (`initialCardBudget`,
 * default `INITIAL_CARD_BUDGET`): with no entities — the CLI-without-config case
 * — the entity boundary slows nothing down and the BFS would expand the whole
 * document. The budget makes the initial state a PREVIEW of the top levels; what
 * it turns down stays visible, simply collapsed.
 */
export class CollapseState {
  private readonly graph: Graph
  private readonly expanded: Set<NodeId> = new Set()
  /**
   * Revealed pages of card children, per node. The ABSENCE of an entry means
   * `{0}`: ordinary expansion therefore writes nothing, and pagination kicks in
   * by itself as soon as a node exceeds `PAGE_SIZE` card children — that is what
   * keeps the cost of the state proportional to the open pages, not to the
   * graph. The PRESENCE of an entry is authoritative, even when empty:
   * `unrevealPage(id, 0)` is a legitimate state ("nothing revealed") and not a
   * return to the default.
   *
   * `collapse()` does not touch this map: the revealed pages of a collapsed node
   * are KEPT, same policy as the `expanded` set — re-expanding shows again what
   * had been revealed.
   */
  private readonly revealed: Map<NodeId, Set<number>> = new Map()
  private static readonly DEFAULT_PAGES: ReadonlySet<number> = new Set([0])

  constructor(
    graph: Graph,
    opts: {
      initialCardBudget?: number
      /**
       * Lifts the entity boundary: the BFS descends THROUGH entities instead of
       * stopping at them. For the tree view, whose every node below the root is an
       * entity — a tree that opens entirely collapsed shows nothing but its roots.
       *
       * The card budget still applies unchanged: "fully expanded" means everything
       * the budget affords, top levels first. A normalised document with 100k
       * entities must not enter ELK in one call.
       */
      expandEntities?: boolean
    } = {},
  ) {
    this.graph = graph
    const budget = opts.initialCardBudget ?? INITIAL_CARD_BUDGET
    const expandEntities = opts.expandEntities ?? false

    // The historical BFS expanded everything down to the entity boundaries —
    // without a config there are no entities, hence no brake, and the whole
    // document went into ELK in one call (16 s at 50k nodes). The budget is the
    // second brake: we stop MARKING nodes expanded once enough visible cards
    // have been "bought". The BFS serves the top levels first — that is the
    // preview. A node reached but not marked stays a visible collapsed card.
    let cards = 1 // the root itself
    const queue: NodeId[] = [graph.rootId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = graph.nodes.get(id)
      if (!node) continue
      // The root is always expanded/visible, even in the (unusual) case
      // where it is itself an entity node; its children still respect
      // the entity-boundary rule below.
      if (!expandEntities && node.kind === "entity" && id !== graph.rootId) continue

      // Expanding `id` reveals its first page of card children: that is what it
      // costs the budget. The root is always expanded — a document that opens on
      // nothing at all is not a preview.
      const cost = Math.min(this.cardChildren(id).length, PAGE_SIZE)
      if (id !== graph.rootId && cards + cost > budget) continue
      cards += cost

      this.expanded.add(id)
      if (!expandEntities && node.kind === "entity") continue // do not descend past an entity boundary

      // Only enqueue what can become visible: the elided ones (always rows) and
      // the FIRST page of card children. Enqueueing beyond that would spend the
      // budget marking expanded nodes that the pages hide anyway.
      let cardIndex = 0
      for (const childId of node.childIds) {
        const child = graph.nodes.get(childId)
        if (!child) continue
        if (child.elided) {
          queue.push(childId)
          continue
        }
        if (cardIndex < PAGE_SIZE) queue.push(childId)
        cardIndex++
      }
    }
  }

  isExpanded(id: NodeId): boolean {
    return this.expanded.has(id)
  }

  expand(id: NodeId): void {
    this.expanded.add(id)
  }

  collapse(id: NodeId): void {
    this.expanded.delete(id)
  }

  revealedPages(id: NodeId): ReadonlySet<number> {
    return this.revealed.get(id) ?? CollapseState.DEFAULT_PAGES
  }

  revealPage(id: NodeId, page: number): void {
    this.mutablePages(id).add(page)
  }

  unrevealPage(id: NodeId, page: number): void {
    this.mutablePages(id).delete(page)
  }

  /**
   * The mutable page set of `id`, materialized from the default on first write.
   * Copying `DEFAULT_PAGES` rather than sharing it is vital: it is static, and
   * mutating it would repaginate the whole graph at once.
   */
  private mutablePages(id: NodeId): Set<number> {
    let pages = this.revealed.get(id)
    if (!pages) {
      pages = new Set(CollapseState.DEFAULT_PAGES)
      this.revealed.set(id, pages)
    }
    return pages
  }

  /**
   * The children of `id` that are CARDS, in `childIds` order. The elided ones
   * are discarded because they are rows of `id`'s card: they do not paginate,
   * and counting them would shift the index of the real cards.
   */
  private cardChildren(id: NodeId): NodeId[] {
    const node = this.graph.nodes.get(id)
    if (!node) return []
    return node.childIds.filter((childId) => {
      const child = this.graph.nodes.get(childId)
      return child !== undefined && !child.elided
    })
  }

  /** Rank of `childId` among `parentId`'s card children; -1 if absent or elided. */
  cardIndexOf(parentId: NodeId, childId: NodeId): number {
    return this.cardChildren(parentId).indexOf(childId)
  }

  /**
   * The unrevealed ranges of `id`'s card children, in increasing index order.
   * Consecutive unrevealed pages are MERGED into a single range: on screen they
   * are replaced by one token, and revealing it eats into the gap from its first
   * page (`nextPage`).
   */
  hiddenGaps(id: NodeId): HiddenGap[] {
    const cards = this.cardChildren(id)
    const pageCount = Math.ceil(cards.length / PAGE_SIZE)
    const pages = this.revealedPages(id)
    const gaps: HiddenGap[] = []
    let page = 0
    while (page < pageCount) {
      if (pages.has(page)) {
        page++
        continue
      }
      const start = page
      while (page < pageCount && !pages.has(page)) page++
      const fromIndex = start * PAGE_SIZE
      // The last page is incomplete: clamp on the real card count, or the token
      // would announce children that do not exist.
      const count = Math.min(page * PAGE_SIZE, cards.length) - fromIndex
      gaps.push({ fromIndex, count, nextPage: start })
    }
    return gaps
  }

  /**
   * DFS from root; a node is included as soon as it is reached (its
   * parent chain is all expanded), and we only descend through it if
   * it is itself expanded. Root is always expanded and always visible.
   *
   * An ELIDED child escapes that rule: it is not a card to reveal but a ROW of
   * its parent's card, so it is there as soon as that card is, without waiting
   * for the parent to be expanded. That is what makes the `[ n items ]` token
   * visible on a collapsed entity — otherwise the token would be drawn (rows
   * always are) while the node it drives would not exist as far as collapse is
   * concerned, and the click would expand nothing.
   *
   * A CARD child, on the other hand, is not enough to be reached: its page must
   * be revealed. The card index is tracked along the traversal rather than
   * through `cardIndexOf`, which would rebuild the filtered list for each child.
   */
  visibleNodeIds(): Set<NodeId> {
    const visible = new Set<NodeId>()
    const stack: NodeId[] = [this.graph.rootId]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = this.graph.nodes.get(id)
      if (!node) continue
      visible.add(id)
      const expanded = this.isExpanded(id)
      const pages = this.revealedPages(id)
      let cardIndex = 0
      for (const childId of node.childIds) {
        const child = this.graph.nodes.get(childId)
        if (!child) continue
        if (child.elided) {
          stack.push(childId)
          continue
        }
        if (expanded && pages.has(pageOf(cardIndex))) stack.push(childId)
        cardIndex++
      }
    }
    return visible
  }

  /**
   * Expands every ancestor of `id` (not `id` itself). Returns the ids
   * that were newly expanded by this call, in root-first order.
   * Idempotent: calling again with the same id returns [].
   *
   * ALSO reveals, at each link of the path, the page containing the next child:
   * since pagination, an expanded ancestor no longer guarantees the visibility
   * of its descendants. Those reveals are a side effect — they do not enter the
   * return value, which stays the list of expansions.
   */
  expandPathTo(id: NodeId): NodeId[] {
    const ancestors: NodeId[] = []
    let node = this.graph.nodes.get(id)
    let parentId = node?.parentId ?? null
    while (parentId !== null) {
      ancestors.push(parentId)
      node = this.graph.nodes.get(parentId)
      parentId = node?.parentId ?? null
    }
    ancestors.reverse() // root-first

    const newly: NodeId[] = []
    for (const ancestorId of ancestors) {
      if (!this.expanded.has(ancestorId)) {
        this.expanded.add(ancestorId)
        newly.push(ancestorId)
      }
    }

    // Second pass over the COMPLETE chain — not just over `newly`: an already
    // expanded parent may very well have the wrong page revealed. We reveal only
    // the page of the path's child, never the whole prefix, or reaching
    // `/orders/47312` would pay for 47313 cards. An elided child
    // (`cardIndexOf` < 0) is a row of its parent's card: it is already visible,
    // it has no page.
    let childId: NodeId = id
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const parentId = ancestors[i]!
      const index = this.cardIndexOf(parentId, childId)
      if (index >= 0) this.revealPage(parentId, pageOf(index))
      childId = parentId
    }

    return newly
  }
}
