import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js"
import { nearestDrawn, type Graph, type NodeId } from "./model.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
import type { ElkFactory, LayoutResult, Rect } from "./structure-layout.js"

/**
 * The TREE VIEW's layout: one GLOBAL ELK pass over the visible set, top to
 * bottom, and nothing else.
 *
 * Deliberately NOT the structure engine given a direction. The structure view is
 * incremental — a fold inserts a block into an existing arrangement and pushes
 * what lies below it, which is what makes its gestures instantaneous on 47,000
 * cards — and paying for that arithmetic twice, once per axis, was what made the
 * tree view an adaptation of the structure view rather than a view of its own
 * (ADR-0043). The tree's visible set is bounded by the same card budget and the
 * same pagination, so a global layered pass is affordable on every gesture: the
 * whole engine is therefore this one function, with no private state to keep in
 * step with a collapse state, no delta memory to purge, and hence no `tidy` to
 * repair a drift that cannot happen.
 *
 * The `LayoutResult`/`Rect`/`ElkFactory` types are the structure layout's, and
 * that sharing is on purpose: a rect is a rect, and the renderer must be able to
 * read the two views' positions through one type. Nothing else is shared — this
 * module imports no FUNCTION from `structure-layout.ts`.
 */

/** The gaps between cards. Same values as the structure layout's, so a card
 * reads at the same density in both views; they are written again here rather
 * than imported because they belong to this layout's own configuration. */
const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.spacing.nodeNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "48",
  // Without it the layer sweep sorts siblings by the barycenter of whatever
  // subtrees happen to be open, and `childIds` order — document order, roots
  // first — is decided and then not shown. Same reason as the structure view's.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
}

/**
 * The size ELK is given for the tree graph's synthetic ROOT: a 1×1 point.
 *
 * The root is in the MODEL — `CollapseState` and the search index need a node to
 * start from — but it is never drawn: it carries no data of the document, only
 * the entities nothing claimed. Giving it a real card would put an empty box at
 * the top of every tree; dropping it from the layout altogether would split the
 * forest into as many disconnected components as there are roots, which ELK
 * would then pack side by side at arbitrary heights. A 1×1 box keeps the graph
 * connected — so the top-level entities line up on the first row — and is then
 * removed from the returned positions, which is what makes it undrawable by
 * construction: the renderer materialises cards from `positions`.
 */
const ROOT_BOX = { width: 1, height: 1 }

export interface TreeLayout {
  layout(graph: Graph, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<LayoutResult>
}

/**
 * The ELK boxes of the visible nodes, an elided node having none: it is a row of
 * its parent's card, not a card of its own.
 */
function boxesFor(graph: Graph, visible: Set<NodeId>, metrics: NodeMetrics): ElkNode[] {
  const children: ElkNode[] = []
  for (const id of visible) {
    const node = graph.nodes.get(id)
    if (!node || node.elided) continue
    if (id === graph.rootId) {
      children.push({ id, ...ROOT_BOX })
      continue
    }
    const size = measureNode(node, metrics)
    children.push({ id, width: size.width, height: size.height })
  }
  return children
}

/**
 * The containment edges as ELK sees them: every elided endpoint resolved to its
 * nearest DRAWN ancestor. The edge `#p1 → tags` becomes a self-loop on `#p1` and
 * disappears; `tags → tags[0]` becomes `#p1 → tags[0]`, so the elements hang
 * under the entity's card rather than under a box that has none.
 */
function drawnEdges(graph: Graph, visible: Set<NodeId>): ElkExtendedEdge[] {
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
 * Creates the tree view's layout. `elkFactory` is injected the same way the
 * structure engine's is, so a renderer can hand over a worker-backed ELK and the
 * tests an in-process one.
 */
export function createTreeLayout(opts?: { elkFactory?: ElkFactory }): TreeLayout {
  const elkFactory: ElkFactory = opts?.elkFactory ?? (() => new ELK())

  return {
    async layout(
      graph: Graph,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      const elk = elkFactory()

      const result = await elk.layout({
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children: boxesFor(graph, visible, metrics),
        edges: drawnEdges(graph, visible),
      })

      const positions = new Map<NodeId, Rect>()
      for (const child of result.children ?? []) {
        // The synthetic root is dropped here and nowhere else: it took part in
        // the layout (see `ROOT_BOX`) and must not survive it.
        if (child.id === graph.rootId) continue
        positions.set(child.id, {
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: child.width ?? 0,
          height: child.height ?? 0,
        })
      }

      return { positions }
    },
  }
}
