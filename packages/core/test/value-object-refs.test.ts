import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { anchorRectFor, nearestCardRectFor, rowRectFor, type Rect } from "../src/structure-layout.js"
import { DEFAULT_METRICS } from "../src/measure.js"

/**
 * Le cas qui était inexprimable : `CartLine` n'a pas d'identité — ce n'est pas
 * une entité —, mais elle porte la référence vers le `Product`. La déclarer par
 * un CHEMIN qui traverse la ligne (`$.carts[*].lines[*].productRef`) est ce qui
 * la rend exprimable sans inventer une entité sans `id` : le préfixe déclaré
 * le plus long, `$.carts[*]`, en fait le propriétaire.
 *
 * Le fixture vit ici et non dans `fixtures.ts` : il n'existe que pour ces cas,
 * et le poser à côté d'eux évite de faire porter à tous les autres tests une
 * donnée qu'ils n'utilisent pas.
 */
const cartData = {
  carts: [
    {
      id: "k1",
      lines: [
        { sku: "A-1", productRef: "p1", discount: { pct: 10, couponRef: "cp1" } },
        // Pas de `discount` : l'absence sur UNE ligne doit rester silencieuse.
        { sku: "B-7", productRef: "p2" },
      ],
    },
    { id: "k2", lines: [{ sku: "C-3", productRef: "GHOST" }] },
  ],
  products: [
    { id: "p1", name: "Clavier" },
    { id: "p2", name: "Souris" },
  ],
  coupons: [{ id: "cp1", pct: 10 }],
}

const cartConfig: DataGraphConfig = {
  ids: {
    Cart: "$.carts[*].id",
    Product: "$.products[*].id",
    Coupon: "$.coupons[*].id",
  },
  refs: [
    { from: "$.carts[*].lines[*].productRef", to: "$.products[*].id" },
    { from: "$.carts[*].lines[*].discount.couponRef", to: "$.coupons[*].id" },
  ],
}

describe("références portées par un value object", () => {
  const g = buildGraph(cartData, cartConfig)

  it("résout un chemin à un segment exactement comme avant", () => {
    // Le cas dégénéré doit rester bit à bit ce qu'il était, `fromEntity` mis à
    // part : c'est ce qui rend la migration des configs existantes nulle.
    const flat = buildGraph(
      { customers: [{ id: "c1" }], orders: [{ id: "o1", customerId: "c1" }] },
      {
        ids: {
          Customer: "$.customers[*].id",
          Order: "$.orders[*].id",
        },
        refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
      },
    )
    expect(flat.refEdges).toEqual([
      {
        kind: "ref",
        from: "/orders/0",
        fromEntity: "/orders/0",
        to: "/customers/0",
        field: "customerId",
        targetType: "Customer",
        targetId: "c1",
        dangling: false,
      },
    ])
    expect(flat.diagnostics).toEqual([])
  })

  it("résout `lines[*].productRef` depuis chaque ligne du panier", () => {
    const edges = g.refEdges.filter((e) => e.targetType === "Product")
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      ["/carts/0/lines/0", "/products/0"],
      ["/carts/0/lines/1", "/products/1"],
      ["/carts/1/lines/0", null],
    ])
    // L'arête part du nœud qui PORTE la ligne, et `field` est bien une clé de
    // ses lignes : c'est l'invariant dont dépendent la teinte de la valeur, la
    // croix de référence cassée et le panneau de détail.
    const holder = g.nodes.get("/carts/0/lines/0")!
    expect(edges[0]!.field).toBe("productRef")
    expect(holder.rows.some((r) => r.key === "productRef")).toBe(true)
  })

  it("résout un chemin profond à travers deux value objects", () => {
    const edges = g.refEdges.filter((e) => e.targetType === "Coupon")
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      from: "/carts/0/lines/0/discount",
      fromEntity: "/carts/0",
      to: "/coupons/0",
      field: "couponRef",
      dangling: false,
    })
  })

  it("reste silencieux quand le champ manque sur certaines instances seulement", () => {
    // `/carts/0/lines/1` et `/carts/1/lines/0` n'ont pas de `discount`, et
    // `/carts/1` n'a aucun coupon : un champ optionnel n'est pas une faute.
    expect(g.diagnostics.filter((d) => d.code === "unresolved-reference")).toEqual([])
  })

  it("porte `fromEntity` sur l'entité déclarante, pas sur le porteur de la ligne", () => {
    const edge = g.refEdges.find((e) => e.from === "/carts/0/lines/0")!
    expect(edge.fromEntity).toBe("/carts/0")
    // Et `fromEntity === from` dès qu'il n'y a rien à hisser.
    for (const e of g.refEdges) {
      const navigated = e.from !== e.fromEntity
      expect(navigated).toBe(e.from.startsWith("/carts/") && e.from.includes("/lines/"))
    }
  })

  it("pointe le diagnostic `dangling-ref` sur le nœud value object", () => {
    // Le nœud fautif est la LIGNE de panier, pas le panier : c'est là que la
    // croix doit se poser, contre la valeur qui ne résout pas.
    expect(g.diagnostics).toContainEqual(
      expect.objectContaining({ code: "dangling-ref", path: "/carts/1/lines/0" }),
    )
    expect(g.diagnostics.some((d) => d.path === "/carts/1")).toBe(false)
  })

  it("signale par `unresolved-reference` une déclaration que rien ne satisfait", () => {
    const typo = buildGraph(cartData, {
      ...cartConfig,
      refs: [{ from: "$.carts[*].lines[*].produtcRef", to: "$.products[*].id" }],
    })
    expect(typo.refEdges).toEqual([])
    const diag = typo.diagnostics.filter((d) => d.code === "unresolved-reference")
    expect(diag).toHaveLength(1)
    // Le message doit permettre de retrouver la déclaration dans la config :
    // le `from` ABSOLU, tel qu'écrit.
    expect(diag[0]!.path).toBe("$.carts[*].lines[*].produtcRef")
    expect(diag[0]!.message).toContain("lines[*].produtcRef")
    expect(diag[0]!.message).toContain("Cart")
  })

  it("se tait quand le type déclarant n'a aucune instance", () => {
    // Sans instance, rien ne prouve que la déclaration soit fautive — c'est le
    // comportement d'avant, et il ne doit pas devenir bruyant.
    const empty = buildGraph(
      { carts: [], products: [{ id: "p1" }], coupons: [] },
      { ...cartConfig, refs: [{ from: "$.carts[*].lines[*].produtcRef", to: "$.products[*].id" }] },
    )
    expect(empty.diagnostics).toEqual([])
  })

  it("se tait aussi quand la ligne existe mais ne produit aucune arête", () => {
    // Une valeur nulle n'est pas une faute de frappe : la déclaration a bien
    // trouvé sa ligne, elle n'a simplement rien à résoudre.
    const nullRef = buildGraph(
      { carts: [{ id: "k1", lines: [{ productRef: null }] }], products: [], coupons: [] },
      { ...cartConfig, refs: [{ from: "$.carts[*].lines[*].productRef", to: "$.products[*].id" }] },
    )
    expect(nullRef.refEdges).toEqual([])
    expect(nullRef.diagnostics).toEqual([])
  })

  it("ancre le chemin sur l'INSTANCE et ne traverse pas les paniers voisins", () => {
    // `lines[*]` de `/carts/1` ne doit voir que la ligne de `/carts/1`. Un
    // filtrage par `matchesPath` sur tout le graphe croiserait les instances.
    const edges = g.refEdges.filter((e) => e.fromEntity === "/carts/1")
    expect(edges.map((e) => e.from)).toEqual(["/carts/1/lines/0"])
  })
})

