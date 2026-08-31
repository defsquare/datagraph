# Refonte du thème defsquare — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le thème « aplat rouge » du renderer par un système de tokens sémantiques defsquare (clair + sombre), corriger le flou de rendu et le débordement de texte, et transformer la démo en vitrine de marque.

**Architecture:** Le core garde la responsabilité exclusive des métriques de layout (`NodeMetrics`/`measureNode`), enrichies pour distinguer l'avance des polices body et mono. Le renderer reçoit un `Theme` en groupes sémantiques (`surface`/`ink`/`accent`/`edge`/`typography`/`radii`/`strokes`/`entityPalette`) dont `draw.ts` est le seul consommateur, plus aucune constante visuelle n'y subsiste. La démo consomme la lib en boîte noire via son API publique, élargie d'un `setTheme()`.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Pixi.js v8, elkjs, Vitest, Playwright, Vite.

**Spec:** `docs/superpowers/specs/2026-08-31-defsquare-theme-refresh-design.md`

## Global Constraints

- Le core (`packages/core`) n'accède **jamais** au DOM : il tourne en Node et ses tests en dépendent. Toute mesure de police réelle vit dans le renderer.
- Le package n'est pas publié sur npm : les ruptures d'API de `Theme` et `NodeMetrics` sont autorisées et attendues.
- Style de code : le core est **sans point-virgule**, le renderer et la démo sont **avec point-virgule**. Respecter le fichier qu'on modifie.
- Les valeurs de couleur proviennent de `colors_and_type.css` du projet Claude Design « Defsquare Design System ». Les valeurs marquées **dérivée** dans le spec sont à recopier telles quelles depuis ce plan, sans réinvention.
- Aucune ombre portée simulée dans le canvas Pixi (pas de flou disponible en `Graphics`).
- Commandes de vérification : `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter demo e2e`, `pnpm bench`.
- Branche de travail : `feat/defsquare-theme-refresh`. Un commit par tâche.

---

### Task 1: Métriques du core — avances par rôle et fin du débordement

**Files:**
- Modify: `packages/core/src/measure.ts` (réécriture complète)
- Modify: `packages/core/test/layout.test.ts:8-30` (bloc `describe("measureNode")`)
- Test: `packages/core/test/measure.test.ts` (créer)

**Interfaces:**
- Consumes: `GraphNode` depuis `packages/core/src/model.ts` (champs `label`, `rows`, `childIds`, `kind`, et `entityType`/`entityId` sur `kind === "entity"`).
- Produces: `NodeMetrics` (13 champs, ci-dessous), `DEFAULT_METRICS`, `measureNode(node, metrics?) → Size`, et `badgeTextFor(node) → string`. Les tâches 3 et 5 dépendent de `badgeTextFor` et des champs `*CharWidth` pour tronquer avec la même avance que celle qui a dimensionné la carte.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/core/test/measure.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { measureNode, badgeTextFor, DEFAULT_METRICS } from "../src/measure.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("badgeTextFor", () => {
  it("renvoie le type en capitales pour une entité", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers/0")!)).toBe("CUSTOMER")
  })

  it("renvoie le nombre d'enfants pour un conteneur qui en a", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers")!)).toBe("2")
  })

  it("renvoie la chaine vide pour un noeud sans enfant ni type", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers/0/address")!)).toBe("")
  })
})

