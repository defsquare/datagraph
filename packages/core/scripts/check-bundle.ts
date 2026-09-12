/**
 * The pure generator, separated from the script that writes — same split as
 * `renderTokensCss()` and `packages/tokens/scripts/generate-css.ts`. `buildSync`
 * rather than `build`, so the freshness test stays a plain synchronous
 * comparison.
 */

import { buildSync } from "esbuild"
import { fileURLToPath } from "node:url"

export const CHECK_BUNDLE_BANNER = `// GENERATED FILE — do not edit.
// Run \`pnpm --filter @defsquare/datagraph-core generate:check\` after any change to
// the validation closure (validate.ts, build.ts, config.ts, selector.ts, model.ts).
// Embedded verbatim in the datagraph binary by \`include_str!\`, see
// apps/demo/src-tauri/src/check.rs. Freshness: packages/core/test/check-bundle.test.ts.`

export function buildCheckBundle(): string {
  const entry = fileURLToPath(new URL("./check-entry.ts", import.meta.url))
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    // `iife` because the engine evaluates this as a SCRIPT in global scope: no
    // module loader is wired, which is the whole point of the bare-ES posture.
    format: "iife",
    // The measured floor of what the closure uses: `Map`, `Set`, `class extends`,
    // `??`, `?.`. Anything lower would make esbuild down-level and grow the file
    // for an engine that does not need it.
    target: "es2020",
    platform: "neutral",
    charset: "utf8",
    legalComments: "none",
    // Not minified: 21,021 bytes is nothing against a 9.2 MB binary, and
    // it buys a reviewable diff and a readable test failure.
    minify: false,
    banner: { js: CHECK_BUNDLE_BANNER },
  })
  const file = result.outputFiles[0]
  if (!file) throw new Error("esbuild produced no output for the check bundle")
  return file.text
}
