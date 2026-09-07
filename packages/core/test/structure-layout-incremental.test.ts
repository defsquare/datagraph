import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import type { DataGraphConfig } from "../src/config.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("incremental layout", () => {
  async function setup() {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const initial = await engine.layout(g, cs.visibleNodeIds())
    return { g, cs, engine, initial }
  }

  it("expand keeps nodes above unchanged, shifts nodes below, no overlap", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const next = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    const anchor = before.get("/customers/0")!
    for (const [id, r] of before) {
      if (r.y + r.height <= anchor.y) expect(next.positions.get(id)).toEqual(r) // au-dessus : intact
    }
    expect(next.positions.has("/customers/0/address")).toBe(true)
    const addr = next.positions.get("/customers/0/address")!
    expect(addr.x).toBeGreaterThan(anchor.x + anchor.width)
  })

  it("collapse restores previous vertical positions", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const expanded = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(expanded, g, "/customers/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("repeated expand then collapse restores positions", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const once = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    const twice = await engine.layoutAfterExpand(once, g, "/customers/0", cs.visibleNodeIds())
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(twice, g, "/customers/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("replier un tableau elide annule le decalage de son depliage", async () => {
    // `/orders/0/lines` est un tableau, donc ELIDE : il n'a pas de carte, il est
    // le jeton d'une ligne de `/orders/0`. C'est lui qui porte le pli de ses
    // elements, et c'est donc lui — et non la commande qui le contient — qui
    // doit rendre les positions a leur etat d'avant.
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))

    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )
    expect(expanded.positions.has("/orders/0/lines/0")).toBe(true)
    // Le tableau elide n'a AUCUN rect : sa ligne vit dans la carte de la commande.
    expect(expanded.positions.has("/orders/0/lines")).toBe(false)

    cs.collapse("/orders/0/lines")
    const back = engine.layoutAfterCollapse(expanded, g, "/orders/0/lines", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })

  it("replier la carte hote ne retracte pas ce que le jeton a deplie", async () => {
    // Le chevron d'en-tete et le jeton `[ n items ]` sont deux commandes
    // INDEPENDANTES : le premier gouverne les cartes enfants, le second son
    // tableau. Replier `/orders/0` laisse sa carte — et donc sa ligne `lines`,
    // toujours marquee depliee — a l'ecran ; retirer les cartes d'elements ferait
    // mentir le jeton sur ce qu'il montre.
    const { g, cs, engine, initial } = await setup()
    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )

    cs.collapse("/orders/0")
    const visible = cs.visibleNodeIds()
    expect(visible.has("/orders/0/lines")).toBe(true)
    expect(visible.has("/orders/0/lines/0")).toBe(true)

    const back = engine.layoutAfterCollapse(expanded, g, "/orders/0", visible)
    expect(back.positions.has("/orders/0/lines/0")).toBe(true)
  })

  it("layout() global purge la memoire de deltas : un collapse ulterieur n'annule rien", async () => {
    const { g, cs, engine, initial } = await setup()

    // `/orders/0/lines` est le depliage de la fixture qui decale reellement des
    // cartes : sans delta non nul memorise, le test ne prouverait rien.
    cs.expand("/orders/0/lines")
    const expanded = await engine.layoutAfterExpand(
      initial, g, "/orders/0/lines", cs.visibleNodeIds(),
    )
    const moved = [...initial.positions].some(
      ([id, r]) => Math.abs(expanded.positions.get(id)!.y - r.y) > 0.001,
    )
    expect(moved).toBe(true)

    // Mise en page GLOBALE : les positions repartent de zero, le delta memorise
    // pour `/orders/0/lines` ne decrit plus rien de ce qui est a l'ecran.
    const fresh = await engine.layout(g, cs.visibleNodeIds())
    const snapshot = new Map([...fresh.positions].map(([id, r]) => [id, { ...r }]))

    cs.collapse("/orders/0/lines")
    const visible = cs.visibleNodeIds()
    const back = engine.layoutAfterCollapse(fresh, g, "/orders/0/lines", visible)

    // Aucune carte etrangere au sous-arbre replie ne doit avoir bouge : si le
    // delta perime avait survecu, tout ce qui est sous son seuil remonterait.
    for (const [id, r] of snapshot) {
      if (!visible.has(id)) continue
      expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
    }
  })
})

function manyItems(n: number): unknown {
  return { items: Array.from({ length: n }, (_, i) => ({ v: i, w: { deep: i } })) }
}
// `ids: {}` : aucune entite, comme le mode CLI sans config. `/items` est ELIDE
// (une ligne de la carte racine) mais deplie ; ses elements sont de vraies
// cartes, donc paginees — c'est le terrain de `layoutAfterReveal`.
const noConfig: DataGraphConfig = { ids: {} }

