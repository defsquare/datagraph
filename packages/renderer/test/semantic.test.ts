import { describe, it, expect } from "vitest";
import type { Container } from "pixi.js";
import {
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type NodeId,
  type NodeMetrics,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { ClusterShape, GraphLayoutResult } from "@defsquare/data-graph-core/graph-layout";
import {
  aggregateRefEdges,
  createGraphViewController,
  dominantSegmentPrefix,
  type ClustersForArgs,
  type GraphViewController,
} from "../src/graph-view.js";
import {
  blendOver,
  bucketOf,
  drawSemanticDiscs,
  drawSemanticEdges,
  drawSemanticLabels,
  truncateMiddle,
  type SemanticNode,
} from "../src/draw.js";
import { DIM_ALPHA } from "../src/focus.js";
import { resolveTheme } from "../src/theme.js";
import { cartConfig, cartData } from "./fixtures.js";

// --------------------------------------------------------------------------
// EDGE AGGREGATION — the pure function, tested on hand-made edges rather than on
// a constructed graph: what is at stake here is exactly the folding of a list of
// edges onto a partition, and fabricating a JSON document to get there would put
// the whole construction pipeline between the test and its subject.
// --------------------------------------------------------------------------

/** A RESOLVED reference from `fromEntity` to `to`. `from` equals `fromEntity`
 * except when the test is precisely about their difference. */
function ref(fromEntity: NodeId, to: NodeId | null, from = fromEntity): RefEdge {
  return {
    kind: "ref",
    from,
    fromEntity,
    to,
    field: "ref",
    targetType: "T",
    targetId: "x",
    dangling: to === null,
  };
}

function byNodeOf(pairs: [NodeId, string][]): Map<NodeId, string[]> {
  return new Map(pairs.map(([id, aggregateId]) => [id, [aggregateId]]));
}

describe("aggregateRefEdges", () => {
  it("folds the references onto aggregate pairs, with their weight", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
      ["b2", "B"],
    ]);
    const edges = aggregateRefEdges([ref("a1", "b1"), ref("a2", "b2"), ref("a1", "b2")], byNode);
    expect(edges).toEqual([{ a: "A", b: "B", weight: 3 }]);
  });

  it("ignores INTRA-aggregate references", () => {
    // The disc itself already says them; drawing them would put a self-loop in
    // place.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
    ]);
    const edges = aggregateRefEdges([ref("a1", "a2"), ref("a1", "b1")], byNode);
    expect(edges).toEqual([{ a: "A", b: "B", weight: 1 }]);
  });

  it("ignores a reference with one end OUTSIDE any aggregate", () => {
    // An entity with no aggregate keeps its card under the semantic regime: it has
    // no disc, hence no end to link.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    const edges = aggregateRefEdges(
      [ref("a1", "orphan"), ref("orphan", "b1"), ref("a1", "b1")],
      byNode,
    );
    expect(edges).toEqual([{ a: "A", b: "B", weight: 1 }]);
  });

  it("ignores a dangling or targetless reference", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    const broken = { ...ref("a1", "b1"), dangling: true };
    expect(aggregateRefEdges([broken, ref("a1", null)], byNode)).toEqual([]);
  });

  it("counts by the declaring ENTITY, not by the node carrying the row", () => {
    // A reference carried by a value object is its entity's: that is the only
    // level `byNode` answers at. Without `fromEntity`, this edge would vanish —
    // the value object is in no aggregate.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    expect(aggregateRefEdges([ref("a1", "b1", "a1/lines/0")], byNode)).toEqual([
      { a: "A", b: "B", weight: 1 },
    ]);
  });

  it("folds both DIRECTIONS into the same pair", () => {
    // The edge is undirected: at this scale no arrow head is legible, and what the
    // view shows is the coupling.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    expect(aggregateRefEdges([ref("a1", "b1"), ref("b1", "a1")], byNode)).toEqual([
      { a: "A", b: "B", weight: 2 },
    ]);
  });

  it("normalizes the pair: `a` is always the smaller id", () => {
    const byNode = byNodeOf([
      ["z1", "Z"],
      ["a1", "A"],
    ]);
    // Met in the Z → A direction, it still comes out A → Z.
    expect(aggregateRefEdges([ref("z1", "a1")], byNode)).toEqual([
      { a: "A", b: "Z", weight: 1 },
    ]);
  });

  it("returns the pairs in FIRST-ENCOUNTER order, deterministically", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
      ["c1", "C"],
    ]);
    const edges = [ref("c1", "b1"), ref("a1", "b1"), ref("b1", "c1"), ref("a1", "c1")];
    const first = aggregateRefEdges(edges, byNode);
    // B–C first (met first), then A–B, then A–C.
    expect(first.map((e) => `${e.a}-${e.b}`)).toEqual(["B-C", "A-B", "A-C"]);
    expect(first.map((e) => e.weight)).toEqual([2, 1, 1]);
    // Two calls on the same input return exactly the same thing: the drawing's
    // stability from one publication to the next depends on it.
    expect(aggregateRefEdges(edges, byNode)).toEqual(first);
  });

  it("does not conflate two pairs whose ids glue back together", () => {
    // Aggregate ids are `${type}#${entityId}`, and an entity id may contain any
    // printable character: a pair key built on a printable separator would
    // conflate these two pairs.
    const byNode = byNodeOf([
      ["x", "T#a"],
      ["y", "b#T"],
      ["z", "T#a b"],
      ["w", "T"],
    ]);
    const edges = aggregateRefEdges([ref("x", "y"), ref("z", "w")], byNode);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.weight === 1)).toBe(true);
  });

  it("returns an empty array when there is no aggregate", () => {
    expect(aggregateRefEdges([ref("a1", "b1")], new Map())).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// THE DOMINANT PREFIX — the pure function, tested on lists of strings: what is at
// stake is a computation over names, not over a graph.
// --------------------------------------------------------------------------

describe("dominantSegmentPrefix", () => {
  it("returns the longest prefix by SEGMENTS, ending on its dot", () => {
    // The real dataset's case: ~1,300 packages of a single application, all under
    // the same root. The tail of the path is what distinguishes.
    expect(
      dominantSegmentPrefix([
        "com.bnpparibas.bddf.fipro.domain.project",
        "com.bnpparibas.bddf.fipro.domain.contract",
        "com.bnpparibas.bddf.fipro.infra.jpa",
      ]),
    ).toBe("com.bnpparibas.bddf.fipro.");
  });

  it("cuts at SEGMENTS and never in the middle of one", () => {
    // `credit` and `creditcard` share four characters, not a segment: stripping
    // `com.exemple.credit` would leave `card…`, which is no longer a path.
    expect(dominantSegmentPrefix(["com.exemple.credit.a", "com.exemple.creditcard.b"])).toBe(
      "com.exemple.",
    );
  });

  it("holds despite a minority of names from ANOTHER family", () => {
    // The real dataset exactly: packages under a single root, plus a few foreign
    // modules and packages. Demanding unanimity would strip nothing at all — this
    // is the case that motivated the threshold.
    const packages = Array.from({ length: 20 }, (_, i) =>
      // Two branches under the root: otherwise the branch itself would be the
      // dominant prefix, and rightly so.
      i % 2 === 0 ? `com.bnpparibas.bddf.fipro.domain.p${i}` : `com.bnpparibas.bddf.fipro.infra.p${i}`,
    );
    expect(dominantSegmentPrefix([...packages, "bddf-fipro-domain", "com.axway.cft.client"])).toBe(
      "com.bnpparibas.bddf.fipro.",
    );
  });

  it("strips nothing when no prefix reaches the majority", () => {
    // Two families in equal shares: neither is the other's noise.
    expect(
      dominantSegmentPrefix([
        "com.alpha.un.a",
        "com.alpha.un.b",
        "org.beta.deux.c",
        "org.beta.deux.d",
      ]),
    ).toBe("");
  });

  it("strips nothing from a SINGLE label", () => {
    // There is then no repetition on screen: the single disc would lose its full
    // name with nothing given back to the reading.
    expect(dominantSegmentPrefix(["com.exemple.credit.domain"])).toBe("");
    expect(dominantSegmentPrefix([])).toBe("");
  });

  it("strips nothing when the common prefix holds FEWER than two segments", () => {
    // Stripping `com.` gives back almost no room and costs the path's root.
    expect(dominantSegmentPrefix(["com.alpha.x", "com.beta.y"])).toBe("");
  });

  it("returns the empty string when the labels have nothing in common", () => {
    expect(dominantSegmentPrefix(["com.alpha.x", "org.beta.y"])).toBe("");
    // Labels with no dot at all: the case of small datasets, where the label is a
    // short id rather than a path.
    expect(dominantSegmentPrefix(["k1", "p1"])).toBe("");
  });

  it("always leaves ONE segment, even when a label is the prefix of the others", () => {
    // `a.b.c` is entirely common, but stripping it would leave the first disc
    // anonymous: the prefix is capped at one segment fewer than the shortest
    // label.
    expect(dominantSegmentPrefix(["a.b.c", "a.b.c.d"])).toBe("a.b.");
  });

  it("leaves one segment even when ALL the labels are identical", () => {
    // Nothing can tell them apart anyway; what matters is that none becomes empty.
    const prefix = dominantSegmentPrefix(["a.b.c.d", "a.b.c.d"]);
    expect(prefix).toBe("a.b.c.");
    expect("a.b.c.d".slice(prefix.length)).toBe("d");
  });

  it("guarantees a non-empty remainder on a heterogeneous set", () => {
    // The property that lets the caller cut with a plain `slice`: whatever the
    // dataset, no label becomes empty.
    const labels = [
      "com.exemple.credit.domain.project.service",
      "com.exemple.credit.domain",
      "com.exemple.credit.infra",
      "com.exemple.credit",
    ];
    // The common part is `com.exemple.credit`, but the shortest label has only
    // those three segments: the cap brings the prefix back to `com.exemple.`,
    // which still covers two and is therefore stripped.
    const prefix = dominantSegmentPrefix(labels);
    expect(prefix).toBe("com.exemple.");
    expect(labels.map((l) => l.slice(prefix.length))).toEqual([
      "credit.domain.project.service",
      "credit.domain",
      "credit.infra",
      "credit",
    ]);
  });
});

// --------------------------------------------------------------------------
// THE CONTROLLER — what the semantic regime derives from the published state.
// --------------------------------------------------------------------------

/** `cartData` with TWO roots: the cart and the product each become their own
 * aggregate, and the `lines[*].productRef` reference — carried by a value object
 * — links them. It is the smallest dataset that produces an INTER-aggregate
 * aggregated edge, and it covers the `fromEntity` case along the way. */
const twoRootConfig: DataGraphConfig = { ...cartConfig, groups: ["Cart", "Product"] };
const twoRootGraph = buildGraph(cartData, twoRootConfig);

/** The real dataset in miniature: entities whose id is an FQN, the vast majority
 * under one root plus one foreign to the batch. It is the only dataset that
 * exercises dominant-prefix stripping end to end — the shared fixtures have short
 * ids, with no dot. */
const fqnConfig: DataGraphConfig = {
  ids: { Package: "$.packages[*].id" },
  groups: ["Package"],
};
const fqnGraph = buildGraph(
  {
    packages: [
      ...["project", "contract", "party", "rule", "event"].map((name) => ({
        id: `com.exemple.credit.domain.${name}`,
      })),
      ...["jpa", "rest", "soap", "sql"].map((name) => ({
        id: `com.exemple.credit.infra.${name}`,
      })),
      { id: "autre.chose.ici" },
    ],
  },
  fqnConfig,
);

function controllerFor(): GraphViewController {
  return createGraphViewController({
    layoutOptions: undefined,
    getMetrics: (): NodeMetrics => DEFAULT_METRICS,
  });
}

async function published(): Promise<GraphViewController> {
  const controller = controllerFor();
  controller.publish(await controller.compute(twoRootGraph, twoRootConfig, false));
  return controller;
}

/** The painting arguments at rest: nothing selected, nothing hovered. */
function args(over: Partial<ClustersForArgs> = {}): ClustersForArgs {
  return {
    graph: twoRootGraph,
    accentFor: () => "#123456",
    fallbackColor: "#000000",
    selectedAggregateId: null,
    keep: null,
    hoverOf: () => 0,
    ...over,
  };
}

/** Publishes a FABRICATED state: two discs at chosen coordinates and one edge
 * between them. This is the only way to assert the clipping geometry without
 * depending on where the engine puts what. */
function publishSynthetic(
  controller: GraphViewController,
  clusters: ClusterShape[],
  semanticEdges: { a: string; b: string; weight: number }[],
): void {
  const layout: GraphLayoutResult = { positions: new Map(), clusters };
  controller.publish({
    index: { aggregates: new Map(), byNode: new Map() },
    layout,
    semanticEdges,
    // No labels: these discs exist only for their geometry, and falling back to
    // the aggregate id is enough to name them.
    semanticLabels: new Map(),
  });
}

const shape = (aggregateId: string, cx: number, cy: number, r: number): ClusterShape => ({
  aggregateId,
  rootId: `/root/${aggregateId}`,
  cx,
  cy,
  r,
});

describe("graph view controller — semantic regime", () => {
  it("publishes the aggregated edges along with the rest of the state", async () => {
    const controller = await published();
    // One cart, one product, one reference between them: a pair of weight 1.
    expect(controller.semanticEdges(null)).toHaveLength(1);
  });

  it("loses the aggregated edges on invalidation, along with the rest", async () => {
    const controller = await published();
    controller.invalidate();
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("resolves an entity's membership, and returns `undefined` outside any aggregate", async () => {
    const controller = await published();
    expect(controller.aggregateIdOf("/carts/0")).toBe("Cart#k1");
    expect(controller.aggregateIdOf("/carts/0/lines/0")).toBeUndefined();
  });

  it("labels each disc by its root's ENTITY id, and counts its members", async () => {
    const controller = await published();
    const nodes = new Map(controller.semanticNodesFor(args()).map((n) => [n.id, n]));
    expect(nodes.get("Cart#k1")!.label).toBe("k1");
    expect(nodes.get("Product#p1")!.label).toBe("p1");
    expect(nodes.get("Cart#k1")!.count).toBe(1);
  });

  it("strips the common prefix from the PAINTED labels, keeping the full id", async () => {
    // The real dataset in miniature: a single package tree, hence a prefix every
    // disc would repeat. The id, for its part, does not move — selection, the
    // detail panel and search all go through it.
    const controller = controllerFor();
    controller.publish(await controller.compute(fqnGraph, fqnConfig, false));
    const nodes = new Map(
      controller.semanticNodesFor(args({ graph: fqnGraph })).map((n) => [n.id, n]),
    );
    expect(nodes.get("Package#com.exemple.credit.domain.project")!.label).toBe("domain.project");
    expect(nodes.get("Package#com.exemple.credit.infra.jpa")!.label).toBe("infra.jpa");
    // The one foreign to the batch keeps its WHOLE name: the prefix is dominant,
    // not universal, and cutting from it a prefix it does not carry would make no
    // sense.
    expect(nodes.get("Package#autre.chose.ici")!.label).toBe("autre.chose.ici");
  });

  it("loses the labels on invalidation, along with the rest", async () => {
    // The stripped prefix is THIS set of aggregates': kept under another graph, it
    // would name discs with the shorthand of a dataset that is gone.
    const controller = controllerFor();
    controller.publish(await controller.compute(fqnGraph, fqnConfig, false));
    controller.invalidate();
    publishSynthetic(controller, [shape("Package#com.exemple.credit.infra.jpa", 0, 0, 10)], []);
    // No table left: the label falls back to the aggregate id, never to a blank.
    expect(controller.semanticNodesFor(args({ graph: fqnGraph }))[0]!.label).toBe(
      "Package#com.exemple.credit.infra.jpa",
    );
  });

  it("resolves color, dimming and hover EXACTLY like the envelopes", async () => {
    const controller = await published();
    const selected = args({ selectedAggregateId: "Cart#k1", keep: new Set(["/carts/0"]) });
    const hulls = new Map(controller.clustersFor(selected).map((p, i) => [i, p]));
    const discs = controller.semanticNodesFor(selected);
    // The disc and the envelope it replaces describe the same aggregate:
    // everything not specific to the semantic regime must be identical, otherwise
    // the two regimes would not light up together.
    discs.forEach((disc, i) => {
      const hull = hulls.get(i)!;
      expect(disc.circle).toEqual(hull.circle);
      expect(disc.color).toBe(hull.color);
      expect(disc.dim).toBe(hull.dim);
      expect(disc.hover).toBe(hull.hover);
    });
    expect(discs.some((d) => d.hover === 1)).toBe(true);
  });

  it("trims the segment at both discs' edges", () => {
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 10), shape("B", 100, 0, 20)],
      [{ a: "A", b: "B", weight: 1 }],
    );
    expect(controller.semanticEdges(null)).toEqual([
      { x1: 10, y1: 0, x2: 80, y2: 0, weight: 1, dim: false },
    ]);
  });

  it("omits a pair whose discs touch or overlap", () => {
    // No segment is left: a stroke of zero or negative length would be a stroke
    // turned inside out.
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 60), shape("B", 100, 0, 60)],
      [{ a: "A", b: "B", weight: 1 }],
    );
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("omits a pair whose disc is missing from the layout", () => {
    const controller = controllerFor();
    publishSynthetic(controller, [shape("A", 0, 0, 10)], [{ a: "A", b: "B", weight: 1 }]);
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("keeps FULL every edge touching the selected aggregate", () => {
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 10), shape("B", 200, 0, 10), shape("C", 400, 0, 10)],
      [
        { a: "A", b: "B", weight: 1 },
        { a: "B", b: "C", weight: 1 },
        { a: "A", b: "C", weight: 1 },
      ],
    );
    const dims = controller.semanticEdges("B").map((e) => e.dim);
    // A–B and B–C touch the selection, A–C says nothing about it.
    expect(dims).toEqual([false, false, true]);
    // With no selection, nothing recedes.
    expect(controller.semanticEdges(null).every((e) => e.dim === false)).toBe(true);
  });

  it("follows the moved discs, which are mutated IN PLACE", () => {
    const controller = controllerFor();
    const a = shape("A", 0, 0, 10);
    publishSynthetic(controller, [a, shape("B", 100, 0, 10)], [{ a: "A", b: "B", weight: 1 }]);
    a.cx = -100;
    // The segment is recomputed on every read: that is what lets moving an
    // aggregate drag its edges along without republishing anything.
    expect(controller.semanticEdges(null)[0]!.x1).toBe(-90);
  });
});

