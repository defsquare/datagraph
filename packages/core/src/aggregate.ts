import type { ValidatedConfig } from "./config.js"
import type { Graph, NodeId } from "./model.js"

export interface Aggregate {
  /** `${rootType}#${rootEntityId}` — stable d'une construction à l'autre. */
  id: string
  rootId: NodeId
  rootType: string
  /** Inclut `rootId`. */
  memberIds: Set<NodeId>
}

export interface AggregateIndex {
  aggregates: Map<string, Aggregate>
  /** Plusieurs entrées pour une entité = chevauchement. Ordre stable : celui
   * de `ValidatedConfig.aggregates`, puis l'id de la racine. */
  byNode: Map<NodeId, string[]>
}

/**
 * Calcule les agrégats par un BFS **multi-source inverse** sur `refEdges` : on
 * part de toutes les racines à la fois, à distance 0, et on remonte les
 * références (de la cible vers la source). La distance ainsi trouvée pour une
 * entité E est exactement le nombre minimal de références sortantes menant de E
 * à cette racine.
 *
 * Un seul parcours pour toutes les racines — donc linéaire en (entités +
 * références), pas un BFS par racine. C'est aussi ce qui rend le chevauchement
 * naturel : une racine découverte à distance ÉGALE s'ajoute à l'ensemble, une
 * racine découverte à distance SUPÉRIEURE est ignorée.
 *
 * Corollaire important : une racine a une distance 0 à elle-même, donc rien ne
 * peut la revendiquer, et un hub très référencé ne peut pas aspirer tout le
 * graphe — les entités proches d'une racine plus près restent chez elle.
 */
export function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex {
  const aggregates = new Map<string, Aggregate>()
  const byNode = new Map<NodeId, string[]>()

  const rootTypes = new Set(config.aggregates)
  if (rootTypes.size === 0) return { aggregates, byNode }

  // Rang de déclaration, pour l'ordre stable de `byNode`.
  const typeRank = new Map<string, number>()
  config.aggregates.forEach((type, i) => typeRank.set(type, i))

  // 1. Les racines.
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

  // 2. Adjacence inverse : cible -> sources qui la référencent. Les arêtes
  //    cassées ne propagent rien.
  const incoming = new Map<NodeId, NodeId[]>()
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const sources = incoming.get(edge.to)
    if (sources) sources.push(edge.from)
    else incoming.set(edge.to, [edge.from])
  }

  // 3. BFS multi-source. `dist` fait aussi office de marquage de visite, ce qui
  //    coupe les cycles.
  const dist = new Map<NodeId, number>()
  const claims = new Map<NodeId, Set<string>>()
  const queue: NodeId[] = []

  for (const root of roots) {
    dist.set(root.id, 0)
    claims.set(root.id, new Set([root.aggId]))
    queue.push(root.id)
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const currentDist = dist.get(current)!
    const currentClaims = claims.get(current)!
    const nextDist = currentDist + 1

    for (const source of incoming.get(current) ?? []) {
      const known = dist.get(source)
      if (known === undefined) {
        dist.set(source, nextDist)
        claims.set(source, new Set(currentClaims))
        queue.push(source)
      } else if (known === nextDist) {
        // Distance égale : les deux racines revendiquent — c'est le
        // chevauchement, et c'est voulu.
        const set = claims.get(source)!
        for (const aggId of currentClaims) set.add(aggId)
      }
      // known < nextDist : une racine plus proche a déjà pris cette entité.
    }
  }

  // 4. Report dans les agrégats, avec un ordre stable.
  for (const [nodeId, claimed] of claims) {
    const ids = [...claimed].sort((a, b) => {
      const rankA = typeRank.get(aggregates.get(a)!.rootType) ?? 0
      const rankB = typeRank.get(aggregates.get(b)!.rootType) ?? 0
      return rankA !== rankB ? rankA - rankB : a < b ? -1 : a > b ? 1 : 0
    })
    byNode.set(nodeId, ids)
    for (const aggId of ids) aggregates.get(aggId)!.memberIds.add(nodeId)
  }

  return { aggregates, byNode }
}
