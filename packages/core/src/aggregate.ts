import type { ValidatedConfig } from "./config.js"
import type { Graph, NodeId } from "./model.js"

export interface Aggregate {
  /** `${rootType}#${rootEntityId}` — stable across builds. */
  id: string
  rootId: NodeId
  rootType: string
  /** Includes `rootId`. */
  memberIds: Set<NodeId>
}

export interface AggregateIndex {
  aggregates: Map<string, Aggregate>
  /**
   * Membership is a PARTITION: every entity reaching at least one root has
   * exactly one aggregate, so each array holds a single id. The core's only
   * consumer, `graph-layout.ts`, reads `[0]` and nothing else anyway.
   *
   * The type stays `string[]` rather than `string`, and the reason has changed.
   * It used to be `separateClusters`, which carried a rigidity guarantee
   * (union-find merging of aggregates sharing a member) that the partition made
   * inactive without making it moot; that pass is gone. What remains is simpler:
   * the partition is a PRODUCT decision — breaking distance ties by declaration
   * order, cf. `buildAggregates` — not a property of the data model. It has
   * already been the opposite once. A type that made overlap inexpressible would
   * turn a reversal of the rule into a signature rework, to save one `[0]`.
   *
   * The current engine, on the other hand, would NOT survive such a reversal
   * as-is: its two-level decomposition is only correct because each card belongs
   * to exactly one block. One more reason to keep the question open in the type
   * rather than closing it.
   */
  byNode: Map<NodeId, string[]>
}

/**
 * Computes the aggregates with a **reverse multi-source** BFS over `refEdges`:
 * we start from all the roots at once, at distance 0, and walk references
 * backwards (from target to source). The distance thus found for an entity E is
 * exactly the minimal number of outgoing references leading from E to that root.
 *
 * A single traversal for all the roots — hence linear in (entities +
 * references), not one BFS per root.
 *
 * **Tie-breaking.** An entity that reaches several roots at the same minimal
 * distance joins only one: the one whose TYPE is declared first in
 * `ValidatedConfig.aggregates`, and at equal type the one with the smallest
 * aggregate id. Membership is therefore a partition.
 *
 * The BFS only propagates each predecessor's winner, not the whole set of roots
 * it reaches: this is exact, because the set of an entity's minimal roots is the
 * union of those of its successors at minimal distance, and the minimum of a
 * union is the minimum of the minima.
 *
 * An important corollary: a root is at distance 0 from itself, so nothing can
 * claim it, and a heavily referenced hub cannot suck in the whole graph —
 * entities near a closer root stay with it.
 */
export function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex {
  const aggregates = new Map<string, Aggregate>()
  const byNode = new Map<NodeId, string[]>()

  const rootTypes = new Set(config.aggregates)
  if (rootTypes.size === 0) return { aggregates, byNode }

  // Declaration rank: this is what breaks distance ties.
  const typeRank = new Map<string, number>()
  config.aggregates.forEach((type, i) => typeRank.set(type, i))

  // 1. The roots.
  const roots: { id: NodeId; aggId: string }[] = []
  for (const node of graph.nodes.values()) {
    if (node.kind !== "entity" || !rootTypes.has(node.entityType)) continue
    const aggId = `${node.entityType}#${node.entityId}`
    aggregates.set(aggId, {
      id: aggId,
      rootId: node.id,
      rootType: node.entityType,
      memberIds: new Set([node.id]),
    })
    roots.push({ id: node.id, aggId })
  }
  if (roots.length === 0) return { aggregates, byNode }

  /** Total order over the aggregates: type rank, then id. Negative if `a`
   * wins. */
  const compare = (a: string, b: string): number => {
    const rankA = typeRank.get(aggregates.get(a)!.rootType) ?? 0
    const rankB = typeRank.get(aggregates.get(b)!.rootType) ?? 0
    return rankA !== rankB ? rankA - rankB : a < b ? -1 : a > b ? 1 : 0
  }

  // 2. Reverse adjacency: target -> sources that reference it. Dangling edges
  //    propagate nothing.
  //
  //    `fromEntity` and not `from`: membership is reasoned about in ENTITIES,
  //    and a reference carried by a value object is its entity's. Without that
  //    lifting, the source would be a node the BFS never visits — roots and
  //    propagation only know entities — and the cart would not join the
  //    aggregate of the product its line references.
  const incoming = new Map<NodeId, NodeId[]>()
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const sources = incoming.get(edge.to)
    if (sources) sources.push(edge.fromEntity)
    else incoming.set(edge.to, [edge.fromEntity])
  }

  // 3. Multi-source BFS. `dist` doubles as the visited marker, which cuts
  //    cycles.
  const dist = new Map<NodeId, number>()
  const claim = new Map<NodeId, string>()
  const queue: NodeId[] = []

  for (const root of roots) {
    dist.set(root.id, 0)
    claim.set(root.id, root.aggId)
    queue.push(root.id)
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const currentDist = dist.get(current)!
    const currentClaim = claim.get(current)!
    const nextDist = currentDist + 1

    for (const source of incoming.get(current) ?? []) {
      const known = dist.get(source)
      if (known === undefined) {
        dist.set(source, nextDist)
        claim.set(source, currentClaim)
        queue.push(source)
      } else if (known === nextDist) {
        // Equal distance: only one of the two roots keeps the entity. Since the
        // minimum is taken at every encounter, the result does not depend on
        // discovery order.
        const held = claim.get(source)!
        if (compare(currentClaim, held) < 0) claim.set(source, currentClaim)
      }
      // known < nextDist: a closer root already claimed this entity.
    }
  }

  // 4. Carry the claims back into the aggregates.
  for (const [nodeId, aggId] of claim) {
    byNode.set(nodeId, [aggId])
    aggregates.get(aggId)!.memberIds.add(nodeId)
  }

  return { aggregates, byNode }
}
