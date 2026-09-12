import { describe, it, expect } from "vitest";
import { Color } from "pixi.js";
import { buildGraph, rowRectFor, DEFAULT_METRICS } from "@defsquare/datagraph-core";
import { anchorOnRect, drawEdgeHitAreas, drawEdges, drawSelectionOverlay } from "../src/draw.js";
import { DIM_ALPHA } from "../src/focus.js";
import { resolveTheme } from "../src/theme.js";
import { shopData, shopConfig, cartData, cartConfig } from "./fixtures.js";

/**
 * `EdgeMode` has two effects, and only one was covered: `"ref"` mode did stop
 * drawing containment, but it kept drawing references DASHED, whereas the graph
 * view's spec wants them SOLID — dashes would read as "decoration" in the very
 * view whose whole subject is references.
 *
 * What the test observes: Pixi's `GraphicsContext`, as `hulls.test.ts` already
 * does. Every call to `stroke()`/`fill()` pushes an instruction carrying the
 * accumulated path; the NUMBER of commands in that path unambiguously separates a
 * solid stroke (a single `moveTo`+`lineTo`) from a dashed one (a pair per dash).
 * No rendering is needed.
 */
describe("drawEdges — structure mode vs graph mode", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  // Positions spread out for every node: containment edges are drawn only when
  // BOTH ends are positioned, and without them `"contain"` mode would not stand
  // apart from anything. The 400 px spacing also guarantees segments long enough
  // to carry several dashes.
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  /** The path commands (`moveTo`, `lineTo`, …) carried by the context's n-th
   * instruction. */
  function pathActions(g: ReturnType<typeof drawEdges>, index: number): string[] {
    const instruction = g.context.instructions[index] as any;
    return instruction.data.path.instructions.map((x: any) => x.action);
  }

  // The fixture holds only ONE resolved reference (o1 → c1) and one broken one
  // (o2 → GHOST): the resolved references' path therefore describes a single
  // edge, which keeps the counting readable.
  const resolvedRefs = graph.refEdges.filter((e) => !e.dangling && e.to !== null);

  it("the fixture holds exactly one resolved and one dangling reference", () => {
    // Guard against a hollow test: every count below depends on it.
    expect(resolvedRefs).toHaveLength(1);
    expect(graph.refEdges.filter((e) => e.dangling)).toHaveLength(1);
  });

  it('draws references dashed in "contain" mode', () => {
    const g = drawEdges(graph, positions, theme, 0, "contain");
    // stroke(containment) + stroke(references) + fill(arrow heads). Nothing for
    // the broken reference: it no longer lives in the edge space.
    expect(g.context.instructions.length).toBe(3);
    expect((g.context.instructions[0] as any).action).toBe("stroke");
    // Containment is indeed drawn: one bezier per edge.
    expect(pathActions(g, 0)).toContain("bezierCurveTo");
    // The references: far more than two commands for a single edge, hence a run
    // of dashes.
    const ref = pathActions(g, 1);
    expect(ref.length).toBeGreaterThan(2);
    expect(ref.filter((a) => a === "lineTo").length).toBeGreaterThan(1);
  });

  it('draws the same references solid in "ref" mode', () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    // One instruction fewer: no containment stroke left at all.
    expect(g.context.instructions.length).toBe(2);
    // A single resolved edge, drawn as one segment: exactly moveTo + lineTo,
    // where "contain" mode produces a dozen or so.
    expect(pathActions(g, 0)).toEqual(["moveTo", "lineTo"]);
  });

  it("emits nothing any more for a dangling reference, in either mode", () => {
    // The floating stub hooked onto the card's edge designated the CARD, not the
    // offending FIELD. The diagnostic moved onto the card's row (a cross against
    // the value), and the edge space carries no trace of it any more: the drawing
    // is exactly that of a graph with no broken reference.
    for (const mode of ["contain", "ref"] as const) {
      const withDangling = drawEdges(graph, positions, theme, 0, mode);
      const resolvedOnly = drawEdges(
        { ...graph, refEdges: resolvedRefs },
        positions,
        theme,
        0,
        mode,
      );
      expect(withDangling.context.instructions.length).toBe(
        resolvedOnly.context.instructions.length,
      );
      for (let k = 0; k < resolvedOnly.context.instructions.length; k++) {
        expect(pathActions(withDangling, k)).toEqual(pathActions(resolvedOnly, k));
      }
    }
  });

  it("keeps drawing the arrow heads in both modes", () => {
    // The solid stroke replaces the dashes, it does not replace the arrow: the
    // reference's reading direction must survive the switch.
    for (const mode of ["contain", "ref"] as const) {
      const g = drawEdges(graph, positions, theme, 0, mode);
      const fills = (g.context.instructions as any[]).filter((x) => x.action === "fill");
      expect(fills).toHaveLength(1);
    }
  });

  it("draws nothing at LOD 2, whatever the mode", () => {
    for (const mode of ["contain", "ref"] as const) {
      expect(drawEdges(graph, positions, theme, 2, mode).context.instructions.length).toBe(0);
    }
  });
});