describe("measureNode", () => {
  it("budgete la valeur mono a son avance propre, pas a celle du body", () => {
    // Une valeur mono longue doit elargir la carte davantage qu'une cle body
    // de meme longueur : c'est exactement le bug qui faisait deborder
    // "dupont@example.com" hors de sa carte.
    const node = {
      kind: "object" as const,
      id: "/x",
      path: ["x"],
      label: "x",
      parentId: null,
      childIds: [],
      rows: [{ key: "a", value: "wwwwwwwwwwwwwwwwwwww", valueType: "string" as const }],
    }
    const swapped = {
      ...node,
      rows: [{ key: "wwwwwwwwwwwwwwwwwwww", value: "a", valueType: "string" as const }],
    }
    expect(measureNode(node).width).toBeGreaterThan(measureNode(swapped).width)
  })

  it("respecte minWidth et maxWidth", () => {
    const tiny = {
      kind: "object" as const,
      id: "/t", path: ["t"], label: "t", parentId: null, childIds: [], rows: [],
    }
    const huge = {
      ...tiny,
      rows: [{ key: "k".repeat(200), value: "v".repeat(200), valueType: "string" as const }],
    }
    expect(measureNode(tiny).width).toBe(DEFAULT_METRICS.minWidth)
    expect(measureNode(huge).width).toBe(DEFAULT_METRICS.maxWidth)
  })

  it("ajoute paddingBottom seulement quand il y a des lignes", () => {
    const noRows = {
      kind: "object" as const,
      id: "/n", path: ["n"], label: "n", parentId: null, childIds: [], rows: [],
    }
    const oneRow = {
      ...noRows,
      rows: [{ key: "k", value: "v", valueType: "string" as const }],
    }
    expect(measureNode(noRows).height).toBe(DEFAULT_METRICS.headerHeight)
    expect(measureNode(oneRow).height).toBe(
      DEFAULT_METRICS.headerHeight + DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.paddingBottom,
    )
  })

  it("reserve la largeur du chevron uniquement pour un noeud a enfants", () => {
    const leaf = {
      kind: "object" as const,
      id: "/l", path: ["l"], label: "l".repeat(30), parentId: null, childIds: [], rows: [],
    }
    const parent = { ...leaf, childIds: ["/l/a"] }
    expect(measureNode(parent).width).toBeGreaterThan(measureNode(leaf).width)
  })

  it("est deterministe", () => {
    const g = buildGraph(shopData, shopConfig)
    const c1 = g.nodes.get("/customers/0")!
    expect(measureNode(c1)).toEqual(measureNode(c1))
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph-core test measure`
Expected: FAIL — `badgeTextFor` n'est pas exporté, et `DEFAULT_METRICS.minWidth` / `paddingBottom` sont `undefined`.

- [ ] **Step 3: Réécrire `packages/core/src/measure.ts`**

Remplacer intégralement le contenu (attention : **pas de point-virgule** dans le core) :

```ts
import type { GraphNode } from "./model.js"

export interface Size {
  width: number
  height: number
}

export interface NodeMetrics {
  headerHeight: number
  rowHeight: number
  paddingX: number
  paddingBottom: number
  railWidth: number
  gapKeyValue: number
  chevronWidth: number
  /** Avance moyenne du libellé d'en-tête (body 13px / 600). */
  headerCharWidth: number
  /** Avance moyenne de la pastille (body 9.5px / 600 + tracking). */
  badgeCharWidth: number
  /** Avance moyenne d'une clé (body 12px). */
  keyCharWidth: number
  /** Avance d'une valeur (mono 12px — exacte pour Fira Code, 0.6em). */
  valueCharWidth: number
  minWidth: number
  maxWidth: number
}

export const DEFAULT_METRICS: NodeMetrics = {
  headerHeight: 30,
  rowHeight: 19,
  paddingX: 12,
  paddingBottom: 7,
  railWidth: 3,
  gapKeyValue: 16,
  chevronWidth: 14,
  headerCharWidth: 6.5,
  badgeCharWidth: 6.2,
  keyCharWidth: 6.0,
  valueCharWidth: 7.2,
  minWidth: 140,
  maxWidth: 340,
}

/**
 * Texte de la pastille d'en-tête : le type d'entité en capitales pour un nœud
 * entité, le nombre d'enfants pour un conteneur qui en a, la chaîne vide
 * sinon. Exporté parce que le renderer doit dessiner exactement ce que
 * measureNode a budgété.
 */
export function badgeTextFor(node: GraphNode): string {
  if (node.kind === "entity") return node.entityType.toUpperCase()
  if (node.childIds.length > 0) return String(node.childIds.length)
  return ""
}

/**
 * Texte du libellé d'en-tête en LOD 0. Une entité affiche `#<id>` seul : son
 * `label` (« Order #o1 ») répète le type que la pastille porte déjà.
 */
export function headerTextFor(node: GraphNode): string {
  if (node.kind === "entity") return `#${node.entityId}`
  return node.label
}

/**
 * Calcule la taille d'un nœud sans accéder au DOM. La largeur est le max entre
 * l'en-tête et la plus large des lignes ; chaque fragment est budgété avec
 * l'avance de SA police, ce que l'ancienne implémentation ne faisait pas —
 * elle appliquait l'avance body aux valeurs rendues en mono et sous-estimait
 * leur largeur de ~17%.
 */
export function measureNode(node: GraphNode, metrics: NodeMetrics = DEFAULT_METRICS): Size {
  const chrome = metrics.railWidth + 2 * metrics.paddingX

  const badge = badgeTextFor(node)
  const headerW =
    chrome +
    (node.childIds.length > 0 ? metrics.chevronWidth : 0) +
    headerTextFor(node).length * metrics.headerCharWidth +
    (badge.length > 0 ? metrics.gapKeyValue + badge.length * metrics.badgeCharWidth : 0)

  let widest = headerW
  for (const row of node.rows) {
    const rowW =
      chrome +
      row.key.length * metrics.keyCharWidth +
      metrics.gapKeyValue +
      String(row.value).length * metrics.valueCharWidth
    if (rowW > widest) widest = rowW
  }

  const width = Math.min(metrics.maxWidth, Math.max(metrics.minWidth, widest))
  const height =
    metrics.headerHeight +
    node.rows.length * metrics.rowHeight +
    (node.rows.length > 0 ? metrics.paddingBottom : 0)

  return { width, height }
}
```

- [ ] **Step 4: Exporter les nouveaux symboles depuis le core**

Dans `packages/core/src/index.ts`, remplacer la ligne d'export de `measure.js` par :

```ts
export { measureNode, badgeTextFor, headerTextFor, DEFAULT_METRICS, type Size, type NodeMetrics } from "./measure.js"
```

- [ ] **Step 5: Mettre à jour le test de layout existant**

Dans `packages/core/test/layout.test.ts`, une seule ligne change. Le bloc actuel est :

```ts
describe("measureNode", () => {
  it("is deterministic and scales with rows", () => {
    const g = buildGraph(shopData, shopConfig)
    const c1 = g.nodes.get("/customers/0")!
    const s = measureNode(c1)
    expect(s.height).toBe(DEFAULT_METRICS.headerHeight + 3 * DEFAULT_METRICS.rowHeight)
    expect(s.width).toBeGreaterThan(100)
    expect(measureNode(c1)).toEqual(s)
  })
})
```

Remplacer uniquement l'assertion de hauteur par :

```ts
    expect(s.height).toBe(
      DEFAULT_METRICS.headerHeight + 3 * DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.paddingBottom,
    )
```

Les deux autres assertions restent valides telles quelles. Aucune autre assertion du fichier ne dépend de `charWidth` ni de `maxTextChars`.

- [ ] **Step 6: Lancer toute la suite du core**

Run: `pnpm --filter @defsquare/data-graph-core test`
Expected: PASS, y compris `layout.test.ts`, `build.test.ts`, `collapse.test.ts`, `layout-incremental.test.ts`.

- [ ] **Step 7: Typecheck**

Run: `pnpm -r typecheck`
Expected: le core passe. Le renderer **échouera** (`draw.ts` et `create.ts` référencent encore `DEFAULT_METRICS.charWidth`) — c'est attendu, la tâche 3 le corrige. Noter les erreurs, ne pas les corriger ici.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/measure.ts packages/core/src/index.ts packages/core/test/measure.test.ts packages/core/test/layout.test.ts
git commit -m "feat(core): avances par role dans NodeMetrics, corrige le sous-dimensionnement des valeurs mono"
```

---

### Task 2: Contrat de thème sémantique

**Files:**
- Modify: `packages/renderer/src/theme.ts` (réécriture complète)
- Modify: `packages/renderer/src/index.ts:1-2`
- Test: `packages/renderer/test/theme.test.ts` (réécriture complète)

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces: `Theme`, `TypeStyle`, `ThemeOverride`, `defsquareLight`, `defsquareDark`, `neutralLight`, `neutralDark`, `resolveTheme(partial?, base?) → Theme`, `entityAccentMap(entityTypes, theme) → Map<string, string>`. Les tâches 3, 4 et 5 consomment `Theme` et `entityAccentMap`.

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer intégralement `packages/renderer/test/theme.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  defsquareLight,
  defsquareDark,
  neutralLight,
  neutralDark,
  resolveTheme,
  entityAccentMap,
  type Theme,
} from "../src/index.js";

const ALL: [string, Theme][] = [
  ["defsquareLight", defsquareLight],
  ["defsquareDark", defsquareDark],
  ["neutralLight", neutralLight],
  ["neutralDark", neutralDark],
];

describe("contrat de theme", () => {
  it.each(ALL)("%s definit chaque groupe et chaque token", (_name, theme) => {
    expect(Object.keys(theme.surface).sort()).toEqual(["canvas", "card", "cardMuted"]);
    expect(Object.keys(theme.ink).sort()).toEqual(["muted", "onAccent", "primary", "subtle"]);
    expect(Object.keys(theme.accent).sort()).toEqual([
      "danger", "entity", "match", "matchStroke", "selection",
    ]);
    expect(Object.keys(theme.edge).sort()).toEqual([
      "border", "contain", "dangling", "hairline", "ref",
    ]);
    expect(Object.keys(theme.typography).sort()).toEqual(["badge", "header", "key", "value"]);
    expect(Object.keys(theme.radii).sort()).toEqual(["badge", "card"]);
    expect(Object.keys(theme.strokes).sort()).toEqual([
      "border", "edge", "match", "matchCurrent", "selection",
    ]);
  });

  it.each(ALL)("%s n'a que des couleurs hex valides", (_name, theme) => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const group of [theme.surface, theme.ink, theme.accent, theme.edge]) {
      for (const [key, value] of Object.entries(group)) {
        expect(value, key).toMatch(hex);
      }
    }
    for (const color of theme.entityPalette) expect(color).toMatch(hex);
  });

  it.each(ALL)("%s a une palette d'entites non vide", (_name, theme) => {
    expect(theme.entityPalette.length).toBeGreaterThan(0);
  });
});

describe("resolveTheme", () => {
  it("sans argument, egale defsquareLight", () => {
    expect(resolveTheme()).toEqual(defsquareLight);
  });

  it("fusionne en profondeur sans ecraser les freres", () => {
    const custom = resolveTheme({ accent: { selection: "#000000" } });
    expect(custom.accent.selection).toBe("#000000");
    expect(custom.accent.entity).toBe(defsquareLight.accent.entity);
    expect(custom.accent.danger).toBe(defsquareLight.accent.danger);
    expect(custom.surface).toEqual(defsquareLight.surface);
    expect(custom.typography).toEqual(defsquareLight.typography);
  });

  it("fusionne un style typographique partiel", () => {
    const custom = resolveTheme({ typography: { header: { size: 16 } } });
    expect(custom.typography.header.size).toBe(16);
    expect(custom.typography.header.weight).toBe(defsquareLight.typography.header.weight);
    expect(custom.typography.header.family).toBe(defsquareLight.typography.header.family);
    expect(custom.typography.key).toEqual(defsquareLight.typography.key);
  });

  it("accepte une base explicite, ce qui permet de personnaliser le theme sombre", () => {
    const custom = resolveTheme({ accent: { selection: "#00ff00" } }, defsquareDark);
    expect(custom.accent.selection).toBe("#00ff00");
    expect(custom.surface.canvas).toBe(defsquareDark.surface.canvas);
  });

  it("conserve byEntityType", () => {
    const custom = resolveTheme({ byEntityType: { Customer: { accent: "#ff0000" } } });
    expect(custom.byEntityType).toEqual({ Customer: { accent: "#ff0000" } });
  });
});

describe("entityAccentMap", () => {
  it("assigne les couleurs dans l'ordre de la palette", () => {
    const map = entityAccentMap(["Customer", "Order"], defsquareLight);
    expect(map.get("Customer")).toBe(defsquareLight.entityPalette[0]);
    expect(map.get("Order")).toBe(defsquareLight.entityPalette[1]);
  });

  it("boucle au-dela de la longueur de la palette", () => {
    const types = Array.from({ length: 8 }, (_, i) => `T${i}`);
    const map = entityAccentMap(types, defsquareLight);
    const n = defsquareLight.entityPalette.length;
    expect(map.get("T0")).toBe(map.get(`T${n}`));
  });

  it("est deterministe pour un meme ordre d'entree", () => {
    const a = entityAccentMap(["A", "B", "C"], defsquareLight);
    const b = entityAccentMap(["A", "B", "C"], defsquareLight);
    expect([...a]).toEqual([...b]);
  });

  it("byEntityType surcharge la palette", () => {
    const theme = resolveTheme({ byEntityType: { Order: { accent: "#123456" } } });
    const map = entityAccentMap(["Customer", "Order"], theme);
    expect(map.get("Order")).toBe("#123456");
    expect(map.get("Customer")).toBe(theme.entityPalette[0]);
  });

  it("retombe sur accent.entity quand la palette est vide", () => {
    const theme = resolveTheme({ entityPalette: [] });
    expect(entityAccentMap(["Customer"], theme).get("Customer")).toBe(theme.accent.entity);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph test`
Expected: FAIL — `defsquareLight`, `entityAccentMap` n'existent pas.

- [ ] **Step 3: Réécrire `packages/renderer/src/theme.ts`**

```ts
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
  ink: { primary: string; muted: string; subtle: string; onAccent: string };
  accent: {
    /** Rail de repli quand `entityPalette` est vide. */
    entity: string;
    selection: string;
    match: string;
    matchStroke: string;
    danger: string;
  };
  edge: {
    contain: string;
    ref: string;
    dangling: string;
    hairline: string;
    border: string;
  };
  typography: { header: TypeStyle; badge: TypeStyle; key: TypeStyle; value: TypeStyle };
  radii: { card: number; badge: number };
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

const RADII: Theme["radii"] = { card: 6, badge: 3 };

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
  ink: { primary: "#172741", muted: "#4b5563", subtle: "#9ca3af", onAccent: "#ffffff" },
  accent: {
    entity: "#1e416e",
    selection: "#f65e5e",
    match: "#ede2cf",
    matchStroke: "#8d7e63",
    danger: "#f65e5e",
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
  ink: { primary: "#f0f5fc", muted: "#9bb2d9", subtle: "#6b7794", onAccent: "#ffffff" },
  accent: {
    entity: "#3573c3",
    selection: "#f65e5e",
    match: "#3a3323",
    matchStroke: "#e2ca9e",
    danger: "#f65e5e",
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
  ink: { primary: "#18181b", muted: "#52525b", subtle: "#a1a1aa", onAccent: "#ffffff" },
  accent: {
    entity: "#2563eb",
    selection: "#2563eb",
    match: "#fef9c3",
    matchStroke: "#a16207",
    danger: "#dc2626",
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
  ink: { primary: "#fafafa", muted: "#a1a1aa", subtle: "#71717a", onAccent: "#ffffff" },
  accent: {
    entity: "#60a5fa",
    selection: "#60a5fa",
    match: "#422006",
    matchStroke: "#ca8a04",
    danger: "#f87171",
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
```

- [ ] **Step 4: Mettre à jour les exports du renderer**

Dans `packages/renderer/src/index.ts`, remplacer les deux premières lignes par :

```ts
export {
  resolveTheme,
  entityAccentMap,
  defsquareLight,
  defsquareDark,
  neutralLight,
  neutralDark,
} from "./theme.js";
export type { Theme, ThemeOverride, TypeStyle } from "./theme.js";
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph test`
Expected: `theme.test.ts` PASS. Le typecheck reste cassé (`draw.ts`/`create.ts` utilisent l'ancien `theme.colors`) — attendu, tâches 3 à 5.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/theme.ts packages/renderer/src/index.ts packages/renderer/test/theme.test.ts
git commit -m "feat(renderer): contrat de theme semantique, themes defsquare clair et sombre"
```

---

### Task 3: Dessin de la carte de nœud

**Files:**
- Modify: `packages/renderer/src/draw.ts:1-182` (bloc polices + `drawNode`)
- Test: `packages/renderer/test/truncate.test.ts` (créer)

**Interfaces:**
- Consumes: `Theme`, `TypeStyle` (tâche 2) ; `NodeMetrics`, `DEFAULT_METRICS`, `badgeTextFor`, `headerTextFor`, `measureNode` (tâche 1).
- Produces: `drawNode(node, rect, theme, lod, useBitmapText, accent, metrics) → Container`, `truncateToWidth(text, maxWidth, charWidth) → string`, `charWidthFor(role, metrics) → number`. La tâche 5 appelle `drawNode` avec cette signature.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/renderer/test/truncate.test.ts`. Ce test est la régression du bug de débordement : il vérifie que la troncature et la mesure sont d'accord, sans avoir besoin d'un canvas.

```ts
import { describe, it, expect } from "vitest";
import { buildGraph, measureNode, DEFAULT_METRICS, badgeTextFor, headerTextFor } from "@defsquare/data-graph-core";
import { truncateToWidth, charWidthFor } from "../src/draw.js";

const data = {
  customers: [
    { id: "c1", name: "Dupont", email: "dupont@example.com" },
    { id: "c2", name: "Nom-Tres-Long-Qui-Deborde", email: "adresse.electronique.tres.longue@exemple-de-domaine.fr" },
  ],
};
const config = { entities: { Customer: { match: "$.customers[*]", id: "id" } } };

describe("accord mesure / troncature", () => {
  it("aucune ligne tronquee ne depasse la largeur calculee par measureNode", () => {
    const graph = buildGraph(data, config);
    const m = DEFAULT_METRICS;

    for (const node of graph.nodes.values()) {
      const width = measureNode(node, m).width;
      const inner = width - m.railWidth - 2 * m.paddingX;

      for (const row of node.rows) {
        const keyW = row.key.length * charWidthFor("key", m);
        const budget = inner - keyW - m.gapKeyValue;
        const shown = truncateToWidth(String(row.value), budget, charWidthFor("value", m));
        const shownW = shown.length * charWidthFor("value", m);
        expect(keyW + m.gapKeyValue + shownW, `${node.id} ${row.key}`).toBeLessThanOrEqual(inner + 0.001);
      }

      const badge = badgeTextFor(node);
      const badgeW = badge.length > 0 ? m.gapKeyValue + badge.length * charWidthFor("badge", m) : 0;
      const chevronW = node.childIds.length > 0 ? m.chevronWidth : 0;
      const headerBudget = inner - badgeW - chevronW;
      const header = truncateToWidth(headerTextFor(node), headerBudget, charWidthFor("header", m));
      expect(header.length * charWidthFor("header", m)).toBeLessThanOrEqual(headerBudget + 0.001);
    }
  });

  it("tronque avec une ellipse et ne renvoie jamais plus long que l'entree", () => {
    expect(truncateToWidth("abcdefghij", 30, 6)).toBe("abcd…");
    expect(truncateToWidth("abc", 300, 6)).toBe("abc");
    expect(truncateToWidth("abc", 0, 6)).toBe("");
    expect(truncateToWidth("abc", 6, 6)).toBe("…");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @defsquare/data-graph test truncate`
Expected: FAIL — `charWidthFor` n'est pas exporté.

- [ ] **Step 3: Réécrire le haut de `draw.ts` (lignes 1 à 182)**

Remplacer tout ce qui va de l'import initial jusqu'à la fin de `drawNode` (la constante `DASH_LENGTH` et tout ce qui suit reste en place pour l'instant ; la tâche 4 s'en occupe).

```ts
import { BitmapFont, BitmapFontManager, BitmapText, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  badgeTextFor,
  headerTextFor,
  DEFAULT_METRICS,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { Theme, TypeStyle } from "./theme.js";

export type Lod = 0 | 1 | 2;

/** scale >= LOD0_MIN: carte complète (en-tête + lignes). LOD1_MIN <= scale <
 * LOD0_MIN: carte + rail + libellé. scale < LOD1_MIN: rectangle plein. */
export const LOD0_MIN_SCALE = 0.5;
export const LOD1_MIN_SCALE = 0.15;

export function lodForScale(scale: number): Lod {
  if (scale >= LOD0_MIN_SCALE) return 0;
  if (scale >= LOD1_MIN_SCALE) return 1;
  return 2;
}

export type TextRole = "header" | "badge" | "key" | "value";

/** L'avance à utiliser pour tronquer un rôle donné. DOIT rester alignée sur
 * ce que `measureNode` a budgété pour ce même rôle : c'est l'invariant que
 * l'ancienne implémentation violait (une seule avance pour deux polices), d'où
 * les valeurs qui débordaient de leur carte. */
export function charWidthFor(role: TextRole, metrics: NodeMetrics): number {
  switch (role) {
    case "header":
      return metrics.headerCharWidth;
    case "badge":
      return metrics.badgeCharWidth;
    case "key":
      return metrics.keyCharWidth;
    case "value":
      return metrics.valueCharWidth;
  }
}

export function truncateToWidth(text: string, maxWidth: number, charWidth: number): string {
  if (maxWidth <= 0) return "";
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

// Une police bitmap par rôle : les quatre diffèrent en famille, taille ou
// graisse, et BitmapFont cuit un atlas par combinaison.
const FONT_NAMES: Record<TextRole, string> = {
  header: "dg-header",
  badge: "dg-badge",
  key: "dg-key",
  value: "dg-value",
};

// Résolution 2 : le texte reste net jusqu'à 2x de zoom au lieu de baver dès
// que la caméra dépasse 1x.
const FONT_RESOLUTION = 2;

/** Signature d'un rôle, pour ne réinstaller un atlas que si son style change. */
const installed = new Map<TextRole, string>();

function styleKey(theme: Theme, role: TextRole): string {
  const s = theme.typography[role];
  const family = s.family === "body" ? theme.fonts.body : theme.fonts.mono;
  return `${family}|${s.size}|${s.weight}`;
}

function ensureFonts(theme: Theme): void {
  for (const role of ["header", "badge", "key", "value"] as TextRole[]) {
    const key = styleKey(theme, role);
    if (installed.get(role) === key) continue;
    if (installed.has(role)) BitmapFont.uninstall(FONT_NAMES[role]);
    const s = theme.typography[role];
    BitmapFont.install({
      name: FONT_NAMES[role],
      style: {
        fontFamily: s.family === "body" ? theme.fonts.body : theme.fonts.mono,
        fontSize: s.size,
        fontWeight: String(s.weight) as never,
        letterSpacing: (s.tracking ?? 0) * s.size,
        fill: "#ffffff",
      },
      chars: BitmapFontManager.ASCII,
      resolution: FONT_RESOLUTION,
      dynamicFill: true,
    });
    installed.set(role, key);
  }
}

/**
 * BitmapText ne se rastérise pas de façon fiable sous le renderer canvas
 * logiciel de Pixi v8 (`app.renderer.name === "canvas"`, utilisé quand ni
 * WebGL ni WebGPU ne sont disponibles) : vérifié empiriquement, les Graphics
 * s'affichent mais les BitmapText restent vides. Text passe par un autre
 * chemin, sûr en fallback canvas, d'où le `useBitmapText: false` des appelants
 * dans ce cas.
 */
function createLabel(
  text: string,
  theme: Theme,
  role: TextRole,
  color: string,
  useBitmapText: boolean,
): BitmapText | Text {
  const s: TypeStyle = theme.typography[role];
  if (useBitmapText) {
    const t = new BitmapText({ text, style: { fontFamily: FONT_NAMES[role], fontSize: s.size } });
    t.tint = color;
    return t;
  }
  return new Text({
    text,
    style: {
      fontFamily: s.family === "body" ? theme.fonts.body : theme.fonts.mono,
      fontSize: s.size,
      fontWeight: String(s.weight) as never,
      letterSpacing: (s.tracking ?? 0) * s.size,
      fill: color,
    },
  });
}

/** Chevron « ▸ » (replié) ou « ▾ » (déplié), dessiné en Graphics plutôt qu'en
 * glyphe : l'atlas ASCII ne contient pas ces caractères. */
function drawChevron(g: Graphics, x: number, y: number, expanded: boolean, color: string): void {
  const r = 3.5;
  if (expanded) {
    g.moveTo(x - r, y - r * 0.6).lineTo(x + r, y - r * 0.6).lineTo(x, y + r * 0.9);
  } else {
    g.moveTo(x - r * 0.6, y - r).lineTo(x + r * 0.9, y).lineTo(x - r * 0.6, y + r);
  }
  g.fill(color);
}

/**
 * Dessine le visuel d'un nœud, positionné en (0,0) dans son espace local
 * (l'appelant le place à `rect.x`/`rect.y`).
 *
 * LOD 0 : carte + rail de type + en-tête (chevron, libellé, pastille) + lignes
 * clé/valeur, valeur alignée à droite. LOD 1 : carte + rail + libellé complet
 * tronqué. LOD 2 : rectangle plein dans la couleur de type.
 *
 * `accent` est la couleur de rail résolue par l'appelant via `entityAccentMap`
 * — `drawNode` ne peut pas la déduire de `node` et `theme` seuls, puisque
 * l'assignation dépend de l'ordre de déclaration des types dans la config.
 */
export function drawNode(
  node: GraphNode,
  rect: Rect,
  theme: Theme,
  lod: Lod,
  useBitmapText: boolean,
  accent: string,
  metrics: NodeMetrics = DEFAULT_METRICS,
  expanded = false,
): Container {
  if (useBitmapText) ensureFonts(theme);

  const container = new Container();
  container.cullable = true;
  container.cullArea = new Rectangle(0, 0, rect.width, rect.height);

  const isEntity = node.kind === "entity";
  const radius = theme.radii.card;

  if (lod === 2) {
    const g = new Graphics();
    g.rect(0, 0, rect.width, rect.height).fill(isEntity ? accent : theme.edge.contain);
    container.addChild(g);
    return container;
  }

  // Carte + rail, dans un seul Graphics et dans cet ordre précis :
  //   1. un fond accent qui occupe TOUTE la carte,
  //   2. le corps par-dessus, décalé de railWidth vers la droite — ne laisse
  //      donc voir l'accent que sur une bande de railWidth px à gauche,
  //   3. la bordure extérieure, tracée en dernier sur le contour complet.
  // Le corps a ses coins gauches recarrés par un rect, sinon le roundRect
  // laisserait l'accent s'élargir en haut et en bas et le rail ne serait pas
  // d'épaisseur constante.
  const half = theme.strokes.border / 2;
  const innerW = rect.width - theme.strokes.border;
  const innerH = rect.height - theme.strokes.border;
  const surface = isEntity ? theme.surface.card : theme.surface.cardMuted;

  const box = new Graphics();
  if (isEntity) {
    box.roundRect(half, half, innerW, innerH, radius).fill(accent);
    const bodyX = metrics.railWidth;
    box.roundRect(bodyX, half, rect.width - bodyX - half, innerH, radius).fill(surface);
    box.rect(bodyX, half, radius, innerH).fill(surface);
  } else {
    box.roundRect(half, half, innerW, innerH, radius).fill(surface);
  }
  box
    .roundRect(half, half, innerW, innerH, radius)
    .stroke({ width: theme.strokes.border, color: theme.edge.border });
  container.addChild(box);

  const contentX = metrics.railWidth + metrics.paddingX;
  const contentRight = rect.width - metrics.paddingX;
  const inner = contentRight - contentX;

  if (lod === 1) {
    const label = truncateToWidth(node.label, inner, charWidthFor("header", metrics));
    const text = createLabel(label, theme, "header", theme.ink.primary, useBitmapText);
    text.position.set(contentX, Math.round(rect.height / 2 - text.height / 2));
    container.addChild(text);
    return container;
  }

  // --- LOD 0 : en-tête ---
  const headerY = metrics.headerHeight / 2;
  let cursorX = contentX;

  if (node.childIds.length > 0) {
    const chevron = new Graphics();
    drawChevron(chevron, cursorX + 5, headerY, expanded, theme.ink.subtle);
    container.addChild(chevron);
    cursorX += metrics.chevronWidth;
  }

  const badge = badgeTextFor(node);
  const badgeWidth = badge.length > 0 ? badge.length * charWidthFor("badge", metrics) : 0;
  const headerBudget = contentRight - cursorX - (badge.length > 0 ? badgeWidth + metrics.gapKeyValue : 0);

  const headerLabel = truncateToWidth(
    headerTextFor(node),
    headerBudget,
    charWidthFor("header", metrics),
  );
  const headerText = createLabel(headerLabel, theme, "header", theme.ink.primary, useBitmapText);
  headerText.position.set(cursorX, Math.round(headerY - headerText.height / 2));
  container.addChild(headerText);

  if (badge.length > 0) {
    const badgeColor = isEntity ? accent : theme.ink.subtle;
    const badgeText = createLabel(badge, theme, "badge", badgeColor, useBitmapText);
    badgeText.position.set(
      Math.round(contentRight - badgeText.width),
      Math.round(headerY - badgeText.height / 2),
    );
    container.addChild(badgeText);
  }

  // Filet de séparation sous l'en-tête.
  if (node.rows.length > 0) {
    const hairline = new Graphics();
    hairline
      .moveTo(metrics.railWidth, metrics.headerHeight)
      .lineTo(rect.width, metrics.headerHeight)
      .stroke({ width: 1, color: theme.edge.hairline });
    container.addChild(hairline);
  }

  // --- LOD 0 : lignes, valeur alignée à droite ---
  node.rows.forEach((row, index) => {
    const y = metrics.headerHeight + index * metrics.rowHeight + metrics.rowHeight / 2;

    const keyText = createLabel(row.key, theme, "key", theme.ink.muted, useBitmapText);
    keyText.position.set(contentX, Math.round(y - keyText.height / 2));
    container.addChild(keyText);

    const keyWidth = row.key.length * charWidthFor("key", metrics);
    const valueBudget = inner - keyWidth - metrics.gapKeyValue;
    const valueStr = truncateToWidth(String(row.value), valueBudget, charWidthFor("value", metrics));
    if (valueStr.length === 0) return;

    const valueText = createLabel(valueStr, theme, "value", theme.ink.primary, useBitmapText);
    valueText.position.set(
      Math.round(contentRight - valueText.width),
      Math.round(y - valueText.height / 2),
    );
    container.addChild(valueText);
  });

  return container;
}
```

- [ ] **Step 4: Lancer le test de troncature**

Run: `pnpm --filter @defsquare/data-graph test truncate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/draw.ts packages/renderer/test/truncate.test.ts
git commit -m "feat(renderer): carte encre-d-abord avec rail de type, pastille et valeurs alignees a droite"
```

---

### Task 4: Arêtes, têtes de flèche et calques d'état

**Files:**
- Modify: `packages/renderer/src/draw.ts` (à partir de `const DASH_LENGTH`, jusqu'à la fin)

**Interfaces:**
- Consumes: `Theme` (tâche 2).
- Produces: signatures inchangées pour `drawEdges`, `drawEdgeHitAreas`, `drawSelectionOverlay`, `drawSearchHighlights`, plus un paramètre `metrics` optionnel sur `drawSelectionOverlay` et `drawSearchHighlights` pour le rayon de carte. La tâche 5 les appelle depuis `rebuild()`/`redrawOverlay()`.

- [ ] **Step 1: Remplacer tout le bloc à partir de `const DASH_LENGTH`**

```ts
const DASH_LENGTH = 6;
const GAP_LENGTH = 4;

function dashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;

  let dist = 0;
  let drawing = true;
  let x = x1;
  let y = y1;
  while (dist < len) {
    const step = Math.min(drawing ? DASH_LENGTH : GAP_LENGTH, len - dist);
    const nx = x + ux * step;
    const ny = y + uy * step;
    if (drawing) {
      g.moveTo(x, y);
      g.lineTo(nx, ny);
    }
    x = nx;
    y = ny;
    dist += step;
    drawing = !drawing;
  }
}

const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 3.5;

/** Triangle plein pointant de (x1,y1) vers (x2,y2), sa pointe en (x2,y2). */
function arrowHead(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * ARROW_LENGTH;
  const by = y2 - uy * ARROW_LENGTH;
  // Normale unitaire.
  const nx = -uy;
  const ny = ux;
  g.moveTo(x2, y2)
    .lineTo(bx + nx * ARROW_HALF_WIDTH, by + ny * ARROW_HALF_WIDTH)
    .lineTo(bx - nx * ARROW_HALF_WIDTH, by - ny * ARROW_HALF_WIDTH)
    .closePath();
}

const DANGLING_STUB_LENGTH = 32;
const DANGLING_CROSS_RADIUS = 4;

/**
 * Dessine toutes les arêtes entre nœuds visibles dans un seul Graphics,
 * groupées par style : contenance en béziers horizontales pleines, références
 * résolues en pointillés terminés par une tête de flèche, références cassées
 * en moignon pointillé barré d'une croix.
 *
 * Les têtes de flèche sont des triangles pleins : elles ne peuvent pas
 * partager l'appel `stroke()` des pointillés, d'où un `fill()` distinct émis
 * après lui, sur le même Graphics.
 *
 * Renvoie un Graphics vide en LOD 2 (les arêtes ne sont ni lisibles ni
 * rentables à ce niveau de dézoom).
 */
export function drawEdges(graph: Graph, positions: Map<NodeId, Rect>, theme: Theme, lod: Lod): Graphics {
  const g = new Graphics();
  if (lod === 2) return g;

  let hasContain = false;
  for (const edge of graph.containEdges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    g.moveTo(x1, y1);
    g.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    hasContain = true;
  }
  if (hasContain) g.stroke({ width: theme.strokes.edge, color: theme.edge.contain });

  let hasRef = false;
  const resolved: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const edge of graph.refEdges) {
    if (edge.dangling || edge.to === null) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    // La ligne s'arrête au pied de la flèche pour ne pas la traverser.
    const len = Math.hypot(x2 - x1, y2 - y1);
    const t = len > ARROW_LENGTH ? (len - ARROW_LENGTH) / len : 1;
    dashedLine(g, x1, y1, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    resolved.push({ x1, y1, x2, y2 });
    hasRef = true;
  }
  if (hasRef) {
    g.stroke({ width: theme.strokes.edge, color: theme.edge.ref });
    for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
    g.fill(theme.edge.ref);
  }

  let hasDangling = false;
  for (const edge of graph.refEdges) {
    if (!edge.dangling) continue;
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = x1 + DANGLING_STUB_LENGTH;
    const y2 = y1;
    dashedLine(g, x1, y1, x2, y2);
    const r = DANGLING_CROSS_RADIUS;
    g.moveTo(x2 - r, y2 - r);
    g.lineTo(x2 + r, y2 + r);
    g.moveTo(x2 + r, y2 - r);
    g.lineTo(x2 - r, y2 + r);
    hasDangling = true;
  }
  if (hasDangling) g.stroke({ width: theme.strokes.edge, color: theme.edge.dangling });

  return g;
}

export interface EdgeHit {
  edge: RefEdge;
  graphics: Graphics;
}

const REF_HIT_WIDTH = 14;

/**
 * Une zone de clic invisible et épaissie (14px) par arête de référence
 * visible. Purement géométrique : l'appelant règle `eventMode`/`cursor` et
 * branche le tap. L'alpha est 0, mais le hit-test des Graphics étant
 * géométrique, la forme reste cliquable.
 */
export function drawEdgeHitAreas(graph: Graph, positions: Map<NodeId, Rect>): EdgeHit[] {
  const hits: EdgeHit[] = [];
  for (const edge of graph.refEdges) {
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    let x2: number;
    let y2: number;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      x2 = to.x;
      y2 = to.y + to.height / 2;
    } else {
      x2 = x1 + DANGLING_STUB_LENGTH;
      y2 = y1;
    }
    const g = new Graphics();
    g.moveTo(x1, y1)
      .lineTo(x2, y2)
      .stroke({ width: REF_HIT_WIDTH, color: 0xffffff, alpha: 0, cap: "round" });
    hits.push({ edge, graphics: g });
  }
  return hits;
}

/**
 * Surlignage de sélection : contour sur le nœud, sur sa chaîne de parenté
 * jusqu'à la racine, et sur ses références sortantes (moignons cassés
 * inclus). Renvoie un Graphics vide si rien n'est sélectionné ou si le nœud
 * sélectionné n'est pas visible.
 *
 * C'est le seul endroit, avec les références cassées, où le rouge apparaît :
 * comme plus rien d'autre n'est rouge, la sélection se lit immédiatement.
 */
export function drawSelectionOverlay(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  selectedId: NodeId | null,
): Graphics {
  const g = new Graphics();
  if (!selectedId) return g;
  const rect = positions.get(selectedId);
  if (!rect) return g;

  g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card).stroke({
    width: theme.strokes.selection,
    color: theme.accent.selection,
  });

  let hasChain = false;
  let node = graph.nodes.get(selectedId);
  while (node && node.parentId !== null) {
    const childRect = positions.get(node.id);
    const parentRect = positions.get(node.parentId);
    if (childRect && parentRect) {
      const x1 = parentRect.x + parentRect.width;
      const y1 = parentRect.y + parentRect.height / 2;
      const x2 = childRect.x;
      const y2 = childRect.y + childRect.height / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      g.moveTo(x1, y1).bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      hasChain = true;
    }
    node = graph.nodes.get(node.parentId);
  }
  if (hasChain) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });

  let hasRefs = false;
  for (const edge of graph.refEdges) {
    if (edge.from !== selectedId) continue;
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      dashedLine(g, x1, y1, to.x, to.y + to.height / 2);
    } else {
      dashedLine(g, x1, y1, x1 + DANGLING_STUB_LENGTH, y1);
    }
    hasRefs = true;
  }
  if (hasRefs) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });

  return g;
}

/**
 * Surlignage de recherche : remplissage lavé plus contour sur chaque résultat
 * visible, et un contour renforcé dans la couleur de sélection sur le résultat
 * courant, dessiné en dernier pour passer au-dessus. Un id absent de
 * `positions` est ignoré sans bruit.
 */
export function drawSearchHighlights(
  positions: Map<NodeId, Rect>,
  theme: Theme,
  matchedIds: Iterable<NodeId>,
  currentId: NodeId | null,
): Graphics {
  const g = new Graphics();
  for (const id of matchedIds) {
    if (id === currentId) continue; // dessiné ci-dessous, au-dessus
    const rect = positions.get(id);
    if (!rect) continue;
    g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
      .fill({ color: theme.accent.match, alpha: 0.55 })
      .stroke({ width: theme.strokes.match, color: theme.accent.matchStroke });
  }

  if (currentId !== null) {
    const rect = positions.get(currentId);
    if (rect) {
      g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
        .fill({ color: theme.accent.match, alpha: 0.55 })
        .stroke({ width: theme.strokes.matchCurrent, color: theme.accent.selection });
    }
  }

  return g;
}
```

- [ ] **Step 2: Vérifier que la suite de tests du renderer passe toujours**

Run: `pnpm --filter @defsquare/data-graph test`
Expected: PASS (`theme.test.ts` + `truncate.test.ts`). Le typecheck reste cassé tant que `create.ts` n'est pas fait.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/draw.ts
git commit -m "feat(renderer): tetes de fleche sur les refs, surlignages sur tokens semantiques"
```

---

### Task 5: Câblage du renderer — netteté, métriques réelles, `setTheme()`

**Files:**
- Modify: `packages/renderer/src/camera.ts:41-49` (`fitTo`)
- Create: `packages/renderer/src/font-metrics.ts`
- Modify: `packages/renderer/src/create.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/test/font-metrics.test.ts` (créer)

**Interfaces:**
- Consumes: `entityAccentMap`, `Theme` (tâche 2) ; `drawNode(node, rect, theme, lod, useBitmapText, accent, metrics, expanded)` (tâche 3) ; les fonctions d'arêtes (tâche 4) ; `NodeMetrics`, `DEFAULT_METRICS` (tâche 1).
- Produces: `measureFontMetrics(theme, base) → NodeMetrics` ; `DataGraph.setTheme(theme: Theme | ThemeOverride) → void` ; `DataGraphOptions.theme?: ThemeOverride`.

- [ ] **Step 1: Écrire le test de mesure de police**

Créer `packages/renderer/test/font-metrics.test.ts`. Vitest tourne sous Node sans canvas, donc le chemin testé est celui du repli.

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import { measureFontMetrics } from "../src/font-metrics.js";
import { defsquareLight } from "../src/theme.js";

describe("measureFontMetrics", () => {
  it("retombe sur les metriques de base quand aucun contexte 2D n'existe", () => {
    expect(measureFontMetrics(defsquareLight, DEFAULT_METRICS)).toEqual(DEFAULT_METRICS);
  });

  it("ne modifie jamais l'objet de base", () => {
    const snapshot = { ...DEFAULT_METRICS };
    measureFontMetrics(defsquareLight, DEFAULT_METRICS);
    expect(DEFAULT_METRICS).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @defsquare/data-graph test font-metrics`
Expected: FAIL — le module `../src/font-metrics.js` n'existe pas.

- [ ] **Step 3: Créer `packages/renderer/src/font-metrics.ts`**

```ts
import type { NodeMetrics } from "@defsquare/data-graph-core";
import type { Theme } from "./theme.js";

// Échantillon représentatif du texte réellement affiché : minuscules,
// majuscules, chiffres et ponctuation, dans les proportions d'un identifiant
// ou d'un libellé de champ.
const SAMPLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-_#@/";

/**
 * Mesure l'avance moyenne réelle des quatre rôles typographiques via un
 * contexte 2D hors écran, et renvoie une copie de `base` avec les
 * `*CharWidth` corrigés.
 *
 * Le core ne peut pas faire cette mesure : il tourne en Node, sans DOM. Ses
 * constantes par défaut restent donc des approximations déterministes, et le
 * renderer les affine quand il en a les moyens. Sans contexte disponible
 * (Node, test, jsdom sans canvas), `base` est renvoyé inchangé.
 */
export function measureFontMetrics(theme: Theme, base: NodeMetrics): NodeMetrics {
  const ctx = createContext();
  if (!ctx) return { ...base };

  const advance = (role: "header" | "badge" | "key" | "value"): number => {
    const s = theme.typography[role];
    const family = s.family === "body" ? theme.fonts.body : theme.fonts.mono;
    ctx.font = `${s.weight} ${s.size}px ${family}`;
    const width = ctx.measureText(SAMPLE).width;
    if (!Number.isFinite(width) || width <= 0) return NaN;
    return width / SAMPLE.length + (s.tracking ?? 0) * s.size;
  };

  const header = advance("header");
  const badge = advance("badge");
  const key = advance("key");
  const value = advance("value");

  // Une seule mesure ratée invalide le lot : mélanger des avances mesurées et
  // approximées produirait des cartes incohérentes entre elles.
  if (![header, badge, key, value].every((n) => Number.isFinite(n) && n > 0)) return { ...base };

  return {
    ...base,
    headerCharWidth: header,
    badgeCharWidth: badge,
    keyCharWidth: key,
    valueCharWidth: value,
  };
}

function createContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Lancer le test**

Run: `pnpm --filter @defsquare/data-graph test font-metrics`
Expected: PASS.

- [ ] **Step 5: Plafonner `fitTo` à 1**

Dans `packages/renderer/src/camera.ts`, ajouter la constante après `const MAX_SCALE = 3;` :

```ts
// fitTo ne grossit jamais au-delà de la taille native : agrandir un atlas de
// police cuit à sa taille nominale est exactement ce qui rendait le texte
// cotonneux au premier rendu. Le zoom molette, lui, garde MAX_SCALE.
const MAX_FIT_SCALE = 1;
```

et dans `fitTo`, remplacer `scale = clamp(scale, MIN_SCALE, MAX_SCALE);` par :

```ts
    scale = clamp(scale, MIN_SCALE, MAX_FIT_SCALE);
```

- [ ] **Step 6: Câbler `create.ts`**

Appliquer ces sept modifications à `packages/renderer/src/create.ts` :

**(a)** Ajouter `type NodeMetrics` aux imports depuis `@defsquare/data-graph-core` ; `DEFAULT_METRICS` y reste, il sert de base à la mesure de police. Remplacer ensuite les imports locaux de thème par :

```ts
import { entityAccentMap, resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { measureFontMetrics } from "./font-metrics.js";
```

**(b)** Ajouter `setTheme` à l'interface `DataGraph`, juste après `diagnostics()` :

```ts
  /** Remplace le thème et redessine, sans relancer le layout : les
   * `NodeMetrics` ne dépendent pas du thème, donc les positions restent
   * valides. */
  setTheme(theme: Theme | ThemeOverride): void;
```

**(c)** Remplacer `const theme: Theme = resolveTheme(options.theme);` par un `let`, et déclarer les états dérivés à côté des autres :

```ts
  let theme: Theme = resolveTheme(options.theme);
  let metrics: NodeMetrics = DEFAULT_METRICS;
  let entityAccents = new Map<string, string>();
```

**(d)** Ajouter le helper de résolution d'accent près de `boundsOf` :

```ts
  /** Recalcule la table type d'entité → couleur de rail. L'ordre vient des
   * clés de `config.entities` : déterministe et sous contrôle de l'auteur de
   * la config, contrairement à l'ordre d'apparition dans les données. */
  function refreshEntityAccents(config: DataGraphConfig): void {
    entityAccents = entityAccentMap(Object.keys(config.entities), theme);
  }

  function accentFor(node: GraphNode): string {
    if (node.kind !== "entity") return theme.edge.contain;
    return entityAccents.get(node.entityType) ?? theme.accent.entity;
  }
```

**(e)** Dans `rebuild()`, passer accent, métriques et état d'expansion à `drawNode` :

```ts
      const nodeView = drawNode(
        node,
        rect,
        theme,
        currentLod,
        useBitmapText,
        accentFor(node),
        metrics,
        collapseState.isExpanded(id),
      );
```

**(f)** Dans l'IIFE `ready`, remplacer l'appel `app.init` et corriger `viewport()`. Le `app.init` devient :

```ts
    await app.init({
      background: theme.surface.canvas,
      resizeTo: container,
      antialias: true,
      // Sans ces deux options, le canvas est rendu en 1x puis étiré par le CSS
      // sur tout écran à forte densité — la cause principale du flou.
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    });
```

et `viewport()` (déclaré plus haut) devient :

```ts
  function viewport(): Size {
    // `renderer.screen` est en pixels CSS, comme le `stage`. `renderer.width`
    // est en pixels device dès qu'`autoDensity` est actif et casserait donc
    // `fitTo`/`centerOn` sur écran Retina.
    const screen = app.renderer?.screen;
    return { width: screen?.width ?? 0, height: screen?.height ?? 0 };
  }
```

Toujours dans `ready`, juste après `graph = buildGraph(...)`, insérer :

```ts
    metrics = measureFontMetrics(theme, DEFAULT_METRICS);
    refreshEntityAccents(currentConfig);
```

et passer les métriques aux deux appels de layout de ce bloc :

```ts
      layoutResult = await engine.layout(graph, visible, metrics);
```
```ts
      layoutResult = await engine.layout(graph, visible, metrics);
```
(dans le `try` et dans le `catch`).

**(g)** Passer `metrics` partout ailleurs où le layout est invoqué :
- `doExpand` : `await engine.layoutAfterExpand(layoutResult, graph, id, visible, metrics)`
- `focusOn` : `await engine.layoutAfterExpand(layoutResult, graph, ancestorId, collapseState.visibleNodeIds(), metrics)`
- `doSetData` : les deux appels `newEngine.layout(newGraph, visible, metrics)`, et ajouter `refreshEntityAccents(config);` juste après `currentConfig = config;`
- `layoutAfterCollapse` ne prend pas de métriques : ne pas y toucher.

**(h)** Corriger la géométrie de `handleNodeTap` (elle utilise encore `DEFAULT_METRICS` et ignore le padding bas) :

```ts
    if (currentLod === 0) {
      const local = view.toLocal(event.global);
      if (local.y < metrics.headerHeight) {
        if (node.childIds.length > 0) {
          toggleExpand(node.id);
          return;
        }
      } else {
        const rowIndex = Math.floor((local.y - metrics.headerHeight) / metrics.rowHeight);
        // Un clic dans le padding bas ne tombe sur aucune ligne.
        const row = rowIndex < node.rows.length ? node.rows[rowIndex] : undefined;
        if (row) {
```

**(i)** Implémenter `setTheme` dans l'objet retourné, après `diagnostics()` :

```ts
    setTheme(next: Theme | ThemeOverride): void {
      if (destroyed) return;
      // Un Theme complet est reconnaissable à la présence de `entityPalette` ;
      // une surcharge partielle est fusionnée sur le thème courant.
      theme =
        "entityPalette" in next && Array.isArray(next.entityPalette)
          ? (next as Theme)
          : resolveTheme(next as ThemeOverride, theme);
      refreshEntityAccents(currentConfig);
      if (app.renderer) app.renderer.background.color = theme.surface.canvas;
      rebuild();
    },
```

- [ ] **Step 7: Exporter les nouveaux symboles**

Dans `packages/renderer/src/index.ts`, ajouter :

```ts
export { measureFontMetrics } from "./font-metrics.js";
```

et ajouter `charWidthFor`, `truncateToWidth` à l'export existant depuis `./draw.js`, ainsi que `type TextRole`.

- [ ] **Step 8: Typecheck et tests complets**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS partout. Si `fontWeight: String(s.weight) as never` pose problème au typecheck, remplacer par le type Pixi attendu (`TextStyleFontWeight`) importé depuis `pixi.js`.

- [ ] **Step 9: Vérifier visuellement dans la démo**

Run: `pnpm --filter demo dev`
Ouvrir `http://localhost:5173`. Attendu : cartes claires à rail coloré, texte net, aucune valeur ne dépasse de sa carte. La démo n'est pas encore restylée (tâches 6-7) — seul le canvas doit avoir changé.

- [ ] **Step 10: Commit**

```bash
git add packages/renderer/src/create.ts packages/renderer/src/camera.ts packages/renderer/src/font-metrics.ts packages/renderer/src/index.ts packages/renderer/test/font-metrics.test.ts
git commit -m "feat(renderer): resolution device, metriques de police reelles, plafond de fit et setTheme"
```

---

### Task 6: Shell de démo — structure et styles

**Files:**
- Modify: `apps/demo/index.html` (réécriture complète)
- Modify: `apps/demo/src/style.css` (réécriture complète)

Les logos sont **déjà** vendorisés dans `apps/demo/public/defsquare-short-dark-red.svg` et `apps/demo/public/defsquare-short-white-red.svg` (commit `58cf2bc`). Ne pas les recréer.

**Interfaces:**
- Consumes: rien.
- Produces: les ids DOM que la tâche 7 câble — `#app`, `#search`, `#prev-match`, `#next-match`, `#match-counter`, `#toggle-dataset`, `#fit`, `#toggle-theme`, `#logo`, `#stat-nodes`, `#stat-visible`, `#stat-diagnostics`, `#selection-type`, `#selection-label`, `#selection-path`, `#selection-rows`, `#selection-empty`.

- [ ] **Step 1: Réécrire `apps/demo/index.html`**

```html
<!doctype html>
<html lang="fr" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>data-graph — defsquare</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Fira+Code:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="page">
      <header id="appbar">
        <div class="brand">
          <img id="logo" src="/defsquare-short-dark-red.svg" alt="defsquare" />
          <span class="brand-sep" aria-hidden="true"></span>
          <h1>data-graph</h1>
        </div>

        <div class="findbar">
          <svg class="findbar-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <input type="search" id="search" placeholder="Rechercher…" autocomplete="off" aria-label="Rechercher" />
          <span id="match-counter" aria-live="polite"></span>
          <button id="prev-match" class="findbar-nav" title="Résultat précédent (Maj+Entrée)" aria-label="Résultat précédent">↑</button>
          <button id="next-match" class="findbar-nav" title="Résultat suivant (Entrée)" aria-label="Résultat suivant">↓</button>
        </div>

        <div class="actions">
          <button id="fit" class="btn">Ajuster</button>
          <button id="toggle-dataset" class="btn btn-accent">Jeu de données étendu (2000)</button>
          <button id="toggle-theme" class="btn btn-icon" title="Basculer clair/sombre" aria-label="Basculer clair/sombre">◐</button>
        </div>
      </header>

      <div id="layout">
        <div id="app"></div>
        <aside id="detail">
          <h2>Détail du nœud</h2>
          <p id="selection-empty">Sélectionnez un nœud pour voir son détail.</p>
          <span id="selection-type" hidden></span>
          <p id="selection-label" hidden></p>
          <p id="selection-path" hidden></p>
          <dl id="selection-rows"></dl>
        </aside>
      </div>

      <footer id="statusbar">
        <span><strong id="stat-nodes">0</strong> nœuds</span>
        <span><strong id="stat-visible">0</strong> visibles</span>
        <button id="stat-diagnostics" class="status-link" hidden></button>
      </footer>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Réécrire `apps/demo/src/style.css`**

```css
/* Shell defsquare pour la démo data-graph.
   Les tokens sont recopiés de colors_and_type.css du DS defsquare ; le canvas
   reste le héros, le chrome se tient en retrait. */

:root {
  --ds-canvas: #eef0f3;
  --ds-surface: #ffffff;
  --ds-surface-muted: #f7f7f8;
  --ds-ink: #172741;
  --ds-fg: #070f19;
  --ds-muted: #4b5563;
  --ds-subtle: #9ca3af;
  --ds-accent: #f65e5e;
  --ds-primary: #1e416e;
  --ds-border: #dfe3e9;
  --ds-border-soft: #f1f1f3;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-full: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);

  --transition: 150ms ease-in-out;

  --font-title: "EB Garamond", Garamond, Cambria, Georgia, serif;
  --font-body: "IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "Fira Code", "SF Mono", Menlo, Consolas, monospace;
}

html[data-theme="dark"] {
  --ds-canvas: #161a2c;
  --ds-surface: #1e2335;
  --ds-surface-muted: #1a1f30;
  --ds-ink: #f0f5fc;
  --ds-fg: #f0f5fc;
  --ds-muted: #9bb2d9;
  --ds-subtle: #6b7794;
  --ds-primary: #3573c3;
  --ds-border: #2c3247;
  --ds-border-soft: #272d42;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.4);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.45), 0 2px 4px -2px rgb(0 0 0 / 0.45);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--ds-canvas);
  color: var(--ds-fg);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

#page {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
}

/* ---------- Barre d'application ---------- */

#appbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: var(--ds-surface);
  border-bottom: 1px solid var(--ds-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: none;
}

#logo { height: 22px; width: auto; display: block; }

.brand-sep {
  width: 1px;
  height: 20px;
  background: var(--ds-border);
}

#appbar h1 {
  margin: 0;
  font-family: var(--font-title);
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--ds-ink);
  white-space: nowrap;
}

/* ---------- Barre de recherche ---------- */

.findbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 1 380px;
  margin: 0 auto;
  padding: 0 var(--space-1) 0 var(--space-2);
  background: var(--ds-surface-muted);
  border: 1px solid var(--ds-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition), box-shadow var(--transition);
}

.findbar:focus-within {
  border-color: var(--ds-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ds-primary) 18%, transparent);
}

.findbar-icon { width: 15px; height: 15px; flex: none; color: var(--ds-subtle); }

#search {
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ds-fg);
  background: none;
  border: 0;
  outline: none;
}

#search::-webkit-search-cancel-button { display: none; }

#match-counter {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ds-subtle);
  padding: 0 var(--space-1);
  white-space: nowrap;
}

.findbar-nav {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--ds-muted);
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition), color var(--transition);
}

.findbar-nav:hover { background: var(--ds-border-soft); color: var(--ds-ink); }

/* ---------- Actions ---------- */

.actions { display: flex; align-items: center; gap: var(--space-2); flex: none; }

.btn {
  font-family: inherit;
  font-size: 13px;
  padding: 6px 12px;
  color: var(--ds-fg);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--transition), color var(--transition), background-color var(--transition);
}

