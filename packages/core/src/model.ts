export type NodeId = string

export interface ScalarRow {
  key: string
  value: string | number | boolean | null
  valueType: "string" | "number" | "boolean" | "null"
}

export interface BaseNode {
  id: NodeId
  path: (string | number)[]
  label: string
  rows: ScalarRow[]
  parentId: NodeId | null
  childIds: NodeId[]
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

export interface ContainEdge {
  kind: "contain"
  from: NodeId
  to: NodeId
}

export interface RefEdge {
  kind: "ref"
  from: NodeId
  to: NodeId | null
  field: string
  targetType: string
  targetId: string
  dangling: boolean
}

export interface Diagnostic {
  code: "dangling-ref" | "duplicate-id" | "missing-id"
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
    super(`Graph exceeds maxNodes: ${count} > ${max}`)
    this.name = "GraphTooLargeError"
  }
}
