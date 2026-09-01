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
  // Relayé par `create.ts` et non réexporté directement depuis
  // `@defsquare/data-graph-core/graph-layout` : `test/bundle-purity.test.ts`
  // interdit toute forme `export … from` vers ce specifier, y compris
  // type-only. Passer par `create.ts`, qui en fait déjà un `import type`,
  // donne le type aux consommateurs sans toucher à cette garde.
  GraphLayoutOptions,
} from "./create.js";

export { Camera } from "./camera.js";
export type { Size } from "./camera.js";

export {
  drawNode,
  drawEdges,
  drawEdgeHitAreas,
  drawClusters,
  drawSelectionOverlay,
  drawSearchHighlights,
  lodForScale,
  LOD0_MIN_SCALE,
  LOD1_MIN_SCALE,
  charWidthFor,
  truncateToWidth,
} from "./draw.js";
export type { Lod, EdgeHit, EdgeMode, TextRole } from "./draw.js";

export { measureFontMetrics, fontsReady } from "./font-metrics.js";

export { Emitter } from "./events.js";

// Re-exported so consumers can type their config/results without depending
// on @defsquare/data-graph-core directly.
export type {
  DataGraphConfig,
  EntityConfig,
  NodeId,
  GraphNode,
  RefEdge,
  Diagnostic,
  SearchResult,
} from "@defsquare/data-graph-core";
