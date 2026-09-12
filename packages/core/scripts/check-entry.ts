/**
 * Entry point of the bundle the `datagraph` binary embeds. Never imported by the
 * package itself — its only job is to publish the boundary as a global, because
 * an embedded engine has no module loader to reach an export through.
 *
 * Kept apart from `src/validate.ts` so that module stays free of side effects and
 * remains directly unit-testable.
 */
import { runCheck } from "../src/validate.js"

;(globalThis as unknown as { __datagraph_check: typeof runCheck }).__datagraph_check = runCheck
