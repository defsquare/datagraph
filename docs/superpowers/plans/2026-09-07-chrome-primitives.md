# Primitives du chrome en package partagé — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire les primitives visuelles du chrome (`packages/chrome`) pour que la démo et le catalogue les consomment depuis une seule source, et que la vue « Composants UI » du playground n'ait plus une ligne de CSS ni un SVG recopiés.

**Architecture:** Nouveau package privé `@defsquare/data-graph-chrome` sans build (exports pointés sur `src/`), portant trois choses : une feuille `chrome.css` (règles déplacées verbatim depuis `apps/demo/src/style.css`), un module d'icônes, et des fabriques de markup. La démo construit désormais ses primitives par ces fabriques ; le playground aussi. Les assemblages produit restent dans la démo.

**Tech Stack:** TypeScript, ESM, Vite 6, vitest + happy-dom (nouveau), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-07-chrome-primitives-design.md` — ADR associé : `docs/adr/0029-chrome-primitives-shared-package.md`.

## Global Constraints

- **Neutralité visuelle** : les règles CSS sont **déplacées**, jamais réécrites. Le rendu de la démo doit être identique, clair et sombre.
- **Les 18 ids survivent** : `#toggle-view`, `#selection-label`, `#toggle-dataset`, `#selection-type`, `#selection-path`, `#search`, `#menu-toggle`, `#toggle-theme`, `#stat-diagnostics`, `#selection-rows`, `#menu`, `#tidy`, `#stat-visible`, `#stat-nodes`, `#search-toggle`, `#logo`, `#load-error`, `#load-error-message` — plus `#fit`, `#findbar`, `#detail`, `#detail-close`, `#prev-match`, `#next-match`, `#match-counter`, `#selection-empty`, `#app`, `#toolbar`, `#statusbar` utilisés par le câblage TS. **Aucun id ne disparaît.**
- **Aucun comportement dans le package** : pas de gestion d'ouverture/fermeture, pas d'écouteur global. Les fabriques produisent du DOM inerte (sauf les écouteurs propres à un composant qu'aucun consommateur ne peut poser à sa place — il n'y en a aucun ici).
- Commentaires en français documentant le « pourquoi ». Messages de commit en français.
- **Chaque commit porte un trailer `ADR-Reviewed:`** (garde `.claude/hooks/adr-gate.sh`). ADR-0029 couvre ce chantier : les commits d'implémentation portent `ADR-Reviewed: ADR-0029 couvre ce chantier ; aucune nouvelle décision d'architecture.` sauf si une décision nouvelle apparaît.
- Vérifications : `pnpm build && pnpm typecheck && pnpm test` à la racine, **plus** `pnpm --filter demo e2e` (hors de `pnpm test`, c'est le filet du refactor).
- Périmètre : `packages/chrome/`, `apps/demo/`, `apps/design/`, `CLAUDE.md`, `pnpm-lock.yaml`. Rien d'autre.
- Interdit : `git stash` (pile partagée entre worktrees).

---

### Task 1: Scaffold du package + module d'icônes

**Files:**
- Create: `packages/chrome/package.json`
- Create: `packages/chrome/tsconfig.json`
- Create: `packages/chrome/vitest.config.ts`
- Create: `packages/chrome/src/icons.ts`
- Create: `packages/chrome/test/icons.test.ts`

**Interfaces:**
- Produces (consommé par Tasks 2-4) :
  - `type IconName = "search" | "fit" | "tidy" | "graph" | "structure" | "dots" | "close" | "up" | "down"`
  - `function icon(name: IconName, className?: string): SVGSVGElement` — `viewBox="0 0 16 16"`, `aria-hidden="true"`, contenu = le tracé du nom.

**Steps:**

- [ ] **Step 1: Écrire le test** — `packages/chrome/test/icons.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { icon, ICON_NAMES } from "../src/icons.js";

