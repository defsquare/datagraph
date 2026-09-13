/**
 * Copies the brand SVGs the two apps serve from their `public/` directory.
 *
 * Same arrangement as `generate-css.ts`: the copies are generated AND
 * committed, because a Vite app can only serve a file that is already there,
 * and `test/brand.test.ts` is the guard against forgetting to re-run this.
 *
 * The RASTER icon set is a different problem — it needs rsvg-convert and
 * iconutil — and lives in `generate-app-icons.sh`.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const brand = (name: string): string =>
  fileURLToPath(new URL(`../brand/${name}`, import.meta.url));
const repo = (rel: string): string => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

/**
 * A file lands in a `public/` directory only when something actually loads it
 * from there — a copy nothing renders is a copy that rots. Both apps serve the
 * favicon; the demo alone signs its canvas with the lockup, in the two
 * variants `chrome.ts` swaps between on the theme toggle.
 */
const COPIES: ReadonlyArray<readonly [source: string, target: string]> = [
  ["datagraph-favicon.svg", "apps/demo/public/datagraph-favicon.svg"],
  ["datagraph-favicon.svg", "apps/design/public/datagraph-favicon.svg"],
  ["datagraph-lockup.svg", "apps/demo/public/datagraph-lockup.svg"],
  ["datagraph-lockup-inverse.svg", "apps/demo/public/datagraph-lockup-inverse.svg"],
];

for (const [source, target] of COPIES) {
  const to = repo(target);
  mkdirSync(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  copyFileSync(brand(source), to);
  console.log(`écrit: ${to}`);
}
