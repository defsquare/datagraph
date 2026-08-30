import { createDataGraph, type GraphNode } from "@defsquare/data-graph";
import { shopData, shopConfig } from "./sample-data";

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

void (async () => {
  await graph.ready;
  graph.fit();
})();
