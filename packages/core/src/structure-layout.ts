import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js"
import { nearestDrawn, type Graph, type GraphNode, type NodeId } from "./model.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The direction the layout flows in: `"RIGHT"` lays levels out as columns (the
 * structure view), `"DOWN"` as rows (the tree view). */
export type LayoutDirection = "RIGHT" | "DOWN"

/** Swaps a rect's axes. Its own inverse. */
function transposeRect(r: Rect): Rect {
  return { x: r.y, y: r.x, width: r.height, height: r.width }
}

/** Swaps every rect's axes — the engine's boundary in `"DOWN"` mode. */
function transposePositions(positions: Map<NodeId, Rect>): Map<NodeId, Rect> {
  const out = new Map<NodeId, Rect>()
  for (const [id, rect] of positions) out.set(id, transposeRect(rect))
  return out
}

/** The band occupied by the row at index `rowIndex` in card `card`. */
export function rowRectFor(card: Rect, rowIndex: number, metrics: NodeMetrics): Rect {
  return {
    x: card.x,
    y: card.y + metrics.headerHeight + rowIndex * metrics.rowHeight,
    width: card.width,
    height: metrics.rowHeight,
  }
}

/**
 * The rect that ANCHORS `id`: its card if it has one, the band of the row that
 * represents it on its parent's card if it is elided.
 *
 * This is the only point where elision enters the incremental layout.
 * `layoutAfterExpand` places the subtree at `anchor.x + anchor.width + 48`: for
 * an elided array, `anchor` is the band of its row, whose width is the parent
 * card's — the element cards therefore land 48 px to the right of that card, at
 * the HEIGHT of the row, which makes the expansion read as coming out of the
 * token.
 *
 * The parent of an elided node is drawn by construction (`buildGraph` only
 * elides under a parent that has a card), so its rect reads directly from
 * `positions`.
 */
export function anchorRectFor(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  id: NodeId,
  metrics: NodeMetrics = DEFAULT_METRICS,
): Rect | undefined {
  const node = graph.nodes.get(id)
  if (!node) return undefined
  if (!node.elided) return positions.get(id)

  const parentId = node.parentId
  if (parentId === null) return undefined
  const parent = graph.nodes.get(parentId)
  const parentRect = positions.get(parentId)
  if (!parent || !parentRect) return undefined

  const rowIndex = parent.rows.findIndex((r) => r.valueType === "array" && r.arrayId === id)
  if (rowIndex < 0) return parentRect
  return rowRectFor(parentRect, rowIndex, metrics)
}

/**
 * The CARD that represents `id` on screen: its own if it is drawn, otherwise
 * that of its nearest ancestor that has one.
 *
 * An elided, collapsed, or simply out-of-view node is NEVER in `positions`:
 * walking up `parentId` to the first id found there is therefore enough to name
 * the card the view actually shows of it — the value object's card if it is
 * expanded, the host entity's otherwise. `undefined` only remains when nothing
 * in the lineage is on screen, and the edge then really has no origin to show.
 *
 * Why the CARD and not the band of the row that carries the hidden node: making
 * the edge start from the band was a HALF-SIGNAL. The band says "this comes out
 * of here" but not from exactly where, and nothing distinguished an edge lifted
 * from a hidden value object from a reference carried by the entity itself —
 * both left the same card, one slightly lower than the other. The detail moved
 * to SELECTION, which labels each outgoing edge with the instantiated path
 * (`lines[0].productRef` versus `customerId`): the resting view stays sober, and
 * whoever wants to know selects. See `drawEdgeLabels` on the renderer side.
 *
 * The CONTAINMENT pass, on the other hand, keeps `anchorRectFor`: expanding an
 * array must keep reading as coming out of its token, which is a WHOLE signal —
 * the expanded row is precisely what the expansion shows.
 */
export function nearestCardRectFor(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  id: NodeId,
): Rect | undefined {
  let current: NodeId | null = id
  while (current !== null) {
    const rect = positions.get(current)
    if (rect) return rect
    const node: GraphNode | undefined = graph.nodes.get(current)
    if (!node) return undefined
    current = node.parentId
  }
  return undefined
}