.btn:hover { border-color: var(--ds-primary); color: var(--ds-primary); }
.btn:active { background: var(--ds-surface-muted); }
.btn:disabled { opacity: 0.5; cursor: default; }

.btn:focus-visible {
  outline: 2px solid var(--ds-primary);
  outline-offset: 2px;
}

.btn-accent { border-color: var(--ds-accent); color: var(--ds-accent); }
.btn-accent:hover { background: var(--ds-accent); border-color: var(--ds-accent); color: #ffffff; }

.btn-icon { width: 32px; padding: 6px 0; text-align: center; }

/* ---------- Corps ---------- */

#layout { display: flex; flex: 1; min-height: 0; }

#app {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: block;
  background: var(--ds-canvas);
}

#detail {
  width: 300px;
  flex: none;
  overflow-y: auto;
  padding: var(--space-4);
  background: var(--ds-surface);
  border-left: 1px solid var(--ds-border);
  font-size: 13px;
}

#detail h2 {
  margin: 0 0 var(--space-4);
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#selection-empty { margin: 0; color: var(--ds-muted); }

#selection-type {
  display: inline-block;
  padding: 2px 7px;
  margin-bottom: var(--space-2);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ds-surface);
  background: var(--ds-primary);
  border-radius: var(--radius-sm);
}

