import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("rootLabel", () => {
  it("vaut $ par defaut, le symbole racine de la syntaxe de selecteur", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(g.nodes.get(g.rootId)!.label).toBe("$")
  })

  it("est remplacable par la config", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "Boutique" })
    expect(g.nodes.get(g.rootId)!.label).toBe("Boutique")
  })

  it("ne touche qu'a la racine", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "Boutique" })
    expect(g.nodes.get("/customers")!.label).toBe("customers")
    expect(g.nodes.get("/customers/0")!.label).toBe("Customer #c1")
  })

  it("accepte la chaine vide sans retomber sur le defaut", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "" })
    expect(g.nodes.get(g.rootId)!.label).toBe("")
  })
})
