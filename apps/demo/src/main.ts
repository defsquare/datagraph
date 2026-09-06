import {
  createDataGraph,
  type DataGraph,
  type DataGraphConfig,
  type GraphNode,
} from "@defsquare/data-graph";
import { resolveLaunch } from "./launch";
import { createDetailPanel } from "./detail-panel";
import { createSearchUi } from "./search-ui";
import { createChrome } from "./chrome";

// Orchestration seule : ce fichier résout le mode de lancement, crée le graphe
// et câble entre eux les modules du shell. Aucun d'eux n'est propre à la démo —
// sauf `demo-mode.ts`, chargé DYNAMIQUEMENT et uniquement quand aucun fichier
// n'a été fourni.

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

// Top-level await (cible es2022, voir vite.config.ts) : tout le reste du
// module dépend du mode de lancement, l'attendre ici évite d'envelopper le
// fichier entier dans une fonction.
const launch = await resolveLaunch();

// Le chrome se taille AVANT que les modules plus bas ne relisent le DOM : un
// bouton retiré donne `getElementById` → null, et tous les gestionnaires
// savent déjà vivre sans leur élément.
if (launch.mode === "file") {
  // La bascule petit/grand jeu de données est un outil de démo. Son module
  // n'est pas chargé ici, mais le bouton, lui, est dans `index.html` : sans ce
  // retrait le menu offrirait une entrée morte.
  document.getElementById("toggle-dataset")?.remove();
  // `?? {}` : une config du disque peut n'avoir aucune clé `ids`, et ce
  // test est HORS du try/catch plus bas — exploser ici donnerait une fenêtre
  // blanche. On laisse passer, `createDataGraph` la rejette proprement et son
  // catch affiche l'écran d'erreur.
  if (Object.keys(launch.config.ids ?? {}).length === 0) {
    // Sans entités la vue graphe n'a rien à montrer : structure seule.
    document.getElementById("toggle-view")?.remove();
  }
}

function showLoadError(error: unknown): void {
  const messageEl = document.getElementById("load-error-message");
  if (messageEl) messageEl.textContent = error instanceof Error ? error.message : String(error);
  document.getElementById("load-error")?.removeAttribute("hidden");
}

// L'outillage de démo — jeu d'exemple ET son générateur — n'est atteint que par
// cet import dynamique. En mode fichier le chunk n'est jamais téléchargé, donc
// `sample-data.ts` n'est jamais évalué : c'est ce qui évite de fabriquer un jeu
// de démo pour un document que l'utilisateur a fourni lui-même.
let demo: typeof import("./demo-mode") | null = null;
let source: { data: unknown; config: DataGraphConfig };
if (launch.mode === "file") {
  source = { data: launch.data, config: launch.config };
} else {
  demo = await import("./demo-mode");
  source = demo.demoDataset;
}

let graph: DataGraph;
try {
  graph = createDataGraph(container, {
    data: source.data,
    config: source.config,
    // Real Web Worker offload for elk layout is best-effort here: elkjs's
    // bundled ELK falls back to an in-process "fake worker" under Vite/browser
    // rather than failing. The option is still passed end-to-end, so the demo
    // exercises the wiring even where the browser gets no real worker.
    elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
  });
} catch (error) {
  // `createDataGraph` valide la config en synchrone : une config
  // sémantiquement invalide s'arrête ici, en écran d'erreur — pas en fenêtre
  // blanche. Le `throw` stoppe l'évaluation du module : rien plus bas n'a de
  // sens sans instance.
  showLoadError(error);
  throw error;
}

// Exposed for e2e and manual inspection: the Playwright specs drive the public
// API through this handle rather than through the demo's DOM chrome.
declare global {
  interface Window {
    __graph?: DataGraph;
  }
}
window.__graph = graph;

const detail = createDetailPanel(graph);
const search = createSearchUi(graph);
const chrome = createChrome(graph, { onSearchOpen: () => search.focus() });

graph.on("select", (node: GraphNode) => {
  detail.render(node);
  chrome.updateStatus();
});

graph.on("followRef", (edge) => {
  if (edge.dangling) console.warn(`[demo] dangling ref: ${edge.field} -> ${edge.targetType}#${edge.targetId}`);
});

// `setData()` réinitialise l'état de recherche et de sélection du renderer ; le
// shell suit le même chemin de son côté.
demo?.setupDatasetToggle(graph, () => {
  search.reset();
  detail.clear();
  chrome.updateStatus();
});

void (async () => {
  try {
    await graph.ready;
  } catch (error) {
    // Les échecs asynchrones (GraphTooLargeError, worker) arrivent par
    // `ready` : même écran que les échecs synchrones.
    showLoadError(error);
    return;
  }
  graph.fit();
  chrome.applyTheme();
  chrome.syncViewButton();
  chrome.updateStatus();
})();
