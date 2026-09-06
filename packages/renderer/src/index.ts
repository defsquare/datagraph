/**
 * Point d'entrée public du renderer. Ce fichier est un CONTRAT, pas un index
 * exhaustif : n'y figure que ce que le README documente et que la démo (ou un
 * hôte) consomme. Le dessin bas niveau de `draw.ts`, la `Camera`, l'`Emitter`
 * et la mesure de police sont les rouages internes de `createDataGraph` —
 * chacun reste exporté de son module pour `test/*.test.ts`, qui importe
 * `../src/*.js`, mais aucun n'est de la surface publique.
 *
 * `test/api-surface.test.ts` fige la liste des exports d'exécution : toute
 * modification ici doit y être répercutée volontairement.
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

// Un hôte qui rend lui-même les lignes d'un nœud (panneau de détail) a besoin
// de formuler une ligne-tableau comme la carte le fait : « 3 items » et non
// « 3 », qu'on lirait comme la valeur du champ.
export { arrayTokenTextFor } from "@defsquare/data-graph-core";
