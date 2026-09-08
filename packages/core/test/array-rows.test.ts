import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { buildSearchIndex } from "../src/search.js"
import { arrayTokenTextFor, badgeTextFor, measureNode, DEFAULT_METRICS } from "../src/measure.js"
import { nearestDrawn, VALUE_ONLY_KEY, type ArrayRow } from "../src/model.js"
import type { DataGraphConfig } from "../src/config.js"

/**
 * An array is no longer a CARD but a ROW of its parent's card, and its elements
 * are cards. This file covers what is not obvious about that switch: who is
 * elided and who is not, where the array's content goes in the search index, and
 * how containment edges are remapped when one of their endpoints no longer has a
 * box.
 */

const config: DataGraphConfig = {
  ids: { Product: "$.products[*].id" },
}

/** An id path that matches nothing in the data sets below: the graph therefore
 * has NO entity at all — exactly what these cases want to observe, without
 * depending on an empty `ids` map being accepted. */
const NO_ENTITIES: DataGraphConfig = {
  ids: { Absente: "$.absente[*].id" },
}

const data = {
  products: [
    {
      id: "p1",
      name: "Clavier",
      tags: ["mecanique", "USB-C"],
      reviews: [{ author: "Camille", rating: 5 }],
    },
  ],
}

describe("array elision", () => {
  const g = buildGraph(data, config)

  it("replaces the array's card with a row on its parent", () => {
    const product = g.nodes.get("/products/0")!
    const row = product.rows.find((r) => r.key === "tags") as ArrayRow | undefined
    expect(row).toBeDefined()
    expect(row!.valueType).toBe("array")
    expect(row!.value).toBe(2)
    expect(row!.arrayId).toBe("/products/0/tags")
    expect(g.nodes.get("/products/0/tags")!.elided).toBe(true)
  })

  it("places the row in the object's key order, not at the end of the card", () => {
    // `tags` is declared after `name` in the data: the row must sit there too.
    // It is laid down AFTER the child is visited, the only moment when the
    // element count is known, hence the risk of seeing it drift to the end of
    // the list.
    const keys = g.nodes.get("/products/0")!.rows.map((r) => r.key)
    expect(keys).toEqual(["id", "name", "tags", "reviews"])
  })

  it("turns every scalar element into a value-only node", () => {
    const tag = g.nodes.get("/products/0/tags/0")!
    expect(tag.label).toBe("tags[0]")
    expect(tag.rows).toEqual([{ key: VALUE_ONLY_KEY, value: "mecanique", valueType: "string" }])
    expect(tag.elided).toBe(false)
  })

  it("does NOT elide a root document that is a bare array", () => {
    // With no parent to carry the row, eliding it would leave no card at all.
    const bare = buildGraph([1, 2], NO_ENTITIES)
    expect(bare.nodes.get("/")!.elided).toBe(false)
  })

  it("does NOT elide an array whose parent is already elided", () => {
    // Same reason: the host card is missing. The inner array therefore keeps its
    // own, and this is the only case where an array is still drawn as a card.
    const nested = buildGraph({ matrix: [[1, 2]] }, NO_ENTITIES)
    expect(nested.nodes.get("/matrix")!.elided).toBe(true)
    expect(nested.nodes.get("/matrix/0")!.elided).toBe(false)
  })
})

describe("drawn child count", () => {
  it("excludes elided children from the chevron and the badge", () => {
    // The product's only two children are arrays: its header has nothing to
    // reveal, hence neither chevron nor badge. With `childIds.length` it would
    // have announced "2" and a fold with no effect.
    const g = buildGraph(data, config)
    const product = g.nodes.get("/products/0")!
    expect(product.childIds.length).toBe(2)
    expect(product.cardChildCount).toBe(0)

    // An ENTITY's badge carries its type, never a count: the exclusion of elided
    // children is observable on an ordinary container.
    const plain = buildGraph({ box: { tags: ["a"] } }, NO_ENTITIES).nodes.get("/box")!
    expect(plain.childIds.length).toBe(1)
    expect(plain.cardChildCount).toBe(0)
    expect(badgeTextFor(plain)).toBe("")
  })
})

