import type { Rect } from "./structure-layout.js"

export interface Circle {
  cx: number
  cy: number
  r: number
}

interface Point {
  x: number
  y: number
}

/**
 * Tolerance of circle membership. A support point sits, by construction, exactly
 * on the boundary; without slack, floating-point rounding would reject it on the
 * next iteration and restart a search already done.
 */
const EPSILON = 1e-9

function contains(c: Circle, p: Point): boolean {
  const dx = p.x - c.cx
  const dy = p.y - c.cy
  const bound = c.r + EPSILON
  return dx * dx + dy * dy <= bound * bound
}

/** Circle with `[a, b]` as diameter. */
function fromTwo(a: Point, b: Point): Circle {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(a.x - b.x, a.y - b.y) / 2,
  }
}

/**
 * Circle circumscribed about three points. If they are collinear none exists:
 * the largest of the three diameter circles contains all three and does the job.
 */
function fromThree(a: Point, b: Point, c: Point): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < EPSILON) {
    let best = fromTwo(a, b)
    for (const candidate of [fromTwo(a, c), fromTwo(b, c)]) {
      if (candidate.r > best.r) best = candidate
    }
    return best
  }
  const aa = a.x * a.x + a.y * a.y
  const bb = b.x * b.x + b.y * b.y
  const cc = c.x * c.x + c.y * c.y
  const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d
  const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) }
}

/**
 * Welzl's algorithm, in its iterative three-nested-loop form: points are added
 * one at a time, and as soon as a point falls outside the current circle the
 * search is redone with that point forced onto the boundary (then two points on
 * the boundary, then three — a minimal circle is determined by two or three
 * support points).
 *
 * **The input is NOT shuffled**, and that is deliberate. Welzl's expected-linear
 * bound rests on a random permutation of the points; without it, the worst case
 * is cubic. But this repo demands BIT-level determinism (see the FNV-1a seeding
 * in `graph-layout.ts` and the layout determinism tests), and a shuffle — even
 * with a fixed seed — is one more moving part on that path. The sizes at stake
 * make the trade-off easy: a cluster is an aggregate here, so 4 points for the
 * common case (a single card) and 20 for the largest measured on the demo
 * dataset (5 cards).
 *
 * "It would stop being so on aggregates of several hundred cards", this note used
 * to say, without having measured it. It is now quantified, and it is right —
 * with one nuance that matters since intra-aggregate placement became RADIAL
 * (`graph-layout.ts`). Radial places cards ON CIRCLES, so a large share of the
 * corners ends up near the boundary of the enclosing circle: that is unshuffled
 * Welzl's adversarial case, the one that forces the most rebuilds of the support
 * set. Measured, per call, shelves → radial:
 *
 *    41 cards (164 corners)    0.0187 → 0.0352 ms
 *    66 cards (264 corners)    0.0261 → 0.0686 ms
 *   157 cards (628 corners)    0.0673 → 0.2834 ms
 *   297 cards (1188 corners)   0.2158 → 1.6732 ms
 *
 * Growth is indeed superlinear under radial (×7.2 in cards → ×48 in time), so
 * the warning holds and comes sooner than before. But the TRADE-OFF does not
 * change: at the intended scale — 60 cards in the largest test aggregate — that
 * is 0.07 ms per call, and even at 297 cards those 1.7 ms account for 21% of a
 * 7.8 ms layout, far behind level 2's O(k²) simulation (169 ms at 167 discs).
 * Nothing here justifies introducing a shuffle, so the order stays fixed. What
 * would justify reopening the question: a single aggregate of several hundred
 * cards in a real dataset.
 */
function welzl(points: Point[]): Circle {
  let circle: Circle = { cx: points[0]!.x, cy: points[0]!.y, r: 0 }
  for (let i = 1; i < points.length; i++) {
    if (contains(circle, points[i]!)) continue
    circle = { cx: points[i]!.x, cy: points[i]!.y, r: 0 }
    for (let j = 0; j < i; j++) {
      if (contains(circle, points[j]!)) continue
      circle = fromTwo(points[i]!, points[j]!)
      for (let k = 0; k < j; k++) {
        if (contains(circle, points[k]!)) continue
        circle = fromThree(points[i]!, points[j]!, points[k]!)
      }
    }
  }
  return circle
}

/**
 * **Minimal** enclosing circle of the rectangles' corners, its radius grown by
 * `padding`.
 *
 * Inflating the radius on the way out rather than the rectangles on the way in
 * is exact here — unlike the polygonal case — because dilating a circle by
 * `padding` amounts exactly to adding `padding` to its radius: the margin is the
 * same in every direction, with no bisector or reflex corner to handle.
 *
 * Degenerate cases: empty input (null circle at the origin), a single rectangle
 * (its circumscribed circle), identical stacked rectangles (same), collinear
 * centers (cf. `fromThree`), zero-size rectangle (a point).
 */
export function enclosingCircle(rects: Rect[], padding: number): Circle {
  if (rects.length === 0) return { cx: 0, cy: 0, r: 0 }

  const points: Point[] = []
  for (const r of rects) {
    const right = r.x + r.width
    const bottom = r.y + r.height
    points.push({ x: r.x, y: r.y }, { x: right, y: r.y }, { x: right, y: bottom }, { x: r.x, y: bottom })
  }

  const circle = welzl(points)
  return { cx: circle.cx, cy: circle.cy, r: circle.r + padding }
}