/**
 * Dimming: when a card is selected, an edge that does not touch it recedes into
 * the background. A `stroke()` carries a single style, so alpha cannot be set
 * edge by edge: each color group splits into TWO passes, the dimmed one then the
 * full one, and that split is what the test observes — the number of instructions
 * and each one's alpha.
 *
 * The focus is a SET of ids ever since aggregates became selectable too. THIS
 * block passes nothing but SINGLETONS: that is a card selection, and it holds
 * that it renders exactly what it rendered when the signature carried a single
 * id. The multi-id case has its own block further down.
 */
describe("drawEdges — dimming around the focus", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  /** Each instruction's action and alpha, in emission order. */
  function passes(g: ReturnType<typeof drawEdges>): [string, number][] {
    return (g.context.instructions as any[]).map((x) => [x.action, x.data.style.alpha]);
  }

  // The fixture's only resolved reference leaves from `/orders/0`, the only
  // broken one from `/orders/1`: focusing either is enough to cover both sides of
  // each group.
  const SOURCE = "/orders/0";
  const ELSEWHERE = "/customers/1";

  it("draws exactly as before when nothing is focused", () => {
    // Non-regression guard: `focusIds` is optional, and omitting it or passing
    // `null` must give the drawing from before the feature, instruction for
    // instruction — hence no dimmed pass, since there is nothing to dim.
    const none = drawEdges(graph, positions, theme, 0, "contain");
    const explicit = drawEdges(graph, positions, theme, 0, "contain", null);
    expect(passes(explicit)).toEqual(passes(none));
    expect(passes(none)).toEqual([
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
    ]);
  });

  it("splits containment into a dimmed and a full pass around the focus", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set([SOURCE]));
    // Containment dimmed then full, and the focus's outgoing reference (stroke +
    // arrow head) at full opacity.
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
    ]);
  });

  it("dims a reference that touches neither end of the focus", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set([ELSEWHERE]));
    // `/customers/1` is neither source nor target of the resolved reference: both
    // stroke AND arrow head recede.
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
    ]);
  });

  it("keeps a reference at full opacity from its TARGET as well", () => {
    // An incoming reference relates just as much as an outgoing one: the selected
    // target must keep its edge in the foreground.
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set(["/customers/0"]));
    expect(passes(g)).toEqual([
      ["stroke", 1],
      ["fill", 1],
    ]);
  });

  it("still draws no containment in ref mode, focused or not", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set([SOURCE]));
    // Two instructions: the focus's reference, stroke then arrow. No containment
    // pass at all, neither full nor dimmed.
    expect(passes(g)).toHaveLength(2);
  });

  it("draws nothing at LOD 2, focus or not", () => {
    expect(drawEdges(graph, positions, theme, 2, "contain", new Set([SOURCE])).context.instructions).toHaveLength(0);
  });
});

/**
 * The MULTI-id focus: this is what an aggregate selection passes, its set being
 * that of its MEMBERS. The rule is the same as for a singleton — an edge is full
 * if one of its ends is in the set — but it then yields a reading a singleton
 * cannot give: edges INTERNAL to the block and those CROSSING it stay full, and
 * only those with neither end in the block recede.
 */
