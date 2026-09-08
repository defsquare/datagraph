import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { shopData, shopConfig, twoRootsData, twoRootsConfig, chainData, chainConfig } from "./fixtures.js"

function index(data: unknown, config: Parameters<typeof validateConfig>[0]) {
  return buildAggregates(buildGraph(data, config), validateConfig(config))
}

describe("buildAggregates", () => {
  it("groups a root with the entities that reference it", () => {
    const idx = index(shopData, { ...shopConfig, groups: ["Customer"] })
    expect([...idx.aggregates.keys()].sort()).toEqual(["Customer#c1", "Customer#c2"])
    expect([...idx.aggregates.get("Customer#c1")!.memberIds].sort()).toEqual(["/customers/0", "/orders/0"])
    // Nobody references c2: its aggregate reduces to itself.
    expect([...idx.aggregates.get("Customer#c2")!.memberIds]).toEqual(["/customers/1"])
  })

  it("leaves an entity with a dangling reference out of every aggregate", () => {
    const idx = index(shopData, { ...shopConfig, groups: ["Customer"] })
    // /orders/1 points at "GHOST": the reference is dangling, it propagates nothing.
    expect(idx.byNode.get("/orders/1")).toBeUndefined()
  })

  it("arbitrates a distance tie by declaration order of the root type", () => {
    // /orders/0 is one hop from Customer#c1 AND from Product#p9. The rule no
    // longer allows sharing: `Customer` is declared first in `groups`, so it
    // wins the tie, and Product#p9 reduces to itself.
    const idx = index(twoRootsData, twoRootsConfig)
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
    expect(idx.aggregates.get("Customer#c1")!.memberIds.has("/orders/0")).toBe(true)
    expect(idx.aggregates.get("Product#p9")!.memberIds.has("/orders/0")).toBe(false)
    expect([...idx.aggregates.get("Product#p9")!.memberIds]).toEqual(["/products/0"])
  })

  it("follows the declaration order, not the type name: reversing it flips the winner", () => {
    // Same data, declaration order reversed: Product wins. This is what proves
    // the tie-break really reads `config.groups`, and not an alphabetical
    // order or the BFS discovery order.
    const reversed = { ...twoRootsConfig, groups: ["Product", "Customer"] }
    const idx = index(twoRootsData, reversed)
    expect(idx.byNode.get("/orders/0")).toEqual(["Product#p9"])
    expect([...idx.aggregates.get("Customer#c1")!.memberIds]).toEqual(["/customers/0"])
  })

  it("breaks a tie WITHIN one root type by root id", () => {
    // Two roots of the same type at the same distance: declaration rank breaks
    // nothing. The root id does, so that the result is stable from one build
    // to the next.
    const data = {
      customers: [{ id: "c2", name: "Martin" }, { id: "c1", name: "Dupont" }],
      orders: [{ id: "o1", buyerId: "c2", payerId: "c1" }],
    }
    const config = {
      ids: {
        Customer: "$.customers[*].id",
        Order: "$.orders[*].id",
      },
      refs: [
        { from: "$.orders[*].buyerId", to: "$.customers[*].id" },
        { from: "$.orders[*].payerId", to: "$.customers[*].id" },
      ],
      groups: ["Customer"],
    }
    const idx = index(data, config)
    // "Customer#c1" < "Customer#c2", and this despite the JSON array order,
    // which puts c2 first.
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
  })

  it("is a strict partition: no entity belongs to two aggregates", () => {
    // The invariant that replaces overlap. Checked on the fixture that exists
    // precisely to produce a distance tie.
    const idx = index(twoRootsData, twoRootsConfig)
    for (const ids of idx.byNode.values()) expect(ids).toHaveLength(1)

    let members = 0
    const seen = new Set<string>()
    for (const aggregate of idx.aggregates.values()) {
      for (const id of aggregate.memberIds) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
        members++
      }
    }
    expect(members).toBe(seen.size)
  })

  it("is transitive: a LineItem two hops away joins the Customer aggregate", () => {
    const idx = index(chainData, chainConfig)
    expect(idx.aggregates.get("Customer#c1")!.memberIds.has("/lines/0")).toBe(true)
  })

  it("bounds a hub root: only the nearest root claims an entity", () => {
    const idx = index(chainData, chainConfig)
    // The Order reaches Customer in 1 hop and Country in 2: it stays with Customer.
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
    // Country therefore does not swallow the whole graph.
    expect([...idx.aggregates.get("Country#fr")!.memberIds]).toEqual(["/countries/0"])
  })

  it("never absorbs a root into another aggregate", () => {
    const idx = index(chainData, chainConfig)
    // c1 references fr, but c1 is itself a root: distance 0 to itself.
    expect(idx.byNode.get("/customers/0")).toEqual(["Customer#c1"])
  })

  it("terminates on a reference cycle", () => {
    const data = { as: [{ id: "a1", bId: "b1" }], bs: [{ id: "b1", aId: "a1" }] }
    const config = {
      ids: { A: "$.as[*].id", B: "$.bs[*].id" },
      refs: [
        { from: "$.as[*].bId", to: "$.bs[*].id" },
        { from: "$.bs[*].aId", to: "$.as[*].id" },
      ],
      groups: ["A"],
    }
    const idx = index(data, config)
    expect([...idx.aggregates.get("A#a1")!.memberIds].sort()).toEqual(["/as/0", "/bs/0"])
  })

  it("produces no aggregate for a declared root type with no instance", () => {
    const data = { customers: [], orders: [{ id: "o1", customerId: "GHOST" }] }
    const idx = index(data, { ...shopConfig, groups: ["Customer"] })
    expect(idx.aggregates.size).toBe(0)
    expect(idx.byNode.size).toBe(0)
  })

  it("produces nothing when no aggregate root is declared", () => {
    const idx = index(shopData, shopConfig)
    expect(idx.aggregates.size).toBe(0)
  })
})
