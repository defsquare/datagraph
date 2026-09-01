// Point d'entrée secondaire : tout ce qui dépend de cytoscape vit ici et
// SEULEMENT ici. Le barrel principal (`index.ts`) ne doit jamais réexporter ce
// module, sous peine d'imposer ~178 ko gzip à tout consommateur de la vue
// structure. `test/bundle-purity.test.ts` garde cette invariante.
//
// 178 ko est la taille MESURÉE dans ce dépôt : le chunk `graph-layout-*.js`
// qu'émet le build Vite de production d'`apps/demo` (572,09 ko bruts, 178,29 ko
// gzip). Le chiffre de ~183 ko qu'on trouve encore dans `docs/superpowers/`
// vient de la sonde initiale (`spikes/2026-08-31-organic-layout.md`) : c'était
// une estimation d'avant l'intégration, laissée telle quelle comme trace
// historique. Les READMEs et les commentaires de code disent tous 178.
export {
  createGraphLayoutEngine,
  type ClusterShape,
  type GraphLayoutEngine,
  type GraphLayoutOptions,
  type GraphLayoutResult,
} from "./layout-graph.js"
