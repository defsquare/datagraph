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

// Orchestration only: this file resolves the launch mode, creates the graph and
// wires the shell modules together. None of them is demo-specific — except
// `demo-mode.ts`, loaded DYNAMICALLY and only when no file was supplied.

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

// Top-level await (es2022 target, see vite.config.ts): everything else in the
// module depends on the launch mode, awaiting it here avoids wrapping the whole
// file in a function.
const launch = await resolveLaunch();

function showLoadError(error: unknown): void {
  const messageEl = document.getElementById("load-error-message");
  if (messageEl) messageEl.textContent = error instanceof Error ? error.message : String(error);
  document.getElementById("load-error")?.removeAttribute("hidden");
}

// The demo tooling — sample dataset AND its generator — is reached only through
// this dynamic import. In file mode the chunk is never downloaded, so
// `sample-data.ts` is never evaluated: that is what avoids building a demo
// dataset for a document the user supplied themselves.
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
    // The graph view layout, off the main thread. Same shape as the elk URL just
    // above, and the same one Vite recognizes; what each of the four execution
    // modes does with it is detailed in `vite.config.ts`, which also carries the
    // dev alias to the worker's source.
    //
    // On the real audit dataset (6,251 entities), this is what separates a view
    // toggle that freezes the page for ~4.4 s from one during which the structure
    // view stays usable. Without this line everything still works: the renderer
    // computes in-process.
    graphLayoutWorkerUrl: new URL("@defsquare/data-graph/graph-layout-worker", import.meta.url),
  });
} catch (error) {
  // `createDataGraph` validates the config synchronously: a semantically invalid
  // config stops here, on an error screen — not on a blank window. The `throw`
  // halts module evaluation: nothing below makes sense without an instance.
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

// THE ORDER OF THESE THREE LINES IS CONSTRAINED, and so is the rest of this
// block.
//
// `createChrome` does not merely wire things up: it BUILDS the toolbar, the
// search bar and the menu from the chrome package's factories. Anything that
// reads that DOM must therefore come after it — `createSearchUi` looks for
// `#search`, `createDetailPanel` looks for `#detail-close`, and the file-mode
// trimming below removes buttons that do not exist yet before this call.
// (This markup used to be hardcoded in `index.html`, hence present from the
// first byte: order did not matter then.)
//
// The `onSearchOpen` callback references `search`, declared further down: it is
// a closure, only called on the first click on the magnifier — long after this
// module is evaluated.
const chrome = createChrome(graph, {
  onSearchOpen: () => search.focus(),
  // Both hooks are read at CALL time, not at construction: `createChrome` runs
  // before `createSearchUi` and `createDetailPanel` (it is what appends their
  // DOM), so capturing either here would capture a binding not yet initialised.
  onDiagnosticsOpen: () => detail.renderDiagnostics(graph.diagnostics()),
});

// The chrome is trimmed AFTER being built and BEFORE the modules below read it
// back: a removed button makes `getElementById` return null, and every handler
// already knows how to live without its element.
if (launch.mode === "file") {
  // The small/large dataset toggle is a demo tool. Its module is not loaded
  // here, but the menu item has just been created: without this removal the menu
  // would offer a dead entry.
  document.getElementById("toggle-dataset")?.remove();
  // `?? {}`: a config read from disk may carry no `ids` key at all.
  if (Object.keys(launch.config.ids ?? {}).length === 0) {
    // Without entities the graph view has nothing to show: structure only.
    document.getElementById("toggle-view")?.remove();
  }
}

const detail = createDetailPanel(graph);
const search = createSearchUi(graph, {
  onQueryChange: (hasQuery) => chrome.setSearchActive(hasQuery),
});

graph.on("select", (node: GraphNode) => {
  detail.render(node);
});

// The panel describes a selection: when there is none left it has nothing to
// say, and leaving it open would keep describing a node the canvas no longer
// designates.
graph.on("deselect", () => {
  detail.clear();
});

// The single refresh point for the status bar. It replaces the manual calls
// scattered over `select`, the view toggle and the dataset toggle: any operation
// changing the visible set now updates the counter without this file having to
// know it exists.
graph.on("statschange", () => {
  chrome.updateStatus();
});

graph.on("followRef", (edge) => {
  if (!edge.dangling) return;
  // The warn stays useful in dev; it was never feedback. The panel is: the
  // diagnostic the click just ran into is exactly the entry A1 already renders,
  // so we open that list on it rather than inventing a transient state on the
  // status bar.
  console.warn(`[demo] dangling ref: ${edge.field} -> ${edge.targetType}#${edge.targetId}`);
  detail.renderDiagnostics(graph.diagnostics(), edge.from);
});

// `setData()` resets the renderer's search and selection state; the shell takes
// the same path on its side.
demo?.setupDatasetToggle(graph, () => {
  search.reset();
  detail.clear();
});

void (async () => {
  try {
    await graph.ready;
  } catch (error) {
    // Async failures (GraphTooLargeError, worker) arrive through `ready`: same
    // screen as the synchronous ones.
    showLoadError(error);
    return;
  }
  graph.fit();
  chrome.applyTheme();
  chrome.syncViewButton();
  chrome.updateStatus();
})();
