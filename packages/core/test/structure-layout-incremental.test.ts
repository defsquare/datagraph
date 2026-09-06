import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
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
})