#selection-label {
  margin: 0 0 var(--space-1);
  font-size: 15px;
  font-weight: 600;
  color: var(--ds-ink);
}

#selection-path {
  margin: 0 0 var(--space-4);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ds-subtle);
  word-break: break-all;
}

#selection-rows { margin: 0; }

#selection-rows .row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 5px 0;
  border-top: 1px solid var(--ds-border-soft);
}

#selection-rows dt {
  flex: none;
  color: var(--ds-muted);
  font-size: 12px;
}

#selection-rows dd {
  flex: 1;
  margin: 0;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ds-fg);
  word-break: break-all;
}

#selection-rows .ref-btn {
  flex: none;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1;
  color: var(--ds-primary);
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

#selection-rows .ref-btn:hover { color: var(--ds-accent); }
#selection-rows .ref-btn[disabled] { color: var(--ds-subtle); cursor: default; }

/* ---------- Barre d'état ---------- */

#statusbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-1) var(--space-4);
  background: var(--ds-surface);
  border-top: 1px solid var(--ds-border);
  font-size: 11px;
  color: var(--ds-muted);
}

#statusbar strong {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--ds-ink);
}

.status-link {
  margin-left: auto;
  font-family: inherit;
  font-size: 11px;
  color: var(--ds-accent);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.status-link:hover { text-decoration: underline; }
```

- [ ] **Step 3: Vérifier le rendu**

Run: `pnpm --filter demo dev`
Attendu : la page s'affiche avec le logo, la barre de recherche groupée et la barre d'état. Les compteurs restent à 0 et le bouton de thème ne fait rien — c'est la tâche 7. Aucune erreur console autre que d'éventuels avertissements Pixi.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/index.html apps/demo/src/style.css
git commit -m "feat(demo): shell de marque defsquare, barre de recherche groupee et barre d'etat"
```

---

### Task 7: Câblage de la démo et tests e2e

**Files:**
- Modify: `apps/demo/src/main.ts`
- Modify: `apps/demo/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `setTheme`, `defsquareLight`, `defsquareDark` (tâches 2 et 5) ; les ids DOM de la tâche 6.
- Produces: `window.__graph` (inchangé) et `window.__theme` (nom du thème courant), pour les tests e2e.

- [ ] **Step 1: Écrire les tests e2e qui échouent**

Ajouter à la fin de `apps/demo/e2e/smoke.spec.ts` :

```ts
test("la barre d'etat affiche des compteurs non nuls", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("#stat-nodes")).not.toHaveText("0")
  await expect(page.locator("#stat-visible")).not.toHaveText("0")
})

