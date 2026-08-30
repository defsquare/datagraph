import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { GraphTooLargeError } from "../src/model.js"
import { shopData, shopConfig, bigShop } from "./fixtures.js"

describe("buildGraph", () => {
  const g = buildGraph(shopData, shopConfig)

  it("recognizes entities from config", () => {
    const c1 = g.nodes.get("/customers/0")!
    expect(c1.kind).toBe("entity")
    expect(c1).toMatchObject({ entityType: "Customer", entityId: "c1", label: "Customer #c1" })
    expect(g.entityIndex.get("Customer")!.get("c1")).toBe("/customers/0")
  })
  it("groups scalar fields as rows, not child nodes", () => {
    const c1 = g.nodes.get("/customers/0")!
    expect(c1.rows.map(r => r.key)).toEqual(["id", "name", "email"])
    expect(c1.childIds).toEqual(["/customers/0/address"]) // seul l'objet imbriqué est un enfant
  })
  it("builds containment edges and stable pointer ids", () => {
    expect(g.containEdges).toContainEqual({ kind: "contain", from: "/customers/0", to: "/customers/0/address" })
    expect(g.nodes.get("/orders/0/lines")!.kind).toBe("array")
    expect(g.nodes.get("/orders/0/lines/1")!.label).toBe("lines[1]")
  })
  it("flags entity without id field as missing-id and keeps it an object", () => {
    const g2 = buildGraph({ customers: [{ name: "SansId" }] }, shopConfig)
    expect(g2.nodes.get("/customers/0")!.kind).toBe("object")
    expect(g2.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-id", path: "/customers/0" }))
  })
  it("flags duplicate entity ids, first wins", () => {
    const g2 = buildGraph({ customers: [{ id: "c1", name: "A" }, { id: "c1", name: "B" }] }, shopConfig)
    expect(g2.entityIndex.get("Customer")!.get("c1")).toBe("/customers/0")
    expect(g2.diagnostics).toContainEqual(expect.objectContaining({ code: "duplicate-id", path: "/customers/1" }))
  })
  it("throws GraphTooLargeError above maxNodes", () => {
    expect(() => buildGraph(bigShop(2000), { ...shopConfig, maxNodes: 100 })).toThrow(GraphTooLargeError)
  })
  it("handles 10k logical nodes under 1s", () => {
    const t0 = performance.now()
    const big = buildGraph(bigShop(10_000), shopConfig)
    expect(big.logicalNodeCount).toBeGreaterThan(9_000)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
