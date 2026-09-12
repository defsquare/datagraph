import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// In DEV ONLY, workspace packages resolve to their SOURCES rather than to their
// `dist/`. Without this, `pnpm dev` serves the packages' last tsup build — and a
// change under `packages/*/src` stays invisible in the demo until
// `pnpm --filter <package> build` is run again, something already paid for in a
// debugging session spent on a stale bundle.
//
// The production build is deliberately NOT aliased: there the demo consumes the
// packages through their `exports`, exactly as an outside consumer would. That
// is what keeps honest the measurements taken on that build — the graph view
// chunk size quoted by the bundle purity tests is the size of the published
// code, not of a module graph stitched back together from sources.
//
// NOT to be confused with the e2e run: `playwright.config.ts` starts `pnpm dev`,
// so the Playwright tests run in `serve` mode and ALWAYS exercise the aliased
// sources below, never the production bundle nor `vite preview`.
//
// Entry order matters: an alias on a package name also matches its subpaths (a
// bare `find` applies to `find/...`), so `graph-layout` must come before the
// bare core — otherwise it would be rewritten to `src/index.ts/graph-layout`.
//
// ---------------------------------------------------------------------------
// THE GRAPH VIEW LAYOUT WORKER, AND ITS FOUR MODES
//
// `main.ts` passes `graphLayoutWorkerUrl: new URL("@defsquare/datagraph/graph-layout-worker",
// import.meta.url)`, exactly as it already does for elk. Vite recognizes this
// form (`new URL(<literal>, import.meta.url)`), RESOLVES the specifier through
// its plugin chain — aliases included — and rewrites the expression. What it
// then does with it differs per mode, and all four have been exercised:
//
//   1. `vite dev` (so ALSO the Playwright e2e run, cf. the note above). The
//      `@defsquare/datagraph/graph-layout-worker` alias below — placed BEFORE
//      the bare package one, for the ordering reason already explained — points
//      at the worker's TypeScript SOURCE. The dev server serves it transformed
//      to JS, imports rewritten to module URLs; `new Worker(url, { type:
//      "module" })` loads it as is. That is what makes dev exercise the real
//      worker on the real source code — a change to
//      `packages/renderer/src/graph-layout-worker.ts` is visible without a
//      build, like the rest of the aliased sources.
//   2. `vite build`. No alias: the specifier resolves through the package's
//      `exports` field, so to `packages/renderer/dist/graph-layout-worker.js`,
//      and Vite EMITS IT AS AN ASSET (verbatim copy, no re-bundling). That is
//      why that output is produced self-contained — the layout core bundled
//      into it, no bare specifier left to resolve (see the renderer's
//      `tsup.config.ts`). The demo build therefore requires the renderer to be
//      built first: `pnpm -r build` does it in topological order.
//   3. The Tauri shell. It serves mode 2's `dist/` from its local origin, and
//      the CSP allows `worker-src 'self'` (`tauri.conf.json`): the worker is one
//      more file next to the chunks, nothing special.
//   4. vitest / headless. The option is simply not passed — the renderer tests
//      build the controller without a worker factory — so the engine runs
//      in-process, as before.
// ---------------------------------------------------------------------------
export default defineConfig(({ command }) => ({
  resolve:
    command === "serve"
      ? {
          alias: [
            {
              find: "@defsquare/datagraph-core/graph-layout",
              replacement: src("../../packages/core/src/graph-layout.ts"),
            },
            {
              find: "@defsquare/datagraph-core",
              replacement: src("../../packages/core/src/index.ts"),
            },
            {
              find: "@defsquare/datagraph/graph-layout-worker",
              replacement: src("../../packages/renderer/src/graph-layout-worker.ts"),
            },
            // The demo does not import the tokens directly — the renderer's
            // `theme.ts`, itself aliased to its sources, is what pulls them in.
            // Without these two entries that path would fall back to the
            // package's `dist/`, and a color fixed in `packages/tokens/src`
            // would stay invisible in dev.
            {
              find: "@defsquare/datagraph-tokens/css",
              replacement: src("../../packages/tokens/src/css.ts"),
            },
            {
              find: "@defsquare/datagraph-tokens",
              replacement: src("../../packages/tokens/src/index.ts"),
            },
            // The shared chrome. Its two entries must come before the bare
            // package one below, for the ordering reason already explained:
            // `@defsquare/datagraph` also matches the prefix of
            // `@defsquare/datagraph-chrome`, which would be rewritten to
            // `.../renderer/src/index.ts-chrome`.
            {
              find: "@defsquare/datagraph-chrome/chrome.css",
              replacement: src("../../packages/chrome/src/chrome.css"),
            },
            {
              find: "@defsquare/datagraph-chrome",
              replacement: src("../../packages/chrome/src/index.ts"),
            },
            {
              find: "@defsquare/datagraph",
              replacement: src("../../packages/renderer/src/index.ts"),
            },
          ],
        }
      : undefined,
  // main.ts awaits `resolveLaunch()` at top level: Vite's default target
  // (chrome87) rejects that at minification time. The Tauri WebViews
  // (WKWebView, WebView2) and the e2e browsers are well past it.
  build: { target: "es2022" },
}));