test("le bouton de theme bascule clair et sombre", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.click("#toggle-theme")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator("#logo")).toHaveAttribute("src", "/defsquare-short-white-red.svg")
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.click("#toggle-theme")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  expect(errors).toEqual([])
})

test("le panneau de detail montre le type et permet de suivre une reference", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.select("/orders/0"))
  await expect(page.locator("#selection-type")).toHaveText("ORDER")
  await expect(page.locator("#selection-path")).toContainText("/orders/0")
  await page.click("#selection-rows .ref-btn:not([disabled])")
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("une reference cassee est signalee dans la barre d'etat", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("#stat-diagnostics")).toBeVisible()
  await expect(page.locator("#stat-diagnostics")).toContainText("1")
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm --filter demo e2e`
Expected: les quatre nouveaux tests FAIL (compteurs à `0`, `#toggle-theme` sans effet, `#selection-type` vide).

- [ ] **Step 3: Câbler `apps/demo/src/main.ts`**

Appliquer ces cinq ajouts. Le bloc de recherche existant (debounce, Entrée/Maj+Entrée, compteur) et le bloc de bascule de dataset restent tels quels, à l'exception des points notés.

**(a)** Compléter l'import de tête :

```ts
import {
  createDataGraph,
  defsquareLight,
  defsquareDark,
  type GraphNode,
  type RefEdge,
} from "@defsquare/data-graph";
```

