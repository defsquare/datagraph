import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import { buildGraph } from "@defsquare/datagraph-core";
import {
  anchorOnRect,
  drawEdgeLabels,
  edgeLabelPlacements,
  edgeLabelPosition,
  labelParamInView,
} from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";
import { shopData, shopConfig, cartData, cartConfig } from "./fixtures.js";

/**
 * Same DOM adapter substitution as `array-token.test.ts`: Pixi measures label
 * height through a 2D canvas the Node runtime does not have, and what these tests
 * observe — each label's TEXT and the fact that there is one — does not depend on
 * that measurement being faithful.
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

/**
 * The texts the container carries. A label is a SUB-CONTAINER (pill + text around
 * its local origin), which lets `create.ts` reposition it without recreating
 * anything: the read therefore goes one level down.
 */
function textsOf(view: Container): string[] {
  const out: string[] = [];
  for (const item of view.children) {
    for (const child of (item as Container).children ?? []) {
      if (child instanceof Text) out.push(child.text);
    }
  }
  return out;
}

/** The full path, chained as `create.ts` chains it: pure placements, then draw. */
function labelsOf(
  graph: Parameters<typeof edgeLabelPlacements>[0],
  positions: Parameters<typeof edgeLabelPlacements>[1],
  selectedId: Parameters<typeof edgeLabelPlacements>[2],
): Container {
  return drawEdgeLabels(edgeLabelPlacements(graph, positions, selectedId), theme, false);
}

/**
 * The label is the "progressive disclosure" half of the drawing: a reference
 * edge always starts at a card, which does not say which ROW it leaves from.
 * Selecting the source brings out the instantiated path.
 */
describe("drawEdgeLabels", () => {
  const shop = buildGraph(shopData, shopConfig);
  const ORDER = { x: 0, y: 0, width: 160, height: 60 };
  const CUSTOMER = { x: 600, y: 0, width: 160, height: 60 };
  const shopPositions = new Map([
    ["/orders/0", ORDER],
    ["/orders/1", { x: 0, y: 200, width: 160, height: 60 }],
    ["/customers/0", CUSTOMER],
  ]);

  const cart = buildGraph(cartData, cartConfig);
  const CART = { x: 0, y: 0, width: 200, height: 120 };
  const PRODUCT = { x: 600, y: 0, width: 160, height: 60 };
  const LINE = { x: 300, y: 200, width: 180, height: 100 };

  it("names the full path from the entity for a direct reference", () => {
    // The label slides with the viewport and is often read near the TARGET, with
    // the source off-frame: `customerId` alone would not identify which order.
    const view = labelsOf(shop, shopPositions, "/orders/0");
    expect(textsOf(view)).toEqual(["Order#o1.customerId"]);
  });

  it("names the INSTANTIATED PATH when the declaring entity is the one selected", () => {
    // Graph view: `/carts/0/lines/0` has no card, the selection is the cart. The
    // index `[0]` designates the exact element, which the config's `lines[*]`
    // would not.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const view = labelsOf(cart, positions, "/carts/0");
    expect(textsOf(view)).toEqual(["Cart#k1.lines[0].productRef"]);
  });

  it("keeps the full path even when the value object's card is the one selected", () => {
    // The text is UNIFORM whatever node is selected: the label is read far from
    // the selection (it may have slid all the way to the target), and the reader
    // must not have to remember what they selected to understand it.
    const positions = new Map([
      ["/carts/0", CART],
      ["/carts/0/lines/0", LINE],
      ["/products/0", PRODUCT],
    ]);
    const view = labelsOf(cart, positions, "/carts/0/lines/0");
    expect(textsOf(view)).toEqual(["Cart#k1.lines[0].productRef"]);
  });

  it("labels nothing when the TARGET is selected", () => {
    // An incoming edge does not read from a field of the selected card: there is
    // no path to name on that side.
    const view = labelsOf(shop, shopPositions, "/customers/0");
    expect(view.children).toHaveLength(0);
  });

  it("labels nothing without a selection", () => {
    const view = labelsOf(shop, shopPositions, null);
    expect(view.children).toHaveLength(0);
  });

  it("labels nothing for a DANGLING reference", () => {
    // `/orders/1` points at a customer that does not exist: no stroke is drawn,
    // and a label floating without a stroke would designate nothing.
    expect(shop.refEdges.find((e) => e.from === "/orders/1")?.dangling).toBe(true);
    const view = labelsOf(shop, shopPositions, "/orders/1");
    expect(view.children).toHaveLength(0);
  });

  it("labels nothing when the TARGET is off screen", () => {
    // Same rule as the drawing: no stroke, no label.
    const view = labelsOf(shop, new Map([["/orders/0", ORDER]]), "/orders/0");
    expect(view.children).toHaveLength(0);
  });

  it("places the label on the first third of the link, inside a pill", () => {
    // As a FRACTION of the link rather than at a fixed distance from the start:
    // a few pixels from the card, neighboring edges have not spread apart yet
    // and their labels overlapped. Still on the source side — past the halfway
    // point, the label would read as designating the target.
    const view = labelsOf(shop, shopPositions, "/orders/0");
    const item = view.children[0] as Container;
    // The pill and the text are drawn around the sub-container's LOCAL origin;
    // the sub-container is what carries the position along the link.
    expect(item.children.find((c) => c instanceof Graphics)).toBeDefined();
    expect(item.children.find((c) => c instanceof Text)).toBeDefined();
    const start = anchorOnRect(ORDER, CUSTOMER.x + CUSTOMER.width / 2, CUSTOMER.y + CUSTOMER.height / 2);
    const end = anchorOnRect(CUSTOMER, ORDER.x + ORDER.width / 2, ORDER.y + ORDER.height / 2);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const toStart = Math.hypot(item.position.x - start.x, item.position.y - start.y);
    const toEnd = Math.hypot(item.position.x - end.x, item.position.y - end.y);
    expect(toStart).toBeGreaterThan(len * 0.2); // no longer glued to the start
    expect(toStart).toBeLessThan(toEnd); // but still on the source side
  });

  it("staggers the labels of a single source along their links", () => {
    // Two near-parallel edges keep separate labels: the fraction grows by one
    // step per label. Three references leave the same cart towards three stacked
    // products — near-parallel links, the case that stacked the labels on top of
    // each other back when they sat at a fixed distance from the start.
    const g = buildGraph(
      {
        carts: [{ id: "k1", lines: [{ productRef: "a" }, { productRef: "b" }, { productRef: "c" }] }],
        products: [{ id: "a" }, { id: "b" }, { id: "c" }],
      },
      cartConfig,
    );
    const positions = new Map([
      ["/carts/0", { x: 0, y: 0, width: 200, height: 140 }],
      ["/products/0", { x: 600, y: 0, width: 160, height: 60 }],
      ["/products/1", { x: 600, y: 80, width: 160, height: 60 }],
      ["/products/2", { x: 600, y: 160, width: 160, height: 60 }],
    ]);
    const view = labelsOf(g, positions, "/carts/0");
    expect(view.children).toHaveLength(3);
    const xs = view.children.map((c) => c.position.x).sort((a, b) => a - b);
    // Three distinct fractions on links of comparable length: the x coordinates
    // must clearly spread apart, not overlap.
    expect(xs[1]! - xs[0]!).toBeGreaterThan(30);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(30);
  });
});