// --------------------------------------------------------------------------
// THE DRAWING — bare data only, like the rest of `draw.ts`.
// --------------------------------------------------------------------------

describe("truncateMiddle", () => {
  it("leaves a text that fits untouched", () => {
    expect(truncateMiddle("abcd", 100, 10)).toBe("abcd");
  });

  it("eats the MIDDLE and keeps the end, which is what distinguishes", () => {
    // Truncating from the end would give "com.exemp…" for the whole dataset.
    expect(truncateMiddle("com.exemple.credit.domain", 110, 10)).toBe("com.e…omain");
  });

  it("gives the extra character to the HEAD when the budget is odd", () => {
    expect(truncateMiddle("abcdefgh", 40, 10)).toBe("ab…h");
  });

  it("falls back to the ellipsis alone when only one character is left", () => {
    expect(truncateMiddle("abcdef", 10, 10)).toBe("…");
  });

  it("returns the empty string when there is no room", () => {
    expect(truncateMiddle("abc", 0, 10)).toBe("");
    expect(truncateMiddle("abc", -5, 10)).toBe("");
  });
});

describe("bucketOf", () => {
  it("spreads the weights over four buckets", () => {
    expect(bucketOf(1)).toBe(0);
    expect(bucketOf(2)).toBe(1);
    expect(bucketOf(4)).toBe(2);
    expect(bucketOf(6)).toBe(3);
  });

  it("caps: beyond the full weight, everything lands in the top bucket", () => {
    expect(bucketOf(8)).toBe(3);
    expect(bucketOf(800)).toBe(3);
  });

  it("clamps an absurd weight from below", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(-3)).toBe(0);
  });
});

