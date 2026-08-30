import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("reference resolution", () => {
  const g = buildGraph(shopData, shopConfig)

  it("resolves configured references to entity nodes", () => {
    expect(g.refEdges).toContainEqual({
      kind: "ref", from: "/orders/0", to: "/customers/0",
      field: "customerId", targetType: "Customer", targetId: "c1", dangling: false,
    })
  })
  it("keeps dangling references with a diagnostic", () => {
    expect(g.refEdges).toContainEqual(expect.objectContaining({
      from: "/orders/1", to: null, targetId: "GHOST", dangling: true,
    }))
    expect(g.diagnostics).toContainEqual(expect.objectContaining({ code: "dangling-ref", path: "/orders/1" }))
  })
  it("supports circular references between entities", () => {
    const data = { as: [{ id: "a1", bId: "b1" }], bs: [{ id: "b1", aId: "a1" }] }
    const g2 = buildGraph(data, {
      entities: { A: { match: "$.as[*]", id: "id" }, B: { match: "$.bs[*]", id: "id" } },
      references: { A: { bId: "B" }, B: { aId: "A" } },
    })
    expect(g2.refEdges).toHaveLength(2)
    expect(g2.diagnostics).toHaveLength(0)
  })
})
