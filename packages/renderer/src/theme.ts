export interface TypeStyle {
  family: "body" | "mono";
  size: number;
  weight: number;
  /** Interlettrage en em. Absent = 0. */
  tracking?: number;
}

export interface Theme {
  fonts: { body: string; mono: string };
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
  typography: { header: TypeStyle; badge: TypeStyle; key: TypeStyle; value: TypeStyle };
  radii: { card: number };
  strokes: {
    border: number;
    edge: number;
    selection: number;
    match: number;
    matchCurrent: number;
  };
  /** Couleurs de rail, assignées par ordre de déclaration des types d'entité. */
  entityPalette: string[];
  byEntityType?: Record<string, { accent: string }>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ThemeOverride = DeepPartial<Omit<Theme, "entityPalette" | "byEntityType">> & {
  entityPalette?: string[];
  byEntityType?: Theme["byEntityType"];
};

const DEFSQUARE_FONTS = {
  body: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif",
  mono: "Fira Code, SF Mono, Menlo, Consolas, monospace",
};

// Commune aux deux thèmes defsquare : ces couleurs ne servent qu'en rail de
// 3px et en pastille, elles tiennent donc sur fond clair comme sombre.
const DEFSQUARE_PALETTE = [
  "#1e416e", // --color-primary-400
  "#f65e5e", // --color-accent
  "#3dbf9e", // --color-mint
  "#8d7e63", // --color-beige-deep
  "#3573c3", // --color-primary-600
  "#a0427a", // fin de --gradient-heat
];

const TYPOGRAPHY: Theme["typography"] = {
  header: { family: "body", size: 13, weight: 600 },
  badge: { family: "body", size: 9.5, weight: 600, tracking: 0.08 },
  key: { family: "body", size: 12, weight: 400 },
  value: { family: "mono", size: 12, weight: 400 },
};

const RADII: Theme["radii"] = { card: 6 };

const STROKES: Theme["strokes"] = {
  border: 1,
  edge: 1.5,
  selection: 2.5,
  match: 2,
  matchCurrent: 3,
};

export const defsquareLight: Theme = {
  fonts: DEFSQUARE_FONTS,
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
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: DEFSQUARE_PALETTE,
};

export const defsquareDark: Theme = {
  fonts: DEFSQUARE_FONTS,
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
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: DEFSQUARE_PALETTE,
};

const NEUTRAL_FONTS = { body: "system-ui, sans-serif", mono: "monospace" };
const NEUTRAL_PALETTE = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#0891b2", "#be123c"];

export const neutralLight: Theme = {
  fonts: NEUTRAL_FONTS,
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
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: NEUTRAL_PALETTE,
};

export const neutralDark: Theme = {
  fonts: NEUTRAL_FONTS,
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
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: NEUTRAL_PALETTE,
};

function mergeStyle(base: TypeStyle, over?: DeepPartial<TypeStyle>): TypeStyle {
  return { ...base, ...over } as TypeStyle;
}

/**
 * Fusionne une surcharge partielle sur `base` (défaut `defsquareLight`).
 * La fusion est profonde d'exactement un niveau par groupe — les groupes sont
 * plats, sauf `typography` dont chaque entrée est elle-même un objet.
 */
export function resolveTheme(partial?: ThemeOverride, base: Theme = defsquareLight): Theme {
  return {
    fonts: { ...base.fonts, ...partial?.fonts },
    surface: { ...base.surface, ...partial?.surface },
    ink: { ...base.ink, ...partial?.ink },
    accent: { ...base.accent, ...partial?.accent },
    edge: { ...base.edge, ...partial?.edge },
    typography: {
      header: mergeStyle(base.typography.header, partial?.typography?.header),
      badge: mergeStyle(base.typography.badge, partial?.typography?.badge),
      key: mergeStyle(base.typography.key, partial?.typography?.key),
      value: mergeStyle(base.typography.value, partial?.typography?.value),
    },
    radii: { ...base.radii, ...partial?.radii },
    strokes: { ...base.strokes, ...partial?.strokes },
    entityPalette: partial?.entityPalette ?? [...base.entityPalette],
    ...(partial?.byEntityType
      ? { byEntityType: { ...partial.byEntityType } }
      : base.byEntityType
        ? { byEntityType: { ...base.byEntityType } }
        : {}),
  };
}

/**
 * Associe chaque type d'entité à une couleur de rail. L'assignation suit
 * l'ordre de `entityTypes` — que l'appelant tire de l'ordre de déclaration
 * des clés de `config.entities`, pas de l'ordre d'apparition dans les
 * données, pour rester déterministe et sous contrôle de l'auteur.
 */
export function entityAccentMap(entityTypes: string[], theme: Theme): Map<string, string> {
  const map = new Map<string, string>();
  const palette = theme.entityPalette;
  entityTypes.forEach((type, index) => {
    const override = theme.byEntityType?.[type]?.accent;
    if (override) {
      map.set(type, override);
      return;
    }
    map.set(type, palette.length > 0 ? palette[index % palette.length]! : theme.accent.entity);
  });
  return map;
}
