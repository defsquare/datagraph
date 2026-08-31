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
export type { DataGraph, DataGraphOptions, DataGraphEvent } from "./create.js";

export { Camera } from "./camera.js";
export type { Size } from "./camera.js";

export {
  drawNode,
  drawEdges,
  drawEdgeHitAreas,
  drawSelectionOverlay,
  drawSearchHighlights,
  lodForScale,
  LOD0_MIN_SCALE,
  LOD1_MIN_SCALE,
  charWidthFor,
  truncateToWidth,
} from "./draw.js";
export type { Lod, EdgeHit, TextRole } from "./draw.js";

export { measureFontMetrics } from "./font-metrics.js";

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