describe("drawEdges — dimming around a set of members", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  function passes(g: ReturnType<typeof drawEdges>): [string, number][] {
    return (g.context.instructions as any[]).map((x) => [x.action, x.data.style.alpha]);
  }

  it("keeps full every edge with ONE end in the set", () => {
    // A block holding the only resolved reference's source: it stays full, and
    // the second member changes nothing.
    const both = new Set(["/orders/0", "/orders/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", both))).toEqual([
      ["stroke", 1],
      ["fill", 1],
    ]);
    // The proof that MEMBERSHIP of an end is what made it full: the same block
    // stripped of the source dims it.
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", new Set(["/orders/1"])))).toEqual([
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
    ]);
  });

  it("keeps a CROSSING edge full, caught by its target", () => {
    // A block on the customer side: the reference enters the block without
    // leaving it, and stays full.
    const customers = new Set(["/customers/0", "/customers/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", customers))).toEqual([
      ["stroke", 1],
      ["fill", 1],
    ]);
  });

  it("dims everything when the set touches no edge", () => {
    // A block of nodes with no reference at all: nothing speaks to it, so
    // everything recedes — arrow head included, which follows its pass's alpha.
    const unrelated = new Set(["/orders/0/lines/0", "/orders/0/lines/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", unrelated))).toEqual([
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
    ]);
  });

  it("splits containment into two passes as well", () => {
    // Same split as for the singleton: a non-null set is enough to open the
    // dimmed pass, whatever its cardinality.
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set(["/orders/0", "/orders/1"]));
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
    ]);
  });

  it("dims everything for an EMPTY set, which is not the absence of focus", () => {
    // `null` says "no selection", the empty set would say "a selection nobody
    // touches". The two must not be conflated, otherwise an aggregate that cannot
    // be found would bring the entire graph to the foreground.
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", new Set()))).toEqual([
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
    ]);
  });
});

/**
 * A reference's anchoring used to be FIXED: source's mid-right to target's
 * mid-left. Since edges are drawn UNDER the card layer, a target sitting below or
 * to the left ran the line beneath the source card: its start was invisible, and
 * the edge seemed to come out of nowhere. Anchoring now follows the real
 * center→center direction.
 */
describe("anchorOnRect", () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 }; // center (200, 150)

  it("lands on the right edge for a target to the right", () => {
    expect(anchorOnRect(rect, 1000, 150)).toEqual({ x: 300, y: 150 });
  });

  it("lands on the left edge for a target to the left", () => {
    expect(anchorOnRect(rect, -1000, 150)).toEqual({ x: 100, y: 150 });
  });

  it("lands on the bottom edge for a target below", () => {
    expect(anchorOnRect(rect, 200, 900)).toEqual({ x: 200, y: 200 });
  });

  it("lands on the top edge for a target above", () => {
    expect(anchorOnRect(rect, 200, -900)).toEqual({ x: 200, y: 100 });
  });

  it("stays on the perimeter and on the centre→target ray in diagonal", () => {
    // Target on a "shallow" diagonal (slope 1/4): the VERTICAL edge is reached
    // first, not the corner.
    const p = anchorOnRect(rect, 200 + 400, 150 + 100);
    expect(p.x).toBeCloseTo(300, 10); // on the right edge
    expect(p.y).toBeGreaterThan(100);
    expect(p.y).toBeLessThan(200); // …and within the rect's height
    // Collinear with the center→target segment.
    expect((p.y - 150) / (p.x - 200)).toBeCloseTo(100 / 400, 10);

    // Target on a "steep" diagonal (slope 4): this time the bottom HORIZONTAL
    // edge is reached first.
    const q = anchorOnRect(rect, 200 + 100, 150 + 400);
    expect(q.y).toBeCloseTo(200, 10);
    expect(q.x).toBeGreaterThan(100);
    expect(q.x).toBeLessThan(300);
    expect((q.y - 150) / (q.x - 200)).toBeCloseTo(400 / 100, 10);
  });

  it("falls back to the centre for a target inside the rect", () => {
    // A clean fallback: the edge will be hidden under the overlapping cards,
    // which is acceptable — there is no "right" exit point here.
    expect(anchorOnRect(rect, 210, 160)).toEqual({ x: 200, y: 150 });
    expect(anchorOnRect(rect, 200, 150)).toEqual({ x: 200, y: 150 });
  });
});

