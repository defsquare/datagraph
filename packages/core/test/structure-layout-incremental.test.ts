import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import type { DataGraphConfig } from "../src/config.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("incremental layout", () => {
  async function setup() {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const initial = await engine.layout(g, cs.visibleNodeIds())
    return { g, cs, engine, initial }
  }

  it("expand keeps nodes above unchanged, shifts nodes below, no overlap", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const next = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    const anchor = before.get("/customers/0")!
    for (const [id, r] of before) {
      if (r.y + r.height <= anchor.y) expect(next.positions.get(id)).toEqual(r) // above: untouched
    }
    expect(next.positions.has("/customers/0/address")).toBe(true)
    const addr = next.positions.get("/customers/0/address")!
    expect(addr.x).toBeGreaterThan(anchor.x + anchor.width)
  })

  it("collapse restores previous vertical positions", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const expanded = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(expanded, g, "/customers/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("repeated expand then collapse restores positions", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const once = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    const twice = await engine.layoutAfterExpand(once, g, "/customers/0", cs.visibleNodeIds())
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(twice, g, "/customers/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("collapsing an elided array undoes the shift from its expansion", async () => {
    // `/orders/0/lines` is an array, hence ELIDED: it has no card, it is the
    // token of a row of `/orders/0`. It is the one that carries the fold of its
    // elements, and therefore the one — not the order that contains it — that
    // must return the positions to their previous state.
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))

    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )
    expect(expanded.positions.has("/orders/0/lines/0")).toBe(true)
    // The elided array has NO rect: its row lives in the order's card.
    expect(expanded.positions.has("/orders/0/lines")).toBe(false)

    cs.collapse("/orders/0/lines")
    const back = engine.layoutAfterCollapse(expanded, g, "/orders/0/lines", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("collapsing the host card does not retract what the token expanded", async () => {
    // The header chevron and the `[ n items ]` token are two INDEPENDENT
    // controls: the first governs the child cards, the second its array.
    // Collapsing `/orders/0` leaves its card — and hence its `lines` row, still
    // marked expanded — on screen; removing the element cards would make the
    // token lie about what it shows.
    const { g, cs, engine, initial } = await setup()
    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )

    cs.collapse("/orders/0")
    const visible = cs.visibleNodeIds()
    expect(visible.has("/orders/0/lines")).toBe(true)
    expect(visible.has("/orders/0/lines/0")).toBe(true)

    const back = engine.layoutAfterCollapse(expanded, g, "/orders/0", visible)
    expect(back.positions.has("/orders/0/lines/0")).toBe(true)
  })

  it("a global layout() clears the delta memory: a later collapse undoes nothing", async () => {
    const { g, cs, engine, initial } = await setup()

    // `/orders/0/lines` is the fixture's expansion that actually shifts cards:
    // without a non-zero delta memorized, the test would prove nothing.
    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )
    const moved = [...initial.positions].some(
      ([id, r]) => Math.abs(expanded.positions.get(id)!.y - r.y) > 0.001,
    )
    expect(moved).toBe(true)

    // GLOBAL layout: positions start over from scratch, and the delta memorized
    // for `/orders/0/lines` no longer describes anything on screen.
    const fresh = await engine.layout(g, cs.visibleNodeIds())
    const snapshot = new Map([...fresh.positions].map(([id, r]) => [id, { ...r }]))

    cs.collapse("/orders/0/lines")
    const visible = cs.visibleNodeIds()
    const back = engine.layoutAfterCollapse(fresh, g, "/orders/0/lines", visible)

    // No card outside the collapsed subtree may have moved: had the stale delta
    // survived, everything below its threshold would rise back up.
    for (const [id, r] of snapshot) {
      if (!visible.has(id)) continue
      expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
    }
  })
})

function manyItems(n: number): unknown {
  return { items: Array.from({ length: n }, (_, i) => ({ v: i, w: { deep: i } })) }
}
// `ids: {}`: no entity at all, like CLI mode without a config. `/items` is
// ELIDED (one row of the root card) but expanded; its elements are real cards,
// hence paginated — this is `layoutAfterReveal`'s home ground.
const noConfig: DataGraphConfig = { ids: {} }

