# Design system unifié + playground — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une source de tokens unique (`packages/tokens`) qui alimente les thèmes Pixi du renderer et les variables CSS de la démo, plus une app `apps/design` pour consulter chaque token et exercer chaque composant dans ses états.

**Architecture:** Nouveau package TS pur `@defsquare/data-graph-tokens` (zéro dépendance, zéro DOM) ; `packages/renderer/src/theme.ts` reconstruit ses 4 thèmes depuis ces tokens sans changer son API ; un générateur produit `apps/demo/src/tokens.css` (commité, gardé par un test de fraîcheur) ; `apps/design` est une app Vite vanilla-TS qui importe les sources du workspace par alias et rend 4 vues (tokens, composants graphe, composants UI, bac à sable).

**Tech Stack:** TypeScript, tsup, vitest, Vite 6, Pixi v8, pnpm workspace. Pas de framework UI, pas de style-dictionary.

**Spec:** `docs/superpowers/specs/2026-09-07-design-system-playground-design.md`

## Global Constraints

- **Neutralité visuelle absolue** : aucune valeur de couleur/typo/espacement ne change. Les tests existants `packages/renderer/test/theme.test.ts` et `test/api-surface.test.ts` passent **sans modification**.
- Commentaires en français, documentant le « pourquoi » (convention repo).
- `packages/tokens` : zéro dépendance runtime, `"sideEffects": false`, utilisable hors DOM (même contrainte que le renderer).
- L'API publique du renderer ne s'élargit pas (`api-surface.test.ts` fige la liste). Le playground accède aux internes via alias Vite vers les **sources**, jamais via de nouveaux exports.
- Node >= 20, ESM partout (`"type": "module"`).
- Chaque tâche se termine par un commit (messages en français, style `feat(tokens): …`, `feat(design): …`).
- Commandes de vérification : `pnpm typecheck`, `pnpm build`, `pnpm test` à la racine (le test racine inclut cargo via apps/demo — toolchain Rust déjà en place).

---

### Task 1: Package `@defsquare/data-graph-tokens` — les tokens

**Files:**
- Create: `packages/tokens/package.json`
- Create: `packages/tokens/tsconfig.json`
- Create: `packages/tokens/src/index.ts`
- Create: `packages/tokens/test/tokens.test.ts`
- Create: `packages/tokens/README.md` (court : rôle du package, qui le consomme)

**Interfaces:**
- Produces (consommés par Tasks 2, 3, 4-8) :
  - `type FontStack = readonly string[]`
  - `interface ColorTokens { surface: { canvas; card; cardMuted }; ink: { primary; muted; subtle }; accent: { entity; selection; match; matchStroke }; edge: { contain; ref; dangling; hairline; border } }` (toutes `string`)
  - `interface BrandTokens { fonts: { title?: FontStack; body: FontStack; mono: FontStack }; entityPalette: readonly string[]; light: ColorTokens; dark: ColorTokens }`
  - `const defsquare: BrandTokens`, `const neutral: BrandTokens`
  - `interface TypeStyleToken { family: "body" | "mono"; size: number; weight: number; tracking?: number }`
  - `const typography: Record<"header" | "badge" | "key" | "value", TypeStyleToken>`
  - `const radii = { sm: 4, md: 6, lg: 10, full: 9999, card: 6 }`
  - `const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 }`
  - `const strokes = { border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 }`
  - `const motion = { transition: "150ms ease-in-out", easeOut: "cubic-bezier(0.2, 0.8, 0.25, 1)" }`
  - `const chrome: { light: ChromeTokens; dark: ChromeTokens }` avec `interface ChromeTokens { fg: string; float: { bg: string; border: string; hover: string }; shadow: string }` — les tokens DOM-only du shell (le canvas Pixi ne les voit jamais).
  - `function pixiFontStack(stack: FontStack): string` — `stack.join(", ")`
  - `function cssFontStack(stack: FontStack): string` — chaque nom contenant une espace est entouré de guillemets doubles, puis join `", "`.

**Steps:**

- [ ] **Step 1: Écrire le test des valeurs** — `packages/tokens/test/tokens.test.ts`. Il fige les valeurs actuellement dupliquées entre `packages/renderer/src/theme.ts` et `apps/demo/src/style.css` (les recopier depuis ces fichiers — ce sont les valeurs de référence) :

