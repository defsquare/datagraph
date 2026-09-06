import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// En DEV SEULEMENT, les paquets du workspace sont résolus vers leurs SOURCES et
// non vers leur `dist/`. Sans cela, `pnpm dev` sert le dernier build tsup des
// paquets — et une modification de `packages/*/src` reste invisible dans la
// démo tant qu'on n'a pas relancé `pnpm --filter <paquet> build`, ce qui s'est
// déjà payé en séance de débogage d'un bundle périmé.
//
// Le build de production N'EST PAS aliasé, volontairement : la démo y consomme
// les paquets par leurs `exports`, comme le ferait un consommateur externe.
// C'est ce qui garde honnêtes les mesures qui s'appuient sur ce build — la
// taille du chunk de la vue graphe citée par les tests de pureté de bundle est
// celle du code publié, pas celle d'un graphe de modules recollé depuis les
// sources.
//
// À NE PAS confondre avec les e2e : `playwright.config.ts` lance `pnpm dev`,
// donc les tests Playwright tournent en mode `serve` et exercent TOUJOURS les
// sources aliasées ci-dessous, jamais le bundle de production ni `vite preview`.
//
// L'ordre des entrées compte : l'alias d'un nom de paquet matche aussi ses
// sous-chemins (`find` nu s'applique à `find/...`), donc `graph-layout` doit
// précéder le core nu — sinon il se ferait réécrire en `src/index.ts/graph-layout`.
export default defineConfig(({ command }) => ({
  resolve:
    command === "serve"
      ? {
          alias: [
            {
              find: "@defsquare/data-graph-core/graph-layout",
              replacement: src("../../packages/core/src/graph-layout.ts"),
            },
            {
              find: "@defsquare/data-graph-core",
              replacement: src("../../packages/core/src/index.ts"),
            },
            {
              find: "@defsquare/data-graph",
              replacement: src("../../packages/renderer/src/index.ts"),
            },
          ],
        }
      : undefined,
  // main.ts attend `resolveLaunch()` en top-level await : la cible par défaut
  // de Vite (chrome87) le refuse à la minification. Les WebViews de Tauri
  // (WKWebView, WebView2) et les navigateurs des e2e sont largement au-delà.
  build: { target: "es2022" },
}));