**(b)** Remplacer entièrement le bloc du panneau de détail (de `const labelEl` jusqu'à `graph.on("select", ...)` inclus) :

```ts
const typeEl = document.getElementById("selection-type");
const emptyEl = document.getElementById("selection-empty");
const labelEl = document.getElementById("selection-label");
const pathEl = document.getElementById("selection-path");
const rowsEl = document.getElementById("selection-rows");

/** Les arêtes de référence sortantes du nœud, indexées par champ source —
 * c'est ce qui permet au panneau d'afficher un bouton « suivre » sur les
 * bonnes lignes, sans connaître les internes de la lib. */
function outgoingRefs(nodeId: string): Map<string, RefEdge> {
  const map = new Map<string, RefEdge>();
  for (const edge of graph.refEdges(nodeId)) map.set(edge.field, edge);
  return map;
}

function clearSelection(): void {
  emptyEl?.removeAttribute("hidden");
  for (const el of [typeEl, labelEl, pathEl]) el?.setAttribute("hidden", "");
  rowsEl?.replaceChildren();
}

function renderSelection(node: GraphNode): void {
  emptyEl?.setAttribute("hidden", "");
  for (const el of [labelEl, pathEl]) el?.removeAttribute("hidden");

  if (typeEl) {
    if (node.kind === "entity") {
      typeEl.textContent = node.entityType.toUpperCase();
      typeEl.removeAttribute("hidden");
    } else {
      typeEl.setAttribute("hidden", "");
    }
  }
  if (labelEl) labelEl.textContent = node.label;
  if (pathEl) pathEl.textContent = node.path.length > 0 ? `/${node.path.join("/")}` : "/";

  if (!rowsEl) return;
  const refs = outgoingRefs(node.id);
  rowsEl.replaceChildren(
    ...node.rows.flatMap((row) => {
      const wrapper = document.createElement("div");
      wrapper.className = "row";

      const dt = document.createElement("dt");
      dt.textContent = row.key;
      const dd = document.createElement("dd");
      dd.textContent = String(row.value);
      wrapper.append(dt, dd);

      const ref = refs.get(row.key);
      if (ref) {
        const btn = document.createElement("button");
        btn.className = "ref-btn";
        btn.textContent = "→";
        if (ref.to === null || ref.dangling) {
          btn.disabled = true;
          btn.title = `Référence cassée : ${ref.targetType}#${ref.targetId}`;
        } else {
          btn.title = `Aller à ${ref.targetType}#${ref.targetId}`;
          btn.addEventListener("click", () => {
            graph.select(ref.to!);
            graph.focus(ref.to!);
          });
        }
        wrapper.append(btn);
      }
      return [wrapper];
    }),
  );
}