describe("blendOver", () => {
  const black = "#000000";
  const white = "#ffffff";

  it("returns the base at zero intensity and the overlay at full intensity", () => {
    expect(blendOver(black, white, 0)).toBe(0x000000);
    expect(blendOver(black, white, 1)).toBe(0xffffff);
  });

  it("blends linearly, and returns an OPAQUE color", () => {
    // That is the point: the pixel is computed once here rather than by a second
    // translucent fill on every frame.
    expect(blendOver(black, white, 0.5)).toBe(0x808080);
  });

  it("clamps an intensity outside [0,1]", () => {
    expect(blendOver(black, white, 2)).toBe(0xffffff);
    expect(blendOver(black, white, -1)).toBe(0x000000);
  });
});

const theme = resolveTheme(undefined);

function node(over: Partial<SemanticNode> = {}): SemanticNode {
  return {
    id: "A",
    circle: { cx: 0, cy: 0, r: 100 },
    color: "#ff0000",
    label: "alpha",
    count: 3,
    ...over,
  };
}

/** The styles actually emitted, in order. Same reading as `clusters.test.ts`:
 * alpha and width live there. */
function styles(g: { context: { instructions: unknown[] } }) {
  return (g.context.instructions as { action: string; data: unknown }[]).map((instruction) => {
    const style = (instruction.data as { style: { color?: number; alpha: number; width?: number } })
      .style;
    return { action: instruction.action, color: style.color, alpha: style.alpha, width: style.width };
  });
}

