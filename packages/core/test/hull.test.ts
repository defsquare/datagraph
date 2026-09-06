import { describe, it, expect } from "vitest"
import { enclosingCircle } from "../src/hull.js"
import type { Rect } from "../src/structure-layout.js"

/** Vrai si `p` est dans le cercle (ou sur son bord), à epsilon près. Sert
 * d'invariant à toutes les assertions de ce fichier. */
function inside(c: { cx: number; cy: number; r: number }, p: { x: number; y: number }): boolean {
  return Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r + 1e-6
}

function corners(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ]
}

describe("enclosingCircle", () => {
  it("returns a null circle for no rects", () => {
    expect(enclosingCircle([], 10)).toEqual({ cx: 0, cy: 0, r: 0 })
  })

  it("wraps a single rect in its circumscribed circle plus padding", () => {
    const c = enclosingCircle([{ x: 10, y: 20, width: 100, height: 40 }], 5)
    expect(c.cx).toBeCloseTo(60, 6)
    expect(c.cy).toBeCloseTo(40, 6)
    // Demi-diagonale d'un 100×40, plus la marge : √(50² + 20²) + 5.
    expect(c.r).toBeCloseTo(Math.hypot(50, 20) + 5, 6)
  })

  it("spans two rects on the diameter of their two farthest corners", () => {
    // (0,0) et (380,180) sont les deux coins les plus éloignés ; le cercle
    // ayant ce segment pour diamètre contient déjà les six autres, donc c'est
    // LE cercle minimal — un cas à deux points de support, pas trois.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
    ]
    const c = enclosingCircle(rects, 0)
    expect(c.cx).toBeCloseTo(190, 6)
    expect(c.cy).toBeCloseTo(90, 6)
    expect(c.r).toBeCloseTo(Math.hypot(190, 90), 6)
    for (const r of rects) for (const p of corners(r)) expect(inside(c, p)).toBe(true)
  })

  it("contains every corner of every input rect", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
      { x: -80, y: 220, width: 60, height: 50 },
    ]
    const c = enclosingCircle(rects, 12)
    for (const r of rects) {
      for (const p of corners(r)) expect(inside(c, p)).toBe(true)
    }
  })

  it("stays minimal: shrinking the radius drops at least one corner", () => {
    // Le contenant n'est pas suffisant — une boîte englobante circonscrite le
    // serait aussi. Ce qu'on veut est le cercle MINIMAL : le réduire d'un
    // millième de pixel doit faire sortir un coin.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
      { x: -80, y: 220, width: 60, height: 50 },
    ]
    const c = enclosingCircle(rects, 0)
    const shrunk = { cx: c.cx, cy: c.cy, r: c.r - 1e-3 }
    const escaping = rects.flatMap(corners).filter((p) => !inside(shrunk, p))
    expect(escaping.length).toBeGreaterThan(0)
  })

  it("handles collinear rect centres", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 100, y: 0, width: 50, height: 20 },
      { x: 200, y: 0, width: 50, height: 20 },
    ]
    const c = enclosingCircle(rects, 4)
    // Les quatre coins extrêmes — (0,0), (250,0), (0,20), (250,20) — sont
    // équidistants du centre de la bande : le cercle minimal est celui de
    // diamètre la diagonale, aucune configuration à trois points ici.
    expect(c.cx).toBeCloseTo(125, 6)
    expect(c.cy).toBeCloseTo(10, 6)
    expect(c.r).toBeCloseTo(Math.hypot(125, 10) + 4, 6)
    for (const r of rects) for (const p of corners(r)) expect(inside(c, p)).toBe(true)
  })

  it("collapses identical stacked rects to a single padded circle", () => {
    const r: Rect = { x: 7, y: 9, width: 30, height: 30 }
    const c = enclosingCircle([r, { ...r }, { ...r }], 3)
    expect(c.cx).toBeCloseTo(22, 6)
    expect(c.cy).toBeCloseTo(24, 6)
    expect(c.r).toBeCloseTo(Math.hypot(15, 15) + 3, 6)
  })

  it("handles a zero-sized rect", () => {
    const c = enclosingCircle([{ x: 40, y: 12, width: 0, height: 0 }], 6)
    expect(c).toEqual({ cx: 40, cy: 12, r: 6 })
  })

  it("is deterministic", () => {
    // L'entrée n'est PAS mélangée (voir la doc de `enclosingCircle`) : deux
    // appels sur la même entrée donnent bit pour bit le même cercle.
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
    ]
    expect(enclosingCircle(rects, 12)).toEqual(enclosingCircle(rects, 12))
  })
})
