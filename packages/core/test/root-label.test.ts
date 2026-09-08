import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("rootLabel", () => {
  it("defaults to $, the root symbol of the selector syntax", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(g.nodes.get(g.rootId)!.label).toBe("$")
  })

  it("can be overridden by the config", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "Boutique" })
    expect(g.nodes.get(g.rootId)!.label).toBe("Boutique")
  })

  it("affects the root only", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "Boutique" })
    expect(g.nodes.get("/customers")!.label).toBe("customers")
    expect(g.nodes.get("/customers/0")!.label).toBe("Customer #c1")
  })

  it("accepts the empty string without falling back to the default", () => {
    const g = buildGraph(shopData, { ...shopConfig, rootLabel: "" })
    expect(g.nodes.get(g.rootId)!.label).toBe("")
  })
})