/**
 * The rect an incremental path anchors on, expressed in the engine's FLOW SPACE.
 *
 * This is the one place where transposition does not commute. `anchorRectFor`
 * builds an elided array's anchor as a ROW BAND, using `headerHeight`/`rowHeight`
 * along y — real y. In flow space for `"DOWN"` that y is the flow's x, so the band
 * would be a slice of the layout's direction rather than a row: nonsense.
 *
 * So `"DOWN"` anchors an elided node on its nearest DRAWN card (its parent's) and
 * the expansion opens BELOW that card. "Coming out of the token" is a horizontal
 * reading; it does not translate to a vertical layout, and the same rule governs
 * the containment edges on the renderer's side.
 */
function anchorInFlowSpace(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  id: NodeId,
  metrics: NodeMetrics,
  direction: LayoutDirection,
): Rect | undefined {
  if (direction === "RIGHT") return anchorRectFor(graph, positions, id, metrics)
  const drawn = nearestDrawn(graph, id)
  return drawn === null ? undefined : positions.get(drawn)
}

/**
 * The containment edges as ELK sees them: every elided endpoint is resolved to
 * its nearest DRAWN ancestor. The edge `#p1 → tags` becomes a self-loop on `#p1`
 * and disappears; the edge `tags → tags[0]` becomes `#p1 → tags[0]`, which lays
 * the element cards out to the right of `#p1`.
 */
function drawnContainEdges(graph: Graph, visible: Set<NodeId>): ElkExtendedEdge[] {
  const edges: ElkExtendedEdge[] = []
  for (const edge of graph.containEdges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue
    const from = nearestDrawn(graph, edge.from)
    const to = nearestDrawn(graph, edge.to)
    if (from === null || to === null || from === to) continue
    edges.push({ id: `${from}->${to}`, sources: [from], targets: [to] })
  }
  return edges
}

/**
 * The ELK boxes of the visible nodes, an elided node having none.
 *
 * In `"DOWN"` mode the boxes are handed over TRANSPOSED: the engine works in a
 * flow space where the layout always runs along x (see
 * `createStructureLayoutEngine`).
 */
function drawnBoxes(
  graph: Graph,
  ids: Iterable<NodeId>,
  metrics: NodeMetrics,
  direction: LayoutDirection,
): ElkNode[] {
  const children: ElkNode[] = []
  for (const id of ids) {
    const node = graph.nodes.get(id)
    if (!node || node.elided) continue
    const size = measureNode(node, metrics)
    children.push(
      direction === "DOWN"
        ? { id, width: size.height, height: size.width }
        : { id, width: size.width, height: size.height },
    )
  }
  return children
}

export interface LayoutResult {
  positions: Map<NodeId, Rect>
}

/** The vertical gap between two cards, aligned on `elk.spacing.nodeNode`. */
const NODE_GAP = 24

/**
 * The ids `visible` adds relative to `prev`: what is left to LAY OUT.
 *
 * Elided nodes never have a rect, so `!prev.has(id)` would declare them "newly
 * visible" on EVERY call. They are discarded here, or the incremental layout
 * would believe it has a block to place when there is nothing to draw.
 */
function newlyVisibleIds(graph: Graph, prev: Map<NodeId, Rect>, visible: Set<NodeId>): NodeId[] {
  return [...visible].filter((id) => {
    const node = graph.nodes.get(id)
    return node !== undefined && !node.elided && !prev.has(id)
  })
}

/** A block laid out in isolation: its raw rects, its top-left corner, its height. */
interface IsolatedBlock {
  rects: Map<NodeId, Rect>
  minX: number
  minY: number
  height: number
}

/**
 * Lays `newlyVisible` out in ISOLATION (dedicated ELK layout, edges remapped
 * within the block's scope), and returns the raw block with its bbox — without
 * deciding where it lands.
 *
 * Shared by `layoutAfterExpand` and `layoutAfterReveal`: the two differ only in
 * their ANCHOR POINT and shifting rule, never in how the block is computed.
 * Keeping this mechanism single is what stops the two incremental paths from
 * drifting apart silently.
 *
 * `options` exists only for component packing (see `COLUMN_BLOCK_OPTIONS`): all
 * the rest of the config is common.
 */