describe("layoutAfterReveal", () => {
  it("insere le nouveau bloc sous le bloc precedent et decale le dessous", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const before = await engine.layout(g, cs.visibleNodeIds())
    const lastOfPage0 = before.positions.get("/items/99")!

    cs.revealPage("/items", 1)
    const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())

    const first = after.positions.get("/items/100")!
    expect(first.x).toBeCloseTo(lastOfPage0.x, 1) // meme colonne
    expect(first.y).toBeGreaterThan(lastOfPage0.y) // dessous
    // La derniere carte de la page 0 est AU-DESSUS du point d'insertion : elle
    // ne bouge pas, c'est elle qui ancre la pose.
    expect(after.positions.get("/items/99")!.y).toBeCloseTo(lastOfPage0.y, 1)
    // Le bloc entier tient sous le point d'insertion.
    for (let i = 100; i < 200; i++) {
      expect(after.positions.get(`/items/${i}`)!.y).toBeGreaterThan(lastOfPage0.y)
    }
  })

  it("un bloc disjoint sans precedent se pose au-dessus du bloc suivant", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.unrevealPage("/items", 0)
    cs.revealPage("/items", 2)
    const engine = createStructureLayoutEngine()
    const only = await engine.layout(g, cs.visibleNodeIds())
    expect(only.positions.has("/items/200")).toBe(true)
    expect(only.positions.has("/items/0")).toBe(false)

    cs.revealPage("/items", 0)
    const after = await engine.layoutAfterReveal(only, g, "/items", cs.visibleNodeIds())

    expect(after.positions.get("/items/0")).toBeDefined()
    expect(after.positions.get("/items/0")!.y).toBeLessThan(after.positions.get("/items/200")!.y)
    // Le suivant a ete POUSSE vers le bas pour faire place au bloc insere.
    expect(after.positions.get("/items/200")!.y).toBeGreaterThan(
      only.positions.get("/items/200")!.y,
    )
    expect(after.positions.get("/items/0")!.x).toBeCloseTo(
      only.positions.get("/items/200")!.x,
      1,
    )
  })

  it("sans aucune fratrie posee, le bloc retombe sur la pose laterale de l'ancre", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    cs.unrevealPage("/items", 0) // plus une seule carte enfant a l'ecran
    const engineBase = await engine.layout(g, cs.visibleNodeIds())
    const root = engineBase.positions.get("/")!
    expect(engineBase.positions.size).toBe(1)

    cs.revealPage("/items", 1)
    const after = await engine.layoutAfterReveal(engineBase, g, "/items", cs.visibleNodeIds())

    // `/items` est elide : son ancre est la bande de sa ligne dans la carte
    // racine, d'ou une pose 48 px a droite de cette carte.
    const first = after.positions.get("/items/100")!
    expect(first.x).toBeCloseTo(root.x + root.width + 48, 1)
    // La carte qui porte l'ancre ne descend pas avec le bloc qu'elle ouvre.
    expect(after.positions.get("/")!.y).toBeCloseTo(root.y, 5)
  })

  it("un reveal sans nouveau visible rend une copie intacte", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    const before = await engine.layout(g, cs.visibleNodeIds())

    // Rien de nouveau : appel redondant sur les pages deja posees.
    const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())
    expect(after.positions.size).toBe(before.positions.size)
    for (const [id, r] of before.positions) expect(after.positions.get(id)).toEqual(r)
    // Copie, pas alias : muter le resultat ne doit pas contaminer `before`.
    expect(after.positions).not.toBe(before.positions)
  })

  it("deux reveals cumulent leur delta : le repli les annule TOUS", async () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const engine = createStructureLayoutEngine()
    // Partir de la seule page 2 : c'est ce bloc, pose le plus bas, qui encaisse
    // les deux decalages et qui SURVIT au retrait des pages 0 et 1.
    cs.unrevealPage("/items", 0)
    cs.revealPage("/items", 2)
    const base = await engine.layout(g, cs.visibleNodeIds())
    const baseline = new Map([...base.positions].map(([id, r]) => [id, { ...r }]))

    cs.revealPage("/items", 0)
    const one = await engine.layoutAfterReveal(base, g, "/items", cs.visibleNodeIds())
    cs.revealPage("/items", 1)
    const two = await engine.layoutAfterReveal(one, g, "/items", cs.visibleNodeIds())
    const afterFirst = one.positions.get("/items/200")!.y
    const afterSecond = two.positions.get("/items/200")!.y
    expect(afterFirst).toBeGreaterThan(baseline.get("/items/200")!.y)
    expect(afterSecond).toBeGreaterThan(afterFirst)

    // Retirer les deux pages revelees : le cumul memorise sous `/items` doit
    // rendre au bloc restant sa position d'origine. Avec un ecrasement au lieu
    // d'une accumulation, seul le second decalage serait annule.
    cs.unrevealPage("/items", 0)
    cs.unrevealPage("/items", 1)
    const visible = cs.visibleNodeIds()
    const back = engine.layoutAfterCollapse(two, g, "/items", visible)
    for (const [id, r] of baseline) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })
})
