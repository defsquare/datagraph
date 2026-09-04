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

/** Libellé d'un nœud non racine : `tags[0]` sous un tableau, la clé sinon. */
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
   * `parentDrawn` dit si le parent porte une carte, donc s'il peut HÉBERGER la
   * ligne d'un tableau enfant. C'est la seule information non locale dont
   * l'élision a besoin, et la faire descendre coûte moins qu'une seconde passe
   * sur le graphe fini.
   */
  function visitValue(
    value: unknown,
    path: (string | number)[],
    parentId: NodeId | null,
    parentNode: GraphNode | null,
    parentDrawn: boolean,
  ): NodeId {
    const id = pointerOf(path)

    // Une valeur scalaire atteint `visitValue` dans deux cas : le document
    // racine, et chaque ÉLÉMENT d'un tableau — les éléments scalaires sont
    // devenus des nœuds pour que déplier un tableau rende toujours des cartes,
    // quel que soit son contenu. Les valeurs scalaires d'un OBJET, elles,
    // restent des lignes et n'arrivent jamais ici (voir la boucle du bas).
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

    // Un tableau n'est élidé que si quelqu'un peut porter sa ligne. La racine
    // n'a pas de parent, et un tableau sous un tableau déjà élidé n'a pas de
    // carte parente : dans les deux cas il garde la sienne.
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
      // TOUT élément devient un nœud, scalaire compris : c'est ce qui rend le
      // dépliage uniforme — une carte par élément, quel que soit son contenu.
      // Auparavant un élément scalaire était une ligne du tableau, et déplier
      // un tableau de scalaires ne rendait donc qu'une seule carte.
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

  /** Rattache `child` à `parent` : arête de containment, `childIds`, et le
   * compte de cartes que le chevron d'en-tête du parent révélera. */
  function linkChild(parent: GraphNode | null, child: GraphNode): void {
    if (!parent) return
    graph.containEdges.push({ kind: "contain", from: parent.id, to: child.id })
    parent.childIds.push(child.id)
    if (!child.elided) parent.cardChildCount++
  }

  /**
   * Pose sur `node` la ligne qui représente un tableau enfant élidé. Appelée
   * APRÈS la visite de l'enfant : la ligne prend ainsi sa place dans l'ordre
   * de déclaration des clés, `tags` après `categoryId` et non en fin de carte.
   *
   * Elle ne compte PAS comme un nœud logique — le nœud tableau qu'elle
   * représente en a déjà compté un. C'est ce qui laisse `logicalNodeCount`
   * inchangé par toute cette refonte.
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

  // La racine n'a pas de parent capable de porter une ligne : `parentDrawn`
  // vaut false, donc un document qui est un tableau nu garde bien sa carte.
  visitValue(data, [], null, null, false)

  /**
   * Les nœuds atteints depuis `start` en descendant `navigate`, un segment à
   * la fois, par le DERNIER élément du chemin de chaque enfant.
   *
   * Descendre par les enfants, et non filtrer tous les nœuds par `matchesPath`,
   * est ce qui ancre le chemin sur l'INSTANCE : `lines[*]` doit désigner les
   * lignes de ce panier-ci, pas celles de tous les paniers.
   *
   * Un chemin sans navigation rend l'entité elle-même — le cas historique
   * `customerId`, qui reste ainsi exactement le même parcours.
   */
  function navigateFrom(start: GraphNode, navigate: PathSegment[]): GraphNode[] {
    let current: GraphNode[] = [start]
    for (const segment of navigate) {
      const next: GraphNode[] = []
      for (const node of current) {
        for (const childId of node.childIds) {
          const child = graph.nodes.get(childId)
          if (!child) continue
          // `matchesPath` sur le seul dernier élément : la comparaison
          // clé/indice/joker doit rester celle des sélecteurs, pas une seconde
          // implémentation qui lui ressemble.
          if (matchesPath([segment], child.path.slice(-1))) next.push(child)
        }
      }
      if (next.length === 0) return []
      current = next
    }
    return current
  }

  /** Les déclarations dont AUCUNE instance n'a exposé la ligne terminale, et
   * les types dont au moins une instance existe : de quoi n'accuser une
   * déclaration que lorsqu'il y avait matière à la satisfaire. */
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
        // La ligne EXISTE : la déclaration n'est pas une faute de frappe, même
        // si sa valeur ne produit aucune arête (nulle, ou tableau). C'est ce
        // qui distingue `unresolved-reference` d'un champ simplement vide.
        unsatisfied.delete(decl)
        // Une ligne de tableau est écartée explicitement : sa `value` est un
        // NOMBRE D'ÉLÉMENTS, et la prendre pour un identifiant ferait pointer la
        // référence sur « 3 ». Un champ déclaré comme référence mais porté par
        // un tableau est une erreur de config, pas une référence à résoudre.
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
          // Le diagnostic pointe le nœud QUI PORTE la ligne, pas l'entité : la
          // croix de `drawNode` se pose contre la valeur fautive, et elle est
          // sur la carte du value object.
          graph.diagnostics.push({
            code: "dangling-ref",
            path: holder.id,
            message: `Reference "${decl.field}" on ${node.entityType} at ${holder.id} targets unknown ${decl.targetType} "${targetId}"`,
          })
        }
      }
    }
  }

  // Une déclaration jamais satisfaite alors que le type a des instances est
  // presque toujours une faute de frappe — un silence, jusqu'ici. Aucune
  // instance du type, en revanche, ne prouve rien sur la déclaration.
  for (const [sourceType, decls] of validated.references) {
    if (!typesSeen.has(sourceType)) continue
    for (const decl of decls) {
      if (!unsatisfied.has(decl)) continue
      graph.diagnostics.push({
        code: "unresolved-reference",
        // `decl.path` est désormais le `from` absolu : le préfixer du type
        // produirait « Order.$.orders[*]… ».
        path: decl.path,
        message: `Reference "${decl.path}" declared on ${sourceType} matches no row on any ${sourceType}`,
      })
    }
  }

  return graph
}
