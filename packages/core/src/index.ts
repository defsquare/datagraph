export const VERSION = "0.1.0"

export { parseSelector, parseRelativePath, matchesPath, ConfigError, type PathSegment } from "./selector.js"
export {
  validateConfig,
  type EntityConfig,
  type DataGraphConfig,
  type ValidatedConfig,
  type ReferenceDecl,
} from "./config.js"

export { buildGraph } from "./build.js"
export { CollapseState } from "./collapse.js"
export { buildAggregates, type Aggregate, type AggregateIndex } from "./aggregate.js"
export { enclosingCircle, type Circle } from "./hull.js"
export { buildSearchIndex, SearchIndex, type SearchResult } from "./search.js"
export {
  measureNode,
  badgeTextFor,
  headerTextFor,
  arrayTokenTextFor,
  arrayTokenWidth,
  rowValueWidth,
  isValueOnlyRow,
  DEFAULT_METRICS,
  type Size,
  type NodeMetrics,
} from "./measure.js"
export {
  createLayoutEngine,
  rowRectFor,
  anchorRectFor,
  nearestCardRectFor,
  type Rect,
  type LayoutResult,
  type LayoutEngine,
  type ElkFactory,
} from "./layout.js"
export {
  GraphTooLargeError,
  nearestDrawn,
  VALUE_ONLY_KEY,
  type NodeId,
  type ScalarRow,
  type ArrayRow,
  type Row,
  type BaseNode,
  type EntityNode,
  type ObjectNode,
  type ArrayNode,
  type GraphNode,
  type ContainEdge,
  type RefEdge,
  type Diagnostic,
  type Graph,
} from "./model.js"