describe("appartenance d'agrégat via une arête hissée", () => {
  it("fait rejoindre au panier l'agrégat du produit que sa LIGNE référence", () => {
    const config = { ...cartConfig, groups: ["Product"] }
    const idx = buildAggregates(buildGraph(cartData, config), validateConfig(config))
    // La source du BFS est `fromEntity` : sans hissage, `/carts/0/lines/0` — un
    // nœud que le BFS des entités ne visite jamais — serait la source, et le
    // panier n'appartiendrait à aucun agrégat.
    expect(idx.byNode.get("/carts/0")).toEqual(["Product#p1"])
    expect(idx.aggregates.get("Product#p1")!.memberIds.has("/carts/0")).toBe(true)
    // La ligne elle-même n'est membre de rien : elle n'est pas une entité.
    expect(idx.byNode.get("/carts/0/lines/0")).toBeUndefined()
    // `/carts/1` n'a qu'une référence cassée : rien ne propage.
    expect(idx.byNode.get("/carts/1")).toBeUndefined()
  })
})

describe("nearestCardRectFor", () => {
  const g = buildGraph(cartData, cartConfig)
  const CART: Rect = { x: 0, y: 0, width: 200, height: 120 }
  const LINE: Rect = { x: 400, y: 40, width: 180, height: 100 }

  it("rend la carte du nœud quand elle est à l'écran", () => {
    const positions = new Map([["/carts/0", CART], ["/carts/0/lines/0", LINE]])
    expect(nearestCardRectFor(g, positions, "/carts/0/lines/0")).toEqual(LINE)
  })

  it("remonte jusqu'à la carte de l'entité hôte quand la sienne est cachée", () => {
    // `/carts/0/lines/0` n'est pas positionné (tableau replié), et son parent
    // `/carts/0/lines` est ÉLIDÉ : deux remontées sont nécessaires, ce qu'une
    // résolution à un seul niveau raterait.
    const positions = new Map([["/carts/0", CART]])
    expect(nearestCardRectFor(g, positions, "/carts/0/lines/0")).toEqual(CART)
    // Et surtout PAS la bande de la ligne `lines` : c'est le demi-signal
    // abandonné — le départ est la carte, le détail est porté par l'étiquette
    // de sélection.
    const rows = g.nodes.get("/carts/0")!.rows
    const rowIndex = rows.findIndex((r) => r.key === "lines")
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    expect(nearestCardRectFor(g, positions, "/carts/0/lines/0")).not.toEqual(
      rowRectFor(CART, rowIndex, DEFAULT_METRICS),
    )
    // `anchorRectFor`, lui, s'arrête à l'élision et ne voit rien pour une carte
    // simplement absente : c'est bien une remontée de plus.
    expect(anchorRectFor(g, positions, "/carts/0/lines/0")).toBeUndefined()
  })

  it("rend undefined quand rien de la lignée n'est à l'écran", () => {
    expect(nearestCardRectFor(g, new Map(), "/carts/0/lines/0")).toBeUndefined()
  })
})
