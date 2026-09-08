import {
  defsquare,
  neutral,
  pixiFontStack,
  radii as tokenRadii,
  strokes as tokenStrokes,
  typography as tokenTypography,
} from "@defsquare/data-graph-tokens";

/**
 * The values all come from the tokens package, the source of truth shared with
 * the CSS variables of the demo shell — a token fixed over there must show up
 * here without any recopying. The TYPES (`Theme`, `TypeStyle`, `ThemeOverride`),
 * on the other hand, stay defined here: they form the renderer's public API, and
 * its consumers must not pay for it with a type dependency on the tokens
 * package.
 *
 * Groups are copied by spreading (`{ ...defsquare.light.surface }`) rather than
 * referenced: tokens are shared between both outputs, and a resolved theme must never
 * be able to mutate the source.
 */

export interface TypeStyle {
  family: "body" | "mono";
  size: number;
  weight: number;
  /** Letter spacing in em. Absent = 0. */
  tracking?: number;
}

export interface Theme {
  fonts: { body: string; mono: string };
  surface: { canvas: string; card: string; cardMuted: string };
  ink: { primary: string; muted: string; subtle: string };
  accent: {
    /** Fallback rail when `entityPalette` is empty. */
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
  /** Rail colors, assigned in declaration order of the entity types. */
  entityPalette: string[];
  byEntityType?: Record<string, { accent: string }>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ThemeOverride = DeepPartial<Omit<Theme, "entityPalette" | "byEntityType">> & {
  entityPalette?: string[];
  byEntityType?: Theme["byEntityType"];
};

// The tokens package's `fonts.title` is not carried over: it exists only for the DOM
// shell, the Pixi canvas never draws a title.
const DEFSQUARE_FONTS = {
  body: pixiFontStack(defsquare.fonts.body),
  mono: pixiFontStack(defsquare.fonts.mono),
};

// Shared by both defsquare themes: these colors only ever serve as a 3px rail or a
// pill, so they hold up on light and dark backgrounds alike.
const DEFSQUARE_PALETTE = [...defsquare.entityPalette];

const TYPOGRAPHY: Theme["typography"] = {
  header: { ...tokenTypography.header },
  badge: { ...tokenTypography.badge },
  key: { ...tokenTypography.key },
  value: { ...tokenTypography.value },
};

// The canvas knows a single radius, the cards'; the other rungs of `radii` serve the
// DOM shell only.
const RADII: Theme["radii"] = { card: tokenRadii.card };

const STROKES: Theme["strokes"] = { ...tokenStrokes };

export const defsquareLight: Theme = {
  fonts: DEFSQUARE_FONTS,
  surface: { ...defsquare.light.surface },
  ink: { ...defsquare.light.ink },
  accent: { ...defsquare.light.accent },
  edge: { ...defsquare.light.edge },
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: DEFSQUARE_PALETTE,
};

export const defsquareDark: Theme = {
  fonts: DEFSQUARE_FONTS,
  surface: { ...defsquare.dark.surface },
  ink: { ...defsquare.dark.ink },
  accent: { ...defsquare.dark.accent },
  edge: { ...defsquare.dark.edge },
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: DEFSQUARE_PALETTE,
};

const NEUTRAL_FONTS = {
  body: pixiFontStack(neutral.fonts.body),
  mono: pixiFontStack(neutral.fonts.mono),
};
const NEUTRAL_PALETTE = [...neutral.entityPalette];

export const neutralLight: Theme = {
  fonts: NEUTRAL_FONTS,
  surface: { ...neutral.light.surface },
  ink: { ...neutral.light.ink },
  accent: { ...neutral.light.accent },
  edge: { ...neutral.light.edge },
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: NEUTRAL_PALETTE,
};

export const neutralDark: Theme = {
  fonts: NEUTRAL_FONTS,
  surface: { ...neutral.dark.surface },
  ink: { ...neutral.dark.ink },
  accent: { ...neutral.dark.accent },
  edge: { ...neutral.dark.edge },
  typography: TYPOGRAPHY,
  radii: RADII,
  strokes: STROKES,
  entityPalette: NEUTRAL_PALETTE,
};

function mergeStyle(base: TypeStyle, over?: DeepPartial<TypeStyle>): TypeStyle {
  return { ...base, ...over } as TypeStyle;
}

/**
 * Merges a partial override onto `base` (default `defsquareLight`). The merge is deep
 * by exactly one level per group — groups are flat, except `typography`, whose every
 * entry is itself an object.
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
 * Maps each entity type to a rail color. The assignment follows the order of
 * `entityTypes` — which the caller derives from the declaration order of the keys of
 * `config.ids`, not from the order of appearance in the data, so it stays deterministic
 * and under the author's control.
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