describe("icon", () => {
  it("produit un SVG au gabarit du chrome", () => {
    const svg = icon("search");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    // Décoratif : le sens est porté par l'`aria-label` du bouton qui l'englobe.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.innerHTML).toContain("<circle");
  });

  it("pose la classe demandée, et aucune sinon", () => {
    expect(icon("graph", "icon-graph").getAttribute("class")).toBe("icon-graph");
    expect(icon("graph").hasAttribute("class")).toBe(false);
  });

  it("connaît les neuf icônes du chrome, toutes non vides", () => {
    expect([...ICON_NAMES]).toEqual([
      "search", "fit", "tidy", "graph", "structure", "dots", "close", "up", "down",
    ]);
    for (const name of ICON_NAMES) expect(icon(name).innerHTML.trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Scaffolder le package.** `packages/chrome/package.json` — calqué sur `packages/tokens/package.json` mais **sans build** :

```json
{
  "name": "@defsquare/data-graph-chrome",
  "version": "0.0.0",
  "private": true,
  "description": "Chrome primitives shared by the demo and the design system playground: CSS, icons and markup factories.",
  "type": "module",
  "sideEffects": ["*.css"],
  "engines": { "node": ">=20" },
  "exports": {
    ".": "./src/index.ts",
    "./chrome.css": "./src/chrome.css"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.19.43",
    "happy-dom": "^15.11.7",
    "vitest": "^4.1.11"
  }
}
```

Pas de script `build` : le package n'a pas de `dist`, ses `exports` pointent sur les sources — c'est ce que la spec acte (deux consommateurs Vite). `"sideEffects": ["*.css"]` empêche un bundler de secouer la feuille importée pour son effet.

`packages/chrome/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/chrome/vitest.config.ts` — le monorepo n'avait pas d'environnement DOM ; c'est le premier :

```ts
import { defineConfig } from "vitest/config";

// Les fabriques produisent du DOM : elles se testent dans un document, pas dans
// un navigateur. happy-dom suffit — aucune de ces primitives ne dépend d'une
// mise en page calculée, seulement des classes, ids et attributs ARIA émis.
export default defineConfig({
  test: { environment: "happy-dom" },
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec** — `pnpm install` puis `pnpm --filter @defsquare/data-graph-chrome test` → FAIL (`Cannot find module '../src/icons.js'`).

- [ ] **Step 4: Écrire `src/icons.ts`.** Les neuf tracés sont repris **verbatim** de `apps/demo/index.html` (lignes 29-32 search, 36-45 fit, 53-58 tidy, 65-70 graph, 71-76 structure, 91-95 dots, 131-133 close, 107-109 up, 112-114 down). En-tête de fichier : ils vivaient en dur dans le HTML de la démo **et** recopiés dans `apps/design/src/views/ui-components.ts` ; ce module est désormais leur seule source.

```ts
export const ICON_NAMES = [
  "search", "fit", "tidy", "graph", "structure", "dots", "close", "up", "down",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS: Record<IconName, string> = { /* les neuf tracés */ };

/**
 * `innerHTML` sur un littéral figé du module : aucune donnée extérieure n'y
 * transite, et c'est la forme la plus lisible pour garder les tracés identiques
 * à ceux qu'ils remplacent — les réécrire en `createElementNS` rendrait toute
 * comparaison future illisible.
 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  svg.innerHTML = PATHS[name];
  return svg;
}
```

- [ ] **Step 5: Vérifier** — `pnpm --filter @defsquare/data-graph-chrome test` → 3 passants ; `pnpm --filter @defsquare/data-graph-chrome typecheck` → OK.

- [ ] **Step 6: Commit** — `feat(chrome): package des primitives et module d'icônes`

---

### Task 2: `chrome.css` et les fabriques

**Files:**
- Create: `packages/chrome/src/chrome.css`
- Create: `packages/chrome/src/factories.ts`
- Create: `packages/chrome/src/index.ts`
- Create: `packages/chrome/test/factories.test.ts`
- Create: `packages/chrome/README.md`

**Interfaces:**
- Consumes: `icon`, `IconName` (Task 1).
- Produces (consommé par Tasks 3-4) :
  - `createIconButton(o: { icon: IconName | readonly IconName[]; label: string; id?: string; small?: boolean; controls?: string; expanded?: boolean }): HTMLButtonElement` — `type="button"`, classe `ibtn` (+ `ibtn-sm` si `small`), `title` et `aria-label` = `label`, `aria-controls`/`aria-expanded` si fournis. Un tableau d'icônes rend un `<svg class="icon-<nom>">` par entrée (c'est ce dont `#toggle-view` a besoin).
  - `createCluster(...children: Node[]): HTMLDivElement` — classe `cluster float`.
  - `createClusterSeparator(): HTMLSpanElement` — classe `cluster-sep`, `aria-hidden="true"`.
  - `createFindbar(o?: { id?: string; inputId?: string; counterId?: string; prevId?: string; nextId?: string }): { root: HTMLDivElement; input: HTMLInputElement; counter: HTMLSpanElement; prev: HTMLButtonElement; next: HTMLButtonElement }` — `root` classe `findbar float`, `hidden` posé.
  - `createMenu(o: { id?: string; labelledBy?: string }, ...items: Node[]): HTMLDivElement` — classe `menu float`, `role="menu"`, `hidden`.
  - `createMenuItem(o: { label: string; id?: string }): HTMLButtonElement` — classe `menu-item`, `role="menuitem"`, `type="button"`.
  - `createBadge(o?: { id?: string; text?: string }): HTMLSpanElement` — classe `badge`, `hidden` si pas de texte.
  - `createStatusLink(o?: { id?: string; label?: string }): HTMLButtonElement` — classe `status-link`, `type="button"`, `hidden` si pas de libellé.
  - `createRefButton(o: { title: string; disabled?: boolean }): HTMLButtonElement` — classe `ref-btn`, texte `→`.
  - `src/index.ts` réexporte tout `factories.ts` et `icons.ts`.

**Steps:**

- [ ] **Step 1: Écrire le test des fabriques** — `packages/chrome/test/factories.test.ts`. Il fige le contrat que la démo (ses e2e) et le catalogue partagent :

```ts
import { describe, expect, it } from "vitest";
import {
  createBadge, createCluster, createClusterSeparator, createFindbar,
  createIconButton, createMenu, createMenuItem, createRefButton, createStatusLink,
} from "../src/factories.js";

describe("createIconButton", () => {
  it("porte la classe, le type et les deux libellés", () => {
    const b = createIconButton({ icon: "search", label: "Rechercher", id: "search-toggle" });
    expect(b.className).toBe("ibtn");
    expect(b.type).toBe("button");
    expect(b.id).toBe("search-toggle");
    // `title` pour la souris, `aria-label` pour le reste : un bouton sans texte
    // n'a pas de nom accessible sans le second.
    expect(b.title).toBe("Rechercher");
    expect(b.getAttribute("aria-label")).toBe("Rechercher");
    expect(b.querySelectorAll("svg")).toHaveLength(1);
  });

  it("accepte la variante réduite et les attributs de panneau", () => {
    const b = createIconButton({
      icon: "dots", label: "Menu", small: true, controls: "menu", expanded: false,
    });
    expect(b.className).toBe("ibtn ibtn-sm");
    expect(b.getAttribute("aria-controls")).toBe("menu");
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("rend une icône par nom, chacune classée, pour les boutons à deux états", () => {
    const b = createIconButton({ icon: ["graph", "structure"], label: "Vue graphe" });
    const classes = [...b.querySelectorAll("svg")].map((s) => s.getAttribute("class"));
    expect(classes).toEqual(["icon-graph", "icon-structure"]);
  });
});

describe("createFindbar", () => {
  it("assemble icône, champ, compteur et navigation, replié", () => {
    const bar = createFindbar({
      id: "findbar", inputId: "search", counterId: "match-counter",
      prevId: "prev-match", nextId: "next-match",
    });
    expect(bar.root.className).toBe("findbar float");
    expect(bar.root.hasAttribute("hidden")).toBe(true);
    expect(bar.input.type).toBe("search");
    expect(bar.input.className).toBe("findbar-input");
    expect(bar.input.id).toBe("search");
    expect(bar.counter.className).toBe("findbar-counter");
    // Le compteur s'annonce quand il change : c'est le seul retour de recherche
    // pour qui ne voit pas le canvas.
    expect(bar.counter.getAttribute("aria-live")).toBe("polite");
    expect(bar.prev.className).toBe("findbar-nav");
    expect(bar.next.id).toBe("next-match");
    expect(bar.root.querySelector(".findbar-icon")).not.toBeNull();
  });
});

describe("createMenu", () => {
  it("est un panneau de rôle menu, replié, portant ses entrées", () => {
    const item = createMenuItem({ label: "Thème sombre", id: "toggle-theme" });
    const menu = createMenu({ id: "menu", labelledBy: "menu-toggle" }, item);
    expect(menu.className).toBe("menu float");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe("menu-toggle");
    expect(menu.hasAttribute("hidden")).toBe(true);
    expect(item.className).toBe("menu-item");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toBe("Thème sombre");
    expect(menu.contains(item)).toBe(true);
  });
});

describe("primitives d'un seul élément", () => {
  it("createCluster pose la surface flottante autour de ses enfants", () => {
    const sep = createClusterSeparator();
    const cluster = createCluster(createIconButton({ icon: "fit", label: "Ajuster" }), sep);
    expect(cluster.className).toBe("cluster float");
    expect(sep.className).toBe("cluster-sep");
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    expect(cluster.children).toHaveLength(2);
  });

  it("createBadge est replié tant qu'il n'a rien à dire", () => {
    expect(createBadge({ id: "selection-type" }).hasAttribute("hidden")).toBe(true);
    const filled = createBadge({ text: "ORDER" });
    expect(filled.className).toBe("badge");
    expect(filled.textContent).toBe("ORDER");
    expect(filled.hasAttribute("hidden")).toBe(false);
  });

  it("createStatusLink est un bouton, replié par défaut", () => {
    const link = createStatusLink({ id: "stat-diagnostics" });
    expect(link.className).toBe("status-link");
    expect(link.type).toBe("button");
    expect(link.hasAttribute("hidden")).toBe(true);
  });

  it("createRefButton dit où il mène, et se désactive s'il ne mène nulle part", () => {
    const ok = createRefButton({ title: "Aller à Customer#c1" });
    expect(ok.className).toBe("ref-btn");
    expect(ok.textContent).toBe("→");
    expect(ok.disabled).toBe(false);
    expect(createRefButton({ title: "Référence cassée", disabled: true }).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** (`../src/factories.js` absent).

- [ ] **Step 3: Écrire `src/chrome.css`.** Les règles sont **déplacées verbatim** depuis `apps/demo/src/style.css` — les recopier à la main introduirait des écarts ; travailler par couper-coller depuis le fichier source. Contenu, dans cet ordre :

  1. `.float` (style.css:36-43)
  2. `.findbar[hidden], .menu[hidden] { display: none }` — **extrait** de la règle style.css:49-53 dont `#detail[hidden]` **reste dans la démo** (le panneau de détail est un assemblage). Garder le commentaire d'origine (styles.css:45-48) qui explique pourquoi la feuille UA ne suffit pas.
  3. `.cluster`, `.cluster-sep` (67-79)
  4. `.ibtn` et toute sa suite d'états : `svg`, `:hover`, `:active`, `:disabled`, `:focus-visible`, `[aria-expanded="true"]`, `[aria-busy="true"]:disabled`, `@keyframes ibtn-busy`, la garde `prefers-reduced-motion`, `.ibtn-sm` (81-139) — avec leurs commentaires.
  5. `.findbar`, `@keyframes unfold`, `:focus-within`, `.findbar-icon` (147-168), puis **`#search` → `.findbar-input`** (170-182, y compris `::-webkit-search-cancel-button`) et **`#match-counter` → `.findbar-counter`** (184-191), puis `.findbar-nav` et ses états (193-214).
  6. `.menu`, `@keyframes drop-in`, `.menu-item` et ses états (218-255).
  7. **`#selection-type` → `.badge`** (302-313) et **`#selection-type[hidden]` → `.badge[hidden]`** (315-319, avec son commentaire réécrit : c'est désormais une règle d'auteur, pas d'id, qui l'emporte sur la feuille UA).
  8. `.status-link` et `:hover` (404-415).
  9. **`#selection-rows .ref-btn` → `.ref-btn`** (364-377) — désencapsulé de `#selection-rows` : la primitive ne dépend pas de son hôte. Aucune règle concurrente n'existe, la baisse de spécificité est sans effet.

  En-tête du fichier : ces règles habillent les primitives partagées par `apps/demo` et `apps/design` ; elles consomment les variables du paquet de tokens et doivent donc être importées **après** `tokens.css`. Noter les trois renommages d'id → classe et pourquoi (une primitive ne peut pas être stylée par l'id d'une de ses instances).

- [ ] **Step 4: Écrire `src/factories.ts`** aux signatures de la section *Interfaces*, puis `src/index.ts` (`export * from "./icons.js"; export * from "./factories.js";`). En-tête de `factories.ts` : les fabriques produisent du DOM **inerte** — aucun écouteur, aucune gestion d'ouverture ; le comportement appartient à l'application (voir ADR-0029). Elles acceptent un `id` parce que les instances de la démo sont désignées par id, par son câblage comme par ses e2e.

```ts
import { icon, type IconName } from "./icons.js";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, id?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (id) node.id = id;
  return node;
}

export interface IconButtonOptions {
  /** Un tableau rend une icône par nom, classée `icon-<nom>` : c'est ainsi
   * qu'un bouton porte l'état courant ET l'état cible, la feuille en masquant
   * une (cf. `#toggle-view` dans la démo). */
  icon: IconName | readonly IconName[];
  label: string;
  id?: string;
  small?: boolean;
  controls?: string;
  expanded?: boolean;
}

export function createIconButton(o: IconButtonOptions): HTMLButtonElement {
  const button = element("button", o.small ? "ibtn ibtn-sm" : "ibtn", o.id);
  button.type = "button";
  // Les deux : `title` sert l'infobulle à la souris, `aria-label` donne au
  // bouton un nom accessible qu'aucun texte enfant ne porte.
  button.title = o.label;
  button.setAttribute("aria-label", o.label);
  if (o.controls) button.setAttribute("aria-controls", o.controls);
  if (o.expanded !== undefined) button.setAttribute("aria-expanded", String(o.expanded));
  const names = typeof o.icon === "string" ? [o.icon] : o.icon;
  for (const name of names) button.append(icon(name, names.length > 1 ? `icon-${name}` : undefined));
  return button;
}
```

Les autres fabriques suivent la même forme : construire, poser classes/ids/ARIA, retourner. `createFindbar` assemble `icon("search", "findbar-icon")`, l'`input[type=search]` (`autocomplete="off"`, `aria-label="Rechercher"`, `placeholder="Rechercher…"`), le compteur (`aria-live="polite"`), et deux `findbar-nav` portant `icon("up")` / `icon("down")` avec les `title`/`aria-label` « Résultat précédent (Maj+Entrée) » / « Résultat suivant (Entrée) » repris de `index.html`.

- [ ] **Step 5: `packages/chrome/README.md`** — court : ce que le package contient, ce qu'il ne contient pas (comportement, assemblages), pourquoi il est privé et sans build, et la règle d'import de `chrome.css` après `tokens.css`.

- [ ] **Step 6: Vérifier** — `pnpm --filter @defsquare/data-graph-chrome test` (tous passants) et `typecheck`.

- [ ] **Step 7: Commit** — `feat(chrome): feuille des primitives et fabriques de markup`

---

### Task 3: La démo consomme le package

**Files:**
- Modify: `apps/demo/package.json` (dépendance `"@defsquare/data-graph-chrome": "workspace:*"`)
- Modify: `apps/demo/src/style.css` (import + suppression des règles déplacées)
- Modify: `apps/demo/index.html` (retrait du markup des primitives)
- Modify: `apps/demo/src/chrome.ts` (construction par fabriques, puis câblage inchangé)
- Modify: `apps/demo/src/detail-panel.ts` (`createBadge`, `createRefButton`)
- Modify: `apps/demo/vite.config.ts` (alias dev vers les sources du package)

**Interfaces:**
- Consumes: toutes les fabriques de Task 2.
- Produces: rien de nouveau. Le DOM final doit être **équivalent** à l'actuel : mêmes ids, mêmes classes, mêmes attributs ARIA.

**Steps:**

- [ ] **Step 1: Déclarer la dépendance et l'alias.** Ajouter `"@defsquare/data-graph-chrome": "workspace:*"` aux `dependencies` d'`apps/demo`, `pnpm install`. Dans `apps/demo/vite.config.ts`, ajouter au bloc d'alias **dev** (lire le long commentaire du fichier ; l'ordre compte, le plus spécifique d'abord) :

```ts
{ find: "@defsquare/data-graph-chrome/chrome.css", replacement: src("../../packages/chrome/src/chrome.css") },
{ find: "@defsquare/data-graph-chrome", replacement: src("../../packages/chrome/src/index.ts") },
```

Ces entrées précèdent celles de `@defsquare/data-graph` (préfixe distinct, mais l'habitude du fichier est de trier du plus spécifique au plus général).

- [ ] **Step 2: `style.css`.** Ajouter `@import "@defsquare/data-graph-chrome/chrome.css";` **après** `@import "./tokens.css";` (les `@import` restent en tête de feuille). Supprimer les règles listées en Task 2 Step 3, en gardant : `#detail[hidden]` (rétabli en règle autonome), `#toolbar`, `#toggle-view[data-target=…]`, `#detail` et ses descendants d'assemblage (`.detail-head`, `#detail h2`, `#selection-empty`, `#selection-label`, `#selection-path`, `#selection-rows`, `#selection-rows .row`, `dt`, `dd`), `#statusbar`, `#statusbar strong`, `#logo`, `#load-error` et ses descendants, `#app`, `html/body`, le bloc `prefers-reduced-motion` résiduel s'il en reste. Mettre à jour le commentaire de tête : les primitives viennent désormais de `@defsquare/data-graph-chrome`.

- [ ] **Step 3: `index.html`.** Retirer le markup des primitives ; garder les conteneurs positionnés et le contenu d'assemblage :

```html
<div id="app"></div>

<!-- Rempli par `chrome.ts` : les primitives (boutons d'icône, recherche, menu)
     viennent des fabriques du paquet de chrome, seule source partagée avec le
     catalogue du design system. -->
<div id="toolbar"></div>

<aside id="detail" hidden>
  <div class="detail-head">
    <h2>Détail du nœud</h2>
    <!-- la croix est ajoutée ici par `chrome.ts` -->
  </div>
  <p id="selection-empty">Sélectionnez un nœud pour voir son détail.</p>
  <!-- la pastille est insérée ici par `detail-panel.ts` -->
  <p id="selection-label" hidden></p>
  <p id="selection-path" hidden></p>
  <dl id="selection-rows"></dl>
</aside>

<div id="load-error" class="float" hidden>
  <h2>Impossible d'ouvrir le document</h2>
  <pre id="load-error-message"></pre>
</div>

<div id="statusbar">
  <span><strong id="stat-nodes">0</strong> nœuds</span>
  <span><strong id="stat-visible">0</strong> visibles</span>
  <!-- le lien de diagnostics est ajouté ici par `chrome.ts` -->
</div>

<img id="logo" src="/defsquare-short-dark-red.svg" alt="defsquare" />
```

`#load-error` garde `class="float"` : `.float` est une classe qu'on **applique** à une surface, pas un composant qu'on construit — la partager par la feuille suffit.

- [ ] **Step 4: `chrome.ts`.** Avant le câblage actuel, construire le chrome et l'insérer, en préservant chaque id :

```ts
const toolbar = document.getElementById("toolbar");
const searchToggleBtn = createIconButton({
  id: "search-toggle", icon: "search", label: "Rechercher",
  controls: "findbar", expanded: false,
});
const fitBtn = createIconButton({ id: "fit", icon: "fit", label: "Ajuster à la vue" });
const tidyBtn = createIconButton({ id: "tidy", icon: "tidy", label: "Ranger" });
const toggleViewBtn = createIconButton({
  id: "toggle-view", icon: ["graph", "structure"], label: "Vue graphe",
});
toggleViewBtn.dataset.target = "graph";
const menuToggleBtn = createIconButton({
  id: "menu-toggle", icon: "dots", label: "Menu", controls: "menu", expanded: false,
});
menuToggleBtn.setAttribute("aria-haspopup", "menu");

const findbar = createFindbar({
  id: "findbar", inputId: "search", counterId: "match-counter",
  prevId: "prev-match", nextId: "next-match",
});
const datasetItem = createMenuItem({ id: "toggle-dataset", label: "Jeu de données étendu (4000)" });
const themeItem = createMenuItem({ id: "toggle-theme", label: "Thème sombre" });
const menuEl = createMenu({ id: "menu", labelledBy: "menu-toggle" }, datasetItem, themeItem);

toolbar?.append(
  createCluster(searchToggleBtn, fitBtn, tidyBtn, toggleViewBtn, createClusterSeparator(), menuToggleBtn),
  findbar.root,
  menuEl,
);

document.querySelector(".detail-head")?.append(
  createIconButton({ id: "detail-close", icon: "close", label: "Fermer le panneau", small: true }),
);

const statDiagEl = createStatusLink({ id: "stat-diagnostics" });
document.getElementById("statusbar")?.append(statDiagEl);
```

Le reste du fichier ne change **que** sur un point : les `document.getElementById(...)` de ces éléments deviennent inutiles puisque les références existent déjà — les remplacer par ces constantes, en gardant les gardes `?.` là où l'élément vient encore du HTML (`#toolbar`, `#statusbar`, `.detail-head`). Toute la mécanique de dépliage, la politique d'Échap, la barre d'état, le thème et la bascule de vue restent **inchangés**.

- [ ] **Step 5: `detail-panel.ts`.** Créer la pastille par fabrique et l'insérer à sa place :

```ts
const typeEl = createBadge({ id: "selection-type" });
document.getElementById("selection-empty")?.after(typeEl);
```

Remplacer la construction manuelle du bouton de référence par `createRefButton({ title, disabled })`, en gardant la logique de titre et l'écouteur.

- [ ] **Step 6: Vérifier.** `pnpm --filter demo build`, `pnpm typecheck`, puis **le filet** : `pnpm --filter demo e2e` — les huit fichiers e2e doivent passer **sans modification**. En cas d'échec, c'est le refactor qui est faux, pas le test. Lancer aussi `pnpm --filter demo dev` et comparer à l'œil clair/sombre.

- [ ] **Step 7: Commit** — `refactor(demo): le chrome se construit depuis les primitives partagées`

---

### Task 4: Le playground consomme le package

**Files:**
- Modify: `apps/design/package.json` (dépendance `"@defsquare/data-graph-chrome": "workspace:*"`)
- Modify: `apps/design/vite.config.ts` (alias `@chrome/` vers les sources)
- Modify: `apps/design/src/main.ts` (import de `chrome.css`)
- Modify: `apps/design/src/views/ui-components.ts` (fabriques au lieu des copies)
- Modify: `apps/design/src/views/ui-components.css` (361 → ~80 lignes)
- Modify: `apps/design/tsconfig.json` (`paths` pour `@chrome/*`)

**Interfaces:**
- Consumes: toutes les fabriques de Task 2.
- Produces: rien.

**Steps:**

- [ ] **Step 1: Câbler.** Dépendance workspace, `pnpm install`. Dans `vite.config.ts`, ajouter `{ find: "@chrome/", replacement: src("../../packages/chrome/src/") }` au bloc des préfixes, et l'entrée de nom nu `@defsquare/data-graph-chrome` (+ son sous-chemin `/chrome.css` **avant** elle) au second bloc — même raison que les autres : les sources tirées peuvent s'importer entre elles par leur nom de paquet. Miroir dans les `paths` du `tsconfig.json`.

- [ ] **Step 2: `main.ts`.** Importer la feuille du chrome après `./style.css` :

```ts
import "@chrome/chrome.css";
```

Commentaire : la planche des composants UI montre les primitives réelles ; leur feuille doit donc être chargée par le playground comme elle l'est par la démo, après les variables de tokens qu'elle consomme.

- [ ] **Step 3: `ui-components.ts`.** Supprimer le bloc `ICONS`, `SVG_NS`, `icon()` local et les fabriques locales de primitives (`iconButton`, `float`, …). Importer `createIconButton`, `createCluster`, `createClusterSeparator`, `createFindbar`, `createMenu`, `createMenuItem`, `createBadge`, `createStatusLink`, `createRefButton`, `icon` depuis `@chrome/index.ts`. Chaque spécimen appelle désormais la fabrique du produit. Garder intacts : l'ossature de la planche (`section`, `cell`), les légendes, et le principe des **états réels** (aucune classe jumelle). Mettre à jour le commentaire de tête : la recopie a disparu, la planche montre le composant réel — c'est ce que la vue « Composants graphe » faisait déjà via `draw.ts`.

- [ ] **Step 4: `ui-components.css`.** Supprimer tous les blocs « repris de la démo » (`.uic-float`, `.uic-cluster`, `.uic-ibtn` et ses états, `.uic-findbar*`, `.uic-search`, `.uic-match-counter`, `.uic-menu*`, `.uic-badge`, `.uic-detail-*`). Garder l'ossature : `.ui-components-view`, `.uic-section`, `.uic-section-title`, `.uic-note`, `.uic-row`, `.uic-cell`, `.uic-cell-label`, `.uic-stage` (le damier). Remplacer l'avertissement de tête — il documentait une dette qui n'existe plus — par une note disant que les primitives sont désormais habillées par `@defsquare/data-graph-chrome/chrome.css` et que cette feuille-ci n'habille que le cartel.

  Ajouter une seule règle nouvelle, commentée :

```css
/* Les animations d'entrée (`unfold` de la recherche, `drop-in` du menu) sont
   neutralisées SUR LA PLANCHE : le shell remonte la vue à chaque changement de
   thème, elles rejoueraient donc à chaque bascule pour un spécimen qui, lui,
   est posé en permanence. Ce sont des transitions de MONTAGE, pas des états —
   les montrer ici dirait quelque chose de faux sur le composant au repos. */
.uic-stage .findbar,
.uic-stage .menu {
  animation: none;
}
```

- [ ] **Step 5: Vérifier.** `pnpm --filter design typecheck && pnpm --filter design build`. Puis serveur de dev et inspection de `#/ui` en clair et en sombre : les cinq primitives doivent être **visuellement identiques** à ce qu'elles étaient avant le chantier, et identiques à la démo. Vérifier qu'aucune erreur de console n'apparaît et que les états réels (survol, focus clavier) répondent.

- [ ] **Step 6: Commit** — `refactor(design): la planche des composants UI montre les primitives réelles`

---

### Task 5: Documentation et vérification finale

**Files:**
- Modify: `CLAUDE.md` (structure)
- Modify: `apps/design/README.md` (la vue UI ne recopie plus)
- Modify: `README.md` (tableau des packages — `packages/chrome`)

**Interfaces:** aucune.

**Steps:**

- [ ] **Step 1: `CLAUDE.md`.** Dans la section Structure, insérer après `packages/tokens` :

```
- `packages/chrome` — primitives DOM du chrome (surface flottante, bouton d'icône, recherche, menu, pastille) : `chrome.css`, les icônes et les fabriques de markup. Privé et sans build (ses `exports` pointent sur `src/`) : `apps/demo` et `apps/design` le consomment tous deux, ce qui garantit que le catalogue montre le composant réel et non une copie. Le comportement (dépliage, Échap) reste dans la démo — voir `docs/adr/0029-chrome-primitives-shared-package.md`.
```

- [ ] **Step 2: `apps/design/README.md`.** Réécrire la puce de `src/views/ui-components.ts` : elle recopiait le CSS et les icônes de la démo, elle consomme désormais `@defsquare/data-graph-chrome` — même régime que la vue Composants graphe vis-à-vis de `draw.ts`.

- [ ] **Step 3: `README.md`.** Ajouter une ligne au tableau des packages et à l'arbre du monorepo pour `packages/chrome` (en anglais, style existant), en la marquant comme non publiée.

- [ ] **Step 4: Vérification finale complète.** À la racine : `pnpm build && pnpm typecheck && pnpm test`, puis `pnpm --filter demo e2e`. Tout doit être vert. Vérifier enfin par `grep` qu'il ne reste **aucune** recopie : les tracés SVG n'existent qu'une fois (`packages/chrome/src/icons.ts`), et aucune règle `.ibtn`/`.findbar`/`.menu-item` hors de `packages/chrome/src/chrome.css`.

- [ ] **Step 5: Commit** — `docs: le chrome partagé dans la structure du dépôt`

---

## Auto-revue du plan (faite à l'écriture)

- **Couverture spec** : package privé sans build (T1), CSS + icônes + fabriques (T1-T2), les trois renommages id → classe (T2 Step 3), démo consommatrice (T3), playground consommateur (T4), happy-dom (T1), e2e comme filet (T3 Step 6, T5 Step 4), docs (T5). Hors périmètre respecté : aucune tâche ne touche aux assemblages, ne publie le package, ni ne comble les trois manques de design relevés au chantier précédent.
- **Cohérence des types** : les signatures de la section *Interfaces* de T2 sont celles employées en T3 et T4 (`createIconButton({ icon, label, id?, small?, controls?, expanded? })`, `createFindbar` retournant `{ root, input, counter, prev, next }`). `IconName` est défini en T1 et consommé en T2.
- **Placeholders** : aucun. Le seul endroit où le plan ne reproduit pas le code est le déplacement de `chrome.css`, où il cite les plages de lignes de la source — pour un déplacement verbatim, c'est plus sûr que de retaper 200 lignes, qui introduirait des écarts que la revue devrait ensuite retrouver.
- **Risque principal** : le refactor de `index.html` + `chrome.ts`. Le filet est explicite (e2e inchangés) et la contrainte des ids est écrite en tête du plan.
