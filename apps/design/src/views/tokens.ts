import { Application, BitmapText, Text } from "pixi.js";

import { fontNameFor, pixiFontRegistry, TEXT_ROLES, type TextRole } from "@renderer/font-registry.ts";
import { entityAccentMap, type Theme } from "@renderer/theme.ts";
import {
  chrome,
  cssFontStack,
  defsquare,
  neutral,
  radii,
  spacing,
  strokes,
  typography,
  type BrandTokens,
  type ChromeTokens,
  type ColorTokens,
} from "@tokens/index.ts";

import { contrastRatio } from "../contrast.ts";
import { currentTheme, type ThemeState } from "../theme-state.ts";

import "./tokens.css";

/**
 * La vue « Tokens » : chaque valeur de `packages/tokens/src/index.ts` montrée
 * telle qu'elle est, pour la marque active, dans les DEUX modes à la fois.
 *
 * Les deux modes côte à côte plutôt qu'un seul suivant le thème du shell :
 * l'erreur qu'on cherche ici est celle d'un token corrigé en clair qui devient
 * illisible en sombre, et on ne la voit pas en basculant — on la voit en
 * comparant.
 *
 * Conséquence : les couleurs affichées sont écrites en style INLINE depuis les
 * tokens, jamais via les variables CSS. Les variables ne portent que le mode
 * courant (et que la palette defsquare) ; s'en servir ici afficherait le thème
 * du shell à la place du token examiné. Les variables restent en revanche
 * seules maîtresses de l'habillage de la vue (`tokens.css`).
 */

const BRANDS: Record<ThemeState["brand"], BrandTokens> = { defsquare, neutral };

/** Types fictifs de la démonstration d'`entityAccentMap` : sept pour six
 * couleurs. Il en faut UN de plus que la palette, sinon le rebouclage par
 * modulo — le seul comportement non évident de la fonction — ne se voit pas. */
const DEMO_ENTITY_TYPES = [
  "user",
  "order",
  "product",
  "invoice",
  "shipment",
  "warehouse",
  "supplier",
];

/** Spécimen typographique. ASCII pur : l'atlas BitmapFont du renderer est cuit
 * sur `BitmapFontManager.ASCII`, un « — » ou un « é » y manquerait à l'écran. */
const SPECIMEN = "Order #4821 / client_id";

// --- Fabriques DOM.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, note?: string): HTMLElement {
  const s = el("section", "ds-section");
  s.append(el("h2", "ds-section-title", title));
  if (note) s.append(el("p", "ds-note", note));
  return s;
}

/** Pastille de couleur. La bordure est indispensable : sans elle un `#ffffff`
 * sur fond clair n'existe pas à l'écran. */
function swatch(color: string, extraClass?: string): HTMLElement {
  const s = el("span", extraClass ? `swatch ${extraClass}` : "swatch");
  s.style.background = color;
  return s;
}

function cell(...children: (Node | string)[]): HTMLTableCellElement {
  const td = el("td");
  td.append(...children);
  return td;
}

function headerRow(labels: readonly (readonly [string, number])[]): HTMLTableRowElement {
  const tr = el("tr");
  for (const [label, span] of labels) {
    const th = el("th", undefined, label);
    if (span > 1) th.colSpan = span;
    tr.append(th);
  }
  return tr;
}

// --- Section « Couleurs ».

/** Aplatit `ColorTokens` en paires `groupe.clé` → hex, dans l'ordre de
 * déclaration : c'est l'ordre de la source, donc celui qu'on relit en diff. */
function colorEntries(colors: ColorTokens): [string, string][] {
  return Object.entries(colors).flatMap(([group, values]) =>
    Object.entries(values as Record<string, string>).map(
      ([key, hex]) => [`${group}.${key}`, hex] as [string, string],
    ),
  );
}

