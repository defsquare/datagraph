import { describe, it, expect } from "vitest"
import { separateOverlaps } from "../src/separate.js"
import type { Rect } from "../src/layout.js"

function overlapCount(positions: Map<string, Rect>, margin: number): number {
  const rects = [...positions.values()]
  let n = 0
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
      if (ox > 1e-6 && oy > 1e-6) n++
    }
  }
  return n
}

describe("separateOverlaps", () => {
  it("pushes two overlapping rects apart", () => {
    const positions = new Map<string, Rect>([
      ["a", { x: 0, y: 0, width: 100, height: 50 }],
      ["b", { x: 20, y: 10, width: 100, height: 50 }],
    ])
    separateOverlaps(positions, 8, 200)
    expect(overlapCount(positions, 8)).toBe(0)
  })

  it("leaves an already disjoint layout untouched", () => {
    const positions = new Map<string, Rect>([
      ["a", { x: 0, y: 0, width: 100, height: 50 }],
      ["b", { x: 500, y: 500, width: 100, height: 50 }],
    ])
    separateOverlaps(positions, 8, 200)
    expect(positions.get("a")).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(positions.get("b")).toEqual({ x: 500, y: 500, width: 100, height: 50 })
  })

  it("resolves a dense pile", () => {
    const positions = new Map<string, Rect>()
    for (let i = 0; i < 40; i++) {
      positions.set(`n${i}`, { x: (i % 5) * 6, y: Math.floor(i / 5) * 6, width: 120, height: 60 })
    }
    separateOverlaps(positions, 10, 5000)
    expect(overlapCount(positions, 10)).toBe(0)
  })

  it("is deterministic", () => {
    const make = () => {
      const m = new Map<string, Rect>()
      for (let i = 0; i < 20; i++) m.set(`n${i}`, { x: i * 3, y: i * 2, width: 90, height: 40 })
      return m
    }
    const a = make()
    const b = make()
    separateOverlaps(a, 6, 500)
    separateOverlaps(b, 6, 500)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it("handles a single rect and an empty map", () => {
    const one = new Map<string, Rect>([["a", { x: 1, y: 2, width: 3, height: 4 }]])
    expect(() => separateOverlaps(one, 5, 10)).not.toThrow()
    expect(one.get("a")).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(() => separateOverlaps(new Map(), 5, 10)).not.toThrow()
  })
})