describe("edge anchoring follows the direction to the target", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  // The fixture's only resolved reference is /orders/0 → /customers/0. We stack
  // it VERTICALLY here: precisely the case the fixed mid-right / mid-left
  // anchoring made unreadable.
  const SOURCE = "/orders/0";
  const TARGET = "/customers/0";
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>([
    [SOURCE, { x: 0, y: 0, width: 160, height: 60 }], // center (80, 30)
    [TARGET, { x: 0, y: 300, width: 160, height: 60 }], // center (80, 330)
  ]);
  // Expected start: the source's BOTTOM edge. Arrival: the target's TOP edge.
  const START: [number, number] = [80, 60];
  const END: [number, number] = [80, 300];

  function firstPath(g: { context: { instructions: unknown[] } }, index: number): any[] {
    return (g.context.instructions[index] as any).data.path.instructions;
  }

  it("starts the resolved reference on the source edge facing the target", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    const path = firstPath(g, 0);
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual(START);
    // The line stops at the foot of the arrow: same direction, a little short.
    const [ex, ey] = path[1].data;
    expect(ex).toBeCloseTo(80, 10);
    expect(ey).toBeGreaterThan(280);
    expect(ey).toBeLessThan(300);
  });

  it("puts the arrow head tip on the target edge facing the source", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    // Last instruction: the arrow heads' fill.
    const fill = (g.context.instructions as any[]).filter((x) => x.action === "fill");
    expect(fill).toHaveLength(1);
    const tip = fill[0].data.path.instructions[0];
    expect(tip.action).toBe("moveTo");
    expect(tip.data).toEqual(END);
  });

  it("uses the same anchors for the dashed reference in contain mode", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain");
    // No containment edge here (no pair has both ends positioned): the references
    // are therefore the first instruction.
    const path = firstPath(g, 0);
    expect(path[0].data).toEqual(START);
  });

  it("aligns the hit area with the drawn reference", () => {
    const hits = drawEdgeHitAreas(graph, positions);
    const hit = hits.find((h) => h.edge.from === SOURCE);
    expect(hit).toBeDefined();
    const path = firstPath(hit!.graphics, 0);
    expect(path[0].data).toEqual(START);
    expect(path[1].data).toEqual(END);
  });

  it("aligns the selection overlay with the drawn reference", () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE);
    // The LAST stroke, not the last instruction: ever since the highlight repaints
    // the arrow head too, the context ends with a `fill()`, not with the outgoing
    // references' drawing.
    const actions = (g.context.instructions as any[]).map((x) => x.action);
    const path = firstPath(g, actions.lastIndexOf("stroke"));
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual(START);
    // Dashes stopping at the foot of the arrow: the last point drawn falls where
    // the last dash ends, hence within one pattern (dash + gap) plus the arrow's
    // length of the target's anchor.
    const last = path[path.length - 1].data;
    expect(last[0]).toBeCloseTo(END[0], 10);
    expect(Math.abs(last[1] - END[1])).toBeLessThanOrEqual(20);
  });

  it("creates no hit area for a dangling reference", () => {
    // There is no stroke left to aim at: the diagnostic lives on the card's row,
    // and the tap on the card is what carries it. A hit area laid down in the void
    // would promise a navigation `followRef` will not perform.
    const withBroken = new Map(positions);
    withBroken.set("/orders/1", { x: 0, y: 600, width: 160, height: 60 });
    const hits = drawEdgeHitAreas(graph, withBroken);
    expect(hits.find((h) => h.edge.dangling)).toBeUndefined();
    // Resolved references, for their part, keep theirs.
    expect(hits.find((h) => h.edge.from === SOURCE)).toBeDefined();
  });
});

/**
 * The selection highlight must NOT add a drawing on top of the existing edge: it
 * must change that edge's STYLE. It therefore reuses `drawEdges`'s geometry (same
 * anchors, stop at the foot of the arrow, head repainted) and its stroke follows
 * the mode — solid in graph view, dashed in structure view. Dashes laid over a
 * solid edge was the reported defect.
 */
