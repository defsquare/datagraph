import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { measureNode, DEFAULT_METRICS } from "../src/measure.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("measureNode", () => {
  it("is deterministic and scales with rows", () => {
    const g = buildGraph(shopData, shopConfig)
    const c1 = g.nodes.get("/customers/0")!
    const s = measureNode(c1)
    expect(s.height).toBe(
      DEFAULT_METRICS.headerHeight + 3 * DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.paddingBottom,
    )
    expect(s.width).toBeGreaterThan(100)
    expect(measureNode(c1)).toEqual(s)
  })
})

describe("StructureLayoutEngine.layout", () => {
  it("positions all visible nodes left-to-right without overlap", async () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/customers/0")
    const visible = cs.visibleNodeIds()
    const { positions } = await createStructureLayoutEngine().layout(g, visible)
    // `visible` compte aussi les tableaux ELIDES, qui sont representes par une
    // ligne de leur carte parente et n'ont donc pas de rect : l'invariant « tout
    // ce qui est visible est positionne » porte sur les nœuds DESSINES.
    const drawn = [...visible].filter((id) => !g.nodes.get(id)!.elided)
    expect(positions.size).toBe(drawn.length)
    const parent = positions.get("/customers/0")!
    const child = positions.get("/customers/0/address")!
    expect(child.x).toBeGreaterThan(parent.x + parent.width) // gauche → droite
    const rects = [...positions.values()]
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
                      a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlap).toBe(false)
    }
  })
})
