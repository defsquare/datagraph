// THE GRAPH VIEW'S LAYOUT WEB WORKER.
//
// This file is imported by NO other module of the package: it is a build
// ENTRY in its own right (see `tsup.config.ts`), published under
// `@defsquare/datagraph/graph-layout-worker` and meant to be designated
// by a URL, not by an `import`. Nothing it pulls in therefore enters the
// bundle of a consumer that does not use it — that is what authorizes
// the STATIC import of the `./graph-layout` entry point below, which
// `test/bundle-purity.test.ts` forbids everywhere else in `src/` and
// allows here by name, keeping the counterpart: nobody imports this
// file.
//
// WHAT IT SOLVES, measured: on a real audit of 6,251 entities and ~1,300
// aggregates, the two-level layout takes ~4.4 s and is entirely synchronous. Run on
// the main thread, it freezes the page for the whole view switch — no rendering, no
// pan, no zoom. Here, it only freezes this worker, from which nobody expects
// anything else.
//
// CONTENT CONSTRAINT, and it is checked by the purity test: neither Pixi nor DOM. A
// worker has neither `document` nor `window`, and the imported core (`layoutFromInput`)
// is pure for that precise reason. The other half of the engine — the extraction, which
// reads the `Graph` — stays at the caller's: a `Graph` does not travel through a
// `postMessage`, and that is exactly why the core was split (see `GraphLayoutInput`,
// core side).
import { layoutFromInput } from "@defsquare/datagraph-core/graph-layout";
// `import type`: the protocol is declared at its other interlocutor, the controller,
// and the bundler erases this line. No renderer code — hence no Pixi — comes in this
// way.
import type { GraphLayoutWorkerRequest, GraphLayoutWorkerResponse } from "./graph-view.js";

/**
 * The worker's global scope, retyped.
 *
 * The repo's default `lib` is the DOM one, where `self` is a `Window`: the trip through
 * `unknown` is what avoids imposing `lib: "webworker"` on the whole package for this
 * single file. What is retyped is exactly what is used, and that is the entire runtime
 * contract of this module.
 */
const scope = self as unknown as {
  onmessage: ((event: { data: GraphLayoutWorkerRequest }) => void) | null;
  postMessage(message: GraphLayoutWorkerResponse): void;
};

scope.onmessage = (event) => {
  const { gen, input } = event.data;
  try {
    const { positions, clusters } = layoutFromInput(input);
    // Flattened into tuples rather than a `Map` of `Rect`: at 6,251 cards this is one
    // array of numbers instead of that many small objects to clone. The controller
    // rehydrates them (see `hydrateLayout`).
    const flat: [string, number, number, number, number][] = [];
    for (const [id, rect] of positions) flat.push([id, rect.x, rect.y, rect.width, rect.height]);
    scope.postMessage({ gen, ok: true, positions: flat, clusters });
  } catch (err) {
    // An exception does not travel through `postMessage`: we send its message back, and
    // it is the controller that decides what to do with it (warn once, then fall back
    // to in-process for good). The worker itself stays alive — it is its interlocutor
    // that removes it.
    scope.postMessage({ gen, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
