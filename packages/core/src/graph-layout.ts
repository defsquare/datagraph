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

// Le moteur à deux niveaux sort par le MÊME canal, alors qu'il n'importe ni
// cytoscape ni elkjs et pourrait donc vivre dans le barrel principal. Trois
// raisons de ne pas l'y mettre :
//
//   1. C'est un `GraphLayoutEngine`, dont l'interface et les types de retour
//      (`GraphLayoutResult`, `ClusterShape`) sont déclarés dans
//      `layout-graph.js`. Les exposer depuis deux points d'entrée différents
//      obligerait le consommateur à importer son moteur d'un côté et le type
//      qu'il implémente de l'autre.
//   2. Le renderer atteint la vue graphe par un unique `import()` dynamique de
//      ce module ; un second point d'entrée pour un second moteur de la même
//      vue multiplierait les chemins sans rien acheter.
//   3. Il ne coûte rien à qui charge déjà ce chunk : c'est du cœur pur, sans
//      dépendance externe.
//
// Le budget de bundle n'est pas menacé dans l'autre sens non plus : ce module
// reste absent de la fermeture transitive d'`index.js`, ce que
// `test/bundle-purity.test.ts` vérifie. Si le moteur à deux niveaux devient un
// jour LE moteur de la vue et que cytoscape disparaît, c'est tout ce fichier
// qui se replie — pas une exposition à démêler.
//
// Ce que ça coûte, mesuré : le chunk `graph-layout-*.js` du build Vite de
// production d'`apps/demo` passe de 572,09 ko bruts / 178,29 ko gzip à
// 577,17 / 180,28 — **+2,0 ko gzip**, soit +1,1 %. Le « ~178 ko » que citent
// les READMEs et les commentaires reste la bonne façon de dire ce qu'ils
// disent : c'est la part de cytoscape, et c'est elle que la pureté de bundle
// tient à l'écart. Ces 2 ko sont du cœur pur qui disparaîtrait avec elle.
export {
  createTwoLevelLayoutEngine,
  type TwoLevelLayoutOptions,
} from "./layout-two-level.js"
