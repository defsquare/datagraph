import { describe, it, expect } from "vitest";
import { buildGraph, type NodeId, type Rect } from "@defsquare/datagraph-core";
import { cardFate, cardWindowsFor, inflateRect, rectContains, rectsOverlap } from "../src/create.js";
import { drawEdgeHitAreas } from "../src/draw.js";
import { shopData, shopConfig } from "./fixtures.js";

/**
 * Creation-time culling policy, tested where it lives: in pure data. No renderer
 * test mounts `createDataGraph` (no DOM, no WebGL under vitest), and that is
 * exactly why `cardFate` exists as a separate function — the decision is proven
 * here, the execution (`syncCards`) is nothing but the loop around it. The part
 * that cannot be proven here, "a camera jumping to a card finds it drawn on
 * arrival", is covered end to end by `apps/demo/e2e/culling.spec.ts`.
 */

/** The scenario's visible world rectangle: 1000×1000 at the origin. Every window
 * derives from it, so the distances below read in screenfuls. */
const VIEW: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
const windows = cardWindowsFor(VIEW);

/** A 100×100 card placed at (x, y). */
function card(x: number, y: number): Rect {
  return { x, y, width: 100, height: 100 };
}

const FRESH = { materialized: false, pinned: false, budgetLeft: true };
const DRAWN = { materialized: true, pinned: false, budgetLeft: false };

describe("inflateRect", () => {
  it("changes nothing at zero margin", () => {
    expect(inflateRect(VIEW, 0)).toEqual(VIEW);
  });

  it("triples each dimension at margin 1, staying centered", () => {
    expect(inflateRect(VIEW, 1)).toEqual({ x: -1000, y: -1000, width: 3000, height: 3000 });
  });
});

describe("rectsOverlap", () => {
  it("counts contact along an edge", () => {
    // A card sitting exactly on the edge must be drawn: excluding it would make
    // it flicker at the pixel.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("is false as soon as there is a gap", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("requires BOTH axes", () => {
    // Perfect horizontal overlap, but very far apart vertically.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 500, width: 10, height: 10 })).toBe(false);
  });
});

describe("rectContains", () => {
  it("accepts equality and inner contact", () => {
    expect(rectContains(VIEW, VIEW)).toBe(true);
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1000, height: 10 })).toBe(true);
  });

  it("rejects an overflow, even by one pixel", () => {
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1001, height: 10 })).toBe(false);
    expect(rectContains(VIEW, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("cardFate — creation", () => {
  it("unconditionally creates what is on screen", () => {
    // Exhausted budget included: the window to paint is a visual CONTRACT,
    // trimming it would open holes.
    expect(cardFate(card(400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("creates what is just off-frame, within the paint margin", () => {
    // The 15% margin absorbs the one-frame lag between the camera and us: a card
    // entering from the edge must not show up a frame too late.
    expect(cardFate(card(-100, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("creates the neighborhood when the frame budget allows", () => {
    // Half a screen off-frame: comfort, not contract.
    expect(cardFate(card(1400, 400), windows, FRESH)).toBe("create");
  });

  it("DEFERS that same neighborhood when the budget is exhausted", () => {
    expect(cardFate(card(1400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("defer");
  });

  it("builds nothing beyond the neighborhood", () => {
    // Three screens away: this is exactly the work culling removes — 6,251 cards
    // created for a few dozen actually looked at.
    expect(cardFate(card(4000, 4000), windows, FRESH)).toBe("none");
  });

  it("creates everything when there is no camera", () => {
    // Exact fallback to the pre-culling behavior: with no camera, no window
    // means anything.
    const none = cardWindowsFor(null);
    expect(cardFate(card(999_999, 999_999), none, { ...FRESH, budgetLeft: false })).toBe("create");
  });
});

describe("cardFate — reclaiming", () => {
  it("keeps what is on screen", () => {
    expect(cardFate(card(400, 400), windows, DRAWN)).toBe("none");
  });

  it("keeps the wide neighborhood: hysteresis prevents flicker", () => {
    // Two screens off-frame — past the prefetch window, so a card the pass would
    // not create, yet does not destroy either. Without that gap, a camera moving
    // back and forth would destroy and recreate the same cards every frame.
    expect(cardFate(card(2500, 400), windows, DRAWN)).toBe("none");
  });

  it("reclaims what has moved well away", () => {
    expect(cardFate(card(4000, 4000), windows, DRAWN)).toBe("reclaim");
  });

  it("NEVER reclaims a pinned card", () => {
    // Both the selection and the gesture in flight go through `pinned`: the
    // selected card must stay drawn wherever it goes, and destroying the one a
    // drag is holding would kill the gesture's listeners.
    expect(cardFate(card(4000, 4000), windows, { ...DRAWN, pinned: true })).toBe("none");
  });

  it("reclaims nothing when there is no camera", () => {
    expect(cardFate(card(999_999, 999_999), cardWindowsFor(null), DRAWN)).toBe("none");
  });
});

/**
 * The second culled layer, and the scene's most expensive: `drawEdgeHitAreas`
 * produces one INTERACTIVE Graphics per resolved reference — tens of thousands on
 * a real dataset, all pushed through the render pass and through hit-testing when
 * only the ones on screen can ever be aimed at.
 */
describe("drawEdgeHitAreas — window", () => {
  const graph = buildGraph(shopData, shopConfig);
  // The fixture's only resolved reference: /orders/0 → /customers/0, stacked
  // vertically here, hence a segment from (80, 60) to (80, 300).
  const positions = new Map<NodeId, Rect>([
    ["/orders/0", { x: 0, y: 0, width: 160, height: 60 }],
    ["/customers/0", { x: 0, y: 300, width: 160, height: 60 }],
  ]);

  it("produces everything with no window — the original behavior", () => {
    expect(drawEdgeHitAreas(graph, positions)).toHaveLength(1);
    expect(drawEdgeHitAreas(graph, positions, null)).toHaveLength(1);
  });

  it("keeps an edge with one end inside the window", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 0, width: 200, height: 100 })).toHaveLength(1);
  });

  it("keeps an edge that merely CROSSES the window", () => {
    // Neither end inside, but the stroke cuts across it: dropping it would leave
    // a visible, inert line running across the screen.
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 150, width: 200, height: 20 })).toHaveLength(1);
  });

  it("drops an edge entirely outside the window", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 5000, y: 5000, width: 100, height: 100 })).toHaveLength(0);
  });
});
