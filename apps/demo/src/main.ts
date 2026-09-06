import {
  createDataGraph,
  defsquareLight,
  defsquareDark,
  arrayTokenTextFor,
  type DataGraph,
  type GraphNode,
  type RefEdge,
} from "@defsquare/data-graph";
import { shopData, shopConfig, bigShopData, bigShopConfig } from "./sample-data";
import { resolveLaunch } from "./launch";

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

// Top-level await (cible es2022, voir vite.config.ts) : tout le reste du
// module dépend du mode de lancement, l'attendre ici évite d'envelopper le
// fichier entier dans une fonction.
const launch = await resolveLaunch();

// Le chrome se taille AVANT que les gestionnaires plus bas ne relisent le
// DOM : un bouton retiré donne `getElementById` → null, et tous les
// gestionnaires savent déjà vivre sans leur élément.
if (launch.mode === "file") {
  // La bascule petit/grand jeu de données est un outil de démo.
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

let graph: DataGraph;
try {
  graph = createDataGraph(container, {
    data: launch.mode === "file" ? launch.data : shopData,
    config: launch.mode === "file" ? launch.config : shopConfig,
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
    __graph?: typeof graph;
  }
}
window.__graph = graph;

// Proof that the renderer's public "select" event is enough to build a
// detail panel entirely outside the library: plain DOM, no lib internals.
const detailEl = document.getElementById("detail");
const typeEl = document.getElementById("selection-type");
const emptyEl = document.getElementById("selection-empty");
const labelEl = document.getElementById("selection-label");
const pathEl = document.getElementById("selection-path");
const rowsEl = document.getElementById("selection-rows");

/** Les arêtes de référence sortantes du nœud, indexées par champ source —
 * c'est ce qui permet au panneau d'afficher un bouton « suivre » sur les
 * bonnes lignes, sans connaître les internes de la lib. */
function outgoingRefs(nodeId: string): Map<string, RefEdge> {
  const map = new Map<string, RefEdge>();
  for (const edge of graph.refEdges(nodeId)) map.set(edge.field, edge);
  return map;
}

function clearSelection(): void {
  // Le panneau est en surimpression du canvas : sans sélection il n'a rien à
  // dire et disparaît entièrement plutôt que d'occuper le coin avec un vide.
  detailEl?.setAttribute("hidden", "");
  emptyEl?.removeAttribute("hidden");
  for (const el of [typeEl, labelEl, pathEl]) el?.setAttribute("hidden", "");
  rowsEl?.replaceChildren();
}

function renderSelection(node: GraphNode): void {
  detailEl?.removeAttribute("hidden");
  emptyEl?.setAttribute("hidden", "");
  for (const el of [labelEl, pathEl]) el?.removeAttribute("hidden");

  if (typeEl) {
    if (node.kind === "entity") {
      typeEl.textContent = node.entityType.toUpperCase();
      typeEl.removeAttribute("hidden");
    } else {
      typeEl.setAttribute("hidden", "");
    }
  }
  if (labelEl) labelEl.textContent = node.label;
  if (pathEl) pathEl.textContent = node.path.length > 0 ? `/${node.path.join("/")}` : "/";

  if (!rowsEl) return;
  const refs = outgoingRefs(node.id);
  rowsEl.replaceChildren(
    ...node.rows.flatMap((row) => {
      const wrapper = document.createElement("div");
      wrapper.className = "row";

      const dt = document.createElement("dt");
      dt.textContent = row.key;
      const dd = document.createElement("dd");
      // Une ligne-tableau porte un NOMBRE D'ÉLÉMENTS, pas une valeur du
      // document : l'afficher tel quel donnerait « tags 3 », qu'on lirait comme
      // la valeur du champ. Le panneau reprend donc la formulation de la carte.
      dd.textContent =
        row.valueType === "array" ? `[ ${arrayTokenTextFor(row.value)} ]` : String(row.value);
      wrapper.append(dt, dd);

      const ref = refs.get(row.key);
      if (ref) {
        const btn = document.createElement("button");
        btn.className = "ref-btn";
        btn.textContent = "→";
        if (ref.to === null || ref.dangling) {
          btn.disabled = true;
          btn.title = `Référence cassée : ${ref.targetType}#${ref.targetId}`;
        } else {
          btn.title = `Aller à ${ref.targetType}#${ref.targetId}`;
          btn.addEventListener("click", () => {
            graph.select(ref.to!);
            graph.focus(ref.to!);
          });
        }
        wrapper.append(btn);
      }
      return [wrapper];
    }),
  );
}

graph.on("select", (node: GraphNode) => {
  renderSelection(node);
  updateStatus();
});

graph.on("followRef", (edge) => {
  if (edge.dangling) console.warn(`[demo] dangling ref: ${edge.field} -> ${edge.targetType}#${edge.targetId}`);
});

// --- Search: debounced input, Enter/Shift+Enter navigation, ↑/↓ buttons,
// and a "N/total" match counter. `graph.search`/`nextMatch`/`prevMatch`
// don't expose the current index directly, so the counter mirrors the
// renderer's own circular-cursor arithmetic locally (see create.ts's
// stepMatch) — both start in sync (reset to -1 by every search()) and only
// ever move via the same next/prev calls, so they can't drift apart.
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const matchCounterEl = document.getElementById("match-counter");
const prevMatchBtn = document.getElementById("prev-match");
const nextMatchBtn = document.getElementById("next-match");

const SEARCH_DEBOUNCE_MS = 150;
let debounceHandle: ReturnType<typeof setTimeout> | undefined;
let matchTotal = 0;
let matchCursor = -1;

function updateMatchCounter(): void {
  if (!matchCounterEl) return;
  matchCounterEl.textContent = matchTotal > 0 ? `${matchCursor + 1}/${matchTotal}` : "";
}

function runSearch(query: string): void {
  const results = graph.search(query);
  matchTotal = results.length;
  matchCursor = -1;
  updateMatchCounter();
}

/** Runs any pending debounced search immediately — so pressing Enter (or a
 * nav button) right after typing doesn't navigate against stale results
 * from before the last keystroke. */
function flushPendingSearch(): void {
  if (debounceHandle === undefined) return;
  clearTimeout(debounceHandle);
  debounceHandle = undefined;
  runSearch(searchInput?.value ?? "");
}

function goToNextMatch(): void {
  flushPendingSearch();
  const result = graph.nextMatch();
  if (result) matchCursor = matchTotal > 0 ? (matchCursor + 1) % matchTotal : -1;
  updateMatchCounter();
}

function goToPrevMatch(): void {
  flushPendingSearch();
  const result = graph.prevMatch();
  if (result) matchCursor = matchCursor <= 0 ? matchTotal - 1 : matchCursor - 1;
  updateMatchCounter();
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    const value = searchInput.value;
    debounceHandle = setTimeout(() => {
      debounceHandle = undefined;
      runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) goToPrevMatch();
    else goToNextMatch();
  });
}

nextMatchBtn?.addEventListener("click", goToNextMatch);
prevMatchBtn?.addEventListener("click", goToPrevMatch);

// --- Chrome flottant : dépliage de la recherche, menu ⋮, fermeture du détail.
// Aucune de ces bascules ne touche à l'état du graphe — la recherche garde sa
// requête et ses résultats quand on la replie, la sélection survit à la
// fermeture du panneau. Ce n'est que de l'affichage.
const searchToggleBtn = document.getElementById("search-toggle");
const findbarEl = document.getElementById("findbar");
const menuToggleBtn = document.getElementById("menu-toggle");
const menuEl = document.getElementById("menu");

function setExpanded(panel: HTMLElement | null, trigger: HTMLElement | null, open: boolean): void {
  if (open) panel?.removeAttribute("hidden");
  else panel?.setAttribute("hidden", "");
  trigger?.setAttribute("aria-expanded", String(open));
}

function isOpen(panel: HTMLElement | null): boolean {
  return panel !== null && !panel.hasAttribute("hidden");
}

function openSearch(): void {
  setExpanded(findbarEl, searchToggleBtn, true);
  // Déplier sans donner le focus obligerait à un second clic pour taper.
  searchInput?.focus();
  searchInput?.select();
}

function closeSearch(): void {
  setExpanded(findbarEl, searchToggleBtn, false);
}

function closeMenu(): void {
  setExpanded(menuEl, menuToggleBtn, false);
}

searchToggleBtn?.addEventListener("click", () => {
  if (isOpen(findbarEl)) closeSearch();
  else openSearch();
});

menuToggleBtn?.addEventListener("click", () => {
  setExpanded(menuEl, menuToggleBtn, !isOpen(menuEl));
});

// Une entrée choisie referme le menu : c'est l'attente sur un menu déroulant,
// et le libellé mis à jour par le gestionnaire de l'entrée reste correct pour
// la prochaine ouverture.
menuEl?.addEventListener("click", (event) => {
  if ((event.target as HTMLElement | null)?.closest(".menu-item")) closeMenu();
});

// Capture : un clic sur le canvas est consommé par Pixi, il ne remonterait pas
// jusqu'ici en phase de bouillonnement.
document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (isOpen(findbarEl) && !findbarEl?.contains(target) && !searchToggleBtn?.contains(target)) closeSearch();
    if (isOpen(menuEl) && !menuEl?.contains(target) && !menuToggleBtn?.contains(target)) closeMenu();
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  // Un seul niveau se ferme par Échap, le plus récent d'abord.
  if (isOpen(menuEl)) {
    closeMenu();
    menuToggleBtn?.focus();
  } else if (isOpen(findbarEl)) {
    // Échap dans un `input[type=search]` en vide nativement la valeur, SANS
    // émettre d'`input` : la requête du graphe et le compteur resteraient sur
    // l'ancien terme pendant que le champ, lui, paraîtrait vierge. Replier ne
    // doit rien annuler, donc on retient ce vidage.
    event.preventDefault();
    closeSearch();
    searchToggleBtn?.focus();
  }
});

