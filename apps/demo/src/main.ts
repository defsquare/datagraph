import { createDataGraph } from "@defsquare/data-graph";
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

void (async () => {
  await graph.ready;
  graph.fit();
})();
