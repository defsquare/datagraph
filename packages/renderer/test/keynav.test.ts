import { describe, it, expect } from "vitest";
import type { NodeId, Rect } from "@defsquare/data-graph-core";
import { nearestInDirection } from "../src/keynav.js";

/**
 * Arrow navigation over the PUBLISHED layout: no graph, no view, no scene —
 * rectangles and a direction. That is what makes the rule provable here rather
 * than through a canvas, and it is the same split as `drag.ts` and `hover.ts`.
 */
const FROM: Rect = { x: 100, y: 100, width: 100, height: 60 };

function at(x: number, y: number): Rect {
  return { x, y, width: 100, height: 60 };
}

const CANDIDATES: [NodeId, Rect][] = [
  ["/right-near", at(300, 100)],
  ["/right-far", at(900, 100)],
  ["/right-offset", at(320, 400)],
  ["/left", at(-200, 100)],
  ["/up", at(100, -200)],
  ["/down", at(100, 400)],
];

describe("nearestInDirection", () => {
  it("takes the nearest neighbour on the axis", () => {
    expect(nearestInDirection(FROM, CANDIDATES, "right")).toBe("/right-near");
    expect(nearestInDirection(FROM, CANDIDATES, "left")).toBe("/left");
    expect(nearestInDirection(FROM, CANDIDATES, "up")).toBe("/up");
    expect(nearestInDirection(FROM, CANDIDATES, "down")).toBe("/down");
  });

  it("prefers alignment over raw distance", () => {
    // `/right-far` is further along x than `/right-offset`, but it stays on the
    // row: the cross-axis drift is what makes a keyboard move feel wrong, so it
    // weighs double.
    const candidates: [NodeId, Rect][] = [
      ["/aligned", at(900, 100)],
      ["/drifted", at(320, 700)],
    ];
    expect(nearestInDirection(FROM, candidates, "right")).toBe("/aligned");
  });

  it("ignores what is behind, and the node itself", () => {
    expect(nearestInDirection(FROM, [["/left", at(-200, 100)]], "right")).toBeNull();
    expect(nearestInDirection(FROM, [["/self", FROM]], "right")).toBeNull();
  });

  it("returns null with nothing to go to", () => {
    expect(nearestInDirection(FROM, [], "up")).toBeNull();
  });
});
