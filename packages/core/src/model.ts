export type NodeId = string

export interface ScalarRow {
  key: string
  value: string | number | boolean | null
  valueType: "string" | "number" | "boolean" | "null"
}

/**
 * La ligne qui REPRÉSENTE un tableau enfant élidé sur la carte de son parent.
 * `value` porte le nombre d'éléments, et `arrayId` désigne le nœud tableau —
 * c'est lui, et non le parent, qui reste l'unité de pli : garder cet
 * identifiant ici est ce qui permet à `CollapseState`, `expandPathTo` et
 * l'auto-dépliage de la recherche de continuer à travailler par id de nœud,
 * sans connaître la notion de ligne.
 */
export interface ArrayRow {
  key: string
  value: number
  valueType: "array"
  arrayId: NodeId
}

export type Row = ScalarRow | ArrayRow

/**
 * Clé d'une ligne dont la VALEUR SEULE fait le contenu : le document racine
 * quand il est scalaire, et chaque élément scalaire d'un tableau. Le rendu
 * omet la clé pour ces lignes — répéter `tags[0]` en en-tête puis en clé
 * n'apprendrait rien.
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
   * Le nœud est représenté par une LIGNE sur la carte de son parent, et non
   * par une carte à lui : ni boîte dans la mise en page, ni rect dans
   * `positions`, ni carte dessinée. Il reste un nœud à part entière, avec un
   * id, des enfants et un état de pli — c'est ce qui laisse `CollapseState`,
   * `expandPathTo` et l'auto-dépliage de la recherche travailler par id, sans
   * connaître la notion de ligne.
   *
   * Décidé une fois par `buildGraph` et STOCKÉ plutôt que recalculé, parce que
   * l'élision n'est pas une propriété locale : elle demande un parent DESSINÉ
   * pour porter la ligne. Un tableau dont le parent est lui-même élidé garde
   * donc sa carte, et le document racine n'est jamais élidé — sans quoi un
   * document qui est un tableau nu n'aurait aucune carte du tout.
   */
  elided: boolean
  /**
   * Combien d'enfants apparaissent comme des CARTES, c'est-à-dire ce que le
   * chevron d'en-tête révèle réellement. Distinct de `childIds.length` depuis
   * l'élision : une entité dont les seuls enfants sont des tableaux n'a rien à
   * déplier par son en-tête — ses tableaux sont déjà là, en lignes — et
   * afficher un chevron et une pastille « 2 » lui promettrait un geste sans
   * effet.
   *
   * Stocké parce que `badgeTextFor` et `measureNode` ne reçoivent que le nœud,
   * jamais le graphe : le calculer demanderait de résoudre chaque enfant.
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
 * Le plus proche ancêtre DESSINÉ de `id`, `id` lui-même s'il est dessiné, ou
 * `null` si la chaîne casse. Remonte tant que les nœuds sont élidés, et non
 * d'un seul cran : un tableau imbriqué dans un tableau élidé demande plusieurs
 * remontées, et c'est le cas qu'une résolution à un niveau rate.
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
