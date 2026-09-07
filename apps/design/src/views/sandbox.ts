import "./sandbox.css";

import { createDataGraph, type DataGraph } from "@renderer/index.ts";
import { currentTheme, type ThemeState } from "../theme-state.ts";
// The demo's fixtures, imported by relative path: Vite turns a `.json` into a
// module. Copying them here would make them drift from the ones the file-mode
// e2e tests replay — and the point of the sandbox is precisely to show the
// renderer on the SAME data as the product, not on a set built for the window
// display.
import shopConfig from "../../../demo/fixtures/shop.config.json";
import shopData from "../../../demo/fixtures/shop.json";

/**
 * The « Bac à sable » view: a complete renderer instance, on a real fixture, in
 * the playground's current theme.
 *
 * The other three views show PARTS — a token, a card painted out of context, a
 * DOM component frozen in one state. This one shows the assembly: it is the
 * only place in the playground where a token change is judged against what the
 * user will really see, with the real layout, hover, selection and folding.
 *
 * ON THEME CHANGES. The renderer exposes `setTheme()`, which repaints the colors
 * without rerunning the layout — that is the fast path, and it is legitimate
 * for a light/dark pair. This view nonetheless does NOT use it: the shell
 * (`main.ts`) remounts any active view on every theme change, brand as well as
 * mode, and that remount is enough here. A recreated instance is coherent by
 * construction — colors, fonts, card metrics, everything is read afresh
 * together — whereas `setTheme()` only is under a condition nothing checks at
 * runtime (identical typography and fonts between the two themes). The cost is
 * one canvas recreation per manual click, which is paid on no hot path. Showing
 * `setTheme()` at work remains possible later, but that would then be an API
 * demonstration — hence its own specimen, not a shortcut slipped into the
 * sandbox.
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

  // `disposed` doubles the renderer's internal guard rather than relying on it:
  // this module must know for itself whether it is still allowed to touch the
  // DOM it created (the error message below), and that question is none of the
  // instance's business.
  let disposed = false;

  function fail(error: unknown): void {
    if (disposed) return;
    note.textContent = `Échec du chargement : ${error instanceof Error ? error.message : String(error)}`;
  }

  // A `const` out of an IIFE rather than a `let` assigned inside a `try`: the
  // async closure below needs the narrowing of `if (graph)` to HOLD all the way
  // into its body, which a mutable binding does not guarantee.
  const graph = ((): DataGraph | null => {
    try {
      return createDataGraph(stage, {
        data: shopData,
        config: shopConfig,
        theme: currentTheme(state),
        // The same two URLs as `apps/demo/src/main.ts`, and for the same
        // reason: the sandbox must exercise the real WIRING, not a lightened
        // variant. Each is safe to pass — the renderer falls back to an
        // in-process computation if the worker fails to build — which is
        // incidentally what elk does systematically under Vite, warning once in
        // the console, exactly as in the demo. The note in the demo's
        // `vite.config.ts` details the four execution modes; the particularity
        // here is that the playground's aliases are unconditional, so `serve`
        // and `build` alike load the layout worker's SOURCE.
        elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
        graphLayoutWorkerUrl: new URL("@defsquare/data-graph/graph-layout-worker", import.meta.url),
      });
    } catch (error) {
      // `createDataGraph` validates the config synchronously. Without this
      // catch, a fixture gone invalid would give an empty frame and an
      // exception in the console — that is, a playground that does not say what
      // is wrong.
      fail(error);
      return null;
    }
  })();

  if (graph) {
    void (async () => {
      try {
        // Asynchronous failures (graph too large, worker) arrive through
        // `ready`, never through the `throw` above.
        await graph.ready;
      } catch (error) {
        fail(error);
        return;
      }
      // The view may have been unmounted during initialization: `destroy()`
      // guards itself, but framing a destroyed instance would make no sense
      // anyway.
      if (disposed) return;
      graph.fit();
    })();
  }

  return () => {
    disposed = true;
    // `destroy()`'s contract covers being called during `app.init()`: the
    // closure above can therefore still be in flight without leaking anything —
    // no canvas, no layout worker, no global keyboard listener.
    graph?.destroy();
    page.remove();
  };
}
