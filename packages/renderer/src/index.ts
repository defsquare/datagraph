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
  //
  // Remplace `GraphLayoutOptions`, qui ne type plus rien de cette API depuis
  // que la vue graphe tourne sur le moteur à deux niveaux (voir
  // `DataGraphOptions.graphLayoutOptions`). Le cœur l'exporte toujours, pour
  // qui instancierait l'ancien moteur directement ; ce paquet-ci ne le relaie
  // plus, parce qu'un type relayé qui n'est le type d'aucun de ses champs est
  // une invitation à l'erreur.
  TwoLevelLayoutOptions,
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
