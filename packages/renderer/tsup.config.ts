import { defineConfig } from "tsup";

/**
 * TWO ENTRY POINTS, and two OPPOSITE bundling regimes — that is the whole point
 * of this file, which replaces the `tsup src/index.ts` line in `package.json`.
 *
 * 1. `src/index.ts` — the package. NORMAL regime: `pixi.js` and
 *    `@defsquare/datagraph-core` stay external, it is the consumer's bundler
 *    that resolves and dedupes them. Types emitted.
 *
 * 2. `src/graph-layout-worker.ts` — the graph view's Web Worker. STANDALONE
 *    regime: the layout's pure core is bundled INSIDE it (`noExternal`). This is
 *    not a preference, it is the only shape that works — this file is loaded by
 *    URL, not by `import`, so nobody is there to resolve a bare specifier like
 *    `@defsquare/datagraph-core/graph-layout`: the browser would read it as-is
 *    and fail. No `.d.ts` either: we never import it, we point at it.
 *
 * What the worker actually pulls in, and why that is little: the core's
 * `./graph-layout` entry point depends on neither elkjs nor Pixi (see its
 * header), and the worker imports a single pure function from it. Its
 * `import type` of the protocol (`./graph-view.js`) is erased at compile time,
 * so nothing of the renderer comes in that way — `test/bundle-purity.test.ts`
 * makes that a verified invariant.
 *
 * `clean: false` ON BOTH SIDES, with the cleaning done by the `build` script in
 * `package.json` before calling tsup. This is not superstition: tsup runs the
 * configurations of an array IN PARALLEL, both write into the same `dist/`, and
 * a `clean` carried by one would erase the other's output depending on who wins
 * the race. Cleaning must therefore happen once, before both.
 */
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
  },
  {
    entry: ["src/graph-layout-worker.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    noExternal: ["@defsquare/datagraph-core"],
  },
]);