```ts
import { describe, expect, it } from "vitest";
import {
  chrome, cssFontStack, defsquare, motion, neutral, pixiFontStack,
  radii, spacing, strokes, typography,
} from "../src/index.js";

describe("tokens defsquare", () => {
  it("porte les couleurs light actuelles", () => {
    expect(defsquare.light.surface).toEqual({ canvas: "#eef0f3", card: "#ffffff", cardMuted: "#f7f7f8" });
    expect(defsquare.light.ink).toEqual({ primary: "#172741", muted: "#4b5563", subtle: "#9ca3af" });
    expect(defsquare.light.accent).toEqual({ entity: "#1e416e", selection: "#f65e5e", match: "#ede2cf", matchStroke: "#8d7e63" });
    expect(defsquare.light.edge).toEqual({ contain: "#c7cdd6", ref: "#2a5a98", dangling: "#d97706", hairline: "#f1f1f3", border: "#dfe3e9" });
  });
  it("porte les couleurs dark actuelles", () => {
    expect(defsquare.dark.surface).toEqual({ canvas: "#161a2c", card: "#1e2335", cardMuted: "#1a1f30" });
    expect(defsquare.dark.ink).toEqual({ primary: "#f0f5fc", muted: "#9bb2d9", subtle: "#6b7794" });
    expect(defsquare.dark.accent).toEqual({ entity: "#3573c3", selection: "#f65e5e", match: "#3a3323", matchStroke: "#e2ca9e" });
    expect(defsquare.dark.edge).toEqual({ contain: "#3a4159", ref: "#3573c3", dangling: "#e0932e", hairline: "#272d42", border: "#2c3247" });
  });
  it("porte la palette d'entités actuelle", () => {
    expect([...defsquare.entityPalette]).toEqual(["#1e416e", "#f65e5e", "#3dbf9e", "#8d7e63", "#3573c3", "#a0427a"]);
  });
});

describe("tokens neutral", () => {
  it("porte les couleurs actuelles", () => {
    expect(neutral.light.surface.canvas).toBe("#f4f4f5");
    expect(neutral.dark.surface.canvas).toBe("#18181b");
    expect([...neutral.entityPalette]).toEqual(["#2563eb", "#7c3aed", "#059669", "#d97706", "#0891b2", "#be123c"]);
  });
});

describe("échelles partagées", () => {
  it("reprend typographie, radius, espacements, traits et motion", () => {
    expect(typography.header).toEqual({ family: "body", size: 13, weight: 600 });
    expect(typography.badge).toEqual({ family: "body", size: 9.5, weight: 600, tracking: 0.08 });
    expect(typography.key).toEqual({ family: "body", size: 12, weight: 400 });
    expect(typography.value).toEqual({ family: "mono", size: 12, weight: 400 });
    expect(radii).toEqual({ sm: 4, md: 6, lg: 10, full: 9999, card: 6 });
    expect(spacing).toEqual({ 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 });
    expect(strokes).toEqual({ border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 });
    expect(motion).toEqual({ transition: "150ms ease-in-out", easeOut: "cubic-bezier(0.2, 0.8, 0.25, 1)" });
  });
});

describe("tokens chrome (DOM only)", () => {
  it("porte fg, surfaces flottantes et ombres", () => {
    expect(chrome.light.fg).toBe("#070f19");
    expect(chrome.light.float).toEqual({ bg: "rgb(255 255 255 / 0.82)", border: "rgb(23 39 65 / 0.1)", hover: "rgb(23 39 65 / 0.06)" });
    expect(chrome.light.shadow).toBe("0 1px 2px rgb(15 23 42 / 0.06), 0 10px 28px -10px rgb(15 23 42 / 0.22)");
    expect(chrome.dark.fg).toBe("#f0f5fc");
    expect(chrome.dark.float).toEqual({ bg: "rgb(30 35 53 / 0.82)", border: "rgb(240 245 252 / 0.1)", hover: "rgb(240 245 252 / 0.08)" });
    expect(chrome.dark.shadow).toBe("0 1px 2px rgb(0 0 0 / 0.35), 0 12px 30px -10px rgb(0 0 0 / 0.6)");
  });
});

describe("formatage des piles de polices", () => {
  it("pixiFontStack joint sans guillemets", () => {
    expect(pixiFontStack(defsquare.fonts.body)).toBe("IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif");
    expect(pixiFontStack(defsquare.fonts.mono)).toBe("Fira Code, SF Mono, Menlo, Consolas, monospace");
    expect(pixiFontStack(neutral.fonts.body)).toBe("system-ui, sans-serif");
  });
  it("cssFontStack met les noms à espaces entre guillemets", () => {
    expect(cssFontStack(defsquare.fonts.title!)).toBe('"EB Garamond", Garamond, Cambria, Georgia, serif');
    expect(cssFontStack(defsquare.fonts.body)).toBe('"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif');
    expect(cssFontStack(defsquare.fonts.mono)).toBe('"Fira Code", "SF Mono", Menlo, Consolas, monospace');
  });
});
```

