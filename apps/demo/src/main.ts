import {
  createDataGraph,
  defsquareLight,
  defsquareDark,
  type GraphNode,
  type RefEdge,
} from "@defsquare/data-graph";
import { shopData, shopConfig, bigShopData } from "./sample-data";

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

const graph = createDataGraph(container, {
  data: shopData,
  config: shopConfig,
  // Real Web Worker offload for elk layout is best-effort here: elkjs's
  // bundled ELK falls back to an in-process "fake worker" under Vite/browser
  // (see task-11-report.md). The option is still wired end-to-end.
  elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
});

// Exposed for manual/E2E inspection (Task 14 relies on this).
declare global {
  interface Window {
    __graph?: typeof graph;
  }
}
window.__graph = graph;

// Proof that the renderer's public "select" event is enough to build a
// detail panel entirely outside the library: plain DOM, no lib internals.
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
  emptyEl?.removeAttribute("hidden");
  for (const el of [typeEl, labelEl, pathEl]) el?.setAttribute("hidden", "");
  rowsEl?.replaceChildren();
}

function renderSelection(node: GraphNode): void {
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
      dd.textContent = String(row.value);
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
// a ~2000-logical-node `bigShopData` generated fixture. Config is the same
// for both, so this deliberately calls setData(data) without a config,
// exercising the "reuse current config when omitted" path.
const toggleDatasetBtn = document.getElementById("toggle-dataset") as HTMLButtonElement | null;
let usingBigDataset = false;

if (toggleDatasetBtn) {
  toggleDatasetBtn.addEventListener("click", () => {
    void (async () => {
      toggleDatasetBtn.disabled = true;
      try {
        usingBigDataset = !usingBigDataset;
        await graph.setData(usingBigDataset ? bigShopData : shopData);
        toggleDatasetBtn.textContent = usingBigDataset ? "Jeu de données réduit" : "Jeu de données étendu (2000)";
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
  graph.setTheme(dark ? defsquareDark : defsquareLight);
  window.__theme = dark ? "dark" : "light";
}

themeBtn?.addEventListener("click", () => {
  dark = !dark;
  applyTheme();
});

// --- Bascule Structure / Graphe.
const toggleViewBtn = document.getElementById("toggle-view") as HTMLButtonElement | null;

toggleViewBtn?.addEventListener("click", () => {
  void (async () => {
    toggleViewBtn.disabled = true;
    try {
      const next = graph.currentView() === "graph" ? "structure" : "graph";
      await graph.setView(next);
      // Le libellé est dérivé de la vue RÉELLEMENT active, jamais de celle
      // qu'on a demandée : `setView` avale deux échecs sans rejeter — l'import
      // dynamique du moteur de la vue graphe qui échoue (réseau, chunk absent)
      // et le cas où un `setData` concurrent a déjà pris la main. Dans les deux
      // cas la promesse se résout alors que la vue n'a pas bougé, et un libellé
      // posé depuis `next` annoncerait une vue qui n'est pas à l'écran.
      const active = graph.currentView();
      toggleViewBtn.textContent = active === "graph" ? "Vue structure" : "Vue graphe";
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
  await graph.ready;
  graph.fit();
  applyTheme();
  updateStatus();
})();