function colorsSection(brand: BrandTokens): HTMLElement {
  const s = section(
    "Couleurs",
    "Les quatre groupes de ColorTokens, clair et sombre côte à côte. La valeur affichée est celle de la source, pas celle du thème du shell.",
  );

  const table = el("table", "ds-table");
  const thead = el("thead");
  thead.append(headerRow([["Token", 1], ["Clair", 2], ["Sombre", 2]]));
  table.append(thead);

  const tbody = el("tbody");
  const dark = new Map(colorEntries(brand.dark));
  let currentGroup = "";

  for (const [name, lightHex] of colorEntries(brand.light)) {
    const group = name.split(".")[0]!;
    if (group !== currentGroup) {
      currentGroup = group;
      const tr = el("tr", "group-row");
      const th = el("th", undefined, group);
      th.colSpan = 5;
      tr.append(th);
      tbody.append(tr);
    }

    const darkHex = dark.get(name) ?? lightHex;
    const tr = el("tr");
    tr.append(
      cell(el("code", "token-name", name)),
      cell(swatch(lightHex)),
      cell(el("code", "hex", lightHex)),
      cell(swatch(darkHex)),
      cell(el("code", "hex", darkHex)),
    );
    tbody.append(tr);
  }

  table.append(tbody);
  s.append(table);
  s.append(contrastTable(brand));
  return s;
}

/** Les paires réellement dessinées par le renderer : les trois encres sur la
 * surface des cartes. Les autres combinaisons n'existent pas à l'écran, les
 * noter donnerait des chiffres que personne n'a à corriger. */
const CONTRAST_PAIRS: readonly (keyof ColorTokens["ink"])[] = ["primary", "muted", "subtle"];

function grade(ratio: number): string {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  return "—";
}

function contrastCells(colors: ColorTokens, ink: keyof ColorTokens["ink"]): HTMLTableCellElement[] {
  const fg = colors.ink[ink];
  const bg = colors.surface.card;
  const ratio = contrastRatio(fg, bg);
  const badge = grade(ratio);

  const preview = el("span", "contrast-preview", "Aa");
  preview.style.color = fg;
  preview.style.background = bg;

  const score = el("span", "ratio", ratio.toFixed(2));
  const tag = el("span", `badge badge-${badge === "—" ? "fail" : badge.toLowerCase()}`, badge);

  return [cell(preview), cell(score, tag)];
}

