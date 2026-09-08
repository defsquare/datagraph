import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState, PAGE_SIZE, pageOf } from "../src/collapse.js"
import type { DataGraphConfig } from "../src/config.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("CollapseState", () => {
  it("starts with only root children visible, collapsed", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const visible = cs.visibleNodeIds()
    expect(visible).toContain("/customers/0")     // child of /customers, itself a child of the root…
    expect(visible).not.toContain("/customers/0/address") // …but nothing under a collapsed entity
    expect(cs.isExpanded("/customers/0")).toBe(false)
  })
  it("expand reveals direct children only", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/orders/0")
    expect(cs.visibleNodeIds()).toContain("/orders/0/lines")
    expect(cs.visibleNodeIds()).not.toContain("/orders/0/lines/0") // lines not expanded yet
  })
  it("expandPathTo returns newly expanded ancestors root-first", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const newly = cs.expandPathTo("/orders/0/lines/1")
    expect(newly).toEqual(["/orders/0", "/orders/0/lines"])
    expect(cs.visibleNodeIds()).toContain("/orders/0/lines/1")
    expect(cs.expandPathTo("/orders/0/lines/1")).toEqual([]) // idempotent
  })
})

function manyItems(n: number): unknown {
  return { items: Array.from({ length: n }, (_, i) => ({ v: i, w: { deep: i } })) }
}
// `ids: {}`: no entity at all, like CLI mode without a config. The `/items`
// array is then ELIDED (one row of the root card) but stays expanded by the
// BFS: its 250 object elements ARE real cards — hence paginated.
const noConfig: DataGraphConfig = { ids: {} }

describe("CollapseState — pages révélées", () => {
  it("un nœud déplié ne montre que la première page de ses enfants-cartes", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/0")).toBe(true)
    expect(visible.has("/items/99")).toBe(true)
    expect(visible.has("/items/100")).toBe(false)
    expect(visible.has("/items/249")).toBe(false)
  })

  it("revealPage ajoute une page ; les cartes révélées arrivent repliées", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/200")).toBe(true)
    expect(visible.has("/items/249")).toBe(true)
    // The initial BFS only queued the FIRST page of `/items`, so `/items/200`
    // was never marked expanded, and revealing its page brings it in alone.
    // That is deliberate — revealing a page must not drag in a subtree the
    // initial budget had precisely ruled out; the user expands afterwards.
    expect(cs.isExpanded("/items/200")).toBe(false)
    expect(visible.has("/items/200/w")).toBe(false)
    cs.expand("/items/200")
    expect(cs.visibleNodeIds().has("/items/200/w")).toBe(true)
    expect(visible.has("/items/100")).toBe(false) // page 1 stays hidden
  })

  it("unrevealPage retire une page, y compris la page 0", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    cs.unrevealPage("/items", 2)
    expect(cs.visibleNodeIds().has("/items/200")).toBe(false)
    cs.unrevealPage("/items", 0)
    expect(cs.visibleNodeIds().has("/items/0")).toBe(false)
  })

  it("revealedPages vaut {0} par défaut et suit les révélations", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    expect([...cs.revealedPages("/items")]).toEqual([0])
    cs.revealPage("/items", 2)
    expect([...cs.revealedPages("/items")].sort()).toEqual([0, 2])
    cs.unrevealPage("/items", 0)
    expect([...cs.revealedPages("/items")]).toEqual([2])
  })

  it("hiddenGaps décrit les trous en ordre d'indices, avec la page à révéler", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2) // revealed: pages {0, 2} out of 3 (250 cards)
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 100, count: 100, nextPage: 1 },
    ])
    cs.unrevealPage("/items", 0) // revealed: {2}
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 0, count: 200, nextPage: 0 },
    ])
  })

  it("hiddenGaps borne le dernier trou sur le nombre réel de cartes", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    // Only page 0 is revealed: the gap covers pages 1 and 2, the last of which
    // is incomplete (50 cards, not 100).
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 100, count: 150, nextPage: 1 },
    ])
  })

  it("hiddenGaps est vide sous PAGE_SIZE enfants et pour un nœud inconnu", () => {
    const g = buildGraph(manyItems(50), noConfig)
    const cs = new CollapseState(g)
    expect(cs.hiddenGaps("/items")).toEqual([])
    expect(cs.hiddenGaps("/nope")).toEqual([])
  })

  it("cardIndexOf compte parmi les enfants-cartes ; élidé et absent rendent -1", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    expect(cs.cardIndexOf("/items", "/items/0")).toBe(0)
    expect(cs.cardIndexOf("/items", "/items/113")).toBe(113)
    expect(cs.cardIndexOf("/items", "/absent")).toBe(-1)
    // `/items` is elided: it does not count as a card of the root.
    expect(cs.cardIndexOf("/", "/items")).toBe(-1)
  })

  it("expandPathTo révèle la page de chaque maillon du chemin, pas tout le préfixe", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.collapse("/items") // start over from a collapsed array
    cs.expandPathTo("/items/213/w")
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/213")).toBe(true)
    expect(visible.has("/items/100")).toBe(false) // page 1 was never paid for
    expect(cs.revealedPages("/items").has(2)).toBe(true)
    expect(cs.expandPathTo("/items/213/w")).toEqual([]) // idempotent
  })

  it("pageOf aligne sur PAGE_SIZE", () => {
    expect(PAGE_SIZE).toBe(100)
    expect(pageOf(0)).toBe(0)
    expect(pageOf(99)).toBe(0)
    expect(pageOf(100)).toBe(1)
  })
})

describe("CollapseState — budget initial", () => {
  // Three tiers: root -> a,b (objects) -> 10 object children each.
  function tiers(): unknown {
    const child = () => Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`k${i}`, { leaf: i }]),
    )
    return { a: child(), b: child() }
  }

  it("cesse de déplier une fois le budget de cartes atteint, niveaux hauts d'abord", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g, { initialCardBudget: 5 })
    const visible = cs.visibleNodeIds()
    // the root and its 2 children fit within 5; the 10 grandchildren of /a
    // would make 13 -> /a and /b stay visible collapsed cards
    expect(visible.has("/a")).toBe(true)
    expect(visible.has("/b")).toBe(true)
    expect(cs.isExpanded("/a")).toBe(false)
    expect(visible.has("/a/k0")).toBe(false)
  })

  it("la racine est toujours dépliée, même sous un budget de 0", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g, { initialCardBudget: 0 })
    expect(cs.isExpanded(g.rootId)).toBe(true)
    expect(cs.visibleNodeIds().has("/a")).toBe(true) // root children = visible collapsed cards
  })

  it("un document sous le budget est intégralement déplié, comme avant", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g) // default 300 >> ~23 cards
    expect(cs.isExpanded("/a")).toBe(true)
    expect(cs.visibleNodeIds().has("/a/k0")).toBe(true)
  })

  it("la frontière d'entité reste prioritaire : une entité n'est jamais dépliée par le BFS", () => {
    const g = buildGraph(
      { customers: [{ id: "c1", extra: { x: 1 } }] },
      { ids: { Customer: "$.customers[*].id" } },
    )
    const cs = new CollapseState(g, { initialCardBudget: 10_000 })
    const entity = [...g.nodes.values()].find((n) => n.kind === "entity")!
    expect(cs.isExpanded(entity.id)).toBe(false)
  })

  it("un nœud marqué déplié ne révèle que sa première page (interaction budget × pages)", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g) // 250 cards > 100 but budget 300: marked expanded
    expect(cs.visibleNodeIds().has("/items/100")).toBe(false)
  })
})
