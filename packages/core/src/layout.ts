import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js"
import type { Graph, NodeId } from "./model.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
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
  // vertical shift (delta) applied to nodes below it, so the matching
  // layoutAfterCollapse call can undo it precisely.
  const expansionDeltas: Map<NodeId, number> = new Map()

  return {
    async layout(
      graph: Graph,
      visible: Set<NodeId>,
      metrics: NodeMetrics = DEFAULT_METRICS,
    ): Promise<LayoutResult> {
      const elk = elkFactory()

      const children: ElkNode[] = []
      for (const id of visible) {
        const node = graph.nodes.get(id)
        if (!node) continue
        const size = measureNode(node, metrics)
        children.push({ id, width: size.width, height: size.height })
      }

      const edges: ElkExtendedEdge[] = []
      for (const edge of graph.containEdges) {
        if (!visible.has(edge.from) || !visible.has(edge.to)) continue
        edges.push({
          id: `${edge.from}->${edge.to}`,
          sources: [edge.from],
          targets: [edge.to],
        })
      }

      const elkGraph: ElkNode = {
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children,
        edges,
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

      const anchor = prev.positions.get(expandedId)
      const newlyVisible = [...visible].filter((id) => !prev.positions.has(id))

      if (!anchor || newlyVisible.length === 0) {
        expansionDeltas.set(expandedId, 0)
        return { positions }
      }

      // Step 1: layout the newly visible subgraph under expandedId in isolation,
      // using the same elk config as the main layout.
      const elk = elkFactory()
      const newlyVisibleSet = new Set(newlyVisible)

      const children: ElkNode[] = []
      for (const id of newlyVisible) {
        const node = graph.nodes.get(id)
        if (!node) continue
        const size = measureNode(node, metrics)
        children.push({ id, width: size.width, height: size.height })
      }

      const edges: ElkExtendedEdge[] = []
      for (const edge of graph.containEdges) {
        if (!newlyVisibleSet.has(edge.from) || !newlyVisibleSet.has(edge.to)) continue
        edges.push({
          id: `${edge.from}->${edge.to}`,
          sources: [edge.from],
          targets: [edge.to],
        })
      }

      const elkGraph: ElkNode = {
        id: "root",
        layoutOptions: LAYOUT_OPTIONS,
        children,
        edges,
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

      // Step 4: remember delta so a matching collapse can undo the shift.
      expansionDeltas.set(expandedId, delta)

      return { positions }
    },

    layoutAfterCollapse(
      prev: LayoutResult,
      _graph: Graph,
      collapsedId: NodeId,
      visible: Set<NodeId>,
    ): LayoutResult {
      const positions = new Map<NodeId, Rect>()
      for (const [id, rect] of prev.positions) {
        if (!visible.has(id)) continue
        positions.set(id, { ...rect })
      }

      const delta = expansionDeltas.get(collapsedId) ?? 0
      expansionDeltas.delete(collapsedId)

      if (delta > 0) {
        const anchor = prev.positions.get(collapsedId)
        const threshold = anchor ? anchor.y + anchor.height / 2 : -Infinity
        for (const [id, rect] of positions) {
          if (rect.y > threshold) {
            positions.set(id, { ...rect, y: rect.y - delta })
          }
        }
      }

      return { positions }
    },
  }
}
