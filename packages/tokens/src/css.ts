/**
 * Rendu des tokens en variables CSS, pour le shell DOM de la démo.
 *
 * Ce module est délibérément HORS de l'index : l'index reste de la donnée pure,
 * consommable par le renderer Pixi qui n'a que faire d'une chaîne CSS. Il est
 * exposé par l'export `"./css"` du package.
 *
 * La sortie est la reprise à l'octet près des blocs `:root` et
 * `html[data-theme="dark"]` que `apps/demo/src/style.css` portait en dur : le
 * branchement des tokens ne doit rien changer au rendu de la démo. Toute
 * différence de valeur, d'ordre ou de formatage se verrait — c'est justement ce
 * que le test de fraîcheur du fichier généré surveille.
 */

import {
  type ChromeTokens,
  type ColorTokens,
  chrome,
  cssFontStack,
  defsquare,
  motion,
  radii,
  spacing,
} from "./index.js";

/** Une déclaration au format historique : deux espaces d'indentation. */
function decl(name: string, value: string): string {
  return `  --${name}: ${value};`;
}

/**
 * Couleurs d'un thème. `--ds-accent` est optionnel parce que la feuille
 * historique ne le déclare que dans `:root` : la valeur de sélection est
 * identique dans les deux thèmes, le bloc sombre n'a donc rien à redire.
 */
function colorDecls(colors: ColorTokens, ui: ChromeTokens, withAccent: boolean): string[] {
  return [
    decl("ds-canvas", colors.surface.canvas),
    decl("ds-surface", colors.surface.card),
    decl("ds-surface-muted", colors.surface.cardMuted),
    decl("ds-ink", colors.ink.primary),
    // `--ds-fg` vient du chrome et non de l'encre : le texte du shell est plus
    // contrasté que celui des cartes du canvas.
    decl("ds-fg", ui.fg),
    decl("ds-muted", colors.ink.muted),
    decl("ds-subtle", colors.ink.subtle),
    ...(withAccent ? [decl("ds-accent", colors.accent.selection)] : []),
    decl("ds-primary", colors.accent.entity),
    decl("ds-border", colors.edge.border),
    decl("ds-border-soft", colors.edge.hairline),
  ];
}

/** Commentaire d'intention repris de la feuille historique. */
const FLOAT_INTENT = `  /* Surfaces flottantes : translucides pour que le graphe transparaisse, mais
     assez opaques pour rester lisibles au-dessus d'une carte dense. */`;

function floatDecls(ui: ChromeTokens): string[] {
  return [
    decl("float-bg", ui.float.bg),
    decl("float-border", ui.float.border),
    decl("float-hover", ui.float.hover),
    decl("shadow-float", ui.shadow),
  ];
}

/** Échelle numérique en px : `radii` et `spacing` sont exprimés en pixels nus. */
function scaleDecls(prefix: string, scale: Record<string, number>): string[] {
  return Object.entries(scale).map(([key, value]) => decl(`${prefix}-${key}`, `${value}px`));
}

function fontDecls(fonts: typeof defsquare.fonts): string[] {
  return [
    ...(fonts.title ? [decl("font-title", cssFontStack(fonts.title))] : []),
    decl("font-body", cssFontStack(fonts.body)),
    decl("font-mono", cssFontStack(fonts.mono)),
  ];
}

/** Les groupes sont séparés par une ligne vide, comme dans la feuille d'origine. */
function block(selector: string, groups: string[][]): string {
  return `${selector} {\n${groups.map((g) => g.join("\n")).join("\n\n")}\n}`;
}

const HEADER = `/* GÉNÉRÉ par @defsquare/data-graph-tokens — NE PAS ÉDITER À LA MAIN.
   Régénérer : pnpm --filter @defsquare/data-graph-tokens generate:css
   Un test de fraîcheur (packages/tokens/test/css.test.ts) casse si ce fichier
   diverge de la source des tokens. */`;

/** Feuille complète des variables CSS du shell, en-tête « généré » comprise. */
export function renderTokensCss(): string {
  // `radii.card` est le rayon des cartes dessinées par Pixi : le DOM ne
  // l'utilise pas, et l'exposer ici inventerait une variable que la feuille
  // historique n'a jamais eue.
  const { card: _card, ...domRadii } = radii;

  const root = block(":root", [
    colorDecls(defsquare.light, chrome.light, true),
    [FLOAT_INTENT, ...floatDecls(chrome.light)],
    scaleDecls("radius", domRadii),
    scaleDecls("space", spacing),
    [decl("transition", motion.transition), decl("ease-out", motion.easeOut)],
    fontDecls(defsquare.fonts),
  ]);

  // Le thème sombre ne surcharge que ce qui change : les échelles, la motion et
  // les polices sont héritées de `:root`.
  const dark = block('html[data-theme="dark"]', [
    colorDecls(defsquare.dark, chrome.dark, false),
    floatDecls(chrome.dark),
  ]);

  return `${[HEADER, root, dark].join("\n\n")}\n`;
}