function contrastTable(brand: BrandTokens): HTMLElement {
  const wrap = el("div", "subsection");
  wrap.append(el("h3", "ds-subtitle", "Contraste encre / surface.card"));
  wrap.append(
    el(
      "p",
      "ds-note",
      "Ratio WCAG 2.x. AA exige 4,5 pour du texte courant, AAA 7. Le tiret marque une paire qui ne passe pas — ce qui reste acceptable pour ink.subtle, réservé aux mentions secondaires.",
    ),
  );

  const table = el("table", "ds-table");
  const thead = el("thead");
  thead.append(headerRow([["Paire", 1], ["Clair", 2], ["Sombre", 2]]));
  table.append(thead);

  const tbody = el("tbody");
  for (const ink of CONTRAST_PAIRS) {
    const tr = el("tr");
    tr.append(
      cell(el("code", "token-name", `ink.${ink} sur surface.card`)),
      ...contrastCells(brand.light, ink),
      ...contrastCells(brand.dark, ink),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

// --- Section « Chrome ».

/** Le chrome n'a pas de variante par marque : il n'existe qu'en clair et en
 * sombre, et il est translucide — d'où le damier, qui est le seul moyen de
 * voir ce que « 0.82 d'opacité » veut dire. */
function chromeSection(brand: BrandTokens): HTMLElement {
  const s = section(
    "Chrome",
    "Tokens du shell DOM uniquement : translucidité et ombres, notions que le canvas Pixi ne connaît pas. Posés sur un damier pour rendre l'opacité lisible.",
  );

  const grid = el("div", "chrome-grid");
  for (const mode of ["light", "dark"] as const) {
    grid.append(chromePanel(mode, chrome[mode], brand[mode].surface.canvas));
  }
  s.append(grid);
  return s;
}

function chromePanel(
  mode: "light" | "dark",
  ui: ChromeTokens,
  canvas: string,
): HTMLElement {
  const panel = el("div", "chrome-panel");
  panel.append(el("h3", "ds-subtitle", mode === "light" ? "Clair" : "Sombre"));

  // Le damier reçoit en fond la surface de canvas de la marque : composer la
  // translucidité sur autre chose que le fond réel donnerait une couleur qu'on
  // ne verra jamais dans le produit.
  const checker = el("div", "checker");
  checker.style.backgroundColor = canvas;

  const float = el("div", "float-card");
  float.style.background = ui.float.bg;
  float.style.border = `1px solid ${ui.float.border}`;
  float.style.boxShadow = ui.shadow;
  float.style.color = ui.fg;
  float.append(el("span", "float-title", "float.bg + float.border + shadow"));

  const hover = el("div", "float-hover-strip", "float.hover");
  hover.style.background = ui.float.hover;
  hover.style.color = ui.fg;
  float.append(hover);

  checker.append(float);
  panel.append(checker);

  const list = el("dl", "value-list");
  for (const [name, value] of [
    ["fg", ui.fg],
    ["float.bg", ui.float.bg],
    ["float.border", ui.float.border],
    ["float.hover", ui.float.hover],
    ["shadow", ui.shadow],
  ] as const) {
    list.append(el("dt", "token-name", name), el("dd", "hex", value));
  }
  panel.append(list);
  return panel;
}

// --- Section « Typographie ».

/** Couleur d'encre de chaque rôle telle que `draw.ts` la choisit — le spécimen
 * doit ressembler à la carte, pas à un échantillon neutre. */
function inkFor(role: TextRole, theme: Theme): string {
  switch (role) {
    case "header":
      return theme.ink.primary;
    case "badge":
      return theme.accent.entity;
    case "key":
      return theme.ink.muted;
    case "value":
      return theme.ink.primary;
  }
}

const CANVAS_WIDTH = 460;
const CANVAS_PAD = 12;
const CANVAS_ROW = 46;

interface TypographySection {
  node: HTMLElement;
  dispose: () => void;
}

function typographySection(brand: BrandTokens, state: ThemeState): TypographySection {
  const s = section(
    "Typographie",
    "À gauche le spécimen DOM, à droite le même texte rendu par Pixi dans l'atlas BitmapFont du renderer. C'est la seconde qui fait foi pour le canvas : elle est mesurée puis cuite à la police réelle, et diverge du DOM dès qu'une famille manque.",
  );

  const grid = el("div", "typo-grid");
  const theme = currentTheme(state);

  // Colonne DOM.
  const domPanel = el("div", "typo-panel");
  domPanel.append(el("h3", "ds-subtitle", "DOM"));
  for (const role of TEXT_ROLES) {
    const style = typography[role];
    const row = el("div", "typo-row");
    const meta = el(
      "div",
      "typo-meta",
      `${role} · ${style.family} · ${style.size}px · ${style.weight}${
        style.tracking ? ` · tracking ${style.tracking}em` : ""
      }`,
    );
    const sample = el("div", "typo-sample", SPECIMEN);
    sample.style.fontFamily = cssFontStack(brand.fonts[style.family]);
    sample.style.fontSize = `${style.size}px`;
    sample.style.fontWeight = String(style.weight);
    if (style.tracking) sample.style.letterSpacing = `${style.tracking}em`;
    // Même encre que la colonne Pixi : comparer deux rendus qui ne diffèrent
    // que par la couleur ferait passer un écart de graisse pour un écart de
    // teinte, et c'est la graisse qu'on vient vérifier ici.
    sample.style.color = inkFor(role, theme);
    row.append(meta, sample);
    domPanel.append(row);
  }

  // Colonne Pixi : UNE seule Application pour toute la section — les contextes
  // WebGL sont une ressource comptée par le navigateur, et un canvas par rôle
  // en brûlerait quatre pour afficher quatre lignes de texte.
  const pixiPanel = el("div", "typo-panel");
  pixiPanel.append(el("h3", "ds-subtitle", "Canvas (Pixi)"));
  const canvasHost = el("div", "typo-canvas");
  const caption = el("p", "ds-note", "Initialisation du canvas…");
  pixiPanel.append(canvasHost, caption);

  grid.append(domPanel, pixiPanel);
  s.append(grid);

  const app = new Application();
  // Bail sur les atlas partagés du renderer, exactement comme une instance de
  // DataGraph : le registre les compte par référence, donc `dispose()` ne
  // désinstalle que si personne d'autre ne les porte.
  const lease = pixiFontRegistry.lease();
  let disposed = false;

  void (async () => {
    await app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_PAD * 2 + TEXT_ROLES.length * CANVAS_ROW,
      background: theme.surface.canvas,
      antialias: true,
      // Sans ces deux options le canvas est rendu en 1x puis étiré par le CSS
      // sur un écran dense — le texte y paraîtrait flou pour une raison qui
      // n'a rien à voir avec les tokens examinés.
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    });

    // Le démontage a pu tomber pendant que `init()` était en vol : à ce
    // moment `app.renderer` n'existait pas encore et le cleanup l'a sauté.
    // C'est ici, et nulle part ailleurs, qu'on peut encore le solder.
    if (disposed) {
      app.destroy(true, { children: true });
      return;
    }

    // Même garde que `create.ts` : sous le renderer canvas logiciel de Pixi
    // v8, BitmapText ne se rastérise pas et laisserait le panneau vide. On
    // replie sur Text, et on le DIT — un spécimen silencieusement rendu par
    // un autre chemin que celui du produit serait un faux témoignage.
    const useBitmap = app.renderer.name !== "canvas";
    caption.textContent = useBitmap
      ? "BitmapText sur les atlas installés par le registre de polices du renderer."
      : "Repli Text : ce navigateur n'expose ni WebGL ni WebGPU, BitmapText y resterait vide.";

    if (useBitmap) lease.sync(theme);

    TEXT_ROLES.forEach((role, index) => {
      const y = CANVAS_PAD + index * CANVAS_ROW;

      // Le nom du rôle est écrit dans l'atlas `badge` : c'est le plus petit
      // des quatre, et il est de toute façon installé par le bail.
      const tag = makeLabel(theme, role, "badge", theme.ink.subtle, useBitmap);
      tag.x = CANVAS_PAD;
      tag.y = y;

      const sample = makeLabel(theme, SPECIMEN, role, inkFor(role, theme), useBitmap);
      sample.x = CANVAS_PAD;
      sample.y = y + 14;

      app.stage.addChild(tag, sample);
    });

    canvasHost.append(app.canvas);
  })().catch((error: unknown) => {
    // Une init de renderer qui échoue (WebGL coupé, contexte refusé) laisserait
    // sinon la légende bloquée sur « Initialisation… » et la raison dans une
    // rejection non gérée. La panne se lit ici, à l'endroit du panneau manquant.
    caption.textContent = `Le canvas Pixi n'a pas pu s'initialiser : ${String(error)}`;
  });

  return {
    node: s,
    dispose(): void {
      disposed = true;
      // Avant `app.destroy` : la libération des atlas ne dépend pas du
      // renderer, et elle doit avoir lieu même si `init()` n'a jamais abouti.
      lease.dispose();
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}

/** Réplique locale de `createLabel` de `draw.ts` (qui n'est pas exporté). Le
 * nom d'atlas se dérive du thème seul, d'où l'appel à `fontNameFor` : c'est ce
 * qui garantit qu'on lit ici l'atlas que le bail vient d'installer, et pas un
 * homonyme d'un autre thème. */
function makeLabel(
  theme: Theme,
  text: string,
  role: TextRole,
  color: string,
  useBitmap: boolean,
): BitmapText | Text {
  const style = theme.typography[role];
  if (useBitmap) {
    const t = new BitmapText({
      text,
      style: { fontFamily: fontNameFor(theme, role), fontSize: style.size },
    });
    t.tint = color;
    return t;
  }
  return new Text({
    text,
    style: {
      fontFamily: theme.fonts[style.family],
      fontSize: style.size,
      fontWeight: String(style.weight) as never,
      letterSpacing: (style.tracking ?? 0) * style.size,
      fill: color,
    },
  });
}

// --- Section « Échelles ».

function scalesSection(): HTMLElement {
  const s = section(
    "Échelles",
    "Espacements, rayons et épaisseurs de trait, dessinés à leur taille réelle en pixels — c'est la seule façon de voir qu'un échelon manque ou qu'un autre fait doublon.",
  );

  const grid = el("div", "scale-grid");

  const spacingBlock = el("div", "scale-block");
  spacingBlock.append(el("h3", "ds-subtitle", "spacing"));
  for (const [key, value] of Object.entries(spacing)) {
    const row = el("div", "scale-row");
    const bar = el("span", "scale-bar");
    bar.style.width = `${value}px`;
    row.append(el("code", "token-name", `space-${key}`), bar, el("code", "hex", `${value}px`));
    spacingBlock.append(row);
  }

  const radiiBlock = el("div", "scale-block");
  radiiBlock.append(el("h3", "ds-subtitle", "radii"));
  const radiiRow = el("div", "radii-row");
  for (const [key, value] of Object.entries(radii)) {
    const item = el("div", "radius-item");
    const box = el("span", "radius-box");
    box.style.borderRadius = `${value}px`;
    item.append(box, el("code", "token-name", key), el("code", "hex", `${value}px`));
    radiiRow.append(item);
  }
  radiiBlock.append(radiiRow);

  const strokesBlock = el("div", "scale-block");
  strokesBlock.append(el("h3", "ds-subtitle", "strokes"));
  for (const [key, value] of Object.entries(strokes)) {
    const row = el("div", "scale-row");
    const line = el("span", "stroke-line");
    line.style.height = `${value}px`;
    row.append(el("code", "token-name", key), line, el("code", "hex", `${value}px`));
    strokesBlock.append(row);
  }

  grid.append(spacingBlock, radiiBlock, strokesBlock);
  s.append(grid);
  return s;
}

// --- Section « Palette d'entités ».

function entitySection(brand: BrandTokens, state: ThemeState): HTMLElement {
  const s = section(
    "Palette d'entités",
    "Les couleurs de rail, assignées par ORDRE DE DÉCLARATION des types d'entité — pas par ordre d'apparition dans les données, pour qu'un même jeu de données garde les mêmes couleurs d'une exécution à l'autre.",
  );

  const chips = el("div", "chip-row");
  brand.entityPalette.forEach((color, index) => {
    const chip = el("div", "chip");
    chip.append(swatch(color, "swatch-round"), el("code", "hex", color));
    chip.append(el("code", "token-name", `[${index}]`));
    chips.append(chip);
  });
  s.append(chips);

  const wrap = el("div", "subsection");
  wrap.append(el("h3", "ds-subtitle", "entityAccentMap()"));
  wrap.append(
    el(
      "p",
      "ds-note",
      `Sept types fictifs pour ${brand.entityPalette.length} couleurs : au-delà, l'index reboucle par modulo et deux types partagent une teinte. C'est le moment où il faut soit étendre la palette, soit poser un byEntityType.`,
    ),
  );

  const assigned = entityAccentMap([...DEMO_ENTITY_TYPES], currentTheme(state));
  const table = el("table", "ds-table");
  const thead = el("thead");
  thead.append(headerRow([["Index", 1], ["Type", 1], ["Couleur", 2], ["Origine", 1]]));
  table.append(thead);

  const tbody = el("tbody");
  const size = brand.entityPalette.length;
  DEMO_ENTITY_TYPES.forEach((type, index) => {
    const color = assigned.get(type) ?? "";
    const wrapped = index >= size;
    const tr = el("tr", wrapped ? "wrapped-row" : undefined);
    tr.append(
      cell(el("code", "token-name", String(index))),
      cell(el("code", "token-name", type)),
      cell(swatch(color, "swatch-round")),
      cell(el("code", "hex", color)),
      cell(
        el(
          "code",
          "hex",
          `entityPalette[${index % size}]${wrapped ? ` ← ${index} % ${size}` : ""}`,
        ),
      ),
    );
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  s.append(wrap);
  return s;
}

// --- Montage.

/**
 * Monte la vue. Conforme au contrat de `PlaygroundView.mount` : `root` est vide
 * et nous appartient, le retour démonte. Le shell remonte la vue entière à
 * chaque changement de thème, donc aucun abonnement ici — l'état arrive en
 * argument et la vue en est une pure fonction.
 */
export function mountTokensView(root: HTMLElement, state: ThemeState): () => void {
  const brand = BRANDS[state.brand];

  const page = el("div", "tokens-view");
  page.append(colorsSection(brand));
  page.append(chromeSection(brand));

  const typo = typographySection(brand, state);
  page.append(typo.node);

  page.append(scalesSection());
  page.append(entitySection(brand, state));

  root.append(page);

  return () => {
    typo.dispose();
    page.remove();
  };
}
