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
  /**
   * L'appartenance est une PARTITION : chaque entité atteignant au moins une
   * racine a exactement un agrégat, donc chaque tableau tient un seul id. Le
   * seul consommateur du cœur, `graph-layout.ts`, lit d'ailleurs `[0]` et
   * rien d'autre.
   *
   * Le type reste `string[]` et non `string`, et la raison a changé. Elle
   * tenait à `separateClusters`, qui portait une garantie de rigidité (fusion
   * par union-find des agrégats partageant un membre) que la partition rendait
   * inactive sans la rendre caduque ; cette passe est retirée. Ce qui reste est
   * plus simple : la partition est une décision PRODUIT — l'arbitrage des
   * égalités de distance par ordre de déclaration, cf. `buildAggregates` —, pas
   * une propriété du modèle de données. Elle a déjà été l'inverse une fois. Un
   * type qui rendrait le chevauchement inexprimable transformerait un
   * revirement de règle en refonte de signature, pour économiser un `[0]`.
   *
   * Le moteur actuel, lui, ne survivrait PAS tel quel à un tel revirement : sa
   * décomposition à deux niveaux n'est correcte que parce que chaque carte
   * appartient à exactement un bloc. C'est une raison de plus de garder la
   * question ouverte dans le type plutôt que de la fermer.
   */
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
 * références), pas un BFS par racine.
 *
 * **Arbitrage des égalités.** Une entité qui atteint plusieurs racines à la
 * même distance minimale n'en rejoint qu'une : celle dont le TYPE est déclaré
 * en premier dans `ValidatedConfig.aggregates`, et à type égal celle dont l'id
 * d'agrégat est le plus petit. L'appartenance est donc une partition.
 *
 * Le BFS ne propage que le gagnant de chaque prédécesseur, et non l'ensemble
 * des racines qu'il atteint : c'est exact, parce que l'ensemble des racines
 * minimales d'une entité est l'union de ceux de ses successeurs à distance
 * minimale, et que le minimum d'une union est le minimum des minima.
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

  // Rang de déclaration : c'est lui qui arbitre les égalités de distance.
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

  /** Ordre total sur les agrégats : rang du type, puis id. Négatif si `a`
   * l'emporte. */
  const compare = (a: string, b: string): number => {
    const rankA = typeRank.get(aggregates.get(a)!.rootType) ?? 0
    const rankB = typeRank.get(aggregates.get(b)!.rootType) ?? 0
    return rankA !== rankB ? rankA - rankB : a < b ? -1 : a > b ? 1 : 0
  }

  // 2. Adjacence inverse : cible -> sources qui la référencent. Les arêtes
  //    cassées ne propagent rien.
  //
  //    `fromEntity` et non `from` : l'appartenance se raisonne en ENTITÉS, et
  //    une référence portée par un value object est celle de son entité. Sans
  //    ce hissage, la source serait un nœud que le BFS ne visite pas — les
  //    racines et la propagation ne connaissent que des entités —, et le panier
  //    ne rejoindrait pas l'agrégat du produit que sa ligne référence.
  const incoming = new Map<NodeId, NodeId[]>()
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const sources = incoming.get(edge.to)
    if (sources) sources.push(edge.fromEntity)
    else incoming.set(edge.to, [edge.fromEntity])
  }

  // 3. BFS multi-source. `dist` fait aussi office de marquage de visite, ce qui
  //    coupe les cycles.
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
        // Distance égale : une seule des deux racines garde l'entité. Le
        // minimum étant pris à chaque rencontre, le résultat ne dépend pas de
        // l'ordre de découverte.
        const held = claim.get(source)!
        if (compare(currentClaim, held) < 0) claim.set(source, currentClaim)
      }
      // known < nextDist : une racine plus proche a déjà pris cette entité.
    }
  }

  // 4. Report dans les agrégats.
  for (const [nodeId, aggId] of claim) {
    byNode.set(nodeId, [aggId])
    aggregates.get(aggId)!.memberIds.add(nodeId)
  }

  return { aggregates, byNode }
}
