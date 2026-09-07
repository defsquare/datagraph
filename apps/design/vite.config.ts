import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

// Contrairement à `apps/demo`, les alias du playground sont INCONDITIONNELS :
// ils valent en `serve` comme en `build`.
//
// La démo, elle, n'aliase qu'en dev pour que son build de production consomme
// les paquets par leurs `exports`, comme le ferait un consommateur externe —
// c'est ce qui garde honnêtes les mesures de taille de bundle prises sur ce
// build. Le playground n'a pas cette contrainte : il n'est jamais publié, ne
// sert de référence de taille à personne, et son unique raison d'être est de
// montrer l'ÉTAT COURANT du design system. Un `dist/` périmé d'un paquet y
// serait un mensonge, pas une mesure ; d'où le même chemin de résolution dans
// les deux modes, et aucune dépendance à `pnpm -r build`.
//
// Deux familles d'entrées, et il faut les distinguer :
//
//   1. Les préfixes `@tokens/`, `@renderer/`, `@core/` — c'est par eux, et
//      seulement par eux, que le code du playground importe (`@tokens/css.ts`,
//      `@renderer/theme.ts`). Une entrée préfixe s'applique aussi aux
//      sous-chemins, donc un seul alias par paquet couvre tous ses modules :
//      le playground peut piocher dans n'importe quel fichier source, y compris
//      des modules internes qu'aucun `exports` ne publie — c'est justement ce
//      qu'on veut d'un banc d'essai du design system.
//   2. Les noms de paquets nus — le playground ne les écrit JAMAIS. Ils sont là
//      pour les imports INTERNES des sources ainsi tirées : `theme.ts` du
//      renderer importe `@defsquare/data-graph-tokens`, le renderer importe le
//      core, etc. Sans ces entrées, ces imports-là retomberaient sur les
//      `dist/` (quand ils sont seulement résolvables depuis apps/design, ce que
//      pnpm ne garantit pas), et une valeur corrigée dans `packages/*/src`
//      resterait invisible.
//
// L'ordre compte dans les deux familles : une entrée matche aussi les
// sous-chemins, donc le plus spécifique doit précéder le plus général — sinon
// `@defsquare/data-graph-core/graph-layout` se ferait réécrire en
// `.../core/src/index.ts/graph-layout`.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@tokens/", replacement: src("../../packages/tokens/src/") },
      { find: "@renderer/", replacement: src("../../packages/renderer/src/") },
      { find: "@core/", replacement: src("../../packages/core/src/") },
      { find: "@chrome/", replacement: src("../../packages/chrome/src/") },

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
        find: "@defsquare/data-graph-tokens/css",
        replacement: src("../../packages/tokens/src/css.ts"),
      },
      {
        find: "@defsquare/data-graph-tokens",
        replacement: src("../../packages/tokens/src/index.ts"),
      },
      {
        find: "@defsquare/data-graph-chrome/chrome.css",
        replacement: src("../../packages/chrome/src/chrome.css"),
      },
      {
        find: "@defsquare/data-graph-chrome",
        replacement: src("../../packages/chrome/src/index.ts"),
      },
      {
        find: "@defsquare/data-graph",
        replacement: src("../../packages/renderer/src/index.ts"),
      },
    ],
  },
  // Les woff2 et les logos sont ceux de la démo, servis tels quels : les
  // `@font-face` de `apps/demo/src/fonts.css` — que `main.ts` importe — pointent
  // sur `/fonts/*.woff2`, et les dupliquer ici garantirait surtout de les voir
  // diverger. Pas de CSP à respecter côté playground : aucune coquille Tauri.
  publicDir: fileURLToPath(new URL("../demo/public", import.meta.url)),
  // 5173 est le port de la démo : les deux doivent pouvoir tourner ensemble,
  // typiquement pour comparer un token à son rendu réel dans le viewer.
  server: { port: 5174 },
  // `main.ts` attend `document.fonts.ready` en top-level await ; la cible par
  // défaut de Vite (chrome87) le refuse à la minification.
  build: { target: "es2022" },
});
