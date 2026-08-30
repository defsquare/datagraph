import { validateConfig, type DataGraphConfig } from "./config.js"
import { matchesPath } from "./selector.js"
import {
  GraphTooLargeError,
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

  function visitValue(
    value: unknown,
    path: (string | number)[],
    parentId: NodeId | null,
    parentNode: GraphNode | null,
  ): NodeId {
    const id = pointerOf(path)
    const isArray = Array.isArray(value)
    const entityMatch = !isArray ? findEntityMatch(path) : null

    let label: string
    if (path.length === 0) {
      label = "$"
    } else {
      const key = path[path.length - 1]!
      label = parentNode && parentNode.kind === "array" ? `${parentNode.label}[${key}]` : String(key)
    }

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
      }
      node = objectNode
    }

    graph.nodes.set(id, node)
    countLogical(1)

    if (parentNode) {
      graph.containEdges.push({ kind: "contain", from: parentNode.id, to: id })
      parentNode.childIds.push(id)
    }

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
      ;(value as unknown[]).forEach((item, index) => {
        const childPath = [...path, index]
        if (isScalar(item)) {
          node.rows.push({ key: String(index), value: item, valueType: scalarValueType(item) })
          countLogical(1)
        } else {
          visitValue(item, childPath, id, node)
        }
      })
    } else {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const childPath = [...path, key]
        if (isScalar(val)) {
          node.rows.push({ key, value: val, valueType: scalarValueType(val) })
          countLogical(1)
        } else if (val !== undefined) {
          visitValue(val, childPath, id, node)
        }
      }
    }

    return id
  }

  visitValue(data, [], null, null)

  return graph
}
