import { describe, it, expect } from "vitest"
import { paddedHull } from "../src/hull.js"
import type { Rect } from "../src/layout.js"

/** Vrai si `p` est dans le polygone convexe `poly` (ou sur son bord), à
 * epsilon près. Sert d'invariant à toutes les assertions de ce fichier. */
function inside(poly: { x: number; y: number }[], p: { x: number; y: number }): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function corners(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ]
}

describe("paddedHull", () => {
  it("returns an empty polygon for no rects", () => {
    expect(paddedHull([], 10)).toEqual([])
  })

  it("wraps a single rect in its padded box", () => {
    const poly = paddedHull([{ x: 10, y: 20, width: 100, height: 40 }], 5)
    expect(poly).toHaveLength(4)
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    expect(Math.min(...xs)).toBe(5)
    expect(Math.max(...xs)).toBe(115)
    expect(Math.min(...ys)).toBe(15)
    expect(Math.max(...ys)).toBe(65)
  })

  it("contains every corner of every input rect", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
      { x: -80, y: 220, width: 60, height: 50 },
    ]
    const poly = paddedHull(rects, 12)
    for (const r of rects) {
      for (const c of corners(r)) expect(inside(poly, c)).toBe(true)
    }
  })

  it("handles collinear rect centres without emitting duplicate points", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 100, y: 0, width: 50, height: 20 },
      { x: 200, y: 0, width: 50, height: 20 },
    ]
    const poly = paddedHull(rects, 4)
    expect(poly).toHaveLength(4)
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`
    expect(new Set(poly.map(key)).size).toBe(poly.length)
  })

  it("collapses identical stacked rects to a single padded box", () => {
    const r: Rect = { x: 7, y: 9, width: 30, height: 30 }
    expect(paddedHull([r, { ...r }, { ...r }], 3)).toHaveLength(4)
  })

  it("is deterministic", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
    ]
    expect(paddedHull(rects, 12)).toEqual(paddedHull(rects, 12))
  })
})