- [ ] **Step 2: Scaffolder le package.** `packages/tokens/package.json` calqué sur `packages/core/package.json` (mêmes versions de devDeps) :

```json
{
  "name": "@defsquare/data-graph-tokens",
  "version": "0.1.0",
  "description": "Design tokens for data-graph: single source of truth feeding both the Pixi renderer themes and the demo shell CSS variables.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/defsquare/data-graph.git", "directory": "packages/tokens" },
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "prepublishOnly": "pnpm run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.19.43",
    "tsup": "^8.5.1",
    "vitest": "^4.1.11"
  }
}
```

`tsconfig.json` : copier `packages/core/tsconfig.json` (adapter les chemins si besoin). Vérifier que `pnpm-workspace.yaml` couvre déjà `packages/*` (oui a priori — ne rien toucher sinon).

- [ ] **Step 3: Lancer le test, vérifier qu'il échoue** — `pnpm --filter @defsquare/data-graph-tokens test` → FAIL (module absent).

- [ ] **Step 4: Écrire `src/index.ts`.** Les interfaces et constantes de la section *Interfaces*, avec les valeurs exactes du test. En tête de fichier, un commentaire expliquant le rôle : source de vérité unique, consommée par `theme.ts` (Pixi) et le générateur CSS ; les noms de familles de polices sont contractuels (les `@font-face` de la démo et la mesure BitmapFont les référencent par ce nom). `cssFontStack` :

```ts
export function cssFontStack(stack: FontStack): string {
  return stack.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(", ");
}
```

- [ ] **Step 5: Vérifier** — `pnpm --filter @defsquare/data-graph-tokens test` → PASS ; `pnpm --filter @defsquare/data-graph-tokens build && pnpm --filter @defsquare/data-graph-tokens typecheck` → OK.

- [ ] **Step 6: Commit** — `feat(tokens): source de vérité unique des tokens du design system`

---

### Task 2: Générateur CSS + `tokens.css` + branchement de la démo

**Files:**
- Create: `packages/tokens/src/css.ts`
- Create: `packages/tokens/scripts/generate-css.ts`
- Create: `packages/tokens/test/css.test.ts`
- Create: `apps/demo/src/tokens.css` (généré)
- Modify: `packages/tokens/package.json` (script `generate:css`, devDep `tsx@^4.23.13`, export `./css`)
- Modify: `apps/demo/src/style.css` (retirer les valeurs en dur, importer `tokens.css`)

**Interfaces:**
- Consumes: tout `../src/index.js` (Task 1).
- Produces: `renderTokensCss(): string` (exportée de `src/css.ts`, réexportée par un export `"./css"` du package — PAS par l'index, pour que l'index reste pur données). Le fichier `apps/demo/src/tokens.css` est **généré et commité** ; le test de fraîcheur est le garde-fou.

**Steps:**

