import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { measureNode, badgeTextFor, DEFAULT_METRICS } from "../src/measure.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("badgeTextFor", () => {
  it("returns the type in capitals for an entity", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers/0")!)).toBe("CUSTOMER")
  })

  it("returns the child count for a container that has children", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers")!)).toBe("2")
  })

  it("returns the empty string for a node with neither children nor type", () => {
    const g = buildGraph(shopData, shopConfig)
    expect(badgeTextFor(g.nodes.get("/customers/0/address")!)).toBe("")
  })
})

describe("measureNode", () => {
  it("budgets the mono value with its own advance, not the body's", () => {
    // A long mono value must widen the card more than a body key of the same
    // length: that is exactly the bug that made "dupont@example.com" overflow
    // its card.
    const node = {
      kind: "object" as const,
      id: "/x",
      path: ["x"],
      label: "x",
      parentId: null,
      childIds: [],
      elided: false,
      cardChildCount: 0,
      rows: [{ key: "a", value: "wwwwwwwwwwwwwwwwwwww", valueType: "string" as const }],
    }
    const swapped = {
      ...node,
      rows: [{ key: "wwwwwwwwwwwwwwwwwwww", value: "a", valueType: "string" as const }],
    }
    expect(measureNode(node).width).toBeGreaterThan(measureNode(swapped).width)
  })

  it("respects minWidth and maxWidth", () => {
    const tiny = {
      kind: "object" as const,
      id: "/t", path: ["t"], label: "t", parentId: null, childIds: [], rows: [],
      elided: false, cardChildCount: 0,
    }
    const huge = {
      ...tiny,
      rows: [{ key: "k".repeat(200), value: "v".repeat(200), valueType: "string" as const }],
    }
    expect(measureNode(tiny).width).toBe(DEFAULT_METRICS.minWidth)
    expect(measureNode(huge).width).toBe(DEFAULT_METRICS.maxWidth)
  })

  it("adds paddingBottom only when there are rows", () => {
    const noRows = {
      kind: "object" as const,
      id: "/n", path: ["n"], label: "n", parentId: null, childIds: [], rows: [],
      elided: false, cardChildCount: 0,
    }
    const oneRow = {
      ...noRows,
      rows: [{ key: "k", value: "v", valueType: "string" as const }],
    }
    expect(measureNode(noRows).height).toBe(DEFAULT_METRICS.headerHeight)
    expect(measureNode(oneRow).height).toBe(
      DEFAULT_METRICS.headerHeight + DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.paddingBottom,
    )
  })

  it("reserves the chevron's width only for a node with children", () => {
    const leaf = {
      kind: "object" as const,
      id: "/l", path: ["l"], label: "l".repeat(30), parentId: null, childIds: [], rows: [],
      elided: false, cardChildCount: 0,
    }
    const parent = { ...leaf, childIds: ["/l/a"], cardChildCount: 1 }
    expect(measureNode(parent).width).toBeGreaterThan(measureNode(leaf).width)
  })

  it("is deterministic", () => {
    const g = buildGraph(shopData, shopConfig)
    const c1 = g.nodes.get("/customers/0")!
    expect(measureNode(c1)).toEqual(measureNode(c1))
  })
})
