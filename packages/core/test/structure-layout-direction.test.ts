import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import type { DataGraphConfig } from "../src/config.js"
import { measureNode } from "../src/measure.js"
import { createStructureLayoutEngine, type Rect } from "../src/structure-layout.js"
import { shopData, shopConfig } from "./fixtures.js"

/**
 * THE GEOMETRY PROOF of the tree view's direction. `"DOWN"` is implemented by
 * transposing at the engine's boundary, and the trap of that trick is that a rect
 * left untransposed on the way out is indistinguishable from a correct one until
 * you check its WIDTH: this file checks the sizes as insistently as the places.
 *
 * Nothing here asserts equality with a transposed `"RIGHT"` run: ELK is free to
 * order a layer differently once the boxes change shape, and the direction only
 * promises the INVARIANTS below.
 */

const down = () => createStructureLayoutEngine({ direction: "DOWN" })

function setup(direction: "RIGHT" | "DOWN") {
  const g = buildGraph(shopData, shopConfig)
  const cs = new CollapseState(g)
  const engine = createStructureLayoutEngine({ direction })
  return { g, cs, engine }
}

describe('structure layout direction "DOWN"', () => {
  it("keeps the cards' REAL sizes — the transposition's main trap", async () => {
    const { g, cs, engine } = setup("DOWN")
    cs.expand("/customers/0")
    const { positions } = await engine.layout(g, cs.visibleNodeIds())
    expect(positions.size).toBeGreaterThan(1)
    for (const [id, rect] of positions) {
      const size = measureNode(g.nodes.get(id)!)
      expect(rect.width).toBe(size.width)
      expect(rect.height).toBe(size.height)
    }
  })

  it("puts every child card BELOW its parent, and siblings in one row band", async () => {
    const { g, cs, engine } = setup("DOWN")
    cs.expand("/customers/0")
    const visible = cs.visibleNodeIds()
    const { positions } = await engine.layout(g, visible)

    for (const [id, child] of positions) {
      const parentId = g.nodes.get(id)!.parentId
      const parent = parentId === null ? undefined : positions.get(parentId)
      if (!parent) continue
      expect(child.y).toBeGreaterThanOrEqual(parent.y + parent.height)
    }

    // The two customers are siblings of the same drawn parent: one row band,
    // side by side. Their `y` are not EQUAL — ELK aligns cards of different
    // heights within a layer — but their vertical extents overlap, which is what
    // "a row" means here.
    const c0 = positions.get("/customers/0")!
    const c1 = positions.get("/customers/1")!
    expect(c0.y).toBeLessThan(c1.y + c1.height)
    expect(c1.y).toBeLessThan(c0.y + c0.height)
    expect(Math.abs(c0.x - c1.x)).toBeGreaterThan(0)
  })

  it("is not what the default gives: `direction` defaults to \"RIGHT\"", async () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/customers/0")
    const visible = cs.visibleNodeIds()
    const byDefault = await createStructureLayoutEngine().layout(g, visible)
    const explicit = await createStructureLayoutEngine({ direction: "RIGHT" }).layout(g, visible)
    expect([...byDefault.positions]).toEqual([...explicit.positions])

    // And the structure view's own invariant still holds: children to the RIGHT.
    const parent = byDefault.positions.get("/customers/0")!
    const child = byDefault.positions.get("/customers/0/address")!
    expect(child.x).toBeGreaterThan(parent.x + parent.width)
  })
})

