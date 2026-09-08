// Freeze of the shipped values: proves the move to tokens is a neutral refactor.
// Any deliberate change to a theme must update this freeze and say so in the
// commit.
//
// The deep-equal is deliberately TOTAL (rather than a sample of keys): a value
// drifting — a color, a font size, a stroke width, the order of the entity
// palette — would change the shipped rendering without any other test noticing,
// `theme.test.ts` only checking the shape of the groups.
import { describe, it, expect } from "vitest";
import { defsquareLight, defsquareDark, neutralLight, neutralDark } from "../src/index.js";

const DEFSQUARE_FONTS = {
  body: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif",
  mono: "Fira Code, SF Mono, Menlo, Consolas, monospace",
};

const DEFSQUARE_PALETTE = ["#1e416e", "#f65e5e", "#3dbf9e", "#8d7e63", "#3573c3", "#a0427a"];

const NEUTRAL_FONTS = { body: "system-ui, sans-serif", mono: "monospace" };

const NEUTRAL_PALETTE = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#0891b2", "#be123c"];

const TYPOGRAPHY = {
  header: { family: "body", size: 13, weight: 600 },
  badge: { family: "body", size: 9.5, weight: 600, tracking: 0.08 },
  key: { family: "body", size: 12, weight: 400 },
  value: { family: "mono", size: 12, weight: 400 },
};

const RADII = { card: 6 };

const STROKES = { border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 };

describe("frozen values of the shipped themes", () => {
  it("defsquareLight", () => {
    expect(defsquareLight).toEqual({
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
    });
  });

  it("defsquareDark", () => {
    expect(defsquareDark).toEqual({
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
    });
  });

  it("neutralLight", () => {
    expect(neutralLight).toEqual({
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
    });
  });

  it("neutralDark", () => {
    expect(neutralDark).toEqual({
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
    });
  });
});
