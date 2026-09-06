/**
 * Point d'entrée public du cœur. Ce fichier est un CONTRAT, pas un index
 * exhaustif : n'y figure que ce qu'un consommateur hors du paquet utilise
 * réellement (le renderer, ses tests, la démo, la doc) plus ce qui est
 * nécessaire pour NOMMER les types de cette API. Tout le reste reste exporté
 * de son module — les tests du cœur importent `../src/<module>.js` — sans
 * pour autant devenir de la surface publique à maintenir.
 *
 * `test/api-surface.test.ts` fige la liste des exports d'exécution : toute
 * modification ici doit y être répercutée volontairement.
 */

export const VERSION = "0.1.0"

// `parseSelector`, `parseRelativePath`, `matchesPath` et `PathSegment` sont
// l'implémentation de la grammaire de sélecteurs, consommée par `config.ts` et
// `build.ts` seuls : la config publique se déclare en chaînes, pas en segments.
export { ConfigError } from "./selector.js"
export {
  validateConfig,
  type DataGraphConfig,
  // Type de retour de `validateConfig` ; `ReferenceDecl` type l'un de ses
  // champs, il ne peut donc pas rester hors du contrat.
  type ValidatedConfig,
  type ReferenceDecl,
} from "./config.js"

export { buildGraph } from "./build.js"
export { CollapseState } from "./collapse.js"
export { buildAggregates, type Aggregate, type AggregateIndex } from "./aggregate.js"
export { enclosingCircle, type Circle } from "./hull.js"
// `SearchIndex` est relayé en TYPE seul : un index ne s'obtient que de
// `buildSearchIndex`, et son constructeur prend une entrée dénormalisée
// (`SearchEntry`, avec son champ `lower`) qui est un détail d'implémentation.
// Exporter la classe comme valeur promettait donc un `new` que personne ne
// peut écrire ; le renderer ne s'en sert d'ailleurs qu'en position de type.
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
  // `rowRectFor` sert à `packages/renderer/test/edges.test.ts`, qui importe le
  // cœur par le nom du paquet — donc par ce barrel.
  rowRectFor,
  anchorRectFor,
  nearestCardRectFor,
  type Rect,
  type LayoutResult,
  type StructureLayoutEngine,
  // Dans les options de `createStructureLayoutEngine`.
  type ElkFactory,
} from "./structure-layout.js"
// `nearestDrawn` et `VALUE_ONLY_KEY` restent internes : le premier est un
// détail du calcul de layout, le second la clé conventionnelle d'une ligne
// « valeur seule », que `isValueOnlyRow` expose déjà sous forme de prédicat.
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
