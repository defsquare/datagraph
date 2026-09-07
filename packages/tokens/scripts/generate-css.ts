/**
 * Writes `apps/demo/src/tokens.css` from the token source.
 *
 * The file is generated AND committed: the demo is a Vite build importing
 * static CSS, it cannot run the generator. The freshness test
 * (`test/css.test.ts`) is the guard against forgetting to regenerate.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/css.js";

const target = fileURLToPath(new URL("../../../apps/demo/src/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss());
console.log(`écrit: ${target}`);
