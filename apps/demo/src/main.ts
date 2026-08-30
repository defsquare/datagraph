import { createDataGraph, type GraphNode } from "@defsquare/data-graph";
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
const labelEl = document.getElementById("selection-label");
const pathEl = document.getElementById("selection-path");
const rowsEl = document.getElementById("selection-rows");

function renderSelection(node: GraphNode): void {
  if (labelEl) labelEl.textContent = node.label;
  if (pathEl) pathEl.textContent = node.path.length > 0 ? `/${node.path.join("/")}` : "/";
  if (rowsEl) {
    rowsEl.replaceChildren(
      ...node.rows.map((row) => {
        const li = document.createElement("li");
        li.textContent = `${row.key}: ${row.value}`;
        return li;
      }),
    );
  }
}

graph.on("select", (node: GraphNode) => renderSelection(node));

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
        toggleDatasetBtn.textContent = usingBigDataset ? "Load small dataset" : "Load big dataset (2000)";
        // setData() resets the renderer's own search/selection state; mirror
        // that in the demo's local UI state too.
        if (searchInput) searchInput.value = "";
        matchTotal = 0;
        matchCursor = -1;
        updateMatchCounter();
        if (labelEl) labelEl.textContent = "Click a node to see details.";
        if (pathEl) pathEl.textContent = "";
        if (rowsEl) rowsEl.replaceChildren();
      } finally {
        toggleDatasetBtn.disabled = false;
      }
    })();
  });
}

void (async () => {
  await graph.ready;
  graph.fit();
})();
