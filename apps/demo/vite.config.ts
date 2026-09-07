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
//
// ---------------------------------------------------------------------------
// LE WORKER DE MISE EN PAGE DE LA VUE GRAPHE, ET SES QUATRE MODES
//
// `main.ts` passe `graphLayoutWorkerUrl: new URL("@defsquare/data-graph/graph-layout-worker",
// import.meta.url)`, exactement comme il le fait déjà pour elk. Vite reconnaît
// cette forme (`new URL(<littéral>, import.meta.url)`), RÉSOUT le specifier par
// sa chaîne de plugins — alias compris — et réécrit l'expression. Ce qu'il en
// fait diffère selon le mode, et les quatre ont été essayés :
//
//   1. `vite dev` (donc AUSSI les e2e Playwright, cf. la note ci-dessus).
//      L'alias `@defsquare/data-graph/graph-layout-worker` ci-dessous — placé
//      AVANT celui du paquet nu, pour la raison d'ordre déjà expliquée — envoie
//      sur la SOURCE TypeScript du worker. Le serveur de dev la sert transformée
//      en JS, imports réécrits en URLs de module ; `new Worker(url, { type:
//      "module" })` la charge telle quelle. C'est ce qui fait que le dev exerce
//      le vrai worker sur le vrai code source — une modification de
//      `packages/renderer/src/graph-layout-worker.ts` est visible sans build,
//      comme pour le reste des sources aliasées.
//   2. `vite build`. Pas d'alias : le specifier se résout par le champ `exports`
//      du paquet, donc sur `packages/renderer/dist/graph-layout-worker.js`, et
//      Vite l'ÉMET COMME ASSET (copie verbatim, pas de re-bundling). C'est
//      pourquoi cette sortie-là est produite autonome — le cœur du layout bundlé
//      dedans, aucun specifier nu à résoudre (voir `tsup.config.ts` du
//      renderer). Le build de la démo demande donc que le renderer soit buildé
//      avant : `pnpm -r build` le fait dans l'ordre topologique.
//   3. La coquille Tauri. Elle sert le `dist/` du mode 2 depuis son origine
//      locale, et la CSP autorise `worker-src 'self'` (`tauri.conf.json`) : le
//      worker est un fichier de plus à côté des chunks, rien de particulier.
//   4. vitest / headless. L'option n'est simplement pas passée — les tests du
//      renderer construisent le contrôleur sans fabrique de worker —, donc le
//      moteur tourne en processus, comme avant.
// ---------------------------------------------------------------------------
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
              find: "@defsquare/data-graph/graph-layout-worker",
              replacement: src("../../packages/renderer/src/graph-layout-worker.ts"),
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