graph.on("select", (node: GraphNode) => {
  renderSelection(node);
  updateStatus();
});
```

**(c)** Ajouter la barre d'état, après le bloc de recherche :

```ts
// --- Barre d'état : compteurs et diagnostics.
const statNodesEl = document.getElementById("stat-nodes");
const statVisibleEl = document.getElementById("stat-visible");
const statDiagEl = document.getElementById("stat-diagnostics");

function updateStatus(): void {
  const stats = graph.stats();
  if (statNodesEl) statNodesEl.textContent = String(stats.logicalNodeCount);
  if (statVisibleEl) statVisibleEl.textContent = String(stats.visibleNodeCount);

  const diagnostics = graph.diagnostics();
  if (!statDiagEl) return;
  if (diagnostics.length === 0) {
    statDiagEl.setAttribute("hidden", "");
    return;
  }
  statDiagEl.removeAttribute("hidden");
  statDiagEl.textContent = `${diagnostics.length} diagnostic${diagnostics.length > 1 ? "s" : ""}`;
}

statDiagEl?.addEventListener("click", () => {
  for (const d of graph.diagnostics()) console.warn(`[data-graph] ${d.code} @ ${d.path}: ${d.message}`);
});
```

**(d)** Ajouter la bascule de thème et le bouton d'ajustement :

```ts
// --- Thème : la lib et le shell DOM basculent ensemble.
const themeBtn = document.getElementById("toggle-theme");
const logoEl = document.getElementById("logo") as HTMLImageElement | null;
let dark = false;