describe("drawSemanticDiscs", () => {
  it("emits one fill and one stroke per disc", () => {
    const g = drawSemanticDiscs([node(), node({ id: "B", circle: { cx: 300, cy: 0, r: 50 } })], theme);
    expect(g.context.instructions.length).toBe(4);
  });

  it("paints OPAQUE: the color is pre-blended, not laid on in alpha", () => {
    // This is what hides the aggregated edges passing underneath — and what avoids
    // the second fill that used to double the painted surface.
    const [fill, stroke] = styles(drawSemanticDiscs([node()], theme));
    expect(fill!.alpha).toBe(1);
    expect(stroke!.alpha).toBe(1);
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3));
    expect(stroke!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.75));
  });

  it("strengthens accent and stroke on hover", () => {
    const [fill, stroke] = styles(drawSemanticDiscs([node({ hover: 1 })], theme));
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.5));
    expect(stroke!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 1));
  });

  it("clamps an intensity outside [0,1]", () => {
    const over = styles(drawSemanticDiscs([node({ hover: 4 })], theme));
    const under = styles(drawSemanticDiscs([node({ hover: -2 })], theme));
    expect(over[0]!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.5));
    expect(under[0]!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3));
  });

  it("dims by pulling the disc TOWARDS the canvas, without making it transparent", () => {
    // A dimmed disc recedes, but keeps hiding the edges passing underneath:
    // otherwise the drawing's background would come back up through the very
    // blocks we just pushed out of sight.
    const [fill] = styles(drawSemanticDiscs([node({ dim: true })], theme));
    expect(fill!.alpha).toBe(1);
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3 * DIM_ALPHA));
  });

  it("keeps the stroke width PROPORTIONAL to the radius", () => {
    // This is the condition for semantic zoom: the disc grows with the camera, so
    // its outline must grow with it.
    const [, stroke] = styles(drawSemanticDiscs([node()], theme));
    expect(stroke!.width).toBeCloseTo(100 * 0.03, 6);
    const [, hovered] = styles(drawSemanticDiscs([node({ hover: 1 })], theme));
    expect(hovered!.width).toBeCloseTo(100 * 0.05, 6);
  });

  it("leaves the width intact while dimming", () => {
    const [, stroke] = styles(drawSemanticDiscs([node({ dim: true })], theme));
    expect(stroke!.width).toBeCloseTo(100 * 0.03, 6);
  });

  it("ignores a non-positive radius and carries on", () => {
    const g = drawSemanticDiscs([node({ circle: { cx: 0, cy: 0, r: 0 } }), node()], theme);
    expect(g.context.instructions.length).toBe(2);
  });

  it("paints nothing when there is no disc", () => {
    expect(drawSemanticDiscs([], theme).context.instructions.length).toBe(0);
  });
});

