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
  it("deduplicates multiple row keys matching the same query", () => {
    const results = idx.search("id")
    // Should find both "id" field and "customerId" field on /orders/0
    expect(results).toContainEqual(
      { nodeId: "/orders/0", field: "id", matched: "id" })
    expect(results).toContainEqual(
      { nodeId: "/orders/0", field: "customerId", matched: "customerId" })
  })
  it("returns one result when row key and value both match query", () => {
    // Create a graph with { items: [{ id: "x", name: "name" }] }
    const data = { items: [{ id: "x", name: "name" }] }
    const config = { ids: { Item: "$.items[*].id" }, refs: [] }
    const testIdx = buildSearchIndex(buildGraph(data, config))
    const results = testIdx.search("name")
    // Should return exactly ONE result for /items/0 field "name" (key and value deduplicate)
    const nameMatches = results.filter(
      (r) => r.nodeId === "/items/0" && r.field === "name")
    expect(nameMatches).toHaveLength(1)
    expect(nameMatches[0]).toEqual({ nodeId: "/items/0", field: "name", matched: "name" })
  })
})
