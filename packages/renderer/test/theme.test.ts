import { describe, it, expect } from "vitest";
import {
  defsquareTheme,
  neutralLightTheme,
  neutralDarkTheme,
  resolveTheme,
} from "../src/index.js";

describe("theme", () => {
  it("resolveTheme() with no argument should deep-equal defsquareTheme", () => {
    const resolved = resolveTheme();
    expect(resolved).toEqual(defsquareTheme);
  });

  it("resolveTheme({ colors: { entity: '#000000' } }) should change only entity color", () => {
    const custom = resolveTheme({ colors: { entity: "#000000" } });
    expect(custom.colors.entity).toBe("#000000");
    // All other colors should match defsquareTheme
    expect(custom.colors.background).toBe(defsquareTheme.colors.background);
    expect(custom.colors.nodeFill).toBe(defsquareTheme.colors.nodeFill);
    expect(custom.colors.nodeStroke).toBe(defsquareTheme.colors.nodeStroke);
    expect(custom.colors.text).toBe(defsquareTheme.colors.text);
    expect(custom.colors.textMuted).toBe(defsquareTheme.colors.textMuted);
    expect(custom.colors.refEdge).toBe(defsquareTheme.colors.refEdge);
    expect(custom.colors.containEdge).toBe(defsquareTheme.colors.containEdge);
    expect(custom.colors.selection).toBe(defsquareTheme.colors.selection);
    expect(custom.colors.searchHighlight).toBe(defsquareTheme.colors.searchHighlight);
    expect(custom.colors.danglingRef).toBe(defsquareTheme.colors.danglingRef);
    // Fonts should also match
    expect(custom.fonts.body).toBe(defsquareTheme.fonts.body);
    expect(custom.fonts.mono).toBe(defsquareTheme.fonts.mono);
  });

  it("resolveTheme({ byEntityType: { Customer: { accent: '#ff0000' } } }) should include byEntityType AND keep colors/fonts from defsquareTheme", () => {
    const custom = resolveTheme({
      byEntityType: { Customer: { accent: "#ff0000" } },
    });
    expect(custom.byEntityType).toEqual({ Customer: { accent: "#ff0000" } });
    expect(custom.colors).toEqual(defsquareTheme.colors);
    expect(custom.fonts).toEqual(defsquareTheme.fonts);
  });

  it("all three themes should have exactly the same keys", () => {
    const defsquareKeys = {
      fonts: Object.keys(defsquareTheme.fonts).sort(),
      colors: Object.keys(defsquareTheme.colors).sort(),
    };

    const neutralLightKeys = {
      fonts: Object.keys(neutralLightTheme.fonts).sort(),
      colors: Object.keys(neutralLightTheme.colors).sort(),
    };

    const neutralDarkKeys = {
      fonts: Object.keys(neutralDarkTheme.fonts).sort(),
      colors: Object.keys(neutralDarkTheme.colors).sort(),
    };

    expect(neutralLightKeys).toEqual(defsquareKeys);
    expect(neutralDarkKeys).toEqual(defsquareKeys);
  });
});