// La croix ne masque QUE le panneau : la sélection reste celle du graphe, et
// resélectionner le même nœud le rouvre.
document.getElementById("detail-close")?.addEventListener("click", () => {
  detailEl?.setAttribute("hidden", "");
});

// --- Barre d'état : compteurs et diagnostics.
const statNodesEl = document.getElementById("stat-nodes");
const statVisibleEl = document.getElementById("stat-visible");
const statDiagEl = document.getElementById("stat-diagnostics");

function updateStatus(): void {
  const stats = graph.stats();
  if (statNodesEl) statNodesEl.textContent = String(stats.logicalNodeCount);
  if (statVisibleEl) statVisibleEl.textContent = String(stats.visibleNodeCount);

  const diagnostics = graph.diagnostics();
  if (!statDiagEl) return;
  if (diagnostics.length === 0) {
    statDiagEl.setAttribute("hidden", "");
    return;
  }
  statDiagEl.removeAttribute("hidden");
  statDiagEl.textContent = `${diagnostics.length} diagnostic${diagnostics.length > 1 ? "s" : ""}`;
}

statDiagEl?.addEventListener("click", () => {
  for (const d of graph.diagnostics()) console.warn(`[data-graph] ${d.code} @ ${d.path}: ${d.message}`);
});

// --- Dataset swap: exercises setData() with the small `shopData` fixture vs.
// a ~4000-logical-node `bigShopData` generated fixture (4061 exactly: 78
// clients, 234 commandes, 30 produits, 8 catégories — 350 entités).
//
// La config est passée EXPLICITEMENT dans les deux sens : le petit jeu déclare
// `reviews[*].customerId`, que le grand — sans reviews — ne peut pas
// satisfaire, et réutiliser la même config afficherait un
// `unresolved-reference` légitime mais déroutant dans la barre d'état. Le
// chemin « setData(data) sans config réutilise la config courante » n'est donc
// plus exercé ici ; il l'est par un test e2e dédié (smoke.spec.ts).
const toggleDatasetBtn = document.getElementById("toggle-dataset") as HTMLButtonElement | null;
let usingBigDataset = false;

