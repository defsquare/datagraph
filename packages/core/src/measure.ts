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
  /** Width of the accent band BEFORE the card's border covers it: the border is
   * centered on the outer stroke and repaints the leftmost `strokes.border` px
   * of that band, so the rail actually visible measures
   * `railWidth - strokes.border`. */
  railWidth: number
  gapKeyValue: number
  chevronWidth: number
  /** Average advance of the header label (body 13px / 600). */
  headerCharWidth: number
  /** Average advance of the badge (body 9.5px / 600 + tracking). */
  badgeCharWidth: number
  /** Average advance of a key (body 12px). */
  keyCharWidth: number
  /** Advance of a value (mono 12px — exact for Fira Code, 0.6em). */
  valueCharWidth: number
  /** Horizontal inner padding of an array row's pill, on each side of the
   * text. */
  tokenPaddingX: number
  /** Room reserved for the pill's chevron, gap included. */
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
 * Text of an array row: "1 item", "3 items". Exported for the same reason as
 * `badgeTextFor` — the renderer must draw EXACTLY what `measureNode` budgeted,
 * and two wordings drifting apart would yield a pill wider than the room
 * reserved for it.
 */
export function arrayTokenTextFor(count: number): string {
  return count === 1 ? "1 item" : `${count} items`
}

/**
 * Total width of an array row's pill, chrome included.
 * The text uses the value font, like every row value.
 */
export function arrayTokenWidth(count: number, metrics: NodeMetrics): number {
  return (
    arrayTokenTextFor(count).length * metrics.valueCharWidth +
    2 * metrics.tokenPaddingX +
    metrics.tokenChevronWidth
  )
}

/**
 * Width of a row's "value" fragment, whatever its nature: the text for a scalar
 * row, the whole pill for an array row. Shared by measuring and drawing, the way
 * `rowIndexAt` is shared by click and hover — two separate arithmetics would
 * drift, and the card would then reserve room the pill does not honor.
 *
 * NOT exported: the sharing in question is internal to this module —
 * `measureNode` budgets, and the renderer draws from `arrayTokenWidth` and
 * `valueCharWidth`, never from this composite width. No caller outside this
 * file, tests included.
 */
function rowValueWidth(row: Row, metrics: NodeMetrics): number {
  if (row.valueType === "array") return arrayTokenWidth(row.value, metrics)
  return String(row.value).length * metrics.valueCharWidth
}

/** A row whose value ALONE is the content: its key is not drawn, so it consumes
 * neither key width nor key/value gap. */
export function isValueOnlyRow(row: Row): boolean {
  return row.key === VALUE_ONLY_KEY
}

/**
 * Text of the header badge: the entity type in capitals for an entity node, the
 * child count for a container that has any, the empty string otherwise.
 * Exported because the renderer must draw exactly what measureNode budgeted.
 */
export function badgeTextFor(node: GraphNode): string {
  if (node.kind === "entity") return node.entityType.toUpperCase()
  // ELIDED children are excluded: they are already there, as rows, and counting
  // them would have the badge announce an expansion that yields nothing.
  if (node.cardChildCount > 0) return String(node.cardChildCount)
  return ""
}

/**
 * Text of the header label at LOD 0. An entity shows `#<id>` alone: its `label`
 * ("Order #o1") repeats the type the badge already carries.
 */
export function headerTextFor(node: GraphNode): string {
  if (node.kind === "entity") return `#${node.entityId}`
  return node.label
}

/**
 * Computes a node's size without touching the DOM. The width is the max of the
 * header and the widest row; each fragment is budgeted with the advance of ITS
 * font, which the old implementation did not do — it applied the body advance to
 * values rendered in mono and underestimated their width by ~17%.
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
