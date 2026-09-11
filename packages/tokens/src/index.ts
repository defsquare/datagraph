/**
 * The single source of truth for data-graph's design tokens.
 *
 * The same values feed two outputs that, until now, each duplicated them on
 * their own side: the Pixi themes of `packages/renderer/src/theme.ts` and the
 * CSS variables of the demo's shell. A token fixed here must show up
 * everywhere; that is the package's reason to exist, and why it depends on
 * nothing (no DOM, no Pixi) and stays importable from a Node script.
 *
 * Font family NAMES are contractual: the demo's `@font-face` rules and the
 * renderer's BitmapFont measuring reference them by that exact name. Renaming
 * them breaks rendering silently (fallback to the system font) — so we do not
 * touch them without touching both consumers as well.
 */

/** A font stack, from the most specific down to the generic fallback. */
export type FontStack = readonly string[];

export interface ColorTokens {
  surface: { canvas: string; card: string; cardMuted: string };
  ink: { primary: string; muted: string; subtle: string };
  accent: {
    /** Fallback rail when `entityPalette` is empty. */
    entity: string;
    selection: string;
    match: string;
    matchStroke: string;
    /** The CURRENT search result. Deliberately not `selection`: the two are
     * different notions, and one colour for both made a found card look
     * selected. Not `edge.dangling` either — amber already means "broken". */
    matchCurrent: string;
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
  /** `title` belongs to the DOM shell alone: the Pixi canvas never draws any. */
  fonts: { title?: FontStack; body: FontStack; mono: FontStack };
  /** Rail colors, assigned in declaration order of the entity types. */
  entityPalette: readonly string[];
  light: ColorTokens;
  dark: ColorTokens;
}

const DEFSQUARE_FONTS: BrandTokens["fonts"] = {
  title: ["EB Garamond", "Garamond", "Cambria", "Georgia", "serif"],
  body: ["IBM Plex Sans Condensed", "IBM Plex Sans", "system-ui", "sans-serif"],
  mono: ["Fira Code", "SF Mono", "Menlo", "Consolas", "monospace"],
};

// Shared by the light and dark themes: these colors only ever serve as a 3px
// rail or a badge, so they hold up on a light background as on a dark one.
const DEFSQUARE_PALETTE = [
  "#1e416e", // --color-primary-400
  "#f65e5e", // --color-accent
  "#3dbf9e", // --color-mint
  "#8d7e63", // --color-beige-deep
  "#3573c3", // --color-primary-600
  "#a0427a", // end of --gradient-heat
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
      matchCurrent: "#1f7a66",
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
      matchCurrent: "#5fd7bb",
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

/** Fallback brand, with no dependency on the defsquare fonts or colors. */
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
      matchCurrent: "#0f766e",
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
      matchCurrent: "#5eead4",
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
  /** Letter spacing in em. Absent = 0. */
  tracking?: number;
}

export const typography: Record<"header" | "badge" | "key" | "value", TypeStyleToken> = {
  header: { family: "body", size: 13, weight: 600 },
  badge: { family: "body", size: 9.5, weight: 600, tracking: 0.08 },
  key: { family: "body", size: 12, weight: 400 },
  value: { family: "mono", size: 12, weight: 400 },
};

/** Radii in px. `card` is the canvas cards' radius, aligned on `md`. */
export const radii = { sm: 4, md: 6, lg: 10, full: 9999, card: 6 };

/** Spacing scale in px, indexed in steps of 4. */
export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 };

/** Stroke widths in px, exactly as the renderer draws them. */
export const strokes = { border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 };

/** Raw CSS values: only the DOM shell animates, the canvas redraws. */
export const motion = {
  transition: "150ms ease-in-out",
  easeOut: "cubic-bezier(0.2, 0.8, 0.25, 1)",
};

export interface ChromeTokens {
  fg: string;
  /**
   * The status bar's link — the only chrome text sitting DIRECTLY on the canvas,
   * with no floating surface under it. It is therefore the only one whose
   * contrast is computable (see `contrast.ts`) and the only one that had to
   * leave `accent.selection`: the brand red reads ~2.75:1 on the light canvas,
   * well under the 4.5:1 AA floor at 11px (see `test/contrast.test.ts`).
   */
  link: string;
  /** Translucent floating surfaces laid over the canvas. */
  float: { bg: string; border: string; hover: string };
  shadow: string;
}

/**
 * Shell tokens: they exist in the DOM only (translucency, shadows), notions the
 * Pixi canvas does not know and will never see.
 */
export const chrome: { light: ChromeTokens; dark: ChromeTokens } = {
  light: {
    fg: "#070f19",
    // Darkened from the brand accent #f65e5e (~2.75:1 on #eef0f3) until it
    // clears 4.5:1 on BOTH light canvases this token is shared by: #eef0f3
    // (defsquare, 4.76:1) and #f4f4f5 (neutral, 4.95:1) — the tighter of the
    // two, so it is the binding constraint. Kept as close to the brand red
    // as AA allows rather than darkened further — see `test/contrast.test.ts`
    // for the floor this holds to.
    link: "#c0392b",
    float: {
      bg: "rgb(255 255 255 / 0.82)",
      border: "rgb(23 39 65 / 0.1)",
      hover: "rgb(23 39 65 / 0.06)",
    },
    shadow: "0 1px 2px rgb(15 23 42 / 0.06), 0 10px 28px -10px rgb(15 23 42 / 0.22)",
  },
  dark: {
    fg: "#f0f5fc",
    // Unchanged: the brand accent already clears 4.5:1 on both dark canvases
    // (5.48:1 on #161a2c, 5.64:1 on #18181b).
    link: "#f65e5e",
    float: {
      bg: "rgb(30 35 53 / 0.82)",
      border: "rgb(240 245 252 / 0.1)",
      hover: "rgb(240 245 252 / 0.08)",
    },
    shadow: "0 1px 2px rgb(0 0 0 / 0.35), 0 12px 30px -10px rgb(0 0 0 / 0.6)",
  },
};

/**
 * Stack for Pixi: it parses `fontFamily` itself, so CSS quotes would become
 * part of the name looked up and would miss the font.
 */
export function pixiFontStack(stack: FontStack): string {
  return stack.join(", ");
}

/** Stack for CSS: a name with spaces must be quoted to stay a single family. */
export function cssFontStack(stack: FontStack): string {
  return stack.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(", ");
}