async function layoutIsolatedBlock(
  elkFactory: ElkFactory,
  graph: Graph,
  newlyVisible: NodeId[],
  visible: Set<NodeId>,
  metrics: NodeMetrics,
  direction: LayoutDirection,
  options: Record<string, string> = LAYOUT_OPTIONS,
): Promise<IsolatedBlock> {
  const elk = elkFactory()

  // The block is laid out in isolation, so its edge remapping must happen within
  // ITS scope: an elided array of the block resolves there to an ancestor that
  // is not part of it. Elided nodes are added to the scope so `nearestDrawn` can
  // traverse them, but `drawnBoxes` gives them no box.
  const scope = new Set(newlyVisible)
  for (const id of visible) {
    const node = graph.nodes.get(id)
    if (node?.elided) scope.add(id)
  }

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: options,
    children: drawnBoxes(graph, newlyVisible, metrics, direction),
    edges: drawnContainEdges(graph, scope).filter(
      (e) => scope.has(e.sources[0]!) && scope.has(e.targets[0]!),
    ),
  }

  const result = await elk.layout(elkGraph)

  const rects = new Map<NodeId, Rect>()
  let minX = Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const child of result.children ?? []) {
    const rect: Rect = {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    }
    rects.set(child.id, rect)
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return { rects, minX, minY, height: maxY - minY }
}

/**
 * Writes the block into `into`, its top-left corner brought onto `(x, y)`. The
 * block comes out of ELK with an arbitrary origin: this is where, and nowhere
 * else, the anchor each incremental path chose becomes positions.
 */
function placeBlock(into: Map<NodeId, Rect>, block: IsolatedBlock, x: number, y: number): void {
  const offsetX = x - block.minX
  const offsetY = y - block.minY
  for (const [id, rect] of block.rects) {
    into.set(id, {
      x: rect.x + offsetX,
      y: rect.y + offsetY,
      width: rect.width,
      height: rect.height,
    })
  }
}

/**
 * The children of `parentId` that are CARDS, in `childIds` order.
 *
 * The elided ones are discarded: they are rows of the parent's card, they carry
 * no rank in the children's column. This is the same order as pagination's
 * (`CollapseState.cardIndexOf`) — the engine recomputes it from the graph rather
 * than depending on the collapse state, of which it stays independent.
 */
function cardChildrenOf(graph: Graph, parentId: NodeId): NodeId[] {
  const parent = graph.nodes.get(parentId)
  if (!parent) return []
  return parent.childIds.filter((childId) => {
    const child = graph.nodes.get(childId)
    return child !== undefined && !child.elided
  })
}

/** Where to insert a revealed block: column, block top, shift threshold. */
interface Insertion {
  colX: number
  blockTopY: number
  thresholdY: number
}

/**
 * The insertion point of a block of revealed cards in `parentId`'s children
 * column, deduced from the block's NEIGHBORHOOD in the card-children order.
 *
 * A revealed page is not an expansion: its cards belong to an already laid out
 * sequence, so they must fall WITHIN that sequence, at their rank, and not
 * beside the parent. Hence the order of preference:
 *  - a sibling laid out BEFORE the block: we land under it, same column;
 *  - failing that, a sibling laid out AFTER: we take its place and push it down;
 *  - failing that, nothing of this sibling group is laid out: we fall back to
 *    `layoutAfterExpand`'s lateral placement, the only landmark left.
 */