/**
 * A disc's label and badge, in the order `drawSemanticLabels` mounts them: that
 * is the function's contract, and reading it here avoids repeating the same typed
 * descent in every test.
 */
function partsOf(
  layer: Container,
  index = 0,
): { text: string; y: number; scale: { x: number } }[] {
  return (layer.children[index] as Container).children as unknown as {
    text: string;
    y: number;
    scale: { x: number };
  }[];
}

describe("drawSemanticLabels", () => {
  it("groups the label and its badge in a container tagged by the aggregate", () => {
    // This is what lets `dragCluster` move only the label concerned.
    const layer = drawSemanticLabels([node({ id: "Package#alpha" })], theme, false);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]!.label).toBe("Package#alpha");
    expect(partsOf(layer)).toHaveLength(2);
  });

  it("never intercepts the pointer: the disc underneath carries the gesture", () => {
    expect(drawSemanticLabels([node()], theme, false).eventMode).toBe("none");
  });

  it("gives the SAME character budget to every disc, whatever its size", () => {
    // The radius cancels out between the usable width and the font size: that is
    // what makes a disc's size read as a quantity of members and not as a quantity
    // of text.
    const long = "com.exemple.credit.domain.model.request";
    const small = drawSemanticLabels([node({ label: long, circle: { cx: 0, cy: 0, r: 40 } })], theme, false);
    const big = drawSemanticLabels([node({ label: long, circle: { cx: 0, cy: 0, r: 900 } })], theme, false);
    const textOf = (layer: Container): string => partsOf(layer)[0]!.text;
    expect(textOf(small)).toBe(textOf(big));
    expect(textOf(small).length).toBeLessThan(long.length);
    expect(textOf(small)).toContain("…");
  });

  it("scales rather than changing the font size", () => {
    // Creating 1,300 texts at 1,300 sizes would demand as many atlases; scaling
    // lets the labels share the cards' one.
    const layer = drawSemanticLabels([node({ circle: { cx: 0, cy: 0, r: 100 } })], theme, false);
    const label = partsOf(layer)[0]!;
    expect(label.scale.x).toBeCloseTo((100 * 0.2) / theme.typography.header.size, 6);
  });

  it("writes the member count under the label", () => {
    const layer = drawSemanticLabels([node({ count: 42 })], theme, false);
    const [label, badge] = partsOf(layer);
    expect(badge!.text).toBe("42");
    expect(badge!.y).toBeGreaterThan(label!.y);
  });

  it("ignores a non-positive radius", () => {
    expect(
      drawSemanticLabels([node({ circle: { cx: 0, cy: 0, r: 0 } })], theme, false).children,
    ).toHaveLength(0);
  });
});

