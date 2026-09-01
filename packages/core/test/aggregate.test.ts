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
    const idx = index(shopData, { ...shopConfig, aggregates: ["Customer"] })
    expect([...idx.aggregates.keys()].sort()).toEqual(["Customer#c1", "Customer#c2"])
    expect([...idx.aggregates.get("Customer#c1")!.memberIds].sort()).toEqual(["/customers/0", "/orders/0"])
    // c2 n'est référencée par personne : son agrégat se réduit à elle-même.
    expect([...idx.aggregates.get("Customer#c2")!.memberIds]).toEqual(["/customers/1"])
  })

  it("leaves an entity with a dangling reference out of every aggregate", () => {
    const idx = index(shopData, { ...shopConfig, aggregates: ["Customer"] })
    // /orders/1 pointe vers "GHOST" : la référence est cassée, elle ne propage rien.
    expect(idx.byNode.get("/orders/1")).toBeUndefined()
  })

  it("arbitrates a distance tie by declaration order of the root type", () => {
    // /orders/0 est à un saut de Customer#c1 ET de Product#p9. La règle
    // n'admet plus le partage : `Customer` est déclaré en premier dans
    // `aggregates`, donc il emporte l'arbitrage, et Product#p9 se réduit à
    // lui-même.
    const idx = index(twoRootsData, twoRootsConfig)
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
    expect(idx.aggregates.get("Customer#c1")!.memberIds.has("/orders/0")).toBe(true)
    expect(idx.aggregates.get("Product#p9")!.memberIds.has("/orders/0")).toBe(false)
    expect([...idx.aggregates.get("Product#p9")!.memberIds]).toEqual(["/products/0"])
  })

  it("follows the declaration order, not the type name: reversing it flips the winner", () => {
    // Même donnée, ordre de déclaration inversé : c'est Product qui gagne.
    // C'est ce qui prouve que l'arbitrage lit bien `config.aggregates` et non
    // un ordre alphabétique ou l'ordre de découverte du BFS.
    const reversed = { ...twoRootsConfig, aggregates: ["Product", "Customer"] }
    const idx = index(twoRootsData, reversed)
    expect(idx.byNode.get("/orders/0")).toEqual(["Product#p9"])
    expect([...idx.aggregates.get("Customer#c1")!.memberIds]).toEqual(["/customers/0"])
  })

  it("breaks a tie WITHIN one root type by root id", () => {
    // Deux racines du même type à la même distance : le rang de déclaration ne
    // départage rien. L'id de la racine le fait, pour que le résultat soit
    // stable d'une construction à l'autre.
    const data = {
      customers: [{ id: "c2", name: "Martin" }, { id: "c1", name: "Dupont" }],
      orders: [{ id: "o1", buyerId: "c2", payerId: "c1" }],
    }
    const config = {
      entities: {
        Customer: { match: "$.customers[*]", id: "id" },
        Order: { match: "$.orders[*]", id: "id" },
      },
      references: { Order: { buyerId: "Customer", payerId: "Customer" } },
      aggregates: ["Customer"],
    }
    const idx = index(data, config)
    // "Customer#c1" < "Customer#c2", et ce malgré l'ordre du tableau JSON qui
    // place c2 en premier.
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
  })

  it("is a strict partition: no entity belongs to two aggregates", () => {
    // L'invariant qui remplace le chevauchement. Vérifié sur le fixture qui
    // existe précisément pour produire une égalité de distance.
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
    // L'Order atteint Customer à 1 saut et Country à 2 : il reste chez Customer.
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
    // Country ne récupère donc pas tout le graphe.
    expect([...idx.aggregates.get("Country#fr")!.memberIds]).toEqual(["/countries/0"])
  })

  it("never absorbs a root into another aggregate", () => {
    const idx = index(chainData, chainConfig)
    // c1 référence fr, mais c1 est elle-même racine : distance 0 à elle-même.
    expect(idx.byNode.get("/customers/0")).toEqual(["Customer#c1"])
  })

  it("terminates on a reference cycle", () => {
    const data = { as: [{ id: "a1", bId: "b1" }], bs: [{ id: "b1", aId: "a1" }] }
    const config = {
      entities: { A: { match: "$.as[*]", id: "id" }, B: { match: "$.bs[*]", id: "id" } },
      references: { A: { bId: "B" }, B: { aId: "A" } },
      aggregates: ["A"],
    }
    const idx = index(data, config)
    expect([...idx.aggregates.get("A#a1")!.memberIds].sort()).toEqual(["/as/0", "/bs/0"])
  })

  it("produces no aggregate for a declared root type with no instance", () => {
    const data = { customers: [], orders: [{ id: "o1", customerId: "GHOST" }] }
    const idx = index(data, { ...shopConfig, aggregates: ["Customer"] })
    expect(idx.aggregates.size).toBe(0)
    expect(idx.byNode.size).toBe(0)
  })

  it("produces nothing when no aggregate root is declared", () => {
    const idx = index(shopData, shopConfig)
    expect(idx.aggregates.size).toBe(0)
  })
})