declare global {
  interface Window {
    __theme?: string;
  }
}

function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  if (logoEl) {
    logoEl.src = dark ? "/defsquare-short-white-red.svg" : "/defsquare-short-dark-red.svg";
  }
  graph.setTheme(dark ? defsquareDark : defsquareLight);
  window.__theme = dark ? "dark" : "light";
}

themeBtn?.addEventListener("click", () => {
  dark = !dark;
  applyTheme();
});

document.getElementById("fit")?.addEventListener("click", () => graph.fit());
```

**(e)** Dans le handler de `#toggle-dataset`, remplacer les lignes qui vidaient le panneau (`if (labelEl) labelEl.textContent = ...` et les deux suivantes) par :

```ts
        clearSelection();
        updateStatus();
```

et remplacer le texte du bouton par `"Jeu de données réduit"` / `"Jeu de données étendu (2000)"`.

Enfin, dans l'IIFE finale, ajouter `updateStatus()` :

```ts
void (async () => {
  await graph.ready;
  graph.fit();
  applyTheme();
  updateStatus();
})();
```

- [ ] **Step 4: Ajouter `stats()` et `refEdges()` à l'API publique du renderer**

Le panneau et la barre d'état ont besoin de deux informations que la lib n'expose pas encore. Dans `packages/renderer/src/create.ts`, ajouter à l'interface `DataGraph` :

```ts
  /** Compteurs pour une barre d'état hôte. */
  stats(): { logicalNodeCount: number; visibleNodeCount: number };
  /** Les arêtes de référence sortantes d'un nœud, pour qu'un hôte puisse
   * proposer « suivre la référence » sans connaître les internes. */
  refEdges(from: NodeId): RefEdge[];
```

et dans l'objet retourné, après `diagnostics()` :

```ts
    stats(): { logicalNodeCount: number; visibleNodeCount: number } {
      return {
        logicalNodeCount: graph?.logicalNodeCount ?? 0,
        visibleNodeCount: collapseState?.visibleNodeIds().size ?? 0,
      };
    },

    refEdges(from: NodeId): RefEdge[] {
      return graph ? graph.refEdges.filter((e) => e.from === from) : [];
    },
```

- [ ] **Step 5: Lancer typecheck, tests unitaires et e2e**

Run: `pnpm -r typecheck && pnpm -r test && pnpm --filter demo e2e`
Expected: PASS partout, les huit tests e2e inclus.

- [ ] **Step 6: Commit**

```bash
git add apps/demo/src/main.ts apps/demo/e2e/smoke.spec.ts packages/renderer/src/create.ts
git commit -m "feat(demo): bascule de theme, barre d'etat et suivi de reference dans le panneau"
```

---

### Task 8: Documentation et vérification de non-régression

**Files:**
- Modify: `packages/renderer/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: l'API publique finale des tâches 2, 5 et 7.
- Produces: rien de consommé par du code.

- [ ] **Step 1: Mesurer le coût des polices en résolution 2**

Run: `pnpm bench`
Noter le résultat. Le bench mesure le core (build + layout), donc il ne devrait pas bouger ; s'il régresse de plus de 10%, c'est que la tâche 1 a alourdi `measureNode` — investiguer avant de continuer.

- [ ] **Step 2: Mesurer le rendu sur le gros jeu de données**

Run: `pnpm --filter demo dev`
Charger le jeu de données étendu (2000), basculer le thème, dézoomer jusqu'au LOD 2, rezoomer. Vérifier dans l'onglet Performance du navigateur qu'aucune image ne dépasse 32 ms en régime établi. Quatre atlas de police en résolution 2 pèsent environ huit fois la mémoire de texture de l'ancienne paire en résolution 1 : si la mémoire GPU pose problème, ramener `FONT_RESOLUTION` à 1.5 dans `draw.ts` et re-mesurer.

- [ ] **Step 3: Mettre à jour `packages/renderer/README.md`**

Remplacer chaque exemple de thème par la nouvelle forme. Le bloc de surcharge devient :

```ts
import { createDataGraph, defsquareDark, resolveTheme } from "@defsquare/data-graph";

// Surcharge partielle : tout token non mentionné vient de defsquareLight.
const graph = createDataGraph(el, {
  data,
  config,
  theme: {
    accent: { selection: "#0ea5e9" },
    byEntityType: { Customer: { accent: "#3dbf9e" } },
  },
});

// Bascule complète vers le thème sombre, à chaud.
graph.setTheme(defsquareDark);

// Ou une variante du sombre.
graph.setTheme(resolveTheme({ surface: { canvas: "#000000" } }, defsquareDark));
```

Documenter également `stats()` et `refEdges(from)` dans la liste des méthodes, et remplacer toute mention de `theme.colors.*` par le groupe sémantique correspondant.

- [ ] **Step 4: Mettre à jour le `README.md` racine**

Le README racine contient un exemple de thème sombre (ajouté au commit `bcfcc9b`). Le remplacer par `graph.setTheme(defsquareDark)` et corriger toute mention de l'ancienne forme `colors`/`fonts`.

- [ ] **Step 5: Vérification finale complète**

Run: `pnpm -r typecheck && pnpm -r test && pnpm --filter demo e2e && pnpm -r build`
Expected: PASS partout.

- [ ] **Step 6: Commit**

```bash
git add README.md packages/renderer/README.md
git commit -m "docs: documente le contrat de theme semantique, setTheme, stats et refEdges"
```

---

## Notes pour l'exécutant

**Ordre imposé.** Les tâches 1 à 5 se suivent strictement : chacune casse le typecheck du renderer jusqu'à ce que la tâche 5 le referme. Ne pas s'alarmer d'un typecheck rouge entre les tâches 1 et 4 — les steps le disent explicitement quand c'est attendu. En revanche, les tests unitaires de chaque tâche doivent passer avant de commiter.

**Ce qui n'est pas négociable.** Le core ne touche pas au DOM. La troncature dans `draw.ts` utilise la même avance par rôle que `measureNode` — c'est l'invariant qui corrige le bug de débordement, et le test de la tâche 3 le garde. `viewport()` lit `renderer.screen`, pas `renderer.width`.

**Ce qui reste à l'appréciation.** Les positions exactes en pixels du chevron et de la pastille, si le rendu paraît décalé à l'œil. Le `FONT_RESOLUTION` peut descendre à 1.5 si la mémoire GPU pose problème sur le gros jeu de données.
