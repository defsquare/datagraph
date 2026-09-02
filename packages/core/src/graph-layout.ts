// Point d'entrée secondaire : le moteur de mise en page de la VUE GRAPHE et
// son contrat. Le barrel principal (`index.ts`) ne le réexporte pas, et
// `test/bundle-purity.test.ts` garde cette invariante.
//
// TRACE HISTORIQUE — pourquoi ce point d'entrée existe. Il a été créé pour
// isoler `cytoscape` + `cytoscape-fcose`, que l'ancien moteur (fcose puis deux
// passes de relaxation) importait statiquement : ~178 ko gzip qu'il aurait été
// inacceptable d'imposer à un consommateur de la seule vue structure. Ce moteur
// est retiré, les deux dépendances avec lui, et le chunk que le build Vite de
// production d'`apps/demo` émet ici est passé de **180,28 ko gzip** (577,17 ko
// bruts) à **2,64 ko gzip** (5,76 ko bruts) — un facteur 68. Le chunk
// principal, lui, n'a pas bougé d'un octet significatif (552,04 ko gzip avant
// comme après) : rien n'a fui dans le barrel au passage.
//
// Il reste séparé quand même, et il faut être honnête sur ce que ça vaut
// désormais : PLUS RIEN en kilo-octets. 2,64 ko sur un bundle de démo à 552 ko
// gzip ne se défend pas par le poids. Ce que la séparation achète aujourd'hui
// est d'une autre nature — le chargement de la vue graphe reste paresseux par
// CONSTRUCTION et non par chance, donc ce que cette vue tirera demain le sera
// aussi par défaut ; et `./graph-layout` est un export public du package.json,
// que refusionner serait un changement d'API pour économiser un fichier.
// `test/bundle-purity.test.ts` garde cette séparation, avec la même mise à jour
// d'enjeu dans sa documentation.
export {
  createTwoLevelLayoutEngine,
  // Republié pour le renderer, qui recalcule l'enveloppe d'un agrégat pendant
  // le déplacement d'une carte à la souris et doit le faire avec le MÊME
  // `hullPadding` que le moteur. Il le lit sur le namespace de son `import()`
  // dynamique, seule voie autorisée vers ce point d'entrée.
  TWO_LEVEL_LAYOUT_DEFAULTS,
  type ClusterShape,
  type GraphLayoutEngine,
  type GraphLayoutResult,
  type TwoLevelLayoutOptions,
} from "./layout-two-level.js"
