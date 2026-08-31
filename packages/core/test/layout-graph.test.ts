import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { createGraphLayoutEngine } from "../src/layout-graph.js"
import { shopData, shopConfig } from "./fixtures.js"

const config = { ...shopConfig, aggregates: ["Customer"] }

function setup() {
  const graph = buildGraph(shopData, config)
  const aggregates = buildAggregates(graph, validateConfig(config))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

describe("createGraphLayoutEngine", () => {
  it("positions entities only — no root, no array, no object node", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    for (const id of result.positions.keys()) {
      expect(graph.nodes.get(id)?.kind).toBe("entity")
    }
    expect(result.positions.has("/")).toBe(false)
    expect(result.positions.has("/customers")).toBe(false)
  })

  it("never leaks a virtual cluster centre into the result", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    for (const id of result.positions.keys()) expect(id.startsWith("__agg:")).toBe(false)
  })

  it("places every visible entity", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(visible.size)
  })

  it("is deterministic to the pixel across two runs", async () => {
    const { graph, aggregates, visible } = setup()
    const a = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const b = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
  })

  it("leaves no overlapping cards", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const rects = [...result.positions.values()]
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(ox > 1e-6 && oy > 1e-6).toBe(false)
      }
    }
  })
})
