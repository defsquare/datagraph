import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { AggregateCollapseState } from "../src/aggregate-collapse.js"
import { shopData, shopConfig, twoRootsData, twoRootsConfig } from "./fixtures.js"

const shopAgg = { ...shopConfig, aggregates: ["Customer"] }

function state(data: unknown, config: Parameters<typeof validateConfig>[0]) {
  const graph = buildGraph(data, config)
  const entityIds = [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id)
  return new AggregateCollapseState(buildAggregates(graph, validateConfig(config)), entityIds)
}

describe("AggregateCollapseState", () => {
  it("starts with every aggregate expanded", () => {
    const s = state(shopData, shopAgg)
    expect(s.isExpanded("Customer#c1")).toBe(true)
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })

  it("collapsing an aggregate hides its non-root members", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    const visible = s.visibleEntityIds()
    expect(visible.has("/customers/0")).toBe(true) // la racine reste
    expect(visible.has("/orders/0")).toBe(false)
  })

  it("re-expanding restores them", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    s.expand("Customer#c1")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })

  it("keeps an entity outside any aggregate always visible", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    s.collapse("Customer#c2")
    // /orders/1 a une référence cassée : il n'appartient à aucun agrégat.
    expect(s.visibleEntityIds().has("/orders/1")).toBe(true)
  })

  it("keeps a shared entity visible while any of its aggregates is expanded", () => {
    const s = state(twoRootsData, twoRootsConfig)
    s.collapse("Customer#c1")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true) // Product#p9 est encore déplié
    s.collapse("Product#p9")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(false) // tous fermés
  })

  it("ignores collapse of an unknown aggregate id", () => {
    const s = state(shopData, shopAgg)
    expect(() => s.collapse("Ghost#x")).not.toThrow()
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })
})
