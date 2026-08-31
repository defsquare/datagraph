import type { GraphNode } from "./model.js"

export interface Size {
  width: number
  height: number
}

export interface NodeMetrics {
  headerHeight: number
  rowHeight: number
  paddingX: number
  paddingBottom: number
  railWidth: number
  gapKeyValue: number
  chevronWidth: number
  /** Avance moyenne du libellé d'en-tête (body 13px / 600). */
  headerCharWidth: number
  /** Avance moyenne de la pastille (body 9.5px / 600 + tracking). */
  badgeCharWidth: number
  /** Avance moyenne d'une clé (body 12px). */
  keyCharWidth: number
  /** Avance d'une valeur (mono 12px — exacte pour Fira Code, 0.6em). */
  valueCharWidth: number
  minWidth: number
  maxWidth: number
}

export const DEFAULT_METRICS: NodeMetrics = {
  headerHeight: 30,
  rowHeight: 19,
  paddingX: 12,
  paddingBottom: 7,
  railWidth: 3,
  gapKeyValue: 16,
  chevronWidth: 14,
  headerCharWidth: 6.5,
  badgeCharWidth: 6.2,
  keyCharWidth: 6.0,
  valueCharWidth: 7.2,
  minWidth: 140,
  maxWidth: 340,
}

/**
 * Texte de la pastille d'en-tête : le type d'entité en capitales pour un nœud
 * entité, le nombre d'enfants pour un conteneur qui en a, la chaîne vide
 * sinon. Exporté parce que le renderer doit dessiner exactement ce que
 * measureNode a budgété.
 */
export function badgeTextFor(node: GraphNode): string {
  if (node.kind === "entity") return node.entityType.toUpperCase()
  if (node.childIds.length > 0) return String(node.childIds.length)
  return ""
}

/**
 * Texte du libellé d'en-tête en LOD 0. Une entité affiche `#<id>` seul : son
 * `label` (« Order #o1 ») répète le type que la pastille porte déjà.
 */
export function headerTextFor(node: GraphNode): string {
  if (node.kind === "entity") return `#${node.entityId}`
  return node.label
}

/**
 * Calcule la taille d'un nœud sans accéder au DOM. La largeur est le max entre
 * l'en-tête et la plus large des lignes ; chaque fragment est budgété avec
 * l'avance de SA police, ce que l'ancienne implémentation ne faisait pas —
 * elle appliquait l'avance body aux valeurs rendues en mono et sous-estimait
 * leur largeur de ~17%.
 */
export function measureNode(node: GraphNode, metrics: NodeMetrics = DEFAULT_METRICS): Size {
  const chrome = metrics.railWidth + 2 * metrics.paddingX

  const badge = badgeTextFor(node)
  const headerW =
    chrome +
    (node.childIds.length > 0 ? metrics.chevronWidth : 0) +
    headerTextFor(node).length * metrics.headerCharWidth +
    (badge.length > 0 ? metrics.gapKeyValue + badge.length * metrics.badgeCharWidth : 0)

  let widest = headerW
  for (const row of node.rows) {
    const rowW =
      chrome +
      row.key.length * metrics.keyCharWidth +
      metrics.gapKeyValue +
      String(row.value).length * metrics.valueCharWidth
    if (rowW > widest) widest = rowW
  }

  const width = Math.min(metrics.maxWidth, Math.max(metrics.minWidth, widest))
  const height =
    metrics.headerHeight +
    node.rows.length * metrics.rowHeight +
    (node.rows.length > 0 ? metrics.paddingBottom : 0)

  return { width, height }
}
