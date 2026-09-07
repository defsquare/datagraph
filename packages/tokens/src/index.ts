/**
 * Source de vérité unique des tokens de design de data-graph.
 *
 * Les mêmes valeurs alimentent deux sorties qui, jusqu'ici, les dupliquaient
 * chacune de son côté : les thèmes Pixi de `packages/renderer/src/theme.ts` et
 * les variables CSS du shell de la démo. Un token corrigé ici doit se voir
 * partout ; c'est la raison d'être du package, et pourquoi il ne dépend de
 * rien (ni DOM, ni Pixi) et reste importable depuis un script Node.
 *
 * Les NOMS de familles de polices sont contractuels : les `@font-face` de la
 * démo et la mesure des BitmapFont du renderer les référencent par ce nom
 * exact. Les renommer casse silencieusement le rendu (repli sur la police
 * système) — donc on ne les touche pas sans toucher aussi les deux consommateurs.
 */

/** Pile de polices, du plus spécifique au repli générique. */
export type FontStack = readonly string[];

export interface ColorTokens {
  surface: { canvas: string; card: string; cardMuted: string };
  ink: { primary: string; muted: string; subtle: string };
  accent: {
    /** Rail de repli quand `entityPalette` est vide. */
    entity: string;
    selection: string;
    match: string;
    matchStroke: string;
  };
  edge: {
    contain: string;
    ref: string;
    dangling: string;
    hairline: string;
    border: string;
  };
}

export interface BrandTokens {
  /** `title` est propre au shell DOM : le canvas Pixi n'en dessine jamais. */
  fonts: { title?: FontStack; body: FontStack; mono: FontStack };
  /** Couleurs de rail, assignées par ordre de déclaration des types d'entité. */
  entityPalette: readonly string[];
  light: ColorTokens;
  dark: ColorTokens;
}

const DEFSQUARE_FONTS: BrandTokens["fonts"] = {
  title: ["EB Garamond", "Garamond", "Cambria", "Georgia", "serif"],
  body: ["IBM Plex Sans Condensed", "IBM Plex Sans", "system-ui", "sans-serif"],
  mono: ["Fira Code", "SF Mono", "Menlo", "Consolas", "monospace"],
};

// Commune aux thèmes clair et sombre : ces couleurs ne servent qu'en rail de
// 3px et en pastille, elles tiennent donc sur fond clair comme sombre.
const DEFSQUARE_PALETTE = [
  "#1e416e", // --color-primary-400
  "#f65e5e", // --color-accent
  "#3dbf9e", // --color-mint
  "#8d7e63", // --color-beige-deep
  "#3573c3", // --color-primary-600
  "#a0427a", // fin de --gradient-heat
] as const;

export const defsquare: BrandTokens = {
  fonts: DEFSQUARE_FONTS,
  entityPalette: DEFSQUARE_PALETTE,
  light: {
    surface: { canvas: "#eef0f3", card: "#ffffff", cardMuted: "#f7f7f8" },
    ink: { primary: "#172741", muted: "#4b5563", subtle: "#9ca3af" },
    accent: {
      entity: "#1e416e",
      selection: "#f65e5e",
      match: "#ede2cf",
      matchStroke: "#8d7e63",
    },
    edge: {
      contain: "#c7cdd6",
      ref: "#2a5a98",
      dangling: "#d97706",
      hairline: "#f1f1f3",
      border: "#dfe3e9",
    },
  },
  dark: {
    surface: { canvas: "#161a2c", card: "#1e2335", cardMuted: "#1a1f30" },
    ink: { primary: "#f0f5fc", muted: "#9bb2d9", subtle: "#6b7794" },
    accent: {
      entity: "#3573c3",
      selection: "#f65e5e",
      match: "#3a3323",
      matchStroke: "#e2ca9e",
    },
    edge: {
      contain: "#3a4159",
      ref: "#3573c3",
      dangling: "#e0932e",
      hairline: "#272d42",
      border: "#2c3247",
    },
  },
};

const NEUTRAL_FONTS: BrandTokens["fonts"] = {
  body: ["system-ui", "sans-serif"],
  mono: ["monospace"],
};

