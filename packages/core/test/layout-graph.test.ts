import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { createGraphLayoutEngine } from "../src/layout-graph.js"
import { shopData, shopConfig, bigShop } from "./fixtures.js"

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
    // La racine et le nœud tableau /customers sont ajoutés à `visible` pour
    // que le filtre `kind !== "entity"` de layout-graph.ts soit réellement
    // exercé : sans eux, `visible` ne contient que des entités et le filtre
    // ne rejette jamais rien.
    const visibleWithStructural = new Set([...visible, graph.rootId, "/customers"])
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visibleWithStructural)
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

  it("pulls a referenced entity closer than an unrelated one", async () => {
    // shopData (2 clients) donne un signal trop faible pour être fiable : à
    // cette échelle, l'amorçage déterministe par hachage domine encore le
    // résultat plus que la seule arête de référence. bigShop produit N paires
    // customer/order INDÉPENDANTES (order_i référence uniquement customer_i,
    // jamais un autre client) : chaque paire est sa propre composante
    // connexe, ce qui donne à fcose un vrai signal de regroupement à
    // exploiter, et à ce test une marge large et non fragile.
    const data = bigShop(150)
    const graph = buildGraph(data, config)
    const aggregates = buildAggregates(graph, validateConfig(config))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

    const centreOf = (id: string) => {
      const r = result.positions.get(id)!
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    const distanceBetween = (a: string, b: string) => {
      const p = centreOf(a)
      const q = centreOf(b)
      return Math.hypot(p.x - q.x, p.y - q.y)
    }

    // /orders/0 référence /customers/0 via customerId : une arête les relie.
    // /customers/<dernier> n'a aucun lien, direct ou indirect, avec
    // /orders/0 — deux composantes disjointes, que fcose écarte nettement
    // l'une de l'autre. Sans la construction des arêtes de référence
    // (layout-graph.ts), ce test ne distinguerait plus les deux distances.
    const last = data.customers.length - 1
    const linked = distanceBetween("/orders/0", "/customers/0")
    const unrelated = distanceBetween("/orders/0", `/customers/${last}`)

    expect(linked).toBeLessThan(unrelated * 0.5)
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