function insertionPointFor(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  parentId: NodeId,
  newlyVisible: Set<NodeId>,
  metrics: NodeMetrics,
  direction: LayoutDirection,
): Insertion | undefined {
  const cards = cardChildrenOf(graph, parentId)
  const firstNew = cards.findIndex((id) => newlyVisible.has(id))

  if (firstNew >= 0) {
    for (let i = firstNew - 1; i >= 0; i--) {
      const rect = positions.get(cards[i]!)
      // The last one laid out BEFORE the block: the block opens right under it,
      // and it does not move (its `y` is strictly above the threshold).
      if (rect) {
        const y = rect.y + rect.height + NODE_GAP
        return { colX: rect.x, blockTopY: y, thresholdY: y }
      }
    }
    for (let i = firstNew + 1; i < cards.length; i++) {
      const rect = positions.get(cards[i]!)
      // The first one laid out AFTER: the block takes its top, and it plus
      // everything below descends (inclusive threshold, it sits exactly on it).
      if (rect) return { colX: rect.x, blockTopY: rect.y, thresholdY: rect.y }
    }
  }

  const anchor = anchorInFlowSpace(graph, positions, parentId, metrics, direction)
  if (!anchor) return undefined
  // No sibling laid out: lateral placement, like an expansion. The threshold
  // stays the anchor's midline — `layoutAfterExpand`'s — or the anchor itself,
  // whose top is at `blockTopY`, would descend with the rest.
  return {
    colX: anchor.x + anchor.width + 48,
    blockTopY: anchor.y,
    thresholdY: anchor.y + anchor.height / 2,
  }
}

export type ElkFactory = () => InstanceType<typeof import("elkjs/lib/elk.bundled.js").default>