describe("drawSelectionOverlay — the highlight follows the edge's style", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const SOURCE = "/orders/0"; // resolved reference to /customers/0
  const TARGET = "/customers/0";
  const DANGLING = "/orders/1"; // broken reference: no edge drawn any more
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>([
    [SOURCE, { x: 0, y: 0, width: 160, height: 60 }],
    [TARGET, { x: 0, y: 300, width: 160, height: 60 }],
    [DANGLING, { x: 600, y: 0, width: 160, height: 60 }],
  ]);

  /** Each instruction's action and path commands, in order. */
  function shape(g: ReturnType<typeof drawSelectionOverlay>): { action: string; path: string[] }[] {
    return (g.context.instructions as any[]).map((x) => ({
      action: x.action,
      path: x.data.path.instructions.map((p: any) => p.action),
    }));
  }

  it('draws the reference SOLID in "ref" mode', () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE, "ref");
    const s = shape(g);
    // The card's ring, the reference's stroke, the arrow head. No parent chain:
    // the parents are not positioned here.
    expect(s.map((x) => x.action)).toEqual(["stroke", "stroke", "fill"]);
    // A single segment, like `drawEdges` in "ref" mode — not the N dashes.
    expect(s[1]!.path).toEqual(["moveTo", "lineTo"]);
  });

  it('keeps the reference DASHED in "contain" mode (and by default)', () => {
    const explicit = drawSelectionOverlay(graph, positions, theme, SOURCE, "contain");
    const implicit = drawSelectionOverlay(graph, positions, theme, SOURCE);
    expect(shape(implicit)).toEqual(shape(explicit));
    const s = shape(explicit);
    expect(s.map((x) => x.action)).toEqual(["stroke", "stroke", "fill"]);
    expect(s[1]!.path.filter((a) => a === "lineTo").length).toBeGreaterThan(1);
  });

  it("repaints the arrow head in the selection color, in both modes", () => {
    for (const mode of ["contain", "ref"] as const) {
      const g = drawSelectionOverlay(graph, positions, theme, SOURCE, mode);
      const fills = (g.context.instructions as any[]).filter((x) => x.action === "fill");
      expect(fills).toHaveLength(1);
      expect(fills[0].data.style.color).toBe(new Color(theme.accent.selection).toNumber());
      // The tip sits on the target's anchor, as in `drawEdges`.
      expect(fills[0].data.path.instructions[0].data).toEqual([80, 300]);
    }
  });

  it("stops the stroke at the foot of the arrow instead of running through it", () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE, "ref");
    const line = (g.context.instructions[1] as any).data.path.instructions;
    const [ex, ey] = line[1].data;
    expect(ex).toBeCloseTo(80, 10);
    expect(ey).toBeGreaterThan(280);
    expect(ey).toBeLessThan(300);
  });

  it("highlights nothing beyond the ring for a dangling reference", () => {
    // A broken reference has no edge left to restyle: selecting its source can
    // therefore paint nothing but the card's ring.
    const contain = shape(drawSelectionOverlay(graph, positions, theme, DANGLING, "contain"));
    const ref = shape(drawSelectionOverlay(graph, positions, theme, DANGLING, "ref"));
    expect(ref).toEqual(contain);
    expect(ref.map((x) => x.action)).toEqual(["stroke"]);
  });

  it("paints the stroke in the selection's color and width", () => {
    for (const mode of ["contain", "ref"] as const) {
      const g = drawSelectionOverlay(graph, positions, theme, SOURCE, mode);
      const style = (g.context.instructions[1] as any).data.style;
      expect(style.color).toBe(new Color(theme.accent.selection).toNumber());
      expect(style.width).toBe(theme.strokes.selection);
    }
  });
});

/**
 * A reference declared by path starts at the node that CARRIES the row — a value
 * object, which most often has no card on screen: collapsed in structure view,
 * nonexistent in graph view. Its start is therefore LIFTED to the nearest CARD,
 * failing which the edge would not be drawn at all and the relation would vanish
 * from the very view meant to show it.
 *
 * And to the card, mind, not the row's band: starting from the band did not
 * distinguish a lifted edge from a direct reference, it was half a signal. That
 * detail moved to the selection labels.
 */
