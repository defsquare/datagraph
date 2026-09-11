import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import type { NodeId, Rect } from "@defsquare/data-graph-core";
import { drawSearchHighlights } from "../src/draw.js";
import { defsquareDark, defsquareLight, type Theme } from "../src/theme.js";

/**
 * The search highlight must EMPHASISE without washing out.
 *
 * The previous treatment laid a filled veil over the whole card, which lowered
 * the contrast of the very text the user was looking for, and outlined the
 * current match in the selection colour — two concepts wearing one costume.
 * These tests state both constraints on the drawing itself: no fill over a
 * card's body, and a current-match colour that is not the selection's.
 */
const positions = new Map<NodeId, Rect>([
  ["/a", { x: 0, y: 0, width: 100, height: 60 }],
  ["/b", { x: 200, y: 0, width: 100, height: 60 }],
]);

/** The colours the graphics records, split by instruction kind. */
function styles(g: Graphics): { fills: number[]; strokes: number[] } {
  const fills: number[] = [];
  const strokes: number[] = [];
  for (const instruction of g.context.instructions) {
    const i = instruction as { action?: string; data?: { style?: { color?: number } } };
    const color = i.data?.style?.color;
    if (typeof color !== "number") continue;
    if (i.action === "fill") fills.push(color);
    else if (i.action === "stroke") strokes.push(color);
  }
  return { fills, strokes };
}

function hex(theme: Theme, key: "match" | "matchStroke" | "matchCurrent" | "selection"): number {
  return Number.parseInt(theme.accent[key].slice(1), 16);
}

describe("drawSearchHighlights", () => {
  for (const [name, theme] of [
    ["light", defsquareLight],
    ["dark", defsquareDark],
  ] as const) {
    it(`lays no fill over a matched card in ${name}`, () => {
      const { fills } = styles(drawSearchHighlights(positions, theme, ["/a", "/b"], null));
      // A halo may be filled; the CARD's own rectangle may not. The rule the
      // regression needs is simpler and stronger: `accent.match` never appears
      // as a fill over the card box.
      expect(fills).not.toContain(hex(theme, "match"));
    });

    it(`outlines every match in ${name}`, () => {
      const { strokes } = styles(drawSearchHighlights(positions, theme, ["/a", "/b"], null));
      expect(strokes).toContain(hex(theme, "matchStroke"));
    });

    it(`distinguishes the current match from the selection in ${name}`, () => {
      const { strokes } = styles(drawSearchHighlights(positions, theme, ["/a", "/b"], "/a"));
      expect(strokes).toContain(hex(theme, "matchCurrent"));
      expect(strokes).not.toContain(hex(theme, "selection"));
    });
  }

  it("ignores an id absent from the positions, without a sound", () => {
    const g = drawSearchHighlights(positions, defsquareLight, ["/nope"], "/nope");
    expect(styles(g).strokes).toEqual([]);
  });
});
