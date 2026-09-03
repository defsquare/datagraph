import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("reference resolution", () => {
  const g = buildGraph(shopData, shopConfig)

  it("resolves configured references to entity nodes", () => {
    // `fromEntity === from` pour un chemin sans navigation : l'entité porte la
    // ligne en propre, il n'y a rien à hisser.
    expect(g.refEdges).toContainEqual({
      kind: "ref", from: "/orders/0", fromEntity: "/orders/0", to: "/customers/0",
      field: "customerId", targetType: "Customer", targetId: "c1", dangling: false,
    })
  })
  it("keeps dangling references with a diagnostic", () => {
    expect(g.refEdges).toContainEqual(expect.objectContaining({
      from: "/orders/1", to: null, targetId: "GHOST", dangling: true,
    }))
    expect(g.diagnostics).toContainEqual(expect.objectContaining({ code: "dangling-ref", path: "/orders/1" }))
  })
  it("produces no ref edge and no diagnostic for a null foreign key", () => {
    const data = {
      customers: [{ id: "c1", name: "Dupont" }],
      orders: [{ id: "o1", customerId: null, total: 42 }],
    }
    const g3 = buildGraph(data, shopConfig)
    expect(g3.refEdges.filter((e) => e.from === "/orders/0")).toHaveLength(0)
    expect(g3.diagnostics).toHaveLength(0)
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
