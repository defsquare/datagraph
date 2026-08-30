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
  }
}