describe("drawSemanticLabels — legibility floor", () => {
  const tiny = [node({ id: "c67", label: "c67", count: 3, circle: { cx: 0, cy: 0, r: 6 } })];

  it("keeps a small disc's label readable when zoomed out", () => {
    // r * SEMANTIC_LABEL_RATIO = 1.2px of world type; at a camera scale of 0.1
    // that is 0.12px on screen — a smudge. The floor is expressed on SCREEN, so
    // it has to be divided back by the scale to become a world size.
    const layer = drawSemanticLabels(tiny, theme, false, undefined, 0.1);
    const label = partsOf(layer)[0]!;
    // 9px on screen at scale 0.1 = 90px in the world; the scale factor is that
    // over the theme's header size.
    expect(label.scale.x).toBeCloseTo(90 / theme.typography.header.size, 3);
  });

  it("leaves a label alone when the disc is already large enough", () => {
    const big = [node({ id: "big", label: "Boutique", count: 300, circle: { cx: 0, cy: 0, r: 400 } })];
    const layer = drawSemanticLabels(big, theme, false, undefined, 1);
    const label = partsOf(layer)[0]!;
    expect(label.scale.x).toBeCloseTo((400 * 0.2) / theme.typography.header.size, 3);
  });

  it("defaults to a scale of 1, so existing callers are unaffected", () => {
    const big = [node({ id: "big", label: "Boutique", count: 300, circle: { cx: 0, cy: 0, r: 400 } })];
    const withoutArg = partsOf(drawSemanticLabels(big, theme, false))[0]!.scale.x;
    const withDefault = partsOf(drawSemanticLabels(big, theme, false, undefined, 1))[0]!.scale.x;
    expect(withoutArg).toBeCloseTo(withDefault, 5);
  });
});

