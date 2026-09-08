/**
 * Public entry point of the core. This file is a CONTRACT, not an exhaustive
 * index: only what a consumer outside the package actually uses appears here
 * (the renderer, its tests, the demo, the docs) plus what is needed to NAME the
 * types of that API. Everything else stays exported from its own module — the
 * core's tests import `../src/<module>.js` — without thereby becoming public
 * surface to maintain.
 *
 * `test/api-surface.test.ts` freezes the list of runtime exports: any change
 * here must be mirrored there deliberately.
 */

export const VERSION = "0.1.0"

// `parseSelector`, `parseRelativePath`, `matchesPath` and `PathSegment` are the
// implementation of the selector grammar, consumed by `config.ts` and `build.ts`
// alone: the public config is declared in strings, not in segments.
export { ConfigError } from "./selector.js"
export {
  validateConfig,
  type DataGraphConfig,
  // Return type of `validateConfig`; `ReferenceDecl` types one of its fields,
  // so it cannot stay outside the contract.
  type ValidatedConfig,
  type ReferenceDecl,
} from "./config.js"

export { buildGraph } from "./build.js"
// `PAGE_SIZE` and `pageOf` go out with `CollapseState` because pagination is not
// an internal detail: the renderer draws the gap tokens and must name the same
// pages as the collapse state. `INITIAL_CARD_BUDGET` goes out for the same
// reason: it is the default a caller overrides through `opts`, and naming it
// keeps it from being copied as a literal outside the core.
export {
  CollapseState,
  PAGE_SIZE,
  INITIAL_CARD_BUDGET,
  pageOf,
  type HiddenGap,
} from "./collapse.js"
export { buildAggregates, type Aggregate, type AggregateIndex } from "./aggregate.js"
export { enclosingCircle, type Circle } from "./hull.js"
// `SearchIndex` is relayed as a TYPE only: an index is only ever obtained from
// `buildSearchIndex`, and its constructor takes a denormalized input
// (`SearchEntry`, with its `lower` field) that is an implementation detail.
// Exporting the class as a value therefore promised a `new` nobody can write;
// the renderer only uses it in type position anyway.
export { buildSearchIndex, type SearchIndex, type SearchResult } from "./search.js"
export {
  measureNode,
  badgeTextFor,
  headerTextFor,
  arrayTokenTextFor,
  arrayTokenWidth,
  isValueOnlyRow,
  DEFAULT_METRICS,
  type Size,
  type NodeMetrics,
} from "./measure.js"
export {
  createStructureLayoutEngine,
  // `rowRectFor` is used by `packages/renderer/test/edges.test.ts`, which
  // imports the core by package name — hence through this barrel.
  rowRectFor,
  anchorRectFor,
  nearestCardRectFor,
  type Rect,
  type LayoutResult,
  type StructureLayoutEngine,
  // In the options of `createStructureLayoutEngine`.
  type ElkFactory,
} from "./structure-layout.js"
// `nearestDrawn` and `VALUE_ONLY_KEY` stay internal: the first is a detail of
// the layout computation, the second the conventional key of a "value only"
// row, which `isValueOnlyRow` already exposes as a predicate.
export {
  GraphTooLargeError,
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