- [ ] **Step 1: Écrire le test.** `packages/tokens/test/css.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "../src/css.js";

describe("renderTokensCss", () => {
  it("reproduit exactement les blocs de tokens historiques de style.css", () => {
    const css = renderTokensCss();
    // Quelques ancrages : le byte-à-byte complet est couvert par le test de fraîcheur.
    expect(css).toContain("--ds-canvas: #eef0f3;");
    expect(css).toContain("--ds-fg: #070f19;");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--float-bg: rgb(30 35 53 / 0.82);");
    expect(css).toContain('--font-title: "EB Garamond", Garamond, Cambria, Georgia, serif;');
    expect(css).toContain("--radius-full: 9999px;");
    expect(css).toContain("--space-6: 24px;");
  });

  it("est à jour dans apps/demo (fraîcheur du fichier généré)", () => {
    const committed = readFileSync(join(__dirname, "../../../apps/demo/src/tokens.css"), "utf8");
    expect(committed).toBe(renderTokensCss());
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** (module `css.js` absent).

- [ ] **Step 3: Écrire `src/css.ts`.** Il reproduit **à l'identique** (mêmes clés, même ordre, même formatage `  --nom: valeur;`) les blocs `:root { … }` et `html[data-theme="dark"] { … }` actuellement dans `apps/demo/src/style.css` lignes ~13-67 — s'y référer pendant l'écriture, c'est la cible byte-à-byte. Correspondances :
  - `--ds-canvas/surface/surface-muted` ← `defsquare.{light,dark}.surface.{canvas,card,cardMuted}`
  - `--ds-ink` ← `ink.primary`, `--ds-fg` ← `chrome.{light,dark}.fg`, `--ds-muted/subtle` ← `ink`
  - `--ds-accent` ← `accent.selection` (**uniquement dans `:root`** — le bloc dark ne le redéfinit pas, comme aujourd'hui), `--ds-primary` ← `accent.entity`
  - `--ds-border` ← `edge.border`, `--ds-border-soft` ← `edge.hairline`
  - `--float-*`/`--shadow-float` ← `chrome.*.float` / `chrome.*.shadow`
  - `--radius-*` ← `radii` (suffixe `px`), `--space-*` ← `spacing` (suffixe `px`), `--transition`/`--ease-out` ← `motion`
  - `--font-*` ← `cssFontStack(defsquare.fonts.*)`
  - Le bloc dark ne contient que les clés qu'il contient aujourd'hui (couleurs, float, shadow — pas les échelles ni les fonts).
  - En-tête du fichier généré :

```
/* GÉNÉRÉ par @defsquare/data-graph-tokens — NE PAS ÉDITER À LA MAIN.
   Régénérer : pnpm --filter @defsquare/data-graph-tokens generate:css
   Un test de fraîcheur (packages/tokens/test/css.test.ts) casse si ce fichier
   diverge de la source des tokens. */
```

  Conserver aussi les deux commentaires d'intention du bloc actuel (celui sur les surfaces flottantes translucides) en les déplaçant dans le générateur.

- [ ] **Step 4: Écrire `scripts/generate-css.ts`** :

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/css.js";

const target = fileURLToPath(new URL("../../../apps/demo/src/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss());
console.log(`écrit: ${target}`);
```

Ajouter au `package.json` de tokens : `"generate:css": "tsx scripts/generate-css.ts"`, devDep `"tsx": "^4.23.13"`, et l'export `"./css": { "types": "./dist/css.d.ts", "import": "./dist/css.js" }` (ajuster le script build : `tsup src/index.ts src/css.ts --format esm --dts`).

- [ ] **Step 5: Générer et brancher.** `pnpm --filter @defsquare/data-graph-tokens generate:css`. Puis dans `apps/demo/src/style.css` : supprimer les déclarations des blocs `:root` et `html[data-theme="dark"]` (uniquement les tokens listés ci-dessus — **garder** tout le reste du fichier) et ajouter `@import "./tokens.css";` juste après `@import "./fonts.css";` (les `@import` doivent rester en tête de feuille). Garder dans `style.css` le commentaire de tête en le mettant à jour : les tokens ne sont plus « recopiés de colors_and_type.css » mais générés depuis `@defsquare/data-graph-tokens`.

- [ ] **Step 6: Vérifier** — `pnpm --filter @defsquare/data-graph-tokens test` → PASS (fraîcheur incluse). `pnpm --filter demo build` → OK. Lancer `pnpm --filter demo dev` et vérifier à l'œil (ou via les e2e existants : `pnpm --filter demo e2e` si l'environnement Playwright est disponible) que la démo est visuellement inchangée, light et dark.

- [ ] **Step 7: Commit** — `feat(tokens): générer tokens.css de la démo depuis la source unique`

---

### Task 3: `theme.ts` consomme les tokens

**Files:**
- Create: `packages/renderer/test/theme-values.test.ts`
- Modify: `packages/renderer/src/theme.ts`
- Modify: `packages/renderer/package.json` (dépendance `"@defsquare/data-graph-tokens": "workspace:*"`)
- Modify: `apps/demo/vite.config.ts` (alias dev du package tokens vers ses sources)

**Interfaces:**
- Consumes: `defsquare`, `neutral`, `typography`, `radii`, `strokes`, `pixiFontStack` du package tokens.
- Produces: rien de nouveau — l'API publique du renderer est **inchangée** (types `Theme`/`ThemeOverride`/`TypeStyle`, les 4 thèmes, `resolveTheme`, `entityAccentMap`).

**Steps:**

