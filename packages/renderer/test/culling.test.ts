import { describe, it, expect } from "vitest";
import { buildGraph, type NodeId, type Rect } from "@defsquare/data-graph-core";
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
  it("ne touche à rien à marge nulle", () => {
    expect(inflateRect(VIEW, 0)).toEqual(VIEW);
  });

  it("triple chaque dimension à marge 1, en restant centré", () => {
    expect(inflateRect(VIEW, 1)).toEqual({ x: -1000, y: -1000, width: 3000, height: 3000 });
  });
});

describe("rectsOverlap", () => {
  it("compte le contact par un bord", () => {
    // A card sitting exactly on the edge must be drawn: excluding it would make
    // it flicker at the pixel.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("est faux dès qu'il y a un vide", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("exige les DEUX axes", () => {
    // Perfect horizontal overlap, but very far apart vertically.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 500, width: 10, height: 10 })).toBe(false);
  });
});

describe("rectContains", () => {
  it("accepte l'égalité et le contact intérieur", () => {
    expect(rectContains(VIEW, VIEW)).toBe(true);
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1000, height: 10 })).toBe(true);
  });

  it("refuse un débordement, même d'un pixel", () => {
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1001, height: 10 })).toBe(false);
    expect(rectContains(VIEW, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("cardFate — création", () => {
  it("crée sans condition ce qui est à l'écran", () => {
    // Exhausted budget included: the window to paint is a visual CONTRACT,
    // trimming it would open holes.
    expect(cardFate(card(400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("crée ce qui est juste hors cadre, dans la marge de peinture", () => {
    // The 15% margin absorbs the one-frame lag between the camera and us: a card
    // entering from the edge must not show up a frame too late.
    expect(cardFate(card(-100, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("crée le voisinage quand le budget de l'image le permet", () => {
    // Half a screen off-frame: comfort, not contract.
    expect(cardFate(card(1400, 400), windows, FRESH)).toBe("create");
  });

  it("DIFFÈRE ce même voisinage quand le budget est épuisé", () => {
    expect(cardFate(card(1400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("defer");
  });

  it("ne fabrique rien au-delà du voisinage", () => {
    // Three screens away: this is exactly the work culling removes — 6,251 cards
    // created for a few dozen actually looked at.
    expect(cardFate(card(4000, 4000), windows, FRESH)).toBe("none");
  });

  it("crée tout quand il n'y a pas de caméra", () => {
    // Exact fallback to the pre-culling behavior: with no camera, no window
    // means anything.
    const none = cardWindowsFor(null);
    expect(cardFate(card(999_999, 999_999), none, { ...FRESH, budgetLeft: false })).toBe("create");
  });
});

describe("cardFate — recyclage", () => {
  it("garde ce qui est à l'écran", () => {
    expect(cardFate(card(400, 400), windows, DRAWN)).toBe("none");
  });

  it("garde le voisinage large : l'hystérésis empêche le clignotement", () => {
    // Two screens off-frame — past the prefetch window, so a card the pass would
    // not create, yet does not destroy either. Without that gap, a camera moving
    // back and forth would destroy and recreate the same cards every frame.
    expect(cardFate(card(2500, 400), windows, DRAWN)).toBe("none");
  });

  it("recycle ce qui est sorti largement", () => {
    expect(cardFate(card(4000, 4000), windows, DRAWN)).toBe("reclaim");
  });

  it("ne recycle JAMAIS une carte épinglée", () => {
    // Both the selection and the gesture in flight go through `pinned`: the
    // selected card must stay drawn wherever it goes, and destroying the one a
    // drag is holding would kill the gesture's listeners.
    expect(cardFate(card(4000, 4000), windows, { ...DRAWN, pinned: true })).toBe("none");
  });

  it("ne recycle rien quand il n'y a pas de caméra", () => {
    expect(cardFate(card(999_999, 999_999), cardWindowsFor(null), DRAWN)).toBe("none");
  });
});

/**
 * The second culled layer, and the scene's most expensive: `drawEdgeHitAreas`
 * produces one INTERACTIVE Graphics per resolved reference — tens of thousands on
 * a real dataset, all pushed through the render pass and through hit-testing when
 * only the ones on screen can ever be aimed at.
 */
describe("drawEdgeHitAreas — fenêtre", () => {
  const graph = buildGraph(shopData, shopConfig);
  // The fixture's only resolved reference: /orders/0 → /customers/0, stacked
  // vertically here, hence a segment from (80, 60) to (80, 300).
  const positions = new Map<NodeId, Rect>([
    ["/orders/0", { x: 0, y: 0, width: 160, height: 60 }],
    ["/customers/0", { x: 0, y: 300, width: 160, height: 60 }],
  ]);

  it("produit tout sans fenêtre — le comportement d'origine", () => {
    expect(drawEdgeHitAreas(graph, positions)).toHaveLength(1);
    expect(drawEdgeHitAreas(graph, positions, null)).toHaveLength(1);
  });

  it("garde une arête dont un bout est dans la fenêtre", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 0, width: 200, height: 100 })).toHaveLength(1);
  });

  it("garde une arête qui ne fait que TRAVERSER la fenêtre", () => {
    // Neither end inside, but the stroke cuts across it: dropping it would leave
    // a visible, inert line running across the screen.
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 150, width: 200, height: 20 })).toHaveLength(1);
  });

  it("écarte une arête entièrement hors de la fenêtre", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 5000, y: 5000, width: 100, height: 100 })).toHaveLength(0);
  });
});
