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

describe("elision d'un tableau", () => {
  const g = buildGraph(data, config)

  it("remplace la carte du tableau par une ligne sur son parent", () => {
    const product = g.nodes.get("/products/0")!
    const row = product.rows.find((r) => r.key === "tags") as ArrayRow | undefined
    expect(row).toBeDefined()
    expect(row!.valueType).toBe("array")
    expect(row!.value).toBe(2)
    expect(row!.arrayId).toBe("/products/0/tags")
    expect(g.nodes.get("/products/0/tags")!.elided).toBe(true)
  })

  it("range la ligne dans l'ordre des cles de l'objet, pas en fin de carte", () => {
    // `tags` is declared after `name` in the data: the row must sit there too.
    // It is laid down AFTER the child is visited, the only moment when the
    // element count is known, hence the risk of seeing it drift to the end of
    // the list.
    const keys = g.nodes.get("/products/0")!.rows.map((r) => r.key)
    expect(keys).toEqual(["id", "name", "tags", "reviews"])
  })

  it("fait de chaque element scalaire un nœud a valeur seule", () => {
    const tag = g.nodes.get("/products/0/tags/0")!
    expect(tag.label).toBe("tags[0]")
    expect(tag.rows).toEqual([{ key: VALUE_ONLY_KEY, value: "mecanique", valueType: "string" }])
    expect(tag.elided).toBe(false)
  })

  it("n'elide PAS un document racine qui est un tableau nu", () => {
    // With no parent to carry the row, eliding it would leave no card at all.
    const bare = buildGraph([1, 2], NO_ENTITIES)
    expect(bare.nodes.get("/")!.elided).toBe(false)
  })

  it("n'elide PAS un tableau dont le parent est deja elide", () => {
    // Same reason: the host card is missing. The inner array therefore keeps its
    // own, and this is the only case where an array is still drawn as a card.
    const nested = buildGraph({ matrix: [[1, 2]] }, NO_ENTITIES)
    expect(nested.nodes.get("/matrix")!.elided).toBe(true)
    expect(nested.nodes.get("/matrix/0")!.elided).toBe(false)
  })
})

describe("compte d'enfants dessines", () => {
  it("exclut les enfants elides du chevron et de la pastille", () => {
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

describe("visibilite d'un tableau elide", () => {
  const g = buildGraph(data, config)
  const cs = new CollapseState(g)

  it("expose la ligne meme quand la carte hote est repliee", () => {
    // An entity starts collapsed. Its `tags` row is drawn all the same — rows
    // always are — so the node it drives must exist for the fold, otherwise
    // clicking the token would expand nothing.
    expect(cs.isExpanded("/products/0")).toBe(false)
    expect(cs.visibleNodeIds().has("/products/0/tags")).toBe(true)
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(false)
  })

  it("revele les elements des que le tableau lui-meme est deplie", () => {
    cs.expand("/products/0/tags")
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(true)
  })
})

describe("index de recherche", () => {
  const index = buildSearchIndex(buildGraph(data, config))

  it("n'indexe pas le compte d'elements comme une valeur", () => {
    // Otherwise "items" would match EVERY array in the document, and "2" every
    // two-element array.
    expect(index.search("items")).toEqual([])
  })

  it("trouve le contenu reel la ou il vit desormais, sur les elements", () => {
    const hits = index.search("mecanique")
    expect(hits.map((h) => h.nodeId)).toContain("/products/0/tags/0")
  })

  it("indexe toujours la CLE du tableau", () => {
    expect(index.search("tags").map((h) => h.nodeId)).toContain("/products/0")
  })
})

describe("remappage des aretes de containment", () => {
  it("resout une extremite elidee vers son plus proche ancetre dessine", () => {
    const g = buildGraph(data, config)
    expect(nearestDrawn(g, "/products/0/tags")).toBe("/products/0")
    expect(nearestDrawn(g, "/products/0/tags/0")).toBe("/products/0/tags/0")
  })

  it("remonte PLUSIEURS crans d'elision, pas un seul", () => {
    // An array inside an elided array: this is the case a one-level resolution
    // gets wrong, by stopping on a node that still has no card.
    const g = buildGraph({ a: [[[1]]] }, NO_ENTITIES)
    expect(g.nodes.get("/a")!.elided).toBe(true)
    expect(g.nodes.get("/a/0")!.elided).toBe(false)
    expect(nearestDrawn(g, "/a")).toBe("/")
  })

  it("ne donne aucun rect a un tableau elide, mais en donne un a ses elements", async () => {
    const g = buildGraph(data, config)
    const cs = new CollapseState(g)
    cs.expand("/products/0/tags")
    const { positions } = await createStructureLayoutEngine().layout(g, cs.visibleNodeIds())
    expect(positions.has("/products/0/tags")).toBe(false)
    expect(positions.has("/products/0/tags/0")).toBe(true)
    expect(positions.has("/products/0/tags/1")).toBe(true)
  })
})

describe("mesure d'une ligne-tableau", () => {
  it("budgete la pilule avec son chrome, pas comme du texte nu", () => {
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

  it("ne reserve ni cle ni ecart pour une ligne a valeur seule", () => {
    const g = buildGraph({ tags: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, NO_ENTITIES)
    const element = g.nodes.get("/tags/0")!
    const withKey = { ...element, rows: [{ ...element.rows[0]!, key: "k".repeat(20) }] }
    expect(measureNode(element).width).toBeLessThan(measureNode(withKey).width)
  })
})
