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

  it("revealPage ajoute une page ; les cartes révélées arrivent repliées", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/200")).toBe(true)
    expect(visible.has("/items/249")).toBe(true)
    // Le BFS initial n'a enfilé que la PREMIÈRE page de `/items` : `/items/200`
    // n'a donc jamais été marqué déplié, et révéler sa page le fait entrer seul.
    // C'est voulu — révéler une page ne doit pas faire entrer un sous-arbre que
    // le budget initial avait justement écarté ; l'utilisateur déplie ensuite.
    expect(cs.isExpanded("/items/200")).toBe(false)
    expect(visible.has("/items/200/w")).toBe(false)
    cs.expand("/items/200")
    expect(cs.visibleNodeIds().has("/items/200/w")).toBe(true)
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

  it("expandPathTo révèle la page de chaque maillon du chemin, pas tout le préfixe", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.collapse("/items") // repartir d'un tableau replié
    cs.expandPathTo("/items/213/w")
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/213")).toBe(true)
    expect(visible.has("/items/100")).toBe(false) // la page 1 n'a pas été payée
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
  // Trois niveaux : root -> a,b (objets) -> chacun 10 enfants objets.
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
    // la racine et ses 2 enfants tiennent dans 5 ; les 10 petits-enfants
    // de /a en feraient 13 -> /a et /b restent des cartes repliées visibles
    expect(visible.has("/a")).toBe(true)
    expect(visible.has("/b")).toBe(true)
    expect(cs.isExpanded("/a")).toBe(false)
    expect(visible.has("/a/k0")).toBe(false)
  })

  it("la racine est toujours dépliée, même sous un budget de 0", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g, { initialCardBudget: 0 })
    expect(cs.isExpanded(g.rootId)).toBe(true)
    expect(cs.visibleNodeIds().has("/a")).toBe(true) // enfants de la racine = cartes visibles repliées
  })

  it("un document sous le budget est intégralement déplié, comme avant", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g) // défaut 300 >> ~23 cartes
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
    const cs = new CollapseState(g) // 250 cartes > 100 mais budget 300 : marqué déplié
    expect(cs.visibleNodeIds().has("/items/100")).toBe(false)
  })
})