describe("visibility of an elided array", () => {
  const g = buildGraph(data, config)
  const cs = new CollapseState(g)

  it("exposes the row even when the host card is collapsed", () => {
    // An entity starts collapsed. Its `tags` row is drawn all the same — rows
    // always are — so the node it drives must exist for the fold, otherwise
    // clicking the token would expand nothing.
    expect(cs.isExpanded("/products/0")).toBe(false)
    expect(cs.visibleNodeIds().has("/products/0/tags")).toBe(true)
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(false)
  })

  it("reveals the elements as soon as the array itself is expanded", () => {
    cs.expand("/products/0/tags")
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(true)
  })
})

describe("search index", () => {
  const index = buildSearchIndex(buildGraph(data, config))

  it("does not index the element count as a value", () => {
    // Otherwise "items" would match EVERY array in the document, and "2" every
    // two-element array.
    expect(index.search("items")).toEqual([])
  })

  it("finds the real content where it now lives, on the elements", () => {
    const hits = index.search("mecanique")
    expect(hits.map((h) => h.nodeId)).toContain("/products/0/tags/0")
  })

  it("still indexes the array's KEY", () => {
    expect(index.search("tags").map((h) => h.nodeId)).toContain("/products/0")
  })
})

describe("containment edge remapping", () => {
  it("resolves an elided endpoint to its nearest drawn ancestor", () => {
    const g = buildGraph(data, config)
    expect(nearestDrawn(g, "/products/0/tags")).toBe("/products/0")
    expect(nearestDrawn(g, "/products/0/tags/0")).toBe("/products/0/tags/0")
  })

  it("climbs SEVERAL elision steps, not just one", () => {
    // An array inside an elided array: this is the case a one-level resolution
    // gets wrong, by stopping on a node that still has no card.
    const g = buildGraph({ a: [[[1]]] }, NO_ENTITIES)
    expect(g.nodes.get("/a")!.elided).toBe(true)
    expect(g.nodes.get("/a/0")!.elided).toBe(false)
    expect(nearestDrawn(g, "/a")).toBe("/")
  })

  it("gives no rect to an elided array, but gives one to its elements", async () => {
    const g = buildGraph(data, config)
    const cs = new CollapseState(g)
    cs.expand("/products/0/tags")
    const { positions } = await createStructureLayoutEngine().layout(g, cs.visibleNodeIds())
    expect(positions.has("/products/0/tags")).toBe(false)
    expect(positions.has("/products/0/tags/0")).toBe(true)
    expect(positions.has("/products/0/tags/1")).toBe(true)
  })
})

describe("measuring an array row", () => {
  it("budgets the pill with its chrome, not as bare text", () => {
    const g = buildGraph(data, config)
    const product = g.nodes.get("/products/0")!
    const row = product.rows.find((r) => r.key === "tags") as ArrayRow
    // The card must reserve more than the text width alone: without the padding
    // and the chevron, the pill would overflow the space measured for it.
    const textOnly = arrayTokenTextFor(row.value).length * DEFAULT_METRICS.valueCharWidth
    const chrome = DEFAULT_METRICS.railWidth + 2 * DEFAULT_METRICS.paddingX
    const keyW = "tags".length * DEFAULT_METRICS.keyCharWidth + DEFAULT_METRICS.gapKeyValue
    expect(measureNode(product).width).toBeGreaterThan(chrome + keyW + textOnly)
  })

  it("reserves neither key nor gap for a value-only row", () => {
    const g = buildGraph({ tags: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, NO_ENTITIES)
    const element = g.nodes.get("/tags/0")!
    const withKey = { ...element, rows: [{ ...element.rows[0]!, key: "k".repeat(20) }] }
    expect(measureNode(element).width).toBeLessThan(measureNode(withKey).width)
  })
})
