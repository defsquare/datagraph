// Point d'entrée secondaire : tout ce qui dépend de cytoscape vit ici et
// SEULEMENT ici. Le barrel principal (`index.ts`) ne doit jamais réexporter ce
// module, sous peine d'imposer ~183 ko gzip à tout consommateur de la vue
// structure. `test/bundle-purity.test.ts` garde cette invariante.
export {
  createGraphLayoutEngine,
  type ClusterShape,
  type GraphLayoutEngine,
  type GraphLayoutOptions,
  type GraphLayoutResult,
} from "./layout-graph.js"