if (toggleDatasetBtn) {
  toggleDatasetBtn.addEventListener("click", () => {
    void (async () => {
      toggleDatasetBtn.disabled = true;
      try {
        usingBigDataset = !usingBigDataset;
        await graph.setData(
          usingBigDataset ? bigShopData : shopData,
          usingBigDataset ? bigShopConfig : shopConfig,
        );
        toggleDatasetBtn.textContent = usingBigDataset ? "Jeu de données réduit" : "Jeu de données étendu (4000)";
        // setData() resets the renderer's own search/selection state; mirror
        // that in the demo's local UI state too.
        if (searchInput) searchInput.value = "";
        matchTotal = 0;
        matchCursor = -1;
        updateMatchCounter();
        clearSelection();
        updateStatus();
      } finally {
        toggleDatasetBtn.disabled = false;
      }
    })();
  });
}

// --- Thème : la lib et le shell DOM basculent ensemble.
const themeBtn = document.getElementById("toggle-theme");
const logoEl = document.getElementById("logo") as HTMLImageElement | null;
let dark = false;

declare global {
  interface Window {
    __theme?: string;
  }
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  if (logoEl) {
    logoEl.src = dark ? "/defsquare-short-white-red.svg" : "/defsquare-short-dark-red.svg";
  }
  // L'entrée de menu nomme le thème qu'elle ACTIVERAIT, pas celui en place.
  if (themeBtn) themeBtn.textContent = dark ? "Thème clair" : "Thème sombre";
  graph.setTheme(dark ? defsquareDark : defsquareLight);
  window.__theme = dark ? "dark" : "light";
}

