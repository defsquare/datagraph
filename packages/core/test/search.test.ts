import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildSearchIndex } from "../src/search.js"
import { shopData, shopConfig, bigShop } from "./fixtures.js"

describe("SearchIndex", () => {
  const idx = buildSearchIndex(buildGraph(shopData, shopConfig))

  it("finds by scalar value, case-insensitive", () => {
    expect(idx.search("DUPONT")).toContainEqual(
      { nodeId: "/customers/0", field: "name", matched: "Dupont" })
  })
  it("finds by key and by entity id", () => {
    expect(idx.search("customerId").length).toBeGreaterThanOrEqual(2)
    expect(idx.search("c1")).toContainEqual(expect.objectContaining({ nodeId: "/customers/0" }))
  })
  it("searches collapsed regions too (index covers full graph)", () => {
    expect(idx.search("rue de la paix")).toContainEqual(
      expect.objectContaining({ nodeId: "/customers/0/address" }))
  })
  it("returns [] for empty query and stays under 50ms on 10k nodes", () => {
    expect(idx.search("")).toEqual([])
    const big = buildSearchIndex(buildGraph(bigShop(10_000), shopConfig))
    const t0 = performance.now()
    big.search("client 42")
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