describe("drawEdges — lifted start of a reference carried by a value object", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(cartData, cartConfig);

  const CART = { x: 0, y: 0, width: 200, height: 120 };
  const PRODUCT = { x: 600, y: 0, width: 160, height: 60 };
  const LINE = { x: 300, y: 200, width: 180, height: 100 };

  /** The `lines` row's band on the cart card — precisely the anchor the drawing
   * NO LONGER uses. */
  const rows = graph.nodes.get("/carts/0")!.rows;
  const band = rowRectFor(CART, rows.findIndex((r) => r.key === "lines"), DEFAULT_METRICS);

  function firstPath(g: { context: { instructions: unknown[] } }, index: number): any[] {
    return (g.context.instructions[index] as any).data.path.instructions;
  }

  it("the fixture does hold an edge whose source is not an entity", () => {
    expect(graph.refEdges).toHaveLength(1);
    expect(graph.refEdges[0]!.from).toBe("/carts/0/lines/0");
    expect(graph.refEdges[0]!.fromEntity).toBe("/carts/0");
  });

  it("starts from the host CARD when the source card is missing from positions", () => {
    // This is exactly the graph view, and the collapsed structure view: `lines` is
    // elided and `/carts/0/lines/0` has no rect.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const g = drawEdges(graph, positions, theme, 0, "ref");
    const start = anchorOnRect(CART, PRODUCT.x + PRODUCT.width / 2, PRODUCT.y + PRODUCT.height / 2);
    const path = firstPath(g, 0);
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual([start.x, start.y]);
    // And most definitely not the token's band: that is the abandoned half-signal.
    const onBand = anchorOnRect(band, PRODUCT.x + PRODUCT.width / 2, PRODUCT.y + PRODUCT.height / 2);
    expect(path[0].data).not.toEqual([onBand.x, onBand.y]);
  });

  it("starts from the value object's card as soon as it is expanded", () => {
    // Lifting only takes over as a fallback: a card that is present stays the
    // anchor, otherwise expanding the token would change nothing.
    const positions = new Map([
      ["/carts/0", CART],
      ["/carts/0/lines/0", LINE],
      ["/products/0", PRODUCT],
    ]);
    const g = drawEdges(graph, positions, theme, 0, "ref");
    const start = anchorOnRect(LINE, PRODUCT.x + PRODUCT.width / 2, PRODUCT.y + PRODUCT.height / 2);
    const path = firstPath(g, 0);
    expect(path[0].data).toEqual([start.x, start.y]);
  });

  it("draws nothing when the TARGET is hidden", () => {
    // The arrival is not lifted: a target off screen has no attachment point to
    // show, and the edge would fall into the void.
    const g = drawEdges(graph, new Map([["/carts/0", CART]]), theme, 0, "ref");
    expect(g.context.instructions).toHaveLength(0);
  });

  it("keeps the edge full when the declaring ENTITY is the one focused", () => {
    // In graph view the selection is the cart; the value object has no card there
    // to select. Without `fromEntity`, selecting the cart would dim the very edge
    // its own row carries.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set(["/carts/0"]));
    const strokes = (g.context.instructions as any[]).filter((x) => x.action === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].data.style.alpha).toBe(1);
  });

  it("keeps the edge full when the VALUE OBJECT is the one focused", () => {
    // In structure view, the cart line's own card is what gets selected.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set(["/carts/0/lines/0"]));
    const strokes = (g.context.instructions as any[]).filter((x) => x.action === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].data.style.alpha).toBe(1);
  });

  it("dims the edge when the focus touches neither the line, nor the cart, nor the target", () => {
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set(["/ailleurs"]));
    const strokes = (g.context.instructions as any[]).filter((x) => x.action === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].data.style.alpha).toBe(DIM_ALPHA);
  });
});

/**
 * The selection highlight obeys the SAME ownership rule as the labels: an edge
 * also belongs to the entity that declares it. Otherwise selecting the cart would
 * label `lines[0].productRef` without highlighting the stroke — two contradictory
 * answers to the same gesture.
 */
describe("drawSelectionOverlay — a lifted edge belongs to its entity too", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(cartData, cartConfig);
  const positions = new Map([
    ["/carts/0", { x: 0, y: 0, width: 200, height: 120 }],
    ["/products/0", { x: 0, y: 400, width: 200, height: 80 }],
  ]);

  function refStrokes(selectedId: string): number {
    const g = drawSelectionOverlay(graph, positions, theme, selectedId, "ref");
    // Card ring + (possible) reference stroke: the stroke is the one following the
    // ring, the arrow head its fill.
    return (g.context.instructions as any[]).filter((x) => x.action === "stroke").length;
  }

  it("highlights the value object's edge when the ENTITY is selected", () => {
    expect(refStrokes("/carts/0")).toBe(2);
  });

  it("highlights nothing on the TARGET: the rule stays the source's", () => {
    expect(refStrokes("/products/0")).toBe(1);
  });
});