themeBtn?.addEventListener("click", () => {
  dark = !dark;
  applyTheme();
});

// --- Bascule Structure / Graphe.
const toggleViewBtn = document.getElementById("toggle-view") as HTMLButtonElement | null;

/** Aligne icône et libellé accessible du bouton sur la vue que le prochain clic
 * activerait. Prend la vue RÉELLEMENT active en argument, jamais celle qu'on a
 * demandée (voir le commentaire du gestionnaire). */
function syncViewButton(active: "graph" | "structure"): void {
  if (!toggleViewBtn) return;
  const target = active === "graph" ? "structure" : "graph";
  const label = target === "graph" ? "Vue graphe" : "Vue structure";
  toggleViewBtn.dataset.target = target;
  toggleViewBtn.title = label;
  toggleViewBtn.setAttribute("aria-label", label);
}

toggleViewBtn?.addEventListener("click", () => {
  void (async () => {
    toggleViewBtn.disabled = true;
    try {
      const next = graph.currentView() === "graph" ? "structure" : "graph";
      await graph.setView(next);
      // L'icône et le libellé sont dérivés de la vue RÉELLEMENT active, jamais de celle
      // qu'on a demandée : `setView` avale deux échecs sans rejeter — l'import
      // dynamique du moteur de la vue graphe qui échoue (réseau, chunk absent)
      // et le cas où un `setData` concurrent a déjà pris la main. Dans les deux
      // cas la promesse se résout alors que la vue n'a pas bougé, et une icône
      // posée depuis `next` annoncerait une vue qui n'est pas à l'écran.
      const active = graph.currentView();
      syncViewButton(active);
      // La bascule change le nombre de nœuds affichés (l'arbre entier d'un
      // côté, les seules entités de l'autre) : sans ce rafraîchissement, le
      // compteur de la barre d'état reste sur la valeur de l'autre vue.
      updateStatus();
    } finally {
      toggleViewBtn.disabled = false;
    }
  })();
});

document.getElementById("fit")?.addEventListener("click", () => graph.fit());

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
  applyTheme();
  syncViewButton(graph.currentView());
  updateStatus();
})();
