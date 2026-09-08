import { validateConfig, type DataGraphConfig, type ReferenceDecl } from "./config.js"
import { matchesPath, type PathSegment } from "./selector.js"
import {
  GraphTooLargeError,
  VALUE_ONLY_KEY,
  type ArrayNode,
  type EntityNode,
  type Graph,
  type GraphNode,
  type NodeId,
  type ObjectNode,
  type ScalarRow,
} from "./model.js"

function escapePointerSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1")
}

function pointerOf(path: (string | number)[]): NodeId {
  if (path.length === 0) return "/"
  return "/" + path.map((seg) => escapePointerSegment(String(seg))).join("/")
}

type Scalar = string | number | boolean | null

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

function scalarValueType(value: Scalar): ScalarRow["valueType"] {
  if (value === null) return "null"
  return typeof value as "string" | "number" | "boolean"
}

/** Label of a non-root node: `tags[0]` under an array, the key otherwise. */
function labelFor(path: (string | number)[], parentNode: GraphNode | null): string {
  const key = path[path.length - 1]!
  return parentNode && parentNode.kind === "array" ? `${parentNode.label}[${key}]` : String(key)
}

export function buildGraph(data: unknown, config: DataGraphConfig): Graph {
  const validated = validateConfig(config)

  const graph: Graph = {
    nodes: new Map(),
    rootId: "/",
    containEdges: [],
    refEdges: [],
    entityIndex: new Map(),
    diagnostics: [],
    logicalNodeCount: 0,
  }

  function countLogical(n: number): void {
    graph.logicalNodeCount += n
    if (graph.logicalNodeCount > validated.maxNodes) {
      throw new GraphTooLargeError(graph.logicalNodeCount, validated.maxNodes)
    }
  }

  function findEntityMatch(
    path: (string | number)[],
  ): { entityType: string; idField: string } | null {
    for (const [entityType, entity] of validated.entities) {
      if (matchesPath(entity.segments, path)) {
        return { entityType, idField: entity.idField }
      }
    }
    return null
  }

  /**
   * `parentDrawn` says whether the parent carries a card, hence whether it can
   * HOST the row of a child array. That is the only non-local piece of
   * information elision needs, and threading it down costs less than a second
   * pass over the finished graph.
   */
  function visitValue(
    value: unknown,
    path: (string | number)[],
    parentId: NodeId | null,
    parentNode: GraphNode | null,
    parentDrawn: boolean,
  ): NodeId {
    const id = pointerOf(path)

    // A scalar value reaches `visitValue` in two cases: the root document, and
    // every ELEMENT of an array — scalar elements became nodes so that expanding
    // an array always yields cards, whatever it contains. The scalar values of
    // an OBJECT, on the other hand, stay rows and never get here (see the loop
    // below).
    if (isScalar(value)) {
      const scalarNode: ObjectNode = {
        kind: "object",
        id,
        path: [...path],
        label: path.length === 0 ? validated.rootLabel : labelFor(path, parentNode),
        rows: [{ key: VALUE_ONLY_KEY, value, valueType: scalarValueType(value) }],
        parentId,
        childIds: [],
        elided: false,
        cardChildCount: 0,
      }
      graph.nodes.set(id, scalarNode)
      countLogical(1)
      linkChild(parentNode, scalarNode)
      return id
    }

    const isArray = Array.isArray(value)
    const entityMatch = !isArray ? findEntityMatch(path) : null

    // An array is only elided if someone can carry its row. The root has no
    // parent, and an array under an already elided array has no parent card: in
    // both cases it keeps its own.
    const elided = isArray && parentDrawn
    const drawn = !elided

    let label: string = path.length === 0 ? validated.rootLabel : labelFor(path, parentNode)

    let entityType: string | undefined
    let entityId: string | undefined
    if (entityMatch) {
      const rawId = (value as Record<string, unknown>)[entityMatch.idField]
      if (rawId === undefined) {
        graph.diagnostics.push({
          code: "missing-id",
          path: id,
          message: `Entity "${entityMatch.entityType}" at ${id} is missing id field "${entityMatch.idField}"`,
        })
      } else {
        entityType = entityMatch.entityType
        entityId = String(rawId)
      }
    }

    let node: GraphNode
    if (entityType !== undefined && entityId !== undefined) {
      label = `${entityType} #${entityId}`
      const entityNode: EntityNode = {
        kind: "entity",
        id,
        path: [...path],
        label,
        rows: [],
        parentId,
        childIds: [],
        entityType,
        entityId,
        elided,
        cardChildCount: 0,
      }
      node = entityNode
    } else if (isArray) {
      const arrayNode: ArrayNode = {
        kind: "array",
        id,
        path: [...path],
        label,
        rows: [],
        parentId,
        childIds: [],
        length: (value as unknown[]).length,
        elided,
        cardChildCount: 0,
      }
      node = arrayNode
    } else {
      const objectNode: ObjectNode = {
        kind: "object",
        id,
        path: [...path],
        label,
        rows: [],
        parentId,
        childIds: [],
        elided,
        cardChildCount: 0,
      }
      node = objectNode
    }

    graph.nodes.set(id, node)
    countLogical(1)
    linkChild(parentNode, node)

    if (node.kind === "entity") {
      let byType = graph.entityIndex.get(node.entityType)
      if (!byType) {
        byType = new Map()
        graph.entityIndex.set(node.entityType, byType)
      }
      if (byType.has(node.entityId)) {
        graph.diagnostics.push({
          code: "duplicate-id",
          path: id,
          message: `Duplicate entity id "${node.entityId}" for type "${node.entityType}" at ${id}`,
        })
      } else {
        byType.set(node.entityId, id)
      }
    }

    if (isArray) {
      // EVERY element becomes a node, scalars included: that is what makes
      // expansion uniform — one card per element, whatever it contains.
      // Previously a scalar element was a row of the array, so expanding an
      // array of scalars yielded a single card.
      ;(value as unknown[]).forEach((item, index) => {
        const childId = visitValue(item, [...path, index], id, node, drawn)
        addArrayRowIfElided(node, String(index), item, childId, drawn)
      })
    } else {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (isScalar(val)) {
          node.rows.push({ key, value: val, valueType: scalarValueType(val) })
          countLogical(1)
        } else if (val !== undefined) {
          const childId = visitValue(val, [...path, key], id, node, drawn)
          addArrayRowIfElided(node, key, val, childId, drawn)
        }
      }
    }

    return id
  }

  /** Attaches `child` to `parent`: containment edge, `childIds`, and the card
   * count the parent's header chevron will reveal. */
  function linkChild(parent: GraphNode | null, child: GraphNode): void {
    if (!parent) return
    graph.containEdges.push({ kind: "contain", from: parent.id, to: child.id })
    parent.childIds.push(child.id)
    if (!child.elided) parent.cardChildCount++
  }

  /**
   * Places on `node` the row that represents an elided child array. Called AFTER
   * visiting the child: the row thus takes its place in the declaration order of
   * the keys, `tags` after `categoryId` and not at the bottom of the card.
   *
   * It does NOT count as a logical node — the array node it represents already
   * counted one. That is what leaves `logicalNodeCount` unchanged by this whole
   * rework.
   */
  function addArrayRowIfElided(
    node: GraphNode,
    key: string,
    value: unknown,
    childId: NodeId,
    parentDrawn: boolean,
  ): void {
    if (!parentDrawn || !Array.isArray(value)) return
    node.rows.push({
      key,
      value: (value as unknown[]).length,
      valueType: "array",
      arrayId: childId,
    })
  }

  // The root has no parent able to carry a row: `parentDrawn` is false, so a
  // document that is a bare array does keep its card.
  visitValue(data, [], null, null, false)

  /**
   * The nodes reached from `start` by walking down `navigate`, one segment at a
   * time, through the LAST element of each child's path.
   *
   * Walking down through the children, rather than filtering every node with
   * `matchesPath`, is what anchors the path on the INSTANCE: `lines[*]` must
   * designate the lines of THIS cart, not those of every cart.
   *
   * A path with no navigation yields the entity itself — the historical
   * `customerId` case, which thus remains exactly the same traversal.
   */
  function navigateFrom(start: GraphNode, navigate: PathSegment[]): GraphNode[] {
    let current: GraphNode[] = [start]
    for (const segment of navigate) {
      const next: GraphNode[] = []
      for (const node of current) {
        for (const childId of node.childIds) {
          const child = graph.nodes.get(childId)
          if (!child) continue
          // `matchesPath` on the last element alone: the key/index/wildcard
          // comparison must stay the selectors' own, not a second
          // implementation that merely resembles it.
          if (matchesPath([segment], child.path.slice(-1))) next.push(child)
        }
      }
      if (next.length === 0) return []
      current = next
    }
    return current
  }

  /** The declarations whose terminal row NO instance exposed, and the types with
   * at least one instance: enough to blame a declaration only when there was
   * something to satisfy it with. */
  const unsatisfied = new Set<ReferenceDecl>()
  const typesSeen = new Set<string>()
  for (const decls of validated.references.values()) for (const d of decls) unsatisfied.add(d)

  for (const node of graph.nodes.values()) {
    if (node.kind !== "entity") continue
    typesSeen.add(node.entityType)
    const decls = validated.references.get(node.entityType)
    if (!decls) continue
    for (const decl of decls) {
      for (const holder of navigateFrom(node, decl.navigate)) {
        const row = holder.rows.find((r) => r.key === decl.field)
        if (!row) continue
        // The row EXISTS: the declaration is not a typo, even if its value
        // produces no edge (null, or an array). That is what distinguishes
        // `unresolved-reference` from a merely empty field.
        unsatisfied.delete(decl)
        // An array row is discarded explicitly: its `value` is an ELEMENT COUNT,
        // and taking it for an identifier would make the reference point at "3".
        // A field declared as a reference but carried by an array is a config
        // error, not a reference to resolve.
        if (row.valueType === "array" || row.value === null) continue
        const targetId = String(row.value)
        const to = graph.entityIndex.get(decl.targetType)?.get(targetId) ?? null
        const dangling = to === null
        graph.refEdges.push({
          kind: "ref",
          from: holder.id,
          fromEntity: node.id,
          to,
          field: decl.field,
          targetType: decl.targetType,
          targetId,
          dangling,
        })
        if (dangling) {
          // The diagnostic points at the node that CARRIES the row, not the
          // entity: `drawNode`'s cross sits against the offending value, and
          // that value is on the value object's card.
          graph.diagnostics.push({
            code: "dangling-ref",
            path: holder.id,
            message: `Reference "${decl.field}" on ${node.entityType} at ${holder.id} targets unknown ${decl.targetType} "${targetId}"`,
          })
        }
      }
    }
  }

  // A declaration never satisfied while the type does have instances is almost
  // always a typo — silently, until now. Having no instance of the type, on the
  // other hand, proves nothing about the declaration.
  for (const [sourceType, decls] of validated.references) {
    if (!typesSeen.has(sourceType)) continue
    for (const decl of decls) {
      if (!unsatisfied.has(decl)) continue
      graph.diagnostics.push({
        code: "unresolved-reference",
        // `decl.path` is now the absolute `from`: prefixing it with the type
        // would produce "Order.$.orders[*]…".
        path: decl.path,
        message: `Reference "${decl.path}" declared on ${sourceType} matches no row on any ${sourceType}`,
      })
    }
  }

  return graph
}
