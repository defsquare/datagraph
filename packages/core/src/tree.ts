import { buildAggregates } from "./aggregate.js"
import type { ValidatedConfig } from "./config.js"
import type { ContainEdge, Graph, GraphNode, NodeId, ObjectNode } from "./model.js"

/**
 * A SECOND graph, whose containment is re-derived from the references.
 *
 * On a normalised document — flat tables joined by foreign keys — the JSON
 * nesting is `root → table → row`: three levels, and every relation that carries
 * meaning is a reference edge zigzagging across the columns. The hierarchy the
 * reader wants is those references read backwards, and `buildAggregates` already
 * computes exactly that forest for the graph view: a reverse BFS from the
 * `groups` roots, ties broken by declaration order. `parents` is its predecessor
 * pointer; this function turns it into containment.
 *
 * The result is a plain `Graph`, so the structure view's whole machinery —
 * `CollapseState`, pagination, the ELK layered engine and its incremental
 * expand/collapse/reveal — runs on it untouched.
 *
 * What is kept: every entity, and everything nested UNDER an entity (value
 * objects, elided arrays and their elements). What is dropped: the source root,
 * the top-level tables and any intermediate container with no entity ancestor —
 * on a normalised document they carry nothing, and their scalar rows disappear
 * from this view. Accepted.
 *
 * What MOVES is only the top-level entities (those with no entity ancestor):
 * each hangs under the target of the reference it was claimed through, or under
 * a synthetic root when nothing claimed it. Nested entities and value objects
 * keep their containment parent — that is what preserves every `ArrayRow` /
 * `arrayId` invariant, a row saying `orders: 3` still revealing 3 cards.
 *
 * `refEdges`, `entityIndex`, `diagnostics` and `logicalNodeCount` are the
 * source's, shared by reference: they describe the document, not its folding.
 * `source` itself is never mutated — every re-linked node is a copy.
 */
export function buildTreeGraph(source: Graph, config: ValidatedConfig): Graph {
  const sourceRoot = source.nodes.get(source.rootId)
  // The document is already one tree rooted on an entity: there is nothing to
  // re-derive, and a synthetic root would only add a level. DEFENSIVE — no
  // selector can match the empty path today, so `buildGraph` cannot produce such
  // a root; this guards the invariant rather than a reachable case, which is why
  // no test covers it.
  if (!sourceRoot || sourceRoot.kind === "entity") return source

  // Document order, and "has an ENTITY ancestor". Both fall out of one pass
  // because a node is always inserted after its parent (`buildGraph` descends).
  const rank = new Map<NodeId, number>()
  const underEntity = new Map<NodeId, boolean>()
  let index = 0
  for (const node of source.nodes.values()) {
    rank.set(node.id, index++)
    const parent = node.parentId === null ? null : source.nodes.get(node.parentId)
    underEntity.set(node.id, parent !== null && parent !== undefined && (parent.kind === "entity" || underEntity.get(parent.id) === true))
  }

  const { parents } = buildAggregates(source, config)

  // The tree parent of every KEPT node. Filled in two passes: the nodes that do
  // not move first, so the cycle guard below walks an already-complete skeleton.
  const treeParent = new Map<NodeId, NodeId>()
  const kept: GraphNode[] = []
  const topLevelEntities: GraphNode[] = []
  for (const node of source.nodes.values()) {
    const nested = underEntity.get(node.id) === true
    if (nested) {
      kept.push(node)
      treeParent.set(node.id, node.parentId!)
    } else if (node.kind === "entity") {
      kept.push(node)
      topLevelEntities.push(node)
    }
  }

  /** Whether `from` already reaches `target` by walking up the tree parents
   * assigned so far. */
  const reaches = (from: NodeId, target: NodeId): boolean => {
    let current: NodeId | undefined = from
    while (current !== undefined) {
      if (current === target) return true
      current = treeParent.get(current)
    }
    return false
  }

  for (const node of topLevelEntities) {
    const candidate = parents.get(node.id)
    // ponytail: linear walk per re-parented entity — O(depth), and the depth is
    // the BFS distance to a root. Reachable only with nested entities plus cross
    // references; a union-find would pay for itself only if that became common.
    treeParent.set(
      node.id,
      candidate !== undefined && !reaches(candidate, node.id) ? candidate : source.rootId,
    )
  }

  const children = new Map<NodeId, NodeId[]>()
  for (const [id, parentId] of treeParent) {
    const siblings = children.get(parentId)
    if (siblings) siblings.push(id)
    else children.set(parentId, [id])
  }
  const byRank = (a: NodeId, b: NodeId): number => rank.get(a)! - rank.get(b)!
  for (const siblings of children.values()) siblings.sort(byRank)

  // Under the synthetic root, the aggregate roots come FIRST: they are what the
  // configuration declared as the tops of the hierarchy, and burying them among
  // the shared targets nobody claimed would hide the answer in the question.
  const rootTypes = new Set(config.aggregates)
  const rootChildren = children.get(source.rootId) ?? []
  const isAggregateRoot = (id: NodeId): boolean => {
    const node = source.nodes.get(id)
    return node?.kind === "entity" && rootTypes.has(node.entityType)
  }
  const rootChildIds = [
    ...rootChildren.filter(isAggregateRoot),
    ...rootChildren.filter((id) => !isAggregateRoot(id)),
  ]

  const nodes = new Map<NodeId, GraphNode>()
  const cardCount = (childIds: NodeId[]): number =>
    childIds.filter((id) => source.nodes.get(id)?.elided !== true).length

  const treeRoot: ObjectNode = {
    kind: "object",
    id: source.rootId,
    path: [],
    label: sourceRoot.label,
    rows: [],
    parentId: null,
    childIds: rootChildIds,
    elided: false,
    cardChildCount: cardCount(rootChildIds),
  }
  nodes.set(treeRoot.id, treeRoot)

  for (const node of kept) {
    const childIds = children.get(node.id) ?? []
    nodes.set(node.id, {
      ...node,
      parentId: treeParent.get(node.id)!,
      childIds,
      cardChildCount: cardCount(childIds),
    })
  }

  // DFS from the root, parent before child: the layout engine reads these edges
  // in order and expects to have seen a node before its children.
  const containEdges: ContainEdge[] = []
  const stack: NodeId[] = [source.rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const childIds = nodes.get(id)?.childIds ?? []
    for (const childId of childIds) containEdges.push({ kind: "contain", from: id, to: childId })
    for (let i = childIds.length - 1; i >= 0; i--) stack.push(childIds[i]!)
  }

  return {
    nodes,
    rootId: source.rootId,
    containEdges,
    refEdges: source.refEdges,
    entityIndex: source.entityIndex,
    diagnostics: source.diagnostics,
    logicalNodeCount: source.logicalNodeCount,
  }
}
