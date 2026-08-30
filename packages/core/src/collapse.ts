import type { Graph, NodeId } from "./model.js"

/**
 * Tracks which nodes of a Graph are expanded vs collapsed, and derives
 * visibility from that state.
 *
 * Initial state (constructor): BFS from the root, marking every
 * non-entity node encountered as expanded; descent stops at the first
 * entity node on each branch (entities start collapsed).
 */
export class CollapseState {
  private readonly graph: Graph
  private readonly expanded: Set<NodeId> = new Set()

  constructor(graph: Graph) {
    this.graph = graph

    const queue: NodeId[] = [graph.rootId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = graph.nodes.get(id)
      if (!node) continue
      // The root is always expanded/visible, even in the (unusual) case
      // where it is itself an entity node; its children still respect
      // the entity-boundary rule below.
      if (node.kind === "entity" && id !== graph.rootId) continue

      this.expanded.add(id)
      if (node.kind === "entity") continue // do not descend past an entity boundary

      for (const childId of node.childIds) {
        queue.push(childId)
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

  /**
   * DFS from root; a node is included as soon as it is reached (its
   * parent chain is all expanded), and we only descend through it if
   * it is itself expanded. Root is always expanded and always visible.
   */
  visibleNodeIds(): Set<NodeId> {
    const visible = new Set<NodeId>()
    const stack: NodeId[] = [this.graph.rootId]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = this.graph.nodes.get(id)
      if (!node) continue
      visible.add(id)
      if (this.isExpanded(id)) {
        for (const childId of node.childIds) {
          stack.push(childId)
        }
      }
    }
    return visible
  }

  /**
   * Expands every ancestor of `id` (not `id` itself). Returns the ids
   * that were newly expanded by this call, in root-first order.
   * Idempotent: calling again with the same id returns [].
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
    return newly
  }
}
