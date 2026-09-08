/**
 * Public entry point of the renderer. This file is a CONTRACT, not an exhaustive index:
 * only what the README documents and what the demo (or a host) consumes appears here.
 * The low-level drawing in `draw.ts`, the `Camera`, the `Emitter` and font measurement
 * are internal machinery of `createDataGraph` — each stays exported from its own module
 * for `test/*.test.ts`, which imports `../src/*.js`, but none of them is public
 * surface.
 *
 * `test/api-surface.test.ts` freezes the list of runtime exports: any change here must
 * be mirrored there deliberately.
 */

export {
  resolveTheme,
  entityAccentMap,
  defsquareLight,
  defsquareDark,
  neutralLight,
  neutralDark,
} from "./theme.js";
export type { Theme, ThemeOverride, TypeStyle } from "./theme.js";

export { createDataGraph } from "./create.js";
export type {
  DataGraph,
  DataGraphOptions,
  DataGraphEvent,
  DataGraphView,
  // Relayed by `create.ts` and not re-exported directly from
  // `@defsquare/data-graph-core/graph-layout`: `test/bundle-purity.test.ts` forbids any
  // `export … from` form towards that specifier, type-only included. Going through
  // `create.ts`, which already makes it an `import type`, hands consumers the type
  // without touching that guard.
  //
  // Replaces `GraphLayoutOptions`, which no longer types anything in this API now
  // that the graph view runs on the two-level engine (see
  // `DataGraphOptions.graphLayoutOptions`). The core still exports it, for whoever
  // instantiates the old engine directly; this package no longer relays it,
  // because a relayed type that types none of its own fields is an invitation to
  // error.
  TwoLevelLayoutOptions,
} from "./create.js";

// Re-exported so consumers can type their config/results without depending
// on @defsquare/data-graph-core directly.
export type {
  DataGraphConfig,
  NodeId,
  GraphNode,
  Row,
  ArrayRow,
  RefEdge,
  Diagnostic,
  SearchResult,
} from "@defsquare/data-graph-core";

// A host that renders a node's rows itself (a detail panel) needs to phrase an array
// row the way the card does: "3 items" and not "3", which would read as the field's
// value.
export { arrayTokenTextFor } from "@defsquare/data-graph-core";