/**
 * Labels SLIDE along their link to stay in frame, like a road name on a map: you
 * select the source, you follow the link, you zoom near the TARGET, and the label
 * has followed — it says which reference this is without your having to travel
 * back to the source.
 */
describe("labelParamInView", () => {
  const START = { x: 0, y: 0 };
  const END = { x: 1000, y: 0 };
  const BASE = 0.38;
  const MARGIN = 48;

  it("moves NOTHING when the whole edge is visible", () => {
    // This is the invariant that makes the sliding invisible at rest: as long as
    // the link fits on screen, the label stays at its base fraction. Not even the
    // margin is allowed to move it.
    const view = { x: -100, y: -100, width: 1200, height: 200 };
    expect(labelParamInView(START, END, BASE, view, MARGIN)).toBe(BASE);
  });

  it("follows the viewport when it is tight on the TARGET", () => {
    // The case that motivates the whole feature: zoomed on the target, a stroke
    // arrives without saying which one. The label comes onto the visible stretch.
    const view = { x: 800, y: -50, width: 200, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    expect(t).toBeGreaterThan(0.8);
    expect(t).toBeLessThanOrEqual(1);
  });

  it("stays back from the edge when the viewport is tight on the SOURCE", () => {
    // Symmetric: the visible stretch stops at t1, and the label must stay one
    // margin away from the edge, otherwise the pill spills half out of frame.
    const view = { x: -50, y: -50, width: 350, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    // Visible over [0, 0.3]: the label backs off to 0.3 − 48/1000.
    expect(t).toBeCloseTo(0.3 - MARGIN / 1000, 6);
  });

  it("returns the base fraction when the link does NOT cross the frame", () => {
    // Nothing visible to annotate: the resting position is the only choice that
    // does not tell a story.
    const view = { x: 0, y: 500, width: 200, height: 100 };
    expect(labelParamInView(START, END, BASE, view, MARGIN)).toBe(BASE);
  });

  it("returns the base fraction for a zero-length segment", () => {
    // Two cards on the same spot: there is no parametrization to clip.
    const view = { x: -100, y: -100, width: 200, height: 200 };
    expect(labelParamInView(START, START, BASE, view, MARGIN)).toBe(BASE);
  });

  it("settles in the MIDDLE when the visible stretch is shorter than two margins", () => {
    // No position honors both margins at once; the middle is the least bad
    // compromise, and above all it stays INSIDE the visible stretch.
    const view = { x: 500, y: -50, width: 60, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    expect(t).toBeCloseTo(0.53, 6); // middle of [0.5, 0.56]
  });

  it("places the label on the link, on the right side of the stroke", () => {
    // `edgeLabelPosition` is the bridge from fraction to point: what `create.ts`
    // reuses to reposition without recreating a single `Text`.
    const at = edgeLabelPosition(START, END, 0.5);
    expect(at.x).toBeCloseTo(500, 6);
    expect(at.y).toBeCloseTo(10, 6); // the perpendicular offset, a constant
  });
});
