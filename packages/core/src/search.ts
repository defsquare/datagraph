import type { EntityNode, Graph, GraphNode, NodeId } from "./model.js"

export interface SearchResult {
  nodeId: NodeId
  field: string | null
  matched: string
}

interface SearchEntry {
  nodeId: NodeId
  field: string | null
  text: string
  lower: string
}

export class SearchIndex {
  private entries: SearchEntry[]

  constructor(entries: SearchEntry[]) {
    this.entries = entries
  }

  search(query: string): SearchResult[] {
    // Empty query returns empty array
    if (query === "") {
      return []
    }

    const lowerQuery = query.toLowerCase()
    const results: SearchResult[] = []
    const seen = new Set<string>() // Track nodeId+field combinations for deduplication

    // Iterate through entries in order (preserves document order)
    for (const entry of this.entries) {
      if (entry.lower.includes(lowerQuery)) {
        // Deduplicate: one node appears at most once per matched field
        const key = `${entry.nodeId}:${entry.field}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({
            nodeId: entry.nodeId,
            field: entry.field,
            matched: entry.text,
          })
        }
      }
    }

    return results
  }
}

export function buildSearchIndex(graph: Graph): SearchIndex {
  const entries: SearchEntry[] = []

  // Iterate through nodes in insertion order (Map preserves insertion order in JS)
  for (const node of graph.nodes.values()) {
    // Add label (field: null)
    entries.push({
      nodeId: node.id,
      field: null,
      text: node.label,
      lower: node.label.toLowerCase(),
    })

    // If entity node, add entityId (field: null)
    if (node.kind === "entity") {
      const entityNode = node as EntityNode
      entries.push({
        nodeId: node.id,
        field: null,
        text: entityNode.entityId,
        lower: entityNode.entityId.toLowerCase(),
      })
    }

    // Add each row key and value
    for (const row of node.rows) {
      // Add row key with field set to row key (same dedup bucket as value)
      entries.push({
        nodeId: node.id,
        field: row.key,
        text: row.key,
        lower: row.key.toLowerCase(),
      })

      // Add row value with field set to row key (same dedup bucket as key)
      const valueStr = String(row.value)
      entries.push({
        nodeId: node.id,
        field: row.key,
        text: valueStr,
        lower: valueStr.toLowerCase(),
      })
    }
  }

  return new SearchIndex(entries)
}
