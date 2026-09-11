import { describe, it, expect } from "vitest";
import { buildGraph, type Rect } from "@defsquare/data-graph-core";
import { DOMAdapter, Graphics } from "pixi.js";
import { drawNode } from "../src/draw.js";
import { defsquareDark, defsquareLight, neutralDark, type Theme } from "../src/theme.js";
import { shopData, shopConfig } from "./fixtures.js";

/**
 * Card surfaces belong to the PASSED theme, and to nothing else.
 *
 * The audit that opened this pass reported a root card staying light in dark
 * theme. It did not reproduce (see `apps/demo/e2e/tmp-a5.spec.ts`, deleted after
 * confirming the pixels: the root card renders at `#1a1f30`, dark's
 * `surface.cardMuted`, exactly as expected) — but nothing in the code stated
 * the rule either, and a fill written straight into `draw.ts` would have been
 * caught by no test. This one states it: whatever fill a card carries, that
 * color exists in the theme it was drawn with.
 *
 * `Graphics` is inspected through its recorded fill instructions rather than
 * through pixels: `draw.ts` never touches a canvas, which is exactly what makes
 * it testable here (ADR-0006).
 */

// Same DOM adapter substitution as `ref-indicator.test.ts` / `array-token.test.ts`:
// `drawNode` measures label height through a 2D canvas the Node test runtime does
// not have. What this file observes — fill colors, not glyph metrics — does not
// depend on that measurement being faithful.
class FakeCanvasContext {
  font = "";
  letterSpacing = "";
  measureText(text: string) {
    return { width: text.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
  }
}
const browserAdapter = DOMAdapter.get();
DOMAdapter.set({
  ...browserAdapter,
  createCanvas: (width?: number, height?: number) =>
    ({
      width: width ?? 0,
      height: height ?? 0,
      getContext: () => new FakeCanvasContext(),
    }) as never,
  getCanvasRenderingContext2D: () => FakeCanvasContext as never,
});

const graph = buildGraph(shopData, shopConfig);
const RECT: Rect = { x: 0, y: 0, width: 220, height: 120 };

/** Every distinct fill color recorded on the card's box, as `#rrggbb`.
 *
 * A recorded `Graphics` instruction is a discriminated union on `action` —
 * `FillInstruction` (`'fill' | 'cut'`), `StrokeInstruction` (`'stroke'`) or
 * `TextureInstruction` (`'texture'`), confirmed by logging a real instruction
 * rather than assumed, since nothing else in this codebase reads `instructions`
 * back. Narrowing on `action === "fill"` gives `instruction.data.style.color`
 * with no cast (Pixi's `ConvertedFillStyle` guarantees `color: number`) and,
 * just as importantly, keeps strokes OUT: a stroke's color lives in the theme's
 * `edge` palette, not `surface`, and folding it in here would make the
 * "belongs to the theme" assertion vacuous rather than wrong (both groups are
 * theme colors). `action` is exactly the field a caller who needs to tell
 * fills from strokes apart — e.g. a search highlight, which strokes — reads.
 */
function fillColors(theme: Theme, nodeId: string): string[] {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`fixture is missing ${nodeId}`);
  const container = drawNode(node, RECT, theme, 0, false, theme.accent.entity);
  const colors: string[] = [];
  for (const child of container.children) {
    if (!(child instanceof Graphics)) continue;
    for (const instruction of child.context.instructions) {
      if (instruction.action !== "fill") continue;
      colors.push(`#${instruction.data.style.color.toString(16).padStart(6, "0")}`);
    }
  }
  return [...new Set(colors)];
}

/** Every `#rrggbb` a theme declares, flattened. */
function paletteOf(theme: Theme): Set<string> {
  return new Set(
    [
      ...Object.values(theme.surface),
      ...Object.values(theme.ink),
      ...Object.values(theme.accent),
      ...Object.values(theme.edge),
      ...theme.entityPalette,
    ].map((c) => c.toLowerCase()),
  );
}

describe("card surfaces derive from the theme", () => {
  for (const [name, theme] of [
    ["defsquareLight", defsquareLight],
    ["defsquareDark", defsquareDark],
    ["neutralDark", neutralDark],
  ] as const) {
    // `/customers` is a container node (kind "array", not "entity") — the family
    // the audit pointed at, and the one that takes `surface.cardMuted` rather
    // than `surface.card`.
    it(`draws a container card only in ${name}'s own colors`, () => {
      const palette = paletteOf(theme);
      for (const color of fillColors(theme, "/customers")) {
        expect(palette.has(color)).toBe(true);
      }
    });

    it(`fills a container card with ${name}'s cardMuted`, () => {
      expect(fillColors(theme, "/customers")).toContain(theme.surface.cardMuted.toLowerCase());
    });
  }

  it("gives the two themes different card surfaces", () => {
    // Guards the test itself: if both themes produced the same colors, every
    // assertion above would hold for the wrong reason.
    expect(fillColors(defsquareLight, "/customers")).not.toEqual(
      fillColors(defsquareDark, "/customers"),
    );
  });
});
