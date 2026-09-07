/**
 * Écrit `apps/demo/src/tokens.css` depuis la source des tokens.
 *
 * Le fichier est généré ET commité : la démo est un build Vite qui importe du
 * CSS statique, elle ne peut pas exécuter le générateur. Le test de fraîcheur
 * (`test/css.test.ts`) est le garde-fou contre l'oubli de régénération.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/css.js";

const target = fileURLToPath(new URL("../../../apps/demo/src/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss());
console.log(`écrit: ${target}`);
