import { describe, it, expect } from "vitest";
import { Circle } from "pixi.js";
import { drawClusterHitAreas, drawClusters } from "../src/draw.js";
import { DIM_ALPHA } from "../src/focus.js";
import { resolveTheme } from "../src/theme.js";

describe("drawClusters", () => {
  const theme = resolveTheme(undefined);

  it("returns an empty Graphics for no clusters", () => {
    const g = drawClusters([], theme);
    expect(g).toBeDefined();
    expect(g.destroyed).toBe(false);
    // Nothing to paint: the Graphics context holds no instruction at all.
    expect(g.context.instructions.length).toBe(0);
  });

  it("draws a fill and a stroke per cluster, with bounds spanning both circles", () => {
    const g = drawClusters(
      [
        { circle: { cx: 50, cy: 40, r: 50 }, color: "#ff0000" },
        { circle: { cx: 250, cy: 30, r: 30 }, color: "#00ff00" },
      ],
      theme,
    );
    // One fill() + one stroke() per envelope: 2 envelopes -> 4 instructions.
    expect(g.context.instructions.length).toBe(4);
    // The bounds do cover both discs, not just the first.
    const bounds = g.getBounds();
    expect(bounds.minX).toBeLessThan(1);
    expect(bounds.maxX).toBeGreaterThan(279);
    expect(bounds.maxY).toBeGreaterThan(89);
  });

  /** The styles actually emitted, in order: this is where alpha and width live,
   * and reading them directly avoids inferring a render from bounds. */
  function styles(g: ReturnType<typeof drawClusters>) {
    return g.context.instructions.map((instruction) => {
      const style = (instruction.data as { style: { alpha: number; width?: number } }).style;
      return { action: instruction.action, alpha: style.alpha, width: style.width };
    });
  }

  it("paints at rest when no hover intensity is given", () => {
    // The field is optional: any caller ignoring it must get exactly the
    // rendering from before hover existed.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000" }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.08, 6);
    expect(stroke!.alpha).toBeCloseTo(0.35, 6);
    expect(stroke!.width).toBeCloseTo(1.5, 6);
  });

  it("strengthens fill, stroke and line width at maximum intensity", () => {
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000", hover: 1 }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.15, 6);
    expect(stroke!.alpha).toBeCloseTo(0.6, 6);
    expect(stroke!.width).toBeCloseTo(2, 6);
  });

  it("interpolates linearly between the two states", () => {
    // The intensity arrives already eased by `attachHover`: interpolating a
    // second time along a curve here would double the easing and make the ramp
    // limp at the start.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000", hover: 0.5 }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.115, 6);
    expect(stroke!.alpha).toBeCloseTo(0.475, 6);
    expect(stroke!.width).toBeCloseTo(1.75, 6);
  });

  it("clamps an intensity outside [0,1]", () => {
    // No source should ever produce one, but an alpha above 1 or negative would
    // be an invalid render, not merely an ugly one.
    const over = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: 4 }], theme),
    );
    const under = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: -2 }], theme),
    );
    expect(over[0]!.alpha).toBeCloseTo(0.15, 6);
    expect(under[0]!.alpha).toBeCloseTo(0.08, 6);
  });

  it("applies the intensity only to the envelope carrying it", () => {
    // Rendering is per envelope: hovering one must not light up its neighbor,
    // which stays painted at rest in the same Graphics.
    const s = styles(
      drawClusters(
        [
          { circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: 1 },
          { circle: { cx: 100, cy: 0, r: 10 }, color: "#0f0" },
        ],
        theme,
      ),
    );
    expect(s[0]!.alpha).toBeCloseTo(0.15, 6);
    expect(s[2]!.alpha).toBeCloseTo(0.08, 6);
  });

  it("paints at full strength when no dimming is asked for", () => {
    // The field is optional, like `hover`: a caller ignoring it gets exactly the
    // rendering from before dimming existed. It is also the "no selection" case,
    // which `clustersFor` turns into `dim: false` everywhere.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", dim: false }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.08, 6);
    expect(stroke!.alpha).toBeCloseTo(0.35, 6);
  });

  it("dims the fill and stroke of an envelope unrelated to the selection", () => {
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", dim: true }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.08 * DIM_ALPHA, 6);
    expect(stroke!.alpha).toBeCloseTo(0.35 * DIM_ALPHA, 6);
  });

  it("leaves the line width intact while dimming", () => {
    // Width states the object's size, not its importance: thinning it on top of
    // paling it would push the envelope into the sub-pixel.
    const [, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", dim: true }], theme),
    );
    expect(stroke!.width).toBeCloseTo(1.5, 6);
  });

  it("multiplies the dimming by the hover intensity instead of replacing it", () => {
    // A dimmed envelope the pointer crosses still responds, while staying in the
    // background: the two pieces of information do not cancel each other out.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: 1, dim: true }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.15 * DIM_ALPHA, 6);
    expect(stroke!.alpha).toBeCloseTo(0.6 * DIM_ALPHA, 6);
  });

  it("dims only the envelope that asks for it", () => {
    // Rendering is per envelope: dimming one must not push its neighbor back,
    // painted as it is in the same Graphics.
    const s = styles(
      drawClusters(
        [
          { circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", dim: true },
          { circle: { cx: 100, cy: 0, r: 10 }, color: "#0f0", dim: false },
        ],
        theme,
      ),
    );
    expect(s[0]!.alpha).toBeCloseTo(0.08 * DIM_ALPHA, 6);
    expect(s[2]!.alpha).toBeCloseTo(0.08, 6);
  });

  it("skips a circle of non-positive radius", () => {
    const g = drawClusters([{ circle: { cx: 10, cy: 10, r: 0 }, color: "#fff" }], theme);
    // No instruction emitted: a disc of zero radius is not a surface.
    expect(g.context.instructions.length).toBe(0);
  });

  it("keeps painting the following clusters after skipping a degenerate one", () => {
    const g = drawClusters(
      [
        { circle: { cx: 10, cy: 10, r: 0 }, color: "#fff" },
        { circle: { cx: 50, cy: 40, r: 50 }, color: "#ff0000" },
      ],
      theme,
    );
    // The second envelope, a valid one, is indeed painted despite the first
    // being skipped.
    expect(g.context.instructions.length).toBe(2);
  });
});