describe("layoutAfterReveal", () => {
  it("inserts the new block under the previous block and shifts what lies below", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const before = await engine.layout(g, cs.visibleNodeIds())
    const lastOfPage0 = before.positions.get("/items/99")!

    cs.revealPage("/items", 1)
    const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())

    const first = after.positions.get("/items/100")!
    expect(first.x).toBeCloseTo(lastOfPage0.x, 1) // same column
    expect(first.y).toBeGreaterThan(lastOfPage0.y) // below
    // The last card of page 0 is ABOVE the insertion point: it does not move, it
    // is the one that anchors the placement.
    expect(after.positions.get("/items/99")!.y).toBeCloseTo(lastOfPage0.y, 1)
    // The whole block sits below the insertion point.
    for (let i = 100; i < 200; i++) {
      expect(after.positions.get(`/items/${i}`)!.y).toBeGreaterThan(lastOfPage0.y)
    }
  })

  it("a disjoint block with no predecessor lands above the following block", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.unrevealPage("/items", 0)
    cs.revealPage("/items", 2)
    const engine = createStructureLayoutEngine()
    const only = await engine.layout(g, cs.visibleNodeIds())
    expect(only.positions.has("/items/200")).toBe(true)
    expect(only.positions.has("/items/0")).toBe(false)

    cs.revealPage("/items", 0)
    const after = await engine.layoutAfterReveal(only, g, "/items", cs.visibleNodeIds())

    expect(after.positions.get("/items/0")).toBeDefined()
    expect(after.positions.get("/items/0")!.y).toBeLessThan(after.positions.get("/items/200")!.y)
    // The next block was PUSHED down to make room for the inserted one.
    expect(after.positions.get("/items/200")!.y).toBeGreaterThan(
      only.positions.get("/items/200")!.y,
    )
    expect(after.positions.get("/items/0")!.x).toBeCloseTo(
      only.positions.get("/items/200")!.x,
      1,
    )
  })

  it("with no sibling laid down, the block falls back on the anchor's lateral placement", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    cs.unrevealPage("/items", 0) // not a single child card left on screen
    const engineBase = await engine.layout(g, cs.visibleNodeIds())
    const root = engineBase.positions.get("/")!
    expect(engineBase.positions.size).toBe(1)

    cs.revealPage("/items", 1)
    const after = await engine.layoutAfterReveal(engineBase, g, "/items", cs.visibleNodeIds())

    // `/items` is elided: its anchor is the band of its row inside the root
    // card, hence a placement 48 px to the right of that card.
    const first = after.positions.get("/items/100")!
    expect(first.x).toBeCloseTo(root.x + root.width + 48, 1)
    // The card carrying the anchor does not move down with the block it opens.
    expect(after.positions.get("/")!.y).toBeCloseTo(root.y, 5)
  })

  it("a reveal with nothing newly visible returns an untouched copy", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const before = await engine.layout(g, cs.visibleNodeIds())

    // Nothing new: a redundant call over pages already placed.
    const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())
    expect(after.positions.size).toBe(before.positions.size)
    for (const [id, r] of before.positions) expect(after.positions.get(id)).toEqual(r)
    // A copy, not an alias: mutating the result must not contaminate `before`.
    expect(after.positions).not.toBe(before.positions)
  })

  it("two reveals accumulate their delta: the collapse undoes them ALL", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    // Start from page 2 alone: that block, placed lowest, is the one that takes
    // both shifts and SURVIVES the removal of pages 0 and 1.
    cs.unrevealPage("/items", 0)
    cs.revealPage("/items", 2)
    const base = await engine.layout(g, cs.visibleNodeIds())
    const baseline = new Map([...base.positions].map(([id, r]) => [id, { ...r }]))

    cs.revealPage("/items", 0)
    const one = await engine.layoutAfterReveal(base, g, "/items", cs.visibleNodeIds())
    cs.revealPage("/items", 1)
    const two = await engine.layoutAfterReveal(one, g, "/items", cs.visibleNodeIds())
    const afterFirst = one.positions.get("/items/200")!.y
    const afterSecond = two.positions.get("/items/200")!.y
    expect(afterFirst).toBeGreaterThan(baseline.get("/items/200")!.y)
    expect(afterSecond).toBeGreaterThan(afterFirst)

    // Remove the two revealed pages: the total memorized under `/items` must
    // give the remaining block back its original position. With an overwrite
    // instead of an accumulation, only the second shift would be undone.
    cs.unrevealPage("/items", 0)
    cs.unrevealPage("/items", 1)
    const visible = cs.visibleNodeIds()
    const back = engine.layoutAfterCollapse(two, g, "/items", visible)
    for (const [id, r] of baseline) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })
})
