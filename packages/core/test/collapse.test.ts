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
    expect(visible).toContain("/customers/0")     // enfant de /customers, lui-même enfant de racine…
    expect(visible).not.toContain("/customers/0/address") // …mais rien sous une entité repliée
    expect(cs.isExpanded("/customers/0")).toBe(false)
  })
  it("expand reveals direct children only", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/orders/0")
    expect(cs.visibleNodeIds()).toContain("/orders/0/lines")
    expect(cs.visibleNodeIds()).not.toContain("/orders/0/lines/0") // lines pas encore déplié
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
// `ids: {}` : aucune entité, comme le mode CLI sans config. Le tableau `/items`
// est alors ÉLIDÉ (une ligne de la carte racine) mais reste déplié par le BFS :
// ses 250 éléments objets sont, eux, de vraies cartes — donc paginés.
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

  it("revealPage ajoute une page ; les descendants de la page suivent la règle normale", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/200")).toBe(true)
    expect(visible.has("/items/249")).toBe(true)
    // `/items/200` est un objet non-entité, donc déplié par le BFS : révéler sa
    // page le fait entrer AVEC sa descendance, sans autre geste.
    expect(visible.has("/items/200/w")).toBe(true)
    expect(visible.has("/items/100")).toBe(false) // la page 1 reste cachée
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
    cs.revealPage("/items", 2) // révélé : pages {0, 2} sur 3 pages (250 cartes)
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 100, count: 100, nextPage: 1 },
    ])
    cs.unrevealPage("/items", 0) // révélé : {2}
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 0, count: 200, nextPage: 0 },
    ])
  })

  it("hiddenGaps borne le dernier trou sur le nombre réel de cartes", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    // Seule la page 0 est révélée : le trou couvre les pages 1 et 2, dont la
    // dernière est incomplète (50 cartes, pas 100).
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
    // `/items` est élidé : il ne compte pas comme carte de la racine.
    expect(cs.cardIndexOf("/", "/items")).toBe(-1)
  })

  it("pageOf aligne sur PAGE_SIZE", () => {
    expect(PAGE_SIZE).toBe(100)
    expect(pageOf(0)).toBe(0)
    expect(pageOf(99)).toBe(0)
    expect(pageOf(100)).toBe(1)
  })
})
