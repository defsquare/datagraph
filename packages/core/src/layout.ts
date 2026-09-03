import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js"
import { nearestDrawn, type Graph, type NodeId } from "./model.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** La bande occupée par la ligne d'indice `rowIndex` dans la carte `card`. */
export function rowRectFor(card: Rect, rowIndex: number, metrics: NodeMetrics): Rect {
  return {
    x: card.x,
    y: card.y + metrics.headerHeight + rowIndex * metrics.rowHeight,
    width: card.width,
    height: metrics.rowHeight,
  }
}

/**
 * Le rect qui ANCRE `id` : sa carte s'il en a une, la bande de la ligne qui le
 * représente sur la carte de son parent s'il est élidé.
 *
 * C'est le seul point où l'élision entre dans la mise en page incrémentale.
 * `layoutAfterExpand` place le sous-arbre à `anchor.x + anchor.width + 48` :
 * pour un tableau élidé, `anchor` est la bande de sa ligne, dont la largeur
 * est celle de la carte parente — les cartes d'éléments atterrissent donc 48 px
 * à droite de cette carte, à la HAUTEUR de la ligne, ce qui fait lire le
 * dépliage comme sortant du jeton.
 *
 * Le parent d'un nœud élidé est dessiné par construction (`buildGraph` n'élide
 * que sous un parent qui a une carte), donc son rect se lit directement dans
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
 * Les arêtes de containment vues par ELK : chaque extrémité élidée est
 * résolue vers son plus proche ancêtre DESSINÉ. L'arête `#p1 → tags` devient
 * une boucle sur `#p1` et disparaît ; l'arête `tags → tags[0]` devient
 * `#p1 → tags[0]`, ce qui fait poser les cartes d'éléments à droite de `#p1`.
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

/** Les boîtes ELK des nœuds visibles, un nœud élidé n'en ayant aucune. */
function drawnBoxes(graph: Graph, ids: Iterable<NodeId>, metrics: NodeMetrics): ElkNode[] {
  const children: ElkNode[] = []
  for (const id of ids) {
    const node = graph.nodes.get(id)
    if (!node || node.elided) continue
    const size = measureNode(node, metrics)
    children.push({ id, width: size.width, height: size.height })
  }
  return children
}

export interface LayoutResult {
  positions: Map<NodeId, Rect>
}

export type ElkFactory = () => InstanceType<typeof import("elkjs/lib/elk.bundled.js").default>

export interface LayoutEngine {
  layout(graph: Graph, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<LayoutResult>
  layoutAfterExpand(
    prev: LayoutResult,
    graph: Graph,
    expandedId: NodeId,
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
}

/**
 * Creates a layout engine that lays out the flat containment graph
 * (contain edges only, refEdges never participate) using elkjs.
 * By default it runs the bundled elk in-process (Node/tests); a renderer
 * can inject a worker-backed factory instead.
 */
export function createLayoutEngine(opts?: { elkFactory?: ElkFactory }): LayoutEngine {
  const elkFactory: ElkFactory = opts?.elkFactory ?? (() => new ELK())

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
      const elk = elkFactory()

      const elkGraph: ElkNode = {
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children: drawnBoxes(graph, visible, metrics),
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

      return { positions }
    },

    async layoutAfterExpand(
      prev: LayoutResult,
      graph: Graph,
      expandedId: NodeId,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      const positions = new Map<NodeId, Rect>()
      for (const [id, rect] of prev.positions) positions.set(id, { ...rect })

      const anchor = anchorRectFor(graph, prev.positions, expandedId, metrics)
      // Les nœuds élidés n'ont jamais de rect, donc `!prev.positions.has(id)`
      // les déclarerait « nouvellement visibles » à CHAQUE dépliage. Ils sont
      // écartés ici, sans quoi la mise en page incrémentale croirait avoir un
      // sous-arbre à placer alors qu'il n'y a rien à dessiner.
      const newlyVisible = [...visible].filter((id) => {
        const node = graph.nodes.get(id)
        return node !== undefined && !node.elided && !prev.positions.has(id)
      })

      if (!anchor || newlyVisible.length === 0) {
        // Repeated/no-op expand of an already-expanded node: do NOT clobber a
        // previously recorded real delta (a later collapse still needs it to
        // undo the earlier shift). Only seed a zero entry when none exists yet.
        if (!expansionDeltas.has(expandedId)) {
          const thresholdY = anchor ? anchor.y + anchor.height / 2 : -Infinity
          expansionDeltas.set(expandedId, { delta: 0, thresholdY })
        }
        return { positions }
      }

      // Step 1: layout the newly visible subgraph under expandedId in isolation,
      // using the same elk config as the main layout.
      const elk = elkFactory()
      // Le sous-graphe est mis en page en isolation, donc son remappage
      // d'arêtes doit se faire dans SON périmètre : un tableau élidé du
      // sous-arbre y résout vers un ancêtre qui, lui, n'en fait pas partie.
      // Les nœuds élidés sont ajoutés au périmètre pour que `nearestDrawn`
      // puisse les traverser, mais `drawnBoxes` ne leur donne pas de boîte.
      const scope = new Set(newlyVisible)
      for (const id of visible) {
        const node = graph.nodes.get(id)
        if (node?.elided) scope.add(id)
      }

      const elkGraph: ElkNode = {
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children: drawnBoxes(graph, newlyVisible, metrics),
        edges: drawnContainEdges(graph, scope).filter(
          (e) => scope.has(e.sources[0]!) && scope.has(e.targets[0]!),
        ),
      }

      const result = await elk.layout(elkGraph)

      const rawPositions = new Map<NodeId, Rect>()
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
        rawPositions.set(child.id, rect)
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
        maxY = Math.max(maxY, rect.y + rect.height)
      }
      const subtreeBBoxHeight = maxY - minY

      // Step 2: offset the subgraph so its top-left lands at
      // (rect(expandedId).x + rect(expandedId).width + 48, rect(expandedId).y).
      const offsetX = anchor.x + anchor.width + 48 - minX
      const offsetY = anchor.y - minY

      for (const [id, rect] of rawPositions) {
        positions.set(id, {
          x: rect.x + offsetX,
          y: rect.y + offsetY,
          width: rect.width,
          height: rect.height,
        })
      }

      // Step 3: shift down every already-present node (necessarily outside the
      // subtree, since the subtree is exactly what was newly made visible)
      // below the expanded node's midline, by however much the subtree
      // overflows the expanded node's own height.
      const delta = Math.max(0, subtreeBBoxHeight - anchor.height)
      const threshold = anchor.y + anchor.height / 2
      if (delta > 0) {
        for (const [id, rect] of prev.positions) {
          if (rect.y > threshold) {
            positions.set(id, { ...rect, y: rect.y + delta })
          }
        }
      }

      // Step 4: remember delta (and the threshold it was applied above) so a
      // matching collapse can undo the shift.
      expansionDeltas.set(expandedId, { delta, thresholdY: threshold })

      return { positions }
    },

    layoutAfterCollapse(
      prev: LayoutResult,
      _graph: Graph,
      collapsedId: NodeId,
      visible: Set<NodeId>,
    ): LayoutResult {
      const positions = new Map<NodeId, Rect>()
      const nowInvisible: NodeId[] = []
      for (const [id, rect] of prev.positions) {
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

      return { positions }
    },
  }
}