describe("drawSemanticEdges", () => {
  const edge = (weight: number, dim = false) => ({ x1: 0, y1: 0, x2: 100, y2: 0, weight, dim });

  it("paints nothing with no edge, nor with no width unit", () => {
    expect(drawSemanticEdges([], theme, 100).context.instructions.length).toBe(0);
    expect(drawSemanticEdges([edge(1)], theme, 0).context.instructions.length).toBe(0);
  });

  it("emits ONE stroke per occupied bucket, not one per edge", () => {
    // A `stroke()` carries a single style: one width per edge would mean thousands
    // of drawing calls.
    const same = drawSemanticEdges([edge(1), edge(1), edge(1)], theme, 100);
    expect(same.context.instructions.length).toBe(1);
    const spread = drawSemanticEdges([edge(1), edge(3), edge(5), edge(7)], theme, 100);
    expect(spread.context.instructions.length).toBe(4);
  });

  it("grades width AND alpha from the lowest bucket to the highest", () => {
    const s = styles(drawSemanticEdges([edge(1), edge(7)], theme, 100));
    expect(s[0]!.width!).toBeLessThan(s[1]!.width!);
    expect(s[0]!.alpha).toBeLessThan(s[1]!.alpha);
  });

  it("sets the width as a fraction of the unit it is given", () => {
    const small = styles(drawSemanticEdges([edge(1)], theme, 100));
    const large = styles(drawSemanticEdges([edge(1)], theme, 200));
    expect(large[0]!.width!).toBeCloseTo(small[0]!.width! * 2, 6);
  });

  it("paints the dimmed ones BEFORE the full ones, hence underneath", () => {
    // Inside a single Graphics, only emission order settles the overlap: the
    // selection must go over the rest.
    const s = styles(drawSemanticEdges([edge(1), edge(1, true)], theme, 100));
    expect(s).toHaveLength(2);
    expect(s[0]!.alpha).toBeLessThan(s[1]!.alpha);
    expect(s[0]!.alpha).toBeCloseTo(s[1]!.alpha * DIM_ALPHA, 6);
  });
});
