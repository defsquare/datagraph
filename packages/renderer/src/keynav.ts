import type { NodeId, Rect } from "@defsquare/datagraph-core";

export type Direction = "up" | "down" | "left" | "right";

/**
 * How much a drift ACROSS the direction of travel costs, relative to distance
 * along it.
 *
 * Above 1 on purpose: pressing → and landing on a card two rows down is what
 * makes arrow navigation feel arbitrary. Weighting the cross axis keeps the
 * move on the line the user is reading, and only falls back to a distant
 * aligned card when nothing near is aligned at all.
 */
const CROSS_AXIS_WEIGHT = 2;

/** A rectangle's centre. */
function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The visible neighbour to move the selection to, or `null` when the direction
 * leads nowhere.
 *
 * Works on the PUBLISHED layout alone — rectangles and a direction — which is
 * why it lives here and not in `create.ts`: the graph, the view and the scene
 * have no say in which card is to the right of which.
 *
 * Candidates strictly behind the direction of travel are excluded, and so is a
 * candidate whose centre coincides with the origin's (the node itself, and any
 * card exactly on top of it — moving to one would look like nothing happened).
 */
export function nearestInDirection(
  from: Rect,
  candidates: Iterable<readonly [NodeId, Rect]>,
  direction: Direction,
): NodeId | null {
  const origin = centre(from);
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;

  let best: NodeId | null = null;
  let bestScore = Infinity;

  for (const [id, rect] of candidates) {
    const c = centre(rect);
    const along = (horizontal ? c.x - origin.x : c.y - origin.y) * sign;
    if (along <= 0) continue;
    const across = Math.abs(horizontal ? c.y - origin.y : c.x - origin.x);
    const score = along + across * CROSS_AXIS_WEIGHT;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