const NEUTRAL_PALETTE = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#0891b2", "#be123c"] as const;

/** Marque de repli, sans dépendance aux polices ni aux couleurs defsquare. */
export const neutral: BrandTokens = {
  fonts: NEUTRAL_FONTS,
  entityPalette: NEUTRAL_PALETTE,
  light: {
    surface: { canvas: "#f4f4f5", card: "#ffffff", cardMuted: "#fafafa" },
    ink: { primary: "#18181b", muted: "#52525b", subtle: "#a1a1aa" },
    accent: {
      entity: "#2563eb",
      selection: "#2563eb",
      match: "#fef9c3",
      matchStroke: "#a16207",
    },
    edge: {
      contain: "#d4d4d8",
      ref: "#7c3aed",
      dangling: "#dc2626",
      hairline: "#f4f4f5",
      border: "#e4e4e7",
    },
  },
  dark: {
    surface: { canvas: "#18181b", card: "#27272a", cardMuted: "#212124" },
    ink: { primary: "#fafafa", muted: "#a1a1aa", subtle: "#71717a" },
    accent: {
      entity: "#60a5fa",
      selection: "#60a5fa",
      match: "#422006",
      matchStroke: "#ca8a04",
    },
    edge: {
      contain: "#52525b",
      ref: "#a78bfa",
      dangling: "#f87171",
      hairline: "#3f3f46",
      border: "#3f3f46",
    },
  },
};

export interface TypeStyleToken {
  family: "body" | "mono";
  size: number;
  weight: number;
  /** Interlettrage en em. Absent = 0. */
  tracking?: number;
}

export const typography: Record<"header" | "badge" | "key" | "value", TypeStyleToken> = {
  header: { family: "body", size: 13, weight: 600 },
  badge: { family: "body", size: 9.5, weight: 600, tracking: 0.08 },
  key: { family: "body", size: 12, weight: 400 },
  value: { family: "mono", size: 12, weight: 400 },
};

/** Rayons en px. `card` est celui des cartes du canvas, aligné sur `md`. */
export const radii = { sm: 4, md: 6, lg: 10, full: 9999, card: 6 };

/** Échelle d'espacement en px, indexée par pas de 4. */
export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 };

/** Épaisseurs de trait en px, telles que le renderer les dessine. */
export const strokes = { border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 };

/** Valeurs CSS brutes : seul le shell DOM anime, le canvas redessine. */
export const motion = {
  transition: "150ms ease-in-out",
  easeOut: "cubic-bezier(0.2, 0.8, 0.25, 1)",
};

export interface ChromeTokens {
  fg: string;
  /** Surfaces flottantes translucides posées au-dessus du canvas. */
  float: { bg: string; border: string; hover: string };
  shadow: string;
}

/**
 * Tokens du shell : ils n'existent que dans le DOM (translucidité, ombres),
 * notions que le canvas Pixi ne connaît pas et ne verra jamais.
 */
export const chrome: { light: ChromeTokens; dark: ChromeTokens } = {
  light: {
    fg: "#070f19",
    float: {
      bg: "rgb(255 255 255 / 0.82)",
      border: "rgb(23 39 65 / 0.1)",
      hover: "rgb(23 39 65 / 0.06)",
    },
    shadow: "0 1px 2px rgb(15 23 42 / 0.06), 0 10px 28px -10px rgb(15 23 42 / 0.22)",
  },
  dark: {
    fg: "#f0f5fc",
    float: {
      bg: "rgb(30 35 53 / 0.82)",
      border: "rgb(240 245 252 / 0.1)",
      hover: "rgb(240 245 252 / 0.08)",
    },
    shadow: "0 1px 2px rgb(0 0 0 / 0.35), 0 12px 30px -10px rgb(0 0 0 / 0.6)",
  },
};

/**
 * Pile pour Pixi : `fontFamily` y est parsé maison, les guillemets CSS y
 * feraient partie du nom cherché et rateraient la police.
 */
export function pixiFontStack(stack: FontStack): string {
  return stack.join(", ");
}

/** Pile pour CSS : un nom à espaces doit être cité pour rester une seule famille. */
export function cssFontStack(stack: FontStack): string {
  return stack.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(", ");
}
