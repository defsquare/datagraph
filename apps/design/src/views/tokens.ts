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
import { contrastRatio } from "@tokens/contrast.ts";

import { currentTheme, type ThemeState } from "../theme-state.ts";

import "./tokens.css";

/**
 * The « Tokens » view: every value of `packages/tokens/src/index.ts` shown as it
 * is, for the active brand, in BOTH modes at once.
 *
 * Both modes side by side rather than one following the shell's theme: the
 * mistake being hunted here is a token fixed in light that becomes illegible in
 * dark, and one does not see it by toggling — one sees it by comparing.
 *
 * Consequence: the colors displayed are written INLINE from the tokens, never
 * through the CSS variables. The variables only carry the current mode (and
 * only the defsquare palette); using them here would display the shell's theme
 * in place of the token under examination. The variables do remain the sole
 * masters of the view's dressing (`tokens.css`).
 */

const BRANDS: Record<ThemeState["brand"], BrandTokens> = { defsquare, neutral };

/** Fictitious types for the `entityAccentMap` demonstration: seven for six
 * colors. There must be ONE more than the palette holds, otherwise the modulo
 * wraparound — the function's only non-obvious behavior — does not show. */
const DEMO_ENTITY_TYPES = [
  "user",
  "order",
  "product",
  "invoice",
  "shipment",
  "warehouse",
  "supplier",
];

/** Typographic specimen. Pure ASCII: the renderer's BitmapFont atlas is baked on
 * `BitmapFontManager.ASCII`, so a « — » or an « é » would be missing on screen.
 */
const SPECIMEN = "Order #4821 / client_id";

// --- DOM factories.

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

/** A color swatch. The border is indispensable: without it a `#ffffff` on a
 * light background does not exist on screen. */
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

// --- The « Couleurs » section.

/** Flattens `ColorTokens` into `group.key` → hex pairs, in declaration order:
 * that is the source's order, hence the one read back in a diff. */
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

/** The pairs the renderer actually draws: the three inks on the card surface.
 * The other combinations do not exist on screen; scoring them would give
 * numbers nobody has to fix. */
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
  const tag = el("span", `ds-grade ds-grade-${badge === "—" ? "fail" : badge.toLowerCase()}`, badge);

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

// --- The « Chrome » section.

/** The chrome has no per-brand variant: it exists in light and dark only, and
 * it is translucent — hence the checkerboard, the only way to see what "0.82
 * opacity" means. */
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

  // The checkerboard gets the brand's canvas surface as its background:
  // compositing the translucency over anything but the real background would
  // yield a color one will never see in the product.
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

// --- The « Typographie » section.

/** Each role's ink color exactly as `draw.ts` picks it — the specimen must look
 * like the card, not like a neutral sample. */
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

  // DOM column.
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
    // Same ink as the Pixi column: comparing two renderings that differ only by
    // color would pass a weight discrepancy off as a hue one, and weight is
    // what we come to check here.
    sample.style.color = inkFor(role, theme);
    row.append(meta, sample);
    domPanel.append(row);
  }

  // Pixi column: ONE single Application for the whole section — WebGL contexts
  // are a resource the browser rations, and one canvas per role would burn four
  // of them to display four lines of text.
  const pixiPanel = el("div", "typo-panel");
  pixiPanel.append(el("h3", "ds-subtitle", "Canvas (Pixi)"));
  const canvasHost = el("div", "typo-canvas");
  const caption = el("p", "ds-note", "Initialisation du canvas…");
  pixiPanel.append(canvasHost, caption);

  grid.append(domPanel, pixiPanel);
  s.append(grid);

  const app = new Application();
  // A lease on the renderer's shared atlases, exactly like a DataGraph
  // instance: the registry counts them by reference, so `dispose()` only
  // uninstalls if nobody else holds them.
  const lease = pixiFontRegistry.lease();
  let disposed = false;

  void (async () => {
    await app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_PAD * 2 + TEXT_ROLES.length * CANVAS_ROW,
      background: theme.surface.canvas,
      antialias: true,
      // Without these two options the canvas is rendered at 1x then stretched
      // by CSS on a dense screen — the text would look blurry there for a
      // reason that has nothing to do with the tokens under examination.
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    });

    // The unmount may have landed while `init()` was in flight: at that moment
    // `app.renderer` did not exist yet and the cleanup skipped it. Here, and
    // nowhere else, is where it can still be settled.
    if (disposed) {
      // Object form and not `true`: same trap as `RENDERER_DESTROY`, see
      // `pixi-stage.ts` — `true` empties the page's GLOBAL `TexturePool`.
      app.destroy({ removeView: true }, { children: true });
      return;
    }

    // Same guard as `create.ts`: under Pixi v8's software canvas renderer,
    // BitmapText does not rasterize and would leave the panel empty. We fall
    // back to Text, and we SAY so — a specimen silently rendered through a path
    // other than the product's would be false testimony.
    const useBitmap = app.renderer.name !== "canvas";
    caption.textContent = useBitmap
      ? "BitmapText sur les atlas installés par le registre de polices du renderer."
      : "Repli Text : ce navigateur n'expose ni WebGL ni WebGPU, BitmapText y resterait vide.";

    if (useBitmap) lease.sync(theme);

    TEXT_ROLES.forEach((role, index) => {
      const y = CANVAS_PAD + index * CANVAS_ROW;

      // The role's name is written in the `badge` atlas: it is the smallest of
      // the four, and it is installed by the lease anyway.
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
    // A renderer init that fails (WebGL off, context refused) would otherwise
    // leave the caption stuck on "Initialisation…" and the reason in an
    // unhandled rejection. The failure reads here, where the panel is missing.
    caption.textContent = `Le canvas Pixi n'a pas pu s'initialiser : ${String(error)}`;
  });

  return {
    node: s,
    dispose(): void {
      disposed = true;
      // Before `app.destroy`: releasing the atlases does not depend on the
      // renderer, and it must happen even if `init()` never completed.
      lease.dispose();
      // Object form and not `true`: same trap as `RENDERER_DESTROY`, see
      // `pixi-stage.ts` — `true` empties the page's GLOBAL `TexturePool`.
      if (app.renderer) app.destroy({ removeView: true }, { children: true });
    },
  };
}

/** A local replica of `draw.ts`'s `createLabel` (which is not exported). The
 * atlas name derives from the theme alone, hence the call to `fontNameFor`:
 * that is what guarantees we read here the atlas the lease has just installed,
 * and not a namesake from another theme. */
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

// --- The « Échelles » section.

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

// --- The « Palette d'entités » section.

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

// --- Mounting.

/**
 * Mounts the view. Conforms to `PlaygroundView.mount`'s contract: `root` is
 * empty and ours, the return unmounts. The shell remounts the whole view on
 * every theme change, so no subscription here — the state arrives as an
 * argument and the view is a pure function of it.
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
