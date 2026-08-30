import type { GraphNode } from "./model.js"

export interface Size {
  width: number
  height: number
}

export interface NodeMetrics {
  charWidth: number
  rowHeight: number
  headerHeight: number
  paddingX: number
  maxTextChars: number
}

export const DEFAULT_METRICS: NodeMetrics = {
  charWidth: 7.2,
  rowHeight: 20,
  headerHeight: 28,
  paddingX: 12,
  maxTextChars: 42,
}

/**
 * Computes a node's on-screen size deterministically, with no DOM access:
 * width scales with the longest "key: value" row text (capped at
 * maxTextChars), height scales with the row count.
 */
export function measureNode(node: GraphNode, metrics: NodeMetrics = DEFAULT_METRICS): Size {
  let longest = node.label.length
  for (const row of node.rows) {
    const line = `${row.key}: ${row.value}`
    if (line.length > longest) longest = line.length
  }
  const chars = Math.min(metrics.maxTextChars, longest)
  const width = chars * metrics.charWidth + 2 * metrics.paddingX
  const height = metrics.headerHeight + node.rows.length * metrics.rowHeight

  return { width, height }
}
