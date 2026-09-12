export type NodeId = string

export interface ScalarRow {
  key: string
  value: string | number | boolean | null
  valueType: "string" | "number" | "boolean" | "null"
}

/**
 * The row that REPRESENTS an elided child array on its parent's card. `value`
 * carries the element count, and `arrayId` designates the array node — it, and
 * not the parent, remains the unit of collapse: keeping that identifier here is
 * what lets `CollapseState`, `expandPathTo` and search auto-expansion keep
 * working by node id, without knowing anything about rows.
 */
export interface ArrayRow {
  key: string
  value: number
  valueType: "array"
  arrayId: NodeId
}

export type Row = ScalarRow | ArrayRow

/**
 * Key of a row whose VALUE ALONE is the content: the root document when it is
 * scalar, and every scalar element of an array. Rendering omits the key for
 * those rows — repeating `tags[0]` in the header and then as the key would
 * teach nothing.
 */
export const VALUE_ONLY_KEY = "$value"

export interface BaseNode {
  id: NodeId
  path: (string | number)[]
  label: string
  rows: Row[]
  parentId: NodeId | null
  childIds: NodeId[]
  /**
   * The node is represented by a ROW on its parent's card, not by a card of its
   * own: no box in the layout, no rect in `positions`, no card drawn. It stays a
   * full-fledged node, with an id, children and a collapse state — that is what
   * lets `CollapseState`, `expandPathTo` and search auto-expansion work by id,
   * without knowing anything about rows.
   *
   * Decided once by `buildGraph` and STORED rather than recomputed, because
   * elision is not a local property: it requires a DRAWN parent to carry the
   * row. An array whose parent is itself elided therefore keeps its card, and
   * the root document is never elided — otherwise a document that is a bare
   * array would have no card at all.
   */
  elided: boolean
  /**
   * How many children appear as CARDS, that is, what the header chevron
   * actually reveals. Distinct from `childIds.length` since elision: an entity
   * whose only children are arrays has nothing to expand from its header — its
   * arrays are already there, as rows — and showing a chevron and a "2" badge
   * would promise it a gesture with no effect.
   *
   * Stored because `badgeTextFor` and `measureNode` only receive the node, never
   * the graph: computing it would require resolving every child.
   */
  cardChildCount: number
}

export interface EntityNode extends BaseNode {
  kind: "entity"
  entityType: string
  entityId: string
}

export interface ObjectNode extends BaseNode {
  kind: "object"
}

export interface ArrayNode extends BaseNode {
  kind: "array"
  length: number
}

export type GraphNode = EntityNode | ObjectNode | ArrayNode

/**
 * The nearest DRAWN ancestor of `id`, `id` itself if it is drawn, or `null` if
 * the chain breaks. Walks up as long as nodes are elided, not by a single step:
 * an array nested inside an elided array needs several hops, and that is the
 * case a one-level resolution gets wrong.
 */
export function nearestDrawn(graph: Graph, id: NodeId): NodeId | null {
  let current: NodeId | null = id
  while (current !== null) {
    const node: GraphNode | undefined = graph.nodes.get(current)
    if (!node) return null
    if (!node.elided) return current
    current = node.parentId
  }
  return null
}

export interface ContainEdge {
  kind: "contain"
  from: NodeId
  to: NodeId
}

export interface RefEdge {
  kind: "ref"
  /**
   * The node that CARRIES the row: the entity for `customerId`, the value object
   * for `lines[*].productRef`. The invariant "`field` is a row key of `from`"
   * therefore holds in both cases, and everything that works at row level (value
   * tint, broken-reference cross, `refEdges(from)`, detail panel) keeps reading
   * `from` without knowing anything about value objects.
   */
  from: NodeId
  /**
   * The ENTITY that declared the reference — `from` itself when the path has no
   * navigation. That is the level at which the relation exists: a value object
   * has no identity of its own, its reference is its entity's. Hence its use by
   * aggregate membership, the two-level layout and dimming, which all reason in
   * terms of entities.
   */
  fromEntity: NodeId
  to: NodeId | null
  field: string
  targetType: string
  targetId: string
  dangling: boolean
}

export interface Diagnostic {
  /**
   * `unresolved-reference` is about a DECLARATION, not a node: its `path` is the
   * key written in the config (`Cart.lines[*].productRef`) and not a pointer,
   * precisely because no node satisfied it.
   */
  code: "dangling-ref" | "duplicate-id" | "missing-id" | "unresolved-reference"
  path: string
  message: string
}

export interface Graph {
  nodes: Map<NodeId, GraphNode>
  rootId: NodeId
  containEdges: ContainEdge[]
  refEdges: RefEdge[]
  entityIndex: Map<string, Map<string, NodeId>>
  diagnostics: Diagnostic[]
  logicalNodeCount: number
}

export class GraphTooLargeError extends Error {
  constructor(public count: number, public max: number) {
    // The cap is deliberately raisable: the message must name the lever, or the
    // blocked user has no way out from the CLI.
    super(`Graph exceeds maxNodes: ${count} > ${max} — raise "maxNodes" in the config (the CLI's -c option)`)
    this.name = "GraphTooLargeError"
  }
}