export interface StructureLayoutEngine {
  layout(graph: Graph, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<LayoutResult>
  layoutAfterExpand(
    prev: LayoutResult,
    graph: Graph,
    expandedId: NodeId,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<LayoutResult>
  /**
   * Inserts the cards of a freshly revealed page under `parentId`, WITHIN the
   * column of its already laid out children — unlike `layoutAfterExpand`, which
   * opens a subtree BESIDE its anchor.
   */
  layoutAfterReveal(
    prev: LayoutResult,
    graph: Graph,
    parentId: NodeId,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<LayoutResult>
  layoutAfterCollapse(
    prev: LayoutResult,
    graph: Graph,
    collapsedId: NodeId,
    visible: Set<NodeId>,
  ): LayoutResult
}

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "48",
  // Siblings keep their `childIds` order — the document's. Without it the layer
  // sweep reorders a column by the barycenter of the children it happens to
  // have, and a table's rows come out shuffled once a few of them are expanded.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
}

/**
 * The config of the REVEALED block. A revealed page is a slice of a sibling
 * group that the global layout would arrange in ONE column — but in the isolated
 * block the parent is missing, so each card is a connected component of its own
 * and ELK packs them side by side to balance the aspect ratio. The block would
 * come out as a grid, where the previous page is a column: refusing component
 * separation gives the sibling group back the alignment it would have had.
 *
 * `layoutAfterExpand` keeps `LAYOUT_OPTIONS`: its block is a SUBTREE opened to
 * the side, whose packing is the view's established geometry.
 */
const COLUMN_BLOCK_OPTIONS = {
  ...LAYOUT_OPTIONS,
  "elk.separateConnectedComponents": "false",
}

/**
 * Creates a layout engine that lays out the flat containment graph
 * (contain edges only, refEdges never participate) using elkjs.
 * By default it runs the bundled elk in-process (Node/tests); a renderer
 * can inject a worker-backed factory instead.
 *
 * `direction` (default `"RIGHT"`, bit-identical to the structure view) is
 * implemented by TRANSPOSITION at the engine's boundary, not by a second set of
 * incremental paths. The whole engine keeps working in a FLOW SPACE where the
 * layout always runs along x: `"DOWN"` hands ELK boxes with width and height
 * swapped, transposes every `positions` map coming in and transposes every map
 * going out. A layered RIGHT layout over transposed boxes IS a layered DOWN
 * layout over the real boxes, so the three incremental rules — place the block
 * beside the anchor, push what lies below the anchor's midline, undo that push on
 * collapse — become "place the block below the anchor, push what lies to the
 * right of its vertical midline" for free, and `expansionDeltas` stays coherent
 * because it too lives in flow space.
 *
 * Writing the three incremental paths twice, once per axis, would have doubled
 * exactly the arithmetic that took the longest to get right — and the second copy
 * would have drifted the first time one of them was fixed.
 *
 * The single non-commuting point is the elided-array anchor: see
 * `anchorInFlowSpace`.
 */
export function createStructureLayoutEngine(opts?: {
  elkFactory?: ElkFactory
  direction?: LayoutDirection
}): StructureLayoutEngine {
  const elkFactory: ElkFactory = opts?.elkFactory ?? (() => new ELK())
  const direction: LayoutDirection = opts?.direction ?? "RIGHT"

  /** Real space ↔ flow space. The identity in `"RIGHT"` mode. */
  const flip = (positions: Map<NodeId, Rect>): Map<NodeId, Rect> =>
    direction === "DOWN" ? transposePositions(positions) : positions

  // Private engine state: for each node expanded via layoutAfterExpand, the
  // vertical shift (delta) applied to nodes below its midline (thresholdY),
  // so a matching layoutAfterCollapse call can undo it precisely.
  const expansionDeltas: Map<NodeId, { delta: number; thresholdY: number }> = new Map()

  return {
    async layout(
      graph: Graph,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      // A global layout reshuffles every position: the memorized shifts describe
      // `y` values that no longer exist, and undoing them on a later collapse
      // would raise cards for no reason. The delta memory is only valid for the
      // sequence of incremental operations it was born in — this layout opens a
      // new one.
      expansionDeltas.clear()

      const elk = elkFactory()

      const elkGraph: ElkNode = {
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children: drawnBoxes(graph, visible, metrics, direction),
        edges: drawnContainEdges(graph, visible),
      }

      const result = await elk.layout(elkGraph)

      const positions = new Map<NodeId, Rect>()
      for (const child of result.children ?? []) {
        positions.set(child.id, {
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: child.width ?? 0,
          height: child.height ?? 0,
        })
      }

      return { positions: flip(positions) }
    },

    async layoutAfterExpand(
      prev: LayoutResult,
      graph: Graph,
      expandedId: NodeId,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      // Everything below runs in FLOW SPACE: transposed on the way in for
      // `"DOWN"`, transposed back on the way out.
      const prevFlow = flip(prev.positions)
      const positions = new Map<NodeId, Rect>()
      for (const [id, rect] of prevFlow) positions.set(id, { ...rect })

      const anchor = anchorInFlowSpace(graph, prevFlow, expandedId, metrics, direction)
      const newlyVisible = newlyVisibleIds(graph, prevFlow, visible)

      if (!anchor || newlyVisible.length === 0) {
        // Repeated/no-op expand of an already-expanded node: do NOT clobber a
        // previously recorded real delta (a later collapse still needs it to
        // undo the earlier shift). Only seed a zero entry when none exists yet.
        if (!expansionDeltas.has(expandedId)) {
          const thresholdY = anchor ? anchor.y + anchor.height / 2 : -Infinity
          expansionDeltas.set(expandedId, { delta: 0, thresholdY })
        }
        return { positions: flip(positions) }
      }

      // Step 1: layout the newly visible subgraph under expandedId in isolation,
      // using the same elk config as the main layout.
      const block = await layoutIsolatedBlock(
        elkFactory, graph, newlyVisible, visible, metrics, direction,
      )
      const subtreeBBoxHeight = block.height

      // Step 2: offset the subgraph so its top-left lands at
      // (rect(expandedId).x + rect(expandedId).width + 48, rect(expandedId).y).
      placeBlock(positions, block, anchor.x + anchor.width + 48, anchor.y)

      // Step 3: shift down every already-present node (necessarily outside the
      // subtree, since the subtree is exactly what was newly made visible)
      // below the expanded node's midline, by however much the subtree
      // overflows the expanded node's own height.
      const delta = Math.max(0, subtreeBBoxHeight - anchor.height)
      const threshold = anchor.y + anchor.height / 2
      if (delta > 0) {
        for (const [id, rect] of prevFlow) {
          if (rect.y > threshold) {
            positions.set(id, { ...rect, y: rect.y + delta })
          }
        }
      }

      // Step 4: remember delta (and the threshold it was applied above) so a
      // matching collapse can undo the shift.
      expansionDeltas.set(expandedId, { delta, thresholdY: threshold })

      return { positions: flip(positions) }
    },

    async layoutAfterReveal(
      prev: LayoutResult,
      graph: Graph,
      parentId: NodeId,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      const prevFlow = flip(prev.positions)
      const positions = new Map<NodeId, Rect>()
      for (const [id, rect] of prevFlow) positions.set(id, { ...rect })

      const newlyVisible = newlyVisibleIds(graph, prevFlow, visible)
      // Revealing a page of a collapsed node, or re-revealing an already laid
      // out page, adds nothing to draw: lay out NOTHING and shift NOTHING, like
      // `layoutAfterExpand`'s no-op branch. Shifting here would dig a hole no
      // collapse could ever close.
      if (newlyVisible.length === 0) return { positions: flip(positions) }

      const insertion = insertionPointFor(
        graph, prevFlow, parentId, new Set(newlyVisible), metrics, direction,
      )
      if (!insertion) return { positions: flip(positions) }

      const block = await layoutIsolatedBlock(
        elkFactory, graph, newlyVisible, visible, metrics, direction, COLUMN_BLOCK_OPTIONS,
      )

      placeBlock(positions, block, insertion.colX, insertion.blockTopY)

      // The block is INSERTED: everything starting at the insertion point or
      // below makes room for it, by its height plus the inter-card gap. The
      // threshold is inclusive because the next card sits exactly on it.
      const delta = block.height + NODE_GAP
      for (const [id, rect] of prevFlow) {
        if (rect.y >= insertion.thresholdY) {
          positions.set(id, { ...rect, y: rect.y + delta })
        }
      }

      // The shift is memorized under `parentId` — the key of the collapse that
      // will undo it — and ACCUMULATED: several pages can be revealed before any
      // collapse, and overwriting the entry would leave the previous shifts
      // orphaned on cards that would then never return to their place. Summing
      // the deltas and keeping the highest threshold is an accepted
      // approximation — the same family as the one documented at the top of
      // `layoutAfterCollapse`: it undoes too broadly when the inserted blocks do
      // not overlap exactly, and `tidy()` is what repairs it.
      const previous = expansionDeltas.get(parentId)
      expansionDeltas.set(
        parentId,
        previous
          ? {
              delta: previous.delta + delta,
              thresholdY: Math.min(previous.thresholdY, insertion.thresholdY),
            }
          : { delta, thresholdY: insertion.thresholdY },
      )

      return { positions: flip(positions) }
    },

    layoutAfterCollapse(
      prev: LayoutResult,
      _graph: Graph,
      collapsedId: NodeId,
      visible: Set<NodeId>,
    ): LayoutResult {
      const prevFlow = flip(prev.positions)
      const positions = new Map<NodeId, Rect>()
      const nowInvisible: NodeId[] = []
      for (const [id, rect] of prevFlow) {
        if (!visible.has(id)) {
          nowInvisible.push(id)
          continue
        }
        positions.set(id, { ...rect })
      }

      // Undo the shift recorded for collapsedId itself, plus the shift
      // recorded for any node that becomes invisible as a side effect of
      // this collapse (e.g. a descendant that had independently been
      // expanded while nested under collapsedId — its own downward shift
      // would otherwise be left stale on the remaining, still-visible
      // siblings). Applying each recorded shift independently is a faithful
      // inverse in the nominal case (one expand undone by its matching
      // collapse); when several nested expansions are collapsed together in
      // a single call, undoing each shift independently rather than solving
      // for the exact composition of overlapping shifts is an accepted
      // approximation for incremental layout.
      const idsToUndo = new Set<NodeId>([collapsedId, ...nowInvisible])
      const entries: { delta: number; thresholdY: number }[] = []
      for (const id of idsToUndo) {
        const entry = expansionDeltas.get(id)
        if (entry) entries.push(entry)
      }

      for (const entry of entries) {
        if (entry.delta === 0) continue
        for (const [id, rect] of positions) {
          if (rect.y > entry.thresholdY) {
            positions.set(id, { ...rect, y: rect.y - entry.delta })
          }
        }
      }

      for (const id of idsToUndo) expansionDeltas.delete(id)

      return { positions: flip(positions) }
    },
  }
}
