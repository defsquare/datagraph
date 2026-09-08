import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import { drawRemainderToken, REMAINDER_TOKEN_GAP, REMAINDER_TOKEN_HEIGHT } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * Same DOM adapter substitution as `array-token.test.ts`: Pixi measures label
 * height through a 2D canvas the Node runtime does not have, and what these
 * tests observe — the label, the pill's geometry — does not depend on that
 * measurement being faithful.
 */
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

const theme = resolveTheme(undefined);
const metrics = DEFAULT_METRICS;

/** Every text in the token, flattened. */
function textsOf(view: Container): string[] {
  const out: string[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      if (child instanceof Text) out.push(child.text);
      if (child instanceof Container) walk(child);
    }
  };
  walk(view);
  return out;
}

/** The background's geometry, read out of the Graphics instructions — the same
 * reading `array-token.test.ts` does of the chevron: what we observe is the
 * drawing commands, not a render. */
function restRect(token: Container): { x: number; y: number; w: number; h: number } {
  const g = token.getChildByLabel("rest") as Graphics;
  const fill = (g.context.instructions as any[]).find((i) => i.action === "fill");
  const data = (fill.data.path.instructions as any[])[0].data as number[];
  return { x: data[0]!, y: data[1]!, w: data[2]!, h: data[3]! };
}

describe("remainder token", () => {
  it("carries the marker label `create.ts` uses to find its tokens again", () => {
    const token = drawRemainderToken({ count: 47300, width: 260, theme, metrics });
    expect(token.label).toBe("remainder-token");
  });

  it("announces the number of hidden children, not the page number", () => {
    const token = drawRemainderToken({ count: 47300, width: 260, theme, metrics });
    expect(textsOf(token)).toContain("+ 47300");
  });

  it("takes the width it is given — that of the neighboring card anchoring it", () => {
    // A token narrower or wider than the card column would read as an object of
    // a different nature, when it in fact stands in for the missing cards.
    const rect = restRect(drawRemainderToken({ count: 12, width: 187, theme, metrics }));
    expect(rect.w).toBe(187);
    expect(rect.h).toBe(REMAINDER_TOKEN_HEIGHT);
  });

  it("fits in the band separating two stacked cards", () => {
    // Layout reserves no room at all for the token: past `NODE_GAP` (24 px,
    // `packages/core/src/structure-layout.ts`) it covers the neighboring card
    // AND steals its clicks, its layer being on top. The gap `create.ts` adds
    // (`REMAINDER_TOKEN_GAP`) must still fit in what is left: it is the whole
    // invariant that must be checked, not just the token's height, otherwise a
    // height comfortably under 24 px would hide a gap that overflows once the
    // two are added.
    expect(REMAINDER_TOKEN_GAP + REMAINDER_TOKEN_HEIGHT).toBeLessThan(24);
  });

  it("draws itself at (0,0) in its local space, like a card", () => {
    // The caller is the one placing it: `create.ts` computes the anchor from the
    // positions, and an internal offset would shift it twice.
    const rect = restRect(drawRemainderToken({ count: 12, width: 187, theme, metrics }));
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it("truncates the label rather than overflowing a narrow token", () => {
    // The width comes from the neighboring card, not from the text: on a narrow
    // column, an untruncated label would spill out of the pill.
    const token = drawRemainderToken({ count: 1234567, width: 24, theme, metrics });
    const texts = textsOf(token);
    expect(texts).not.toContain("+ 1234567");
    expect(texts.every((t) => t.length < "+ 1234567".length)).toBe(true);
  });
});
