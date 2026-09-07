// LE WEB WORKER DE MISE EN PAGE DE LA VUE GRAPHE.
//
// Ce fichier n'est importé par AUCUN autre module du paquet : c'est une ENTRÉE
// de build à part entière (voir `tsup.config.ts`), publiée sous
// `@defsquare/data-graph/graph-layout-worker` et destinée à être désignée par
// une URL, pas par un `import`. Rien de ce qu'il tire n'entre donc dans le
// bundle d'un consommateur qui ne l'utilise pas — c'est ce qui autorise l'import
// STATIQUE du point d'entrée `./graph-layout` ci-dessous, que
// `test/bundle-purity.test.ts` interdit partout ailleurs dans `src/` et
// autorise ici nommément, en gardant la contrepartie : personne n'importe ce
// fichier.
//
// CE QU'IL RÉSOUT, mesuré : sur un audit réel de 6 251 entités et ~1 300
// agrégats, la mise en page à deux niveaux dure ~4,4 s et est entièrement
// synchrone. Exécutée sur le thread principal, elle gèle la page pendant toute
// la bascule de vue — pas de rendu, pas de pan, pas de zoom. Ici, elle ne gèle
// que ce worker, dont personne n'attend rien d'autre.
//
// CONTRAINTE DE CONTENU, et elle est vérifiée par le test de pureté : ni Pixi ni
// DOM. Un worker n'a ni `document` ni `window`, et le cœur importé
// (`layoutFromInput`) est pur pour cette raison précise. L'autre moitié du
// moteur — l'extraction, qui lit le `Graph` — reste chez l'appelant : un `Graph`
// ne traverse pas un `postMessage`, et c'est exactement pourquoi le cœur a été
// scindé (voir `GraphLayoutInput`, côté cœur).
import { layoutFromInput } from "@defsquare/data-graph-core/graph-layout";
// `import type` : le protocole est déclaré chez son autre interlocuteur, le
// contrôleur, et le bundler efface cette ligne. Aucun code du renderer — donc
// aucun Pixi — n'entre par là.
import type { GraphLayoutWorkerRequest, GraphLayoutWorkerResponse } from "./graph-view.js";

/**
 * La portée globale du worker, retypée.
 *
 * Le `lib` par défaut du dépôt est celui du DOM, où `self` est une `Window` :
 * la traversée par `unknown` est ce qui évite d'imposer `lib: "webworker"` à
 * tout le paquet pour ce seul fichier. Ce qui est retypé est exactement ce qui
 * est utilisé, et c'est tout le contrat d'exécution de ce module.
 */
const scope = self as unknown as {
  onmessage: ((event: { data: GraphLayoutWorkerRequest }) => void) | null;
  postMessage(message: GraphLayoutWorkerResponse): void;
};

scope.onmessage = (event) => {
  const { gen, input } = event.data;
  try {
    const { positions, clusters } = layoutFromInput(input);
    // Aplati en tuples plutôt qu'en `Map` de `Rect` : à 6 251 cartes c'est un
    // tableau de nombres au lieu d'autant de petits objets à cloner. Le
    // contrôleur les réhydrate (voir `hydrateLayout`).
    const flat: [string, number, number, number, number][] = [];
    for (const [id, rect] of positions) flat.push([id, rect.x, rect.y, rect.width, rect.height]);
    scope.postMessage({ gen, ok: true, positions: flat, clusters });
  } catch (err) {
    // Une exception ne traverse pas `postMessage` : on renvoie son message, et
    // c'est le contrôleur qui décide quoi en faire (avertir une fois, puis se
    // replier définitivement en processus). Le worker, lui, reste vivant — c'est
    // son interlocuteur qui le retire.
    scope.postMessage({ gen, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