describe('layoutAfterExpand / layoutAfterCollapse in "DOWN"', () => {
  it("opens the newly visible block BELOW the expanded card", async () => {
    const { g, cs, engine } = setup("DOWN")
    const initial = await engine.layout(g, cs.visibleNodeIds())
    const anchor = initial.positions.get("/customers/0")!

    cs.expand("/customers/0")
    const next = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())

    const block = [...next.positions]
      .filter(([id]) => !initial.positions.has(id))
      .map(([, r]) => r)
    expect(block.length).toBeGreaterThan(0)
    expect(Math.min(...block.map((r) => r.y))).toBeGreaterThanOrEqual(anchor.y + anchor.height)
  })

  it("pushes what lies right of the anchor's VERTICAL midline by the overflow", async () => {
    // A fanned-out node beside a narrower neighbour: expanding it opens a block
    // WIDER than its own card, so the overflow is not zero and the shift is
    // actually observable — which the shop fixture's small expansions are not.
    const g = buildGraph(
      {
        hub: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 }, d: { n: 4 }, e: { n: 5 } },
        side: { x: { n: 1 }, y: { n: 2 } },
      },
      noConfig,
    )
    const cs = new CollapseState(g)
    cs.collapse("/hub")
    const engine = down()
    const initial = await engine.layout(g, cs.visibleNodeIds())
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r } as Rect]))

    const anchor = before.get("/hub")!
    cs.expand("/hub")
    const next = await engine.layoutAfterExpand(initial, g, "/hub", cs.visibleNodeIds())

    const block = [...next.positions].filter(([id]) => !before.has(id)).map(([, r]) => r)
    const blockWidth =
      Math.max(...block.map((r) => r.x + r.width)) - Math.min(...block.map((r) => r.x))
    const delta = blockWidth - anchor.width
    expect(delta).toBeGreaterThan(0)

    // The midline is VERTICAL now: everything past it moves RIGHT by the
    // overflow, everything before it does not move at all.
    const threshold = anchor.x + anchor.width / 2
    for (const [id, r] of before) {
      const after = next.positions.get(id)!
      if (r.x > threshold) expect(after.x).toBeCloseTo(r.x + delta, 5)
      else expect(after).toEqual(r)
    }
  })

  it("collapse restores the pre-expand positions exactly", async () => {
    const { g, cs, engine } = setup("DOWN")
    const initial = await engine.layout(g, cs.visibleNodeIds())
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r } as Rect]))

    cs.expand("/customers/0")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/customers/0", cs.visibleNodeIds(),
    )
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(expanded, g, "/customers/0", cs.visibleNodeIds())

    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) {
      const got = back.positions.get(id)!
      expect(got.x).toBeCloseTo(r.x, 5)
      expect(got.y).toBeCloseTo(r.y, 5)
      expect(got.width).toBe(r.width)
      expect(got.height).toBe(r.height)
    }
  })

  it("anchors an elided array on the PARENT CARD, not on a row band", async () => {
    const { g, cs, engine } = setup("DOWN")
    const initial = await engine.layout(g, cs.visibleNodeIds())
    const parent = initial.positions.get("/orders/0")!
    expect(initial.positions.has("/orders/0/lines")).toBe(false) // elided

    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )
    const line0 = expanded.positions.get("/orders/0/lines/0")!
    expect(line0.y).toBeGreaterThanOrEqual(parent.y + parent.height)
    // A row band's anchor would have opened the block at the row's HEIGHT, i.e.
    // inside the card — which is exactly what this asserts against.
    expect(line0.y).not.toBeCloseTo(parent.y, 0)
  })
})

function manyItems(n: number): unknown {
  return { items: Array.from({ length: n }, (_, i) => ({ v: i, w: { deep: i } })) }
}
const noConfig: DataGraphConfig = { ids: {} }

describe('layoutAfterReveal in "DOWN"', () => {
  it("inserts the revealed page in the sibling ROW and pushes what follows right", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = down()
    const before = await engine.layout(g, cs.visibleNodeIds())
    const lastOfPage0 = before.positions.get("/items/99")!

    cs.revealPage("/items", 1)
    const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())

    const first = after.positions.get("/items/100")!
    expect(first.y).toBeCloseTo(lastOfPage0.y, 1) // same row
    expect(first.x).toBeGreaterThan(lastOfPage0.x) // after it
    expect(after.positions.get("/items/99")!.x).toBeCloseTo(lastOfPage0.x, 1)
    for (let i = 100; i < 200; i++) {
      expect(after.positions.get(`/items/${i}`)!.x).toBeGreaterThan(lastOfPage0.x)
    }
  })

  it("pushes the siblings laid out AFTER the inserted page to the right", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = down()
    cs.unrevealPage("/items", 0)
    cs.revealPage("/items", 2)
    const only = await engine.layout(g, cs.visibleNodeIds())

    cs.revealPage("/items", 0)
    const after = await engine.layoutAfterReveal(only, g, "/items", cs.visibleNodeIds())

    expect(after.positions.get("/items/0")!.x).toBeLessThan(after.positions.get("/items/200")!.x)
    expect(after.positions.get("/items/200")!.x).toBeGreaterThan(
      only.positions.get("/items/200")!.x,
    )
    expect(after.positions.get("/items/0")!.y).toBeCloseTo(
      only.positions.get("/items/200")!.y,
      1,
    )
  })
})
