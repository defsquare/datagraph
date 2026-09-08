import { describe, expect, it } from "vitest";
import {
  chrome, cssFontStack, defsquare, motion, neutral, pixiFontStack,
  radii, spacing, strokes, typography,
} from "../src/index.js";

describe("tokens defsquare", () => {
  it("carries the current light colors", () => {
    expect(defsquare.light.surface).toEqual({ canvas: "#eef0f3", card: "#ffffff", cardMuted: "#f7f7f8" });
    expect(defsquare.light.ink).toEqual({ primary: "#172741", muted: "#4b5563", subtle: "#9ca3af" });
    expect(defsquare.light.accent).toEqual({ entity: "#1e416e", selection: "#f65e5e", match: "#ede2cf", matchStroke: "#8d7e63" });
    expect(defsquare.light.edge).toEqual({ contain: "#c7cdd6", ref: "#2a5a98", dangling: "#d97706", hairline: "#f1f1f3", border: "#dfe3e9" });
  });
  it("carries the current dark colors", () => {
    expect(defsquare.dark.surface).toEqual({ canvas: "#161a2c", card: "#1e2335", cardMuted: "#1a1f30" });
    expect(defsquare.dark.ink).toEqual({ primary: "#f0f5fc", muted: "#9bb2d9", subtle: "#6b7794" });
    expect(defsquare.dark.accent).toEqual({ entity: "#3573c3", selection: "#f65e5e", match: "#3a3323", matchStroke: "#e2ca9e" });
    expect(defsquare.dark.edge).toEqual({ contain: "#3a4159", ref: "#3573c3", dangling: "#e0932e", hairline: "#272d42", border: "#2c3247" });
  });
  it("carries the current entity palette", () => {
    expect([...defsquare.entityPalette]).toEqual(["#1e416e", "#f65e5e", "#3dbf9e", "#8d7e63", "#3573c3", "#a0427a"]);
  });
});

describe("tokens neutral", () => {
  it("carries the current colors", () => {
    expect(neutral.light.surface.canvas).toBe("#f4f4f5");
    expect(neutral.dark.surface.canvas).toBe("#18181b");
    expect([...neutral.entityPalette]).toEqual(["#2563eb", "#7c3aed", "#059669", "#d97706", "#0891b2", "#be123c"]);
  });
});

describe("shared scales", () => {
  it("carries over typography, radius, spacing, strokes and motion", () => {
    expect(typography.header).toEqual({ family: "body", size: 13, weight: 600 });
    expect(typography.badge).toEqual({ family: "body", size: 9.5, weight: 600, tracking: 0.08 });
    expect(typography.key).toEqual({ family: "body", size: 12, weight: 400 });
    expect(typography.value).toEqual({ family: "mono", size: 12, weight: 400 });
    expect(radii).toEqual({ sm: 4, md: 6, lg: 10, full: 9999, card: 6 });
    expect(spacing).toEqual({ 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 });
    expect(strokes).toEqual({ border: 1, edge: 1.5, selection: 2.5, match: 2, matchCurrent: 3 });
    expect(motion).toEqual({ transition: "150ms ease-in-out", easeOut: "cubic-bezier(0.2, 0.8, 0.25, 1)" });
  });
});

describe("tokens chrome (DOM only)", () => {
  it("carries fg, floating surfaces and shadows", () => {
    expect(chrome.light.fg).toBe("#070f19");
    expect(chrome.light.float).toEqual({ bg: "rgb(255 255 255 / 0.82)", border: "rgb(23 39 65 / 0.1)", hover: "rgb(23 39 65 / 0.06)" });
    expect(chrome.light.shadow).toBe("0 1px 2px rgb(15 23 42 / 0.06), 0 10px 28px -10px rgb(15 23 42 / 0.22)");
    expect(chrome.dark.fg).toBe("#f0f5fc");
    expect(chrome.dark.float).toEqual({ bg: "rgb(30 35 53 / 0.82)", border: "rgb(240 245 252 / 0.1)", hover: "rgb(240 245 252 / 0.08)" });
    expect(chrome.dark.shadow).toBe("0 1px 2px rgb(0 0 0 / 0.35), 0 12px 30px -10px rgb(0 0 0 / 0.6)");
  });
});

describe("font stack formatting", () => {
  it("pixiFontStack joins without quotes", () => {
    expect(pixiFontStack(defsquare.fonts.body)).toBe("IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif");
    expect(pixiFontStack(defsquare.fonts.mono)).toBe("Fira Code, SF Mono, Menlo, Consolas, monospace");
    expect(pixiFontStack(neutral.fonts.body)).toBe("system-ui, sans-serif");
  });
  it("cssFontStack quotes the names that contain spaces", () => {
    expect(cssFontStack(defsquare.fonts.title!)).toBe('"EB Garamond", Garamond, Cambria, Georgia, serif');
    expect(cssFontStack(defsquare.fonts.body)).toBe('"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif');
    expect(cssFontStack(defsquare.fonts.mono)).toBe('"Fira Code", "SF Mono", Menlo, Consolas, monospace');
  });
});
