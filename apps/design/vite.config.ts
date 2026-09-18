import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// Unlike `apps/demo`, the playground's aliases are UNCONDITIONAL: they hold in
// `serve` as in `build`.
//
// The demo only aliases in dev, so that its production build consumes the
// packages through their `exports`, the way an external consumer would — that
// is what keeps the bundle size measurements taken on that build honest. The
// playground has no such constraint: it is never published, is nobody's size
// reference, and its sole reason to exist is to show the CURRENT STATE of the
// design system. A package's stale `dist/` would be a lie here, not a
// measurement; hence the same resolution path in both modes, and no dependency
// on `pnpm -r build`.
//
// Two families of entries, and they must be told apart:
//
//   1. The `@tokens/`, `@renderer/`, `@core/` prefixes — through them, and only
//      through them, does the playground's own code import (`@tokens/css.ts`,
//      `@renderer/theme.ts`). A prefix entry applies to subpaths too, so a
//      single alias per package covers all its modules: the playground can
//      reach into any source file, including internal modules no `exports`
//      publishes — which is precisely what one wants from a design system test
//      bench.
//   2. The bare package names — the playground NEVER writes them. They are here
//      for the INTERNAL imports of the sources thus pulled in: the renderer's
//      `theme.ts` imports `@defsquare/datagraph-tokens`, the renderer imports
//      the core, and so on. Without these entries, those imports would fall
//      back to the `dist/` builds (when they are even resolvable from
//      apps/design, which pnpm does not guarantee), and a value fixed in
//      `packages/*/src` would stay invisible.
//
// Order matters in both families: an entry matches subpaths too, so the most
// specific must come before the most general — otherwise
// `@defsquare/datagraph-core/graph-layout` would be rewritten into
// `.../core/src/index.ts/graph-layout`.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@tokens/", replacement: src("../../packages/tokens/src/") },
      { find: "@renderer/", replacement: src("../../packages/renderer/src/") },
      { find: "@core/", replacement: src("../../packages/core/src/") },
      { find: "@chrome/", replacement: src("../../packages/chrome/src/") },

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
      {
        find: "@defsquare/datagraph-tokens/css",
        replacement: src("../../packages/tokens/src/css.ts"),
      },
      {
        find: "@defsquare/datagraph-tokens",
        replacement: src("../../packages/tokens/src/index.ts"),
      },
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
  },
  // The woff2 files and the logos are the demo's, served as they are: the
  // `@font-face` rules in `apps/demo/src/fonts.css` — which `main.ts` imports —
  // point at `/fonts/*.woff2`, and duplicating them here would mostly guarantee
  // watching them drift apart. No CSP to honor on the playground side: no Tauri
  // shell.
  publicDir: fileURLToPath(new URL("../demo/public", import.meta.url)),
  // 5173 is the demo's port: both must be able to run together, typically to
  // compare a token against its real rendering in the viewer.
  server: { port: 5174 },
  // `main.ts` awaits `document.fonts.ready` as a top-level await; Vite's default
  // target (chrome87) rejects it at minification.
  //
  // No minification: the playground is never published, and esbuild's identifier
  // mangling can name a local `of` — `of/(s+1)` inside the bundled elkjs — which
  // the es-module-lexer 1.x bundled in vite 6 and 7 reads as the keyword `of`
  // followed by a regex literal, desynchronising it until the end of the chunk
  // (`Parse error @:1:1` from vite:build-import-analysis). Which name esbuild
  // picks shifts with any source change, so this is a lottery, not a one-off;
  // es-module-lexer 2.3.2 (vite 8) lexes it correctly.
  build: { target: "es2022", minify: false },
});
