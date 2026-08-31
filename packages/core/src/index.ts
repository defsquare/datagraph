export const VERSION = "0.1.0"

export { parseSelector, matchesPath, ConfigError, type PathSegment } from "./selector.js"
export { validateConfig, type EntityConfig, type DataGraphConfig, type ValidatedConfig } from "./config.js"

export { buildGraph } from "./build.js"
export { CollapseState } from "./collapse.js"
export { buildAggregates, type Aggregate, type AggregateIndex } from "./aggregate.js"
export { buildSearchIndex, SearchIndex, type SearchResult } from "./search.js"
export { measureNode, badgeTextFor, headerTextFor, DEFAULT_METRICS, type Size, type NodeMetrics } from "./measure.js"
export {
  createLayoutEngine,
  type Rect,
  type LayoutResult,
  type LayoutEngine,
  type ElkFactory,
} from "./layout.js"
export {
  GraphTooLargeError,
  type NodeId,
  type ScalarRow,
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
