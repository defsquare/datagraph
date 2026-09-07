import {
  defsquare,
  neutral,
  pixiFontStack,
  radii as tokenRadii,
  strokes as tokenStrokes,
  typography as tokenTypography,
} from "@defsquare/data-graph-tokens";

/**
 * Les valeurs viennent toutes du paquet de tokens, source de vérité partagée
 * avec les variables CSS du shell de la démo — un token corrigé là-bas doit se
 * voir ici sans recopie. En revanche les TYPES (`Theme`, `TypeStyle`,
 * `ThemeOverride`) restent définis ici : ils forment l'API publique du
 * renderer, que ses consommateurs ne doivent pas payer d'une dépendance de
 * types vers le paquet de tokens.
 *
 * Les groupes sont recopiés par étalement (`{ ...defsquare.light.surface }`)
 * plutôt que référencés : les tokens sont partagés entre les deux sorties, et
 * un thème résolu ne doit jamais pouvoir muter la source.
 */

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

// `fonts.title` du paquet de tokens n'est pas repris : il n'existe que pour le
// shell DOM, le canvas Pixi ne dessine jamais de titre.
const DEFSQUARE_FONTS = {
  body: pixiFontStack(defsquare.fonts.body),
  mono: pixiFontStack(defsquare.fonts.mono),
};

// Commune aux deux thèmes defsquare : ces couleurs ne servent qu'en rail de
// 3px et en pastille, elles tiennent donc sur fond clair comme sombre.
const DEFSQUARE_PALETTE = [...defsquare.entityPalette];

const TYPOGRAPHY: Theme["typography"] = {
  header: { ...tokenTypography.header },
  badge: { ...tokenTypography.badge },
  key: { ...tokenTypography.key },
  value: { ...tokenTypography.value },
};

// Le canvas ne connaît qu'un rayon, celui des cartes ; les autres échelons de
// `radii` ne servent qu'au shell DOM.
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
 * des clés de `config.ids`, pas de l'ordre d'apparition dans les
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
