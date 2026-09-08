import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { anchorRectFor, nearestCardRectFor, rowRectFor, type Rect } from "../src/structure-layout.js"
import { DEFAULT_METRICS } from "../src/measure.js"

/**
 * The case that used to be inexpressible: `CartLine` has no identity — it is not
 * an entity — yet it carries the reference to the `Product`. Declaring it by a
 * PATH that runs through the line (`$.carts[*].lines[*].productRef`) is what
 * makes it expressible without inventing an entity with no `id`: the longest
 * declared prefix, `$.carts[*]`, makes it the owner.
 *
 * The fixture lives here rather than in `fixtures.ts`: it exists only for these
 * cases, and putting it next to them avoids saddling every other test with data
 * it does not use.
 */
const cartData = {
  carts: [
    {
      id: "k1",
      lines: [
        { sku: "A-1", productRef: "p1", discount: { pct: 10, couponRef: "cp1" } },
        // No `discount`: its absence on ONE line must stay silent.
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
    // The degenerate case must stay bit for bit what it was, `fromEntity` aside:
    // that is what makes migrating existing configs a no-op.
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
    // The edge starts from the node that CARRIES the row, and `field` really is
    // one of its row keys: this is the invariant the value's tint, the dangling
    // reference cross and the detail panel all depend on.
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
    // `/carts/0/lines/1` and `/carts/1/lines/0` have no `discount`, and
    // `/carts/1` has no coupon at all: an optional field is not a mistake.
    expect(g.diagnostics.filter((d) => d.code === "unresolved-reference")).toEqual([])
  })

  it("porte `fromEntity` sur l'entité déclarante, pas sur le porteur de la ligne", () => {
    const edge = g.refEdges.find((e) => e.from === "/carts/0/lines/0")!
    expect(edge.fromEntity).toBe("/carts/0")
    // And `fromEntity === from` as soon as there is nothing to hoist.
    for (const e of g.refEdges) {
      const navigated = e.from !== e.fromEntity
      expect(navigated).toBe(e.from.startsWith("/carts/") && e.from.includes("/lines/"))
    }
  })

  it("pointe le diagnostic `dangling-ref` sur le nœud value object", () => {
    // The offending node is the cart LINE, not the cart: that is where the cross
    // must land, against the value that fails to resolve.
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
    // The message must let the reader find the declaration in the config: the
    // ABSOLUTE `from`, exactly as written.
    expect(diag[0]!.path).toBe("$.carts[*].lines[*].produtcRef")
    expect(diag[0]!.message).toContain("lines[*].produtcRef")
    expect(diag[0]!.message).toContain("Cart")
  })

  it("se tait quand le type déclarant n'a aucune instance", () => {
    // With no instance, nothing proves the declaration is wrong — that was the
    // behaviour before, and it must not turn noisy.
    const empty = buildGraph(
      { carts: [], products: [{ id: "p1" }], coupons: [] },
      { ...cartConfig, refs: [{ from: "$.carts[*].lines[*].produtcRef", to: "$.products[*].id" }] },
    )
    expect(empty.diagnostics).toEqual([])
  })

  it("se tait aussi quand la ligne existe mais ne produit aucune arête", () => {
    // A null value is not a typo: the declaration did find its row, it simply
    // has nothing to resolve.
    const nullRef = buildGraph(
      { carts: [{ id: "k1", lines: [{ productRef: null }] }], products: [], coupons: [] },
      { ...cartConfig, refs: [{ from: "$.carts[*].lines[*].productRef", to: "$.products[*].id" }] },
    )
    expect(nullRef.refEdges).toEqual([])
    expect(nullRef.diagnostics).toEqual([])
  })

  it("ancre le chemin sur l'INSTANCE et ne traverse pas les paniers voisins", () => {
    // `lines[*]` of `/carts/1` must see only the line of `/carts/1`. Filtering
    // the whole graph by `matchesPath` would cross the instances.
    const edges = g.refEdges.filter((e) => e.fromEntity === "/carts/1")
    expect(edges.map((e) => e.from)).toEqual(["/carts/1/lines/0"])
  })
})

describe("appartenance d'agrégat via une arête hissée", () => {
  it("fait rejoindre au panier l'agrégat du produit que sa LIGNE référence", () => {
    const config = { ...cartConfig, groups: ["Product"] }
    const idx = buildAggregates(buildGraph(cartData, config), validateConfig(config))
    // The BFS source is `fromEntity`: without hoisting, `/carts/0/lines/0` — a
    // node the entity BFS never visits — would be the source, and the cart would
    // belong to no aggregate at all.
    expect(idx.byNode.get("/carts/0")).toEqual(["Product#p1"])
    expect(idx.aggregates.get("Product#p1")!.memberIds.has("/carts/0")).toBe(true)
    // The line itself is a member of nothing: it is not an entity.
    expect(idx.byNode.get("/carts/0/lines/0")).toBeUndefined()
    // `/carts/1` has only a dangling reference: nothing propagates.
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
    // `/carts/0/lines/0` is not positioned (collapsed array), and its parent
    // `/carts/0/lines` is ELIDED: two levels of walking up are needed, which a
    // single-level resolution would get wrong.
    const positions = new Map([["/carts/0", CART]])
    expect(nearestCardRectFor(g, positions, "/carts/0/lines/0")).toEqual(CART)
    // And above all NOT the band of the `lines` row: that is the half-signal we
    // dropped — the start is the card, the detail is carried by the selection
    // label.
    const rows = g.nodes.get("/carts/0")!.rows
    const rowIndex = rows.findIndex((r) => r.key === "lines")
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    expect(nearestCardRectFor(g, positions, "/carts/0/lines/0")).not.toEqual(
      rowRectFor(CART, rowIndex, DEFAULT_METRICS),
    )
    // `anchorRectFor`, for its part, stops at elision and sees nothing for a
    // card that is merely absent: this really is one level of walking up more.
    expect(anchorRectFor(g, positions, "/carts/0/lines/0")).toBeUndefined()
  })

  it("rend undefined quand rien de la lignée n'est à l'écran", () => {
    expect(nearestCardRectFor(g, new Map(), "/carts/0/lines/0")).toBeUndefined()
  })
})
