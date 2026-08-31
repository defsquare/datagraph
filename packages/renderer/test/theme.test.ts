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
