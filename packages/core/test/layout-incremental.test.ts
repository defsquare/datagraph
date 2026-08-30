import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { createLayoutEngine } from "../src/layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("incremental layout", () => {
  async function setup() {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const engine = createLayoutEngine()
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
      if (r.y + r.height <= anchor.y) expect(next.positions.get(id)).toEqual(r) // au-dessus : intact
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

  it("collapsing an ancestor undoes nested expansion shifts", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/orders/0")
    const afterOrder = await engine.layoutAfterExpand(initial, g, "/orders/0", cs.visibleNodeIds())
    cs.expand("/orders/0/lines")
    const afterLines = await engine.layoutAfterExpand(afterOrder, g, "/orders/0/lines", cs.visibleNodeIds())
    cs.collapse("/orders/0")
    const back = engine.layoutAfterCollapse(afterLines, g, "/orders/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })
})
