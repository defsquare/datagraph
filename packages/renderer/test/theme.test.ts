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

describe("theme contract", () => {
  it.each(ALL)("%s defines every group and every token", (_name, theme) => {
    expect(Object.keys(theme.surface).sort()).toEqual(["canvas", "card", "cardMuted"]);
    expect(Object.keys(theme.ink).sort()).toEqual(["muted", "primary", "subtle"]);
    expect(Object.keys(theme.accent).sort()).toEqual([
      "entity", "match", "matchStroke", "selection",
    ]);
    expect(Object.keys(theme.edge).sort()).toEqual([
      "border", "contain", "dangling", "hairline", "ref",
    ]);
    expect(Object.keys(theme.typography).sort()).toEqual(["badge", "header", "key", "value"]);
    expect(Object.keys(theme.radii).sort()).toEqual(["card"]);
    expect(Object.keys(theme.strokes).sort()).toEqual([
      "border", "edge", "match", "matchCurrent", "selection",
    ]);
  });

  it.each(ALL)("%s has nothing but valid hex colors", (_name, theme) => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const group of [theme.surface, theme.ink, theme.accent, theme.edge]) {
      for (const [key, value] of Object.entries(group)) {
        expect(value, key).toMatch(hex);
      }
    }
    for (const color of theme.entityPalette) expect(color).toMatch(hex);
  });

  it.each(ALL)("%s has a non-empty entity palette", (_name, theme) => {
    expect(theme.entityPalette.length).toBeGreaterThan(0);
  });
});

describe("resolveTheme", () => {
  it("with no argument, equals defsquareLight", () => {
    expect(resolveTheme()).toEqual(defsquareLight);
  });

  it("merges deeply without overwriting siblings", () => {
    const custom = resolveTheme({ accent: { selection: "#000000" } });
    expect(custom.accent.selection).toBe("#000000");
    expect(custom.accent.entity).toBe(defsquareLight.accent.entity);
    expect(custom.accent.matchStroke).toBe(defsquareLight.accent.matchStroke);
    expect(custom.surface).toEqual(defsquareLight.surface);
    expect(custom.typography).toEqual(defsquareLight.typography);
  });

  it("merges a partial typographic style", () => {
    const custom = resolveTheme({ typography: { header: { size: 16 } } });
    expect(custom.typography.header.size).toBe(16);
    expect(custom.typography.header.weight).toBe(defsquareLight.typography.header.weight);
    expect(custom.typography.header.family).toBe(defsquareLight.typography.header.family);
    expect(custom.typography.key).toEqual(defsquareLight.typography.key);
  });

  it("accepts an explicit base, which is what allows customizing the dark theme", () => {
    const custom = resolveTheme({ accent: { selection: "#00ff00" } }, defsquareDark);
    expect(custom.accent.selection).toBe("#00ff00");
    expect(custom.surface.canvas).toBe(defsquareDark.surface.canvas);
  });

  it("preserves byEntityType", () => {
    const custom = resolveTheme({ byEntityType: { Customer: { accent: "#ff0000" } } });
    expect(custom.byEntityType).toEqual({ Customer: { accent: "#ff0000" } });
  });

  // Regression, fix round 1, finding 1: `setTheme` (create.ts) delegates
  // straight to `resolveTheme(next as ThemeOverride, theme)`, with no
  // Theme/ThemeOverride discriminant — an old discriminant based on the presence
  // of `entityPalette` wrongly mistook an override that only sets the palette for
  // a full Theme, and the resulting cast blew up `theme.surface.canvas`
  // downstream. An override that sets only `entityPalette` must stay an ordinary
  // override: no throw, and nothing changed but the palette (hence the rail
  // colors), the rest of the theme staying the base's.
  it("does not crash on an override setting only entityPalette, and changes nothing but the palette", () => {
    const overriddenPalette = ["#111111", "#222222", "#333333"];
    let custom: Theme | undefined;
    expect(() => {
      custom = resolveTheme({ entityPalette: overriddenPalette }, defsquareLight);
    }).not.toThrow();
    expect(custom!.entityPalette).toEqual(overriddenPalette);
    // The rest of the theme (needed for rendering, e.g. the canvas background)
    // must come through intact from the base — not from a faulty cast to a
    // partial Theme.
    expect(custom!.surface).toEqual(defsquareLight.surface);
    expect(custom!.typography).toEqual(defsquareLight.typography);

    // And the consequence the caller can observe: the rails change.
    const before = entityAccentMap(["Customer", "Order"], defsquareLight);
    const after = entityAccentMap(["Customer", "Order"], custom!);
    expect(after.get("Customer")).toBe(overriddenPalette[0]);
    expect(after.get("Order")).toBe(overriddenPalette[1]);
    expect(after.get("Customer")).not.toBe(before.get("Customer"));
  });

  it("is idempotent on a full Theme (setTheme(fullTheme) reproduces fullTheme exactly)", () => {
    // This idempotence is what lets `setTheme` always call
    // `resolveTheme(next as ThemeOverride, theme)` even when `next` is a full
    // Theme, without needing to tell it apart from an override. A complete
    // `Theme` is structurally assignable to `ThemeOverride` (every `DeepPartial`
    // group accepts a fully populated object).
    expect(resolveTheme(defsquareDark, defsquareLight)).toEqual(defsquareDark);
  });
});

describe("entityAccentMap", () => {
  it("assigns the colors in the palette's order", () => {
    const map = entityAccentMap(["Customer", "Order"], defsquareLight);
    expect(map.get("Customer")).toBe(defsquareLight.entityPalette[0]);
    expect(map.get("Order")).toBe(defsquareLight.entityPalette[1]);
  });

  it("wraps around beyond the palette's length", () => {
    const types = Array.from({ length: 8 }, (_, i) => `T${i}`);
    const map = entityAccentMap(types, defsquareLight);
    const n = defsquareLight.entityPalette.length;
    expect(map.get("T0")).toBe(map.get(`T${n}`));
  });

  it("is deterministic for a given input order", () => {
    const a = entityAccentMap(["A", "B", "C"], defsquareLight);
    const b = entityAccentMap(["A", "B", "C"], defsquareLight);
    expect([...a]).toEqual([...b]);
  });

  it("byEntityType overrides the palette", () => {
    const theme = resolveTheme({ byEntityType: { Order: { accent: "#123456" } } });
    const map = entityAccentMap(["Customer", "Order"], theme);
    expect(map.get("Order")).toBe("#123456");
    expect(map.get("Customer")).toBe(theme.entityPalette[0]);
  });

  it("falls back to accent.entity when the palette is empty", () => {
    const theme = resolveTheme({ entityPalette: [] });
    expect(entityAccentMap(["Customer"], theme).get("Customer")).toBe(theme.accent.entity);
  });
});
