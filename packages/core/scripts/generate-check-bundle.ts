/**
 * Writes `apps/demo/src-tauri/generated/check.js` from the core's validation
 * closure.
 *
 * The file is generated AND committed: `include_str!` needs it to exist at Rust
 * compile time, and making cargo depend on pnpm would impose an order between two
 * toolchains that have no reason to know each other. That order is not resolved
 * here, it is removed. The freshness test (`test/check-bundle.test.ts`) is the
 * guard against forgetting to regenerate.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { buildCheckBundle } from "./check-bundle.js"

const target = fileURLToPath(
  new URL("../../../apps/demo/src-tauri/generated/check.js", import.meta.url),
)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, buildCheckBundle())
console.log(`written: ${target}`)