describe("drawClusterHitAreas", () => {
  it("returns one container per envelope, centered on it", () => {
    // The container is POSITIONED on the center and its `hitArea` is centered on
    // the local origin: moving the cluster then comes down to moving its
    // position, exactly like a card. A `hitArea` in world coordinates would force
    // us to mutate the circle every frame.
    const hits = drawClusterHitAreas([
      { cx: 50, cy: 40, r: 30 },
      { cx: 250, cy: 30, r: 60 },
    ]);
    expect(hits.length).toBe(2);
    expect(hits[0]!.container.position.x).toBe(50);
    expect(hits[0]!.container.position.y).toBe(40);
    const area = hits[0]!.container.hitArea as Circle;
    expect(area.x).toBe(0);
    expect(area.y).toBe(0);
    expect(area.radius).toBe(30);
  });

  it("returns the input object as is, without copying", () => {
    // This is what lets the caller mutate the layout's `ClusterShape` during the
    // drag and see the effect on the next repaint.
    const cluster = { cx: 0, cy: 0, r: 10 };
    expect(drawClusterHitAreas([cluster])[0]!.cluster).toBe(cluster);
  });

  it("is grabbable and shows an open hand", () => {
    const hit = drawClusterHitAreas([{ cx: 0, cy: 0, r: 10 }])[0]!.container;
    expect(hit.eventMode).toBe("static");
    expect(hit.cursor).toBe("grab");
  });

  it("wires no behavior: the hit target is bare", () => {
    // A tap on an envelope does select its aggregate, but `create.ts` is what
    // wires that — like the drag and the hover. THIS function returns nothing but
    // a pointer-sensitive geometry, otherwise it could no longer be tested
    // without an aggregate index and an instance.
    const hit = drawClusterHitAreas([{ cx: 0, cy: 0, r: 10 }])[0]!.container;
    expect(hit.listenerCount("pointertap")).toBe(0);
    expect(hit.listenerCount("pointerdown")).toBe(0);
  });

  it("ignores a non-positive radius", () => {
    // Same guard as `drawClusters`: a disc of zero radius is not a surface, and a
    // `hitArea` of zero radius would be ungrabbable anyway.
    expect(drawClusterHitAreas([{ cx: 10, cy: 10, r: 0 }])).toEqual([]);
  });
});
