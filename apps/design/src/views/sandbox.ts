import "./sandbox.css";

import { createDataGraph, type DataGraph } from "@renderer/index.ts";
import { currentTheme, type ThemeState } from "../theme-state.ts";
// Les fixtures de la démo, importées par chemin relatif : Vite transforme un
// `.json` en module. Les recopier ici les ferait diverger de celles que les e2e
// du mode fichier rejouent — or l'intérêt du bac à sable est justement de
// montrer le renderer sur les MÊMES données que le produit, pas sur un jeu
// fabriqué pour la vitrine.
import shopConfig from "../../../demo/fixtures/shop.config.json";
import shopData from "../../../demo/fixtures/shop.json";

/**
 * La vue « Bac à sable » : une instance complète du renderer, sur une vraie
 * fixture, dans le thème courant du playground.
 *
 * Les trois autres vues montrent des PIÈCES — un token, une carte peinte hors
 * contexte, un composant DOM figé dans un état. Celle-ci montre l'assemblage :
 * c'est le seul endroit du playground où un changement de token se juge sur ce
 * que l'utilisateur verra vraiment, avec la mise en page, le survol, la
 * sélection et le pli réels.
 *
 * SUR LE CHANGEMENT DE THÈME. Le renderer expose `setTheme()`, qui repeint les
 * couleurs sans relancer la mise en page — c'est le chemin rapide, et il est
 * légitime pour un couple clair/sombre. Cette vue ne s'en sert pourtant PAS :
 * le shell (`main.ts`) remonte toute vue active à chaque changement de thème,
 * marque comme mode, et ce remontage-là suffit ici. Une instance recréée est
 * cohérente par construction — couleurs, polices, métriques de cartes, tout est
 * relu ensemble —, là où `setTheme()` ne l'est que sous une condition que rien
 * ne vérifie à l'exécution (typographie et polices identiques entre les deux
 * thèmes). Le coût est une recréation de canvas sur un clic manuel, ce qui ne
 * se paie sur aucun chemin chaud. Montrer `setTheme()` à l'œuvre reste
 * possible plus tard, mais ce serait alors une démonstration d'API — donc son
 * propre spécimen, pas un raccourci glissé dans le bac à sable.
 */
export function mountSandboxView(root: HTMLElement, state: ThemeState): () => void {
  const page = document.createElement("div");
  page.className = "sb-root";

  const note = document.createElement("p");
  note.className = "sb-note";
  note.textContent =
    "Instance complète du renderer sur apps/demo/fixtures/shop.json. Glisser pour déplacer, molette + ⌘/Ctrl pour zoomer, clic sur un en-tête pour plier ou déplier, Échap pour désélectionner.";

  const stage = document.createElement("div");
  stage.className = "sb-stage";

  page.append(note, stage);
  root.append(page);

  // `disposed` double la garde interne du renderer plutôt que de s'y fier : ce
  // module doit savoir lui-même s'il a encore le droit de toucher au DOM qu'il
  // a créé (le message d'erreur ci-dessous), et cette question-là ne concerne
  // pas l'instance.
  let disposed = false;

  function fail(error: unknown): void {
    if (disposed) return;
    note.textContent = `Échec du chargement : ${error instanceof Error ? error.message : String(error)}`;
  }

  // Une `const` issue d'une IIFE plutôt qu'un `let` assigné dans un `try` : la
  // fermeture asynchrone plus bas a besoin que le narrowing de `if (graph)`
  // TIENNE jusque dans son corps, ce qu'une liaison mutable ne garantit pas.
  const graph = ((): DataGraph | null => {
    try {
      return createDataGraph(stage, {
        data: shopData,
        config: shopConfig,
        theme: currentTheme(state),
        // Les deux mêmes URLs que `apps/demo/src/main.ts`, et pour la même
        // raison : le bac à sable doit exercer le CÂBLAGE réel, pas une
        // variante allégée. Chacune est sûre à passer — le renderer se replie
        // sur un calcul en processus si le worker ne se construit pas — ce
        // qu'elk fait d'ailleurs systématiquement sous Vite, en avertissant une
        // fois dans la console, exactement comme dans la démo. La note de
        // `vite.config.ts` de la démo détaille les quatre modes d'exécution ;
        // la particularité ici est que les alias du playground sont
        // inconditionnels, donc `serve` comme `build` chargent la SOURCE du
        // worker de mise en page.
        elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
        graphLayoutWorkerUrl: new URL("@defsquare/data-graph/graph-layout-worker", import.meta.url),
      });
    } catch (error) {
      // `createDataGraph` valide la config en synchrone. Sans ce catch, une
      // fixture devenue invalide donnerait un cadre vide et une exception dans
      // la console — c'est-à-dire un playground qui ne dit pas ce qui ne va pas.
      fail(error);
      return null;
    }
  })();

  if (graph) {
    void (async () => {
      try {
        // Les échecs asynchrones (graphe trop grand, worker) arrivent par
        // `ready`, jamais par le `throw` ci-dessus.
        await graph.ready;
      } catch (error) {
        fail(error);
        return;
      }
      // La vue peut avoir été démontée pendant l'initialisation : `destroy()`
      // se garde lui-même, mais cadrer une instance détruite n'aurait de toute
      // façon aucun sens.
      if (disposed) return;
      graph.fit();
    })();
  }

  return () => {
    disposed = true;
    // Le contrat de `destroy()` couvre l'appel pendant `app.init()` : la
    // fermeture ci-dessus peut donc encore être en vol sans rien fuir — ni
    // canvas, ni worker de mise en page, ni écouteur clavier global.
    graph?.destroy();
    page.remove();
  };
}