- [ ] **Step 1: Écrire le test de gel AVANT le refactor.** `packages/renderer/test/theme-values.test.ts` fige les 4 thèmes **avec leurs littéraux actuels copiés depuis `theme.ts`** (deep-equal complet des objets `defsquareLight`, `defsquareDark`, `neutralLight`, `neutralDark` — recopier toutes les valeurs, y compris `fonts`, `typography`, `radii`, `strokes`, `entityPalette`). Commentaire d'en-tête : « Gel des valeurs livrées : prouve que le passage aux tokens est un refactor neutre. Toute évolution délibérée d'un thème doit mettre à jour ce gel en le disant dans le commit. »

- [ ] **Step 2: Le lancer sur le code ACTUEL** — `pnpm --filter @defsquare/data-graph test -- theme-values` → PASS (c'est un gel, il doit passer avant ET après).

- [ ] **Step 3: Refactorer `theme.ts`.** Remplacer les littéraux par les tokens :

```ts
import {
  defsquare, neutral, pixiFontStack,
  radii as tokenRadii, strokes as tokenStrokes, typography as tokenTypography,
} from "@defsquare/data-graph-tokens";

const DEFSQUARE_FONTS = { body: pixiFontStack(defsquare.fonts.body), mono: pixiFontStack(defsquare.fonts.mono) };
const DEFSQUARE_PALETTE = [...defsquare.entityPalette];
const TYPOGRAPHY: Theme["typography"] = {
  header: { ...tokenTypography.header },
  badge: { ...tokenTypography.badge },
  key: { ...tokenTypography.key },
  value: { ...tokenTypography.value },
};
const RADII: Theme["radii"] = { card: tokenRadii.card };
const STROKES: Theme["strokes"] = { ...tokenStrokes };
```

puis chaque thème pioche son groupe : `surface: { ...defsquare.light.surface }`, `ink: { ...defsquare.light.ink }`, `accent: { ...defsquare.light.accent }`, `edge: { ...defsquare.light.edge }` (idem dark et neutral ; `NEUTRAL_FONTS`/`NEUTRAL_PALETTE` depuis `neutral`). Les types `Theme`/`TypeStyle` restent définis localement dans `theme.ts` (l'API du renderer ne doit pas dépendre des types du package tokens). Garder les commentaires existants (palette commune light/dark, etc.).

- [ ] **Step 4: Alias dev de la démo.** Dans `apps/demo/vite.config.ts`, bloc d'alias dev (lire le long commentaire du fichier avant de toucher — l'ordre des entrées compte pour les préfixes), ajouter la résolution de `@defsquare/data-graph-tokens` vers `packages/tokens/src/index.ts` (et `@defsquare/data-graph-tokens/css` vers `src/css.ts`, entrée placée AVANT le nom nu). Sans cela, `vite dev` servirait le `dist` du package et une modification de token resterait invisible en dev — exactement le bug que ce bloc existe pour éviter.

- [ ] **Step 5: Vérifier** — `pnpm build` (l'ordre topologique pnpm construit tokens avant renderer), puis `pnpm --filter @defsquare/data-graph test` → les 20 fichiers passent, **dont `theme.test.ts`, `api-surface.test.ts` et le gel, tous inchangés**. `pnpm typecheck` → OK.

- [ ] **Step 6: Commit** — `refactor(renderer): les thèmes se construisent depuis les tokens partagés`

---

### Task 4: Scaffold `apps/design` — coquille, thème, navigation

**Files:**
- Create: `apps/design/package.json`
- Create: `apps/design/tsconfig.json`
- Create: `apps/design/vite.config.ts`
- Create: `apps/design/index.html`
- Create: `apps/design/src/main.ts`
- Create: `apps/design/src/theme-state.ts`
- Create: `apps/design/src/style.css`
- Create: `apps/design/README.md` (rôle, `pnpm --filter design dev`, pourquoi les alias sources)

**Interfaces:**
- Consumes: `renderTokensCss()` (`@defsquare/data-graph-tokens/css`), thèmes du renderer via alias.
- Produces (pour Tasks 5-8) :
  - `theme-state.ts` : `interface ThemeState { brand: "defsquare" | "neutral"; mode: "light" | "dark" }`, `function currentTheme(state: ThemeState): Theme` (retourne `defsquareLight`/`defsquareDark`/`neutralLight`/`neutralDark` importés du renderer), `function onThemeChange(cb: (s: ThemeState) => void): () => void`, `function setTheme(patch: Partial<ThemeState>): void`.
  - `main.ts` : registre de vues `{ id: string; label: string; mount(root: HTMLElement, state: ThemeState): () => void }` — chaque vue exporte `mountXxxView` de cette forme ; `main.ts` route par hash (`#/tokens`, `#/graph`, `#/ui`, `#/sandbox`), démonte (appelle le cleanup retourné) avant de remonter, et remonte la vue active à chaque changement de thème (les canvases Pixi sont recréés — c'est la règle `setTheme` couleurs-seulement contournée par reconstruction).

**Steps:**

- [ ] **Step 1: Scaffolder.** `package.json` (nom `design`, private, scripts `dev`/`build`/`typecheck` — PAS de script `test`) calqué sur `apps/demo/package.json`, dépendances : `pixi.js@^8.0.0`, devDeps `typescript`, `vite@^6.0.0`. `vite.config.ts` : reprendre le pattern d'alias de `apps/demo/vite.config.ts` mais **inconditionnel** (le playground n'est jamais publié, il consomme toujours les sources) :
  - `@tokens/` → `packages/tokens/src/`
  - `@renderer/` → `packages/renderer/src/`
  - `@core/` → `packages/core/src/`
  - `publicDir: fileURLToPath(new URL("../demo/public", import.meta.url))` — réutilise les woff2 et logos de la démo (CSP sans objet ici, pas de Tauri).
  - `server.port: 5174` (ne pas entrer en collision avec la démo).
  Dans `tsconfig.json`, des `paths` miroirs pour que `tsc --noEmit` suive les alias.

- [ ] **Step 2: La coquille.** `index.html` minimal (`<div id="app">`). `src/main.ts` :
  - importe `../../demo/src/fonts.css` (les `@font-face` ; les URLs `/fonts/*.woff2` résolvent via le publicDir partagé) et `./style.css` ;
  - injecte les variables : `const style = document.createElement("style"); style.textContent = renderTokensCss(); document.head.append(style);` — en dev, modifier un token dans `packages/tokens/src` recharge ce module et le playground entier ;
  - attend `document.fonts.ready` avant le premier montage (les BitmapFonts Pixi mesurent par nom de famille — regarder comment `apps/demo/src/main.ts` séquence ce point et faire pareil) ;
  - construit le shell : sidebar de navigation (4 entrées), barre haute avec deux contrôles — toggle light/dark (pose `data-theme` sur `<html>`, même mécanisme que la démo) et select defsquare/neutral ;
  - route par hash, défaut `#/tokens`. Pour cette tâche, enregistrer 4 vues placeholder (`mount` = un `<p>` avec le nom) — les tâches 5-8 les remplacent.
  `src/style.css` : styles du shell du playground **écrits avec les variables générées** (`var(--ds-canvas)`, `var(--space-*)`, `var(--font-body)`…) — le playground est lui-même un consommateur du design system.

- [ ] **Step 3: Vérifier** — `pnpm install` (racine, enregistre le nouveau paquet), `pnpm --filter design dev` : les 4 vues naviguent, le toggle dark change le fond, les polices chargent (vérifier dans l'inspecteur réseau que les woff2 arrivent). `pnpm --filter design build && pnpm --filter design typecheck` → OK. `pnpm build` racine → OK (design inclus).

- [ ] **Step 4: Commit** — `feat(design): coquille du playground du design system`

---

### Task 5: Vue Tokens

**Files:**
- Create: `apps/design/src/views/tokens.ts`
- Create: `apps/design/src/contrast.ts`
- Modify: `apps/design/src/main.ts` (enregistrer la vraie vue)

**Interfaces:**
- Consumes: package tokens (tout), `theme-state.ts`, `entityAccentMap` + `fontLease`/BitmapFont via `@renderer/` pour le spécimen Pixi (regarder `@renderer/font-registry.ts` et son usage dans `create.ts`).
- Produces: `mountTokensView(root, state)` conforme au registre.

**Steps:**

- [ ] **Step 1: Sections de la vue** (tout en DOM sauf le spécimen Pixi) :
  - **Couleurs** — pour la marque active, un tableau de swatches par groupe (`surface`, `ink`, `accent`, `edge`) avec light et dark côte à côte, la valeur hex, et pour les paires encre/surface pertinentes (`ink.primary` sur `surface.card`, `ink.muted` sur `surface.card`, `ink.subtle` sur `surface.card`) le ratio de contraste WCAG calculé par `contrast.ts` (`function contrastRatio(fgHex: string, bgHex: string): number` — luminance relative sRGB standard, arrondi à 2 décimales, badge AA/AAA).
  - **Tokens chrome** — `fg`, `float.*` et `shadow` light/dark, montrés sur un fond en damier pour rendre la translucidité lisible.
  - **Typographie** — pour chaque rôle (`header`, `badge`, `key`, `value`) : le spécimen en DOM (famille/taille/graisse/tracking depuis les tokens) ET le même texte rendu en BitmapFont dans un petit canvas Pixi — c'est la vérité du canvas, celle que l'utilisateur voit. Un seul `Application` Pixi pour toute la section (les contextes WebGL sont comptés par le navigateur).
  - **Échelles** — spacing, radii, strokes : barres/carrés proportionnels avec la valeur en px.
  - **Palette d'entités** — les 6 pastilles, puis une démonstration d'`entityAccentMap` : une liste de types fictifs (`["user", "order", "product", "invoice", "shipment", "warehouse", "supplier"]`) et la couleur assignée à chacun, montrant le modulo et l'ordre de déclaration.
- [ ] **Step 2: Vérifier en dev** — les deux marques, les deux modes ; modifier une valeur dans `packages/tokens/src/index.ts`, constater le hot-reload, la remettre.
- [ ] **Step 3: Vérifier** `pnpm --filter design build && pnpm --filter design typecheck`.
- [ ] **Step 4: Commit** — `feat(design): vue tokens du playground`

---

### Task 6: Vue Composants graphe

**Files:**
- Create: `apps/design/src/views/graph-components.ts`
- Create: `apps/design/src/pixi-stage.ts` (utilitaire : crée un `Application` Pixi dans un conteneur DOM donné, fond `theme.surface.canvas`, retourne `{ app, destroy }`)
- Modify: `apps/design/src/main.ts`

**Interfaces:**
- Consumes: `@renderer/draw.ts` (fonctions `drawNode`, `drawEdges`, `drawEdgeLabels`, `drawClusters`, `drawSemanticDiscs`, `drawSemanticLabels`, `drawSemanticEdges`, `lodForScale`), `@renderer/theme.ts`, `@renderer/font-registry.ts`, `@core/measure.ts` (`DEFAULT_METRICS` et la mesure des nœuds). **Avant d'écrire quoi que ce soit, lire les tests du renderer (`packages/renderer/test/draw*.test.ts` et voisins) : ils montrent exactement comment fabriquer la donnée nue attendue par chaque fonction de dessin — c'est la voie pavée, `draw.ts` a été conçu pour être appelé ainsi.**
- Produces: `mountGraphComponentsView(root, state)`.

**Steps:**

- [ ] **Step 1: Spécimens, par section** (un `pixi-stage` par section, spécimens en grille dans le stage, libellé DOM au-dessus de chaque section) :
  - **Carte de nœud** — un même nœud fictif décliné : repos / hover / sélectionné / résultat de recherche (match + matchCurrent) / avec ref cassée (dangling) / replié vs déplié / variante `cardMuted`. Les états sont des **paramètres forcés** passés à `drawNode` (flags de la signature — les lire dans `draw.ts:306`).
  - **Arêtes** — trois paires de rectangles reliés : `contain`, `ref` (avec flèche), `dangling` (pointillés), plus une avec label (`drawEdgeLabels`).
  - **Enveloppes de clusters** — `drawClusters` sur 2-3 cercles fictifs, état repos et état hover (les alphas interpolés).
  - **Zoom sémantique** — `drawSemanticDiscs` + `drawSemanticLabels` + `drawSemanticEdges` à 3 échelles représentatives (utiliser `lodForScale` et les constantes `LOD0_MIN_SCALE`/`LOD1_MIN_SCALE` pour choisir des échelles de part et d'autre des seuils).
- [ ] **Step 2: Reconstruction sur changement de thème** — la vue est remontée par `main.ts` ; vérifier qu'aucun état Pixi ne fuit (le cleanup de `mount` détruit tous les stages via `destroy`).
- [ ] **Step 3: Vérifier en dev** (deux marques × deux modes), puis `pnpm --filter design build && pnpm --filter design typecheck`.
- [ ] **Step 4: Commit** — `feat(design): vue composants graphe, états forcés via draw.ts`

---

### Task 7: Vue Composants UI

**Files:**
- Create: `apps/design/src/views/ui-components.ts`
- Create: `apps/design/src/views/ui-components.css`
- Modify: `apps/design/src/main.ts`

**Interfaces:**
- Consumes: les variables CSS générées (déjà injectées) ; le CSS du chrome de la démo sert de **référence de lecture** (`apps/demo/src/style.css`), pas d'import — ses règles sont ancrées en `position: fixed` sur des ids de page, inutilisables hors de la démo.
- Produces: `mountUiComponentsView(root, state)`.

**Steps:**

- [ ] **Step 1: Reproduire les primitives du chrome** dans `ui-components.css`, en réutilisant les mêmes déclarations que `style.css` de la démo mais sous des classes locales posées en flux normal (`.spec-float`, `.spec-icon-button`, `.spec-findbar`, `.spec-badge`, `.spec-menu-item`…) : surface flottante (`--float-bg` + blur + `--shadow-float`), bouton d'icône, champ de recherche, badge/pastille d'entité, item de menu. Chaque primitive est présentée en rangée d'états : repos, hover (réel, au survol), focus (réel, au clavier), active, `disabled` (attribut), et — pour les états qu'on ne peut pas superposer — une note dans le libellé. Un damier sous les surfaces translucides.
- [ ] **Step 2: Vérifier en dev** (les états répondent, dark OK), `pnpm --filter design build && typecheck`.
- [ ] **Step 3: Commit** — `feat(design): vue composants UI du chrome`

---

### Task 8: Vue Bac à sable + intégration finale

**Files:**
- Create: `apps/design/src/views/sandbox.ts`
- Modify: `apps/design/src/main.ts`
- Modify: `CLAUDE.md` (commandes : dev du playground ; structure : `packages/tokens`, `apps/design`)
- Modify: `README.md` (une ligne dans la structure du repo, si une telle section existe)

**Interfaces:**
- Consumes: `createDataGraph` via `@renderer/index.ts` (ou `@renderer/create.ts`), la fixture `apps/demo/fixtures/shop.json` + `shop.config.json` (import JSON direct par chemin relatif), `theme-state.ts`. Regarder `apps/demo/src/main.ts` pour le câblage réel (options, worker de layout : passer `graphLayoutWorkerUrl` résolue via l'alias, comme la démo le fait — lire le commentaire du vite.config de la démo).
- Produces: `mountSandboxView(root, state)`.

**Steps:**

- [ ] **Step 1: La vue** — un conteneur plein cadre, `createDataGraph(container, data, config, { theme: currentTheme(state) })` (signature exacte à lire dans `create.ts` / le README du renderer). Le changement de mode light↔dark sur la même marque passe par `graph.setTheme(...)` (couleurs seules — c'est le chemin rapide légitime) ; le changement de marque remonte la vue entière (recréation, car typographie potentiellement différente). Cleanup : `graph.destroy()`.
- [ ] **Step 2: Vérifier en dev** — le graphe se charge, expand/collapse et recherche fonctionnent, les 4 combinaisons marque×mode s'affichent.
- [ ] **Step 3: CLAUDE.md** — section Commandes : ajouter `pnpm --filter design dev` (playground du design system, port 5174) ; section Structure : `packages/tokens` (source de vérité des tokens, génère `apps/demo/src/tokens.css` gardé par test de fraîcheur) et `apps/design` (playground, alias sources, jamais publié).
- [ ] **Step 4: Vérification finale complète** — à la racine : `pnpm build && pnpm typecheck && pnpm test`. Tout vert, y compris cargo.
- [ ] **Step 5: Commit** — `feat(design): bac à sable sur fixture réelle + doc du playground`

---

## Auto-revue du plan (faite à l'écriture)

- **Couverture spec** : source unique (T1), CSS généré + fraîcheur (T2), theme.ts refactoré API intacte (T3), playground 4 vues (T4-T8), hors-périmètre respecté (aucune tâche ne touche aux géométries de draw.ts, à la CLI, ni à la persistance du thème).
- **Cohérence des types** : `ColorTokens` n'inclut ni `fg` ni `float` (DOM-only → `chrome`), `Theme` du renderer reste défini localement ; `mountXxxView(root, state)` uniforme pour les 4 vues.
- **Points de vigilance transmis aux exécutants** : ordre des alias Vite (préfixes), un seul `Application` Pixi par section (limite de contextes WebGL), `document.fonts.ready` avant BitmapFont, reconstruction des canvases au changement de typo, byte-à-byte du CSS généré vérifié par le test de fraîcheur.
