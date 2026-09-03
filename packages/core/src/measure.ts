import { VALUE_ONLY_KEY, type GraphNode, type Row } from "./model.js"

export interface Size {
  width: number
  height: number
}

export interface NodeMetrics {
  headerHeight: number
  rowHeight: number
  paddingX: number
  paddingBottom: number
  /** Largeur de la bande d'accent AVANT que la bordure de la carte ne la
   * recouvre : la bordure est centrée sur le tracé extérieur et repeint les
   * `strokes.border` px les plus à gauche de cette bande, donc le rail
   * effectivement visible mesure `railWidth - strokes.border`. */
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
  /** Marge intérieure horizontale de la pilule d'une ligne-tableau, de chaque
   * côté du texte. */
  tokenPaddingX: number
  /** Place réservée au chevron de la pilule, écart compris. */
  tokenChevronWidth: number
  minWidth: number
  maxWidth: number
}

export const DEFAULT_METRICS: NodeMetrics = {
  headerHeight: 30,
  rowHeight: 19,
  paddingX: 12,
  paddingBottom: 7,
  railWidth: 4,
  gapKeyValue: 16,
  chevronWidth: 14,
  headerCharWidth: 6.5,
  badgeCharWidth: 6.2,
  keyCharWidth: 6.0,
  valueCharWidth: 7.2,
  tokenPaddingX: 6,
  tokenChevronWidth: 11,
  minWidth: 140,
  maxWidth: 340,
}

/**
 * Texte d'une ligne-tableau : « 1 item », « 3 items ». Exporté pour la même
 * raison que `badgeTextFor` — le renderer doit dessiner EXACTEMENT ce que
 * `measureNode` a budgété, et deux formulations qui divergeraient rendraient
 * une pilule plus large que la place réservée.
 */
export function arrayTokenTextFor(count: number): string {
  return count === 1 ? "1 item" : `${count} items`
}

/**
 * Largeur totale de la pilule d'une ligne-tableau, chrome compris.
 * Le texte est en police de valeur, comme toute valeur de ligne.
 */
export function arrayTokenWidth(count: number, metrics: NodeMetrics): number {
  return (
    arrayTokenTextFor(count).length * metrics.valueCharWidth +
    2 * metrics.tokenPaddingX +
    metrics.tokenChevronWidth
  )
}

/**
 * Largeur du fragment « valeur » d'une ligne, quelle que soit sa nature : le
 * texte pour une ligne scalaire, la pilule entière pour une ligne-tableau.
 * Partagé par la mesure et le dessin, comme `rowIndexAt` l'est par le clic et
 * le survol — deux arithmétiques séparées dériveraient, et la carte réserverait
 * alors une place que la pilule ne respecte pas.
 */
export function rowValueWidth(row: Row, metrics: NodeMetrics): number {
  if (row.valueType === "array") return arrayTokenWidth(row.value, metrics)
  return String(row.value).length * metrics.valueCharWidth
}

/** Une ligne dont la valeur SEULE fait le contenu : sa clé n'est pas dessinée,
 * donc elle ne consomme ni largeur de clé ni écart clé/valeur. */
export function isValueOnlyRow(row: Row): boolean {
  return row.key === VALUE_ONLY_KEY
}

/**
 * Texte de la pastille d'en-tête : le type d'entité en capitales pour un nœud
 * entité, le nombre d'enfants pour un conteneur qui en a, la chaîne vide
 * sinon. Exporté parce que le renderer doit dessiner exactement ce que
 * measureNode a budgété.
 */
export function badgeTextFor(node: GraphNode): string {
  if (node.kind === "entity") return node.entityType.toUpperCase()
  // Les enfants ÉLIDÉS sont exclus : ils sont déjà là, en lignes, et les
  // compter ferait annoncer par la pastille un dépliage qui ne rendrait rien.
  if (node.cardChildCount > 0) return String(node.cardChildCount)
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
    (node.cardChildCount > 0 ? metrics.chevronWidth : 0) +
    headerTextFor(node).length * metrics.headerCharWidth +
    (badge.length > 0 ? metrics.gapKeyValue + badge.length * metrics.badgeCharWidth : 0)

  let widest = headerW
  for (const row of node.rows) {
    const keyW = isValueOnlyRow(row)
      ? 0
      : row.key.length * metrics.keyCharWidth + metrics.gapKeyValue
    const rowW = chrome + keyW + rowValueWidth(row, metrics)
    if (rowW > widest) widest = rowW
  }

  const width = Math.min(metrics.maxWidth, Math.max(metrics.minWidth, widest))
  const height =
    metrics.headerHeight +
    node.rows.length * metrics.rowHeight +
    (node.rows.length > 0 ? metrics.paddingBottom : 0)

  return { width, height }
}
