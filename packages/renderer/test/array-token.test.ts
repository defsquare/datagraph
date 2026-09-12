import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import {
  arrayTokenTextFor,
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
} from "@defsquare/datagraph-core";
import { drawNode } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * Same DOM adapter substitution as `ref-indicator.test.ts`: Pixi measures label
 * height through a 2D canvas the Node runtime does not have, and what these
 * tests observe — the token's presence, its chevron, the absent key — does not
 * depend on that measurement being faithful.
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
const rect = { x: 0, y: 0, width: 260, height: 140 };

const config: DataGraphConfig = {
  ids: { Product: "$.products[*].id" },
};
const graph = buildGraph(
  { products: [{ id: "p1", tags: ["mecanique", "USB-C", "RGB"] }] },
  config,
);
const product = graph.nodes.get("/products/0")!;
const TAGS_ROW = product.rows.findIndex((r) => r.key === "tags");
const TAGS_ID = "/products/0/tags";

/** The texts the card renders, flattened — the token mounts its children in a
 * sub-container, so a single-level read would miss them. */
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

function tokenOf(view: Container): Container | null {
  return view.getChildByLabel(`array-token:${TAGS_ROW}`) as Container | null;
}

describe("array-row token", () => {
  it("renders the element count, not the raw value", () => {
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    expect(textsOf(view)).toContain(arrayTokenTextFor(3));
    // A bare "3" is what we would get by treating the row as an ordinary scalar
    // row.
    expect(textsOf(view)).not.toContain("3");
  });

  it("mounts the token in a container tagged by label", () => {
    // This label is what lets `create.ts` animate hover without redrawing the
    // card or recomputing its geometry.
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    expect(tokenOf(view)).not.toBeNull();
  });

  it("prepares a HIDDEN hover shape rather than a recomputed color", () => {
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    const hover = tokenOf(view)!.getChildByLabel("hover")!;
    expect(hover.visible).toBe(false);
  });

  it("orients the chevron by the ARRAY's collapse state, not the card's", () => {
    const collapsed = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined,
      new Set<string>(),
    );
    const expanded = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined,
      new Set([TAGS_ID]),
    );
    // The collapsed chevron "▸" is taller than it is wide, the expanded "▾" the
    // other way round. We read the triangle's vertices from the Graphics context,
    // as `segmentOf` does in `ref-indicator.test.ts`: the drawing's geometry is
    // what these tests observe, not a render.
    const shapeOf = (v: Container): { w: number; h: number } => {
      const g = tokenOf(v)!.getChildByLabel("chevron") as Graphics;
      const instructions = g.context.instructions as any[];
      expect(instructions.map((i) => i.action)).toEqual(["fill"]);
      const points = (instructions[0].data.path.instructions as any[]).map((p) => p.data);
      const xs = points.map((p) => p[0] as number);
      const ys = points.map((p) => p[1] as number);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const c = shapeOf(collapsed);
    const e = shapeOf(expanded);
    expect(c.h).toBeGreaterThan(c.w);
    expect(e.w).toBeGreaterThan(e.h);
  });

  it("shows no chevron when the view collapses nothing", () => {
    // `null` is what `create.ts` passes in graph view: the token stays readable
    // but no longer advertises a gesture that would do nothing.
    const view = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined, null,
    );
    expect(tokenOf(view)!.getChildByLabel("chevron")).toBeNull();
    expect(textsOf(view)).toContain(arrayTokenTextFor(3));
  });
});

describe("value-only row", () => {
  it("draws the value without its key", () => {
    // An array's scalar element carries `tags[0]` as its header: repeating
    // `$value` as the key would teach nothing, so `measureNode` reserves no key
    // width for it.
    const element = graph.nodes.get("/products/0/tags/0")!;
    const view = drawNode(element, rect, theme, 0, false, "#000", metrics, false, false);
    const texts = textsOf(view);
    expect(texts).toContain("mecanique");
    expect(texts).not.toContain("$value");
  });
});
