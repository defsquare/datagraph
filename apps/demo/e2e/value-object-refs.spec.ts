import { test, expect, type Page } from "@playwright/test"

/**
 * A reference carried by a VALUE OBJECT: `CartLine` has no identity — it is not
 * an entity, it has neither `id` nor card in graph view — and yet it carries
 * `productRef`. The case used to be inexpressible: declaring it on `Cart` with a
 * path (`lines[*].productRef`) is what makes it expressible.
 *
 * These cases live in e2e because they cross the whole assembly: resolution at
 * build time, hoisting of the drawn line up to a visible ancestor, aggregate
 * membership at the entity level, and the host's detail panel following the
 * reference from the value object's card.
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

const cartData = {
  carts: [{ id: "k1", lines: [{ sku: "A-1", productRef: "p1" }] }],
  products: [{ id: "p1", name: "Clavier" }],
}

const cartConfig = {
  ids: {
    Cart: "$.carts[*].id",
    Product: "$.products[*].id",
  },
  refs: [{ from: "$.carts[*].lines[*].productRef", to: "$.products[*].id" }],
  groups: ["Product"],
}

async function loadCart(page: Page): Promise<void> {
  await gotoReady(page)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [cartData, cartConfig],
  )
}

test("a value object reference resolves and carries its declaring entity", async ({ page }) => {
  await loadCart(page)

  // `refEdges(from)` stays indexed by the node THAT CARRIES the row: that is
  // what lets the detail panel put its button on the right row.
  const edges = await page.evaluate(() =>
    (window as any).__graph.refEdges("/carts/0/lines/0"),
  )
  expect(edges).toHaveLength(1)
  expect(edges[0].to).toBe("/products/0")
  expect(edges[0].fromEntity).toBe("/carts/0")
  expect(edges[0].field).toBe("productRef")

  // No diagnostic: the declaration is satisfied and the target exists.
  const diagnostics = await page.evaluate(() => (window as any).__graph.diagnostics())
  expect(diagnostics).toEqual([])
})

test("in graph view the edge is drawn without error and the counters stay consistent", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await loadCart(page)
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // Two cards, and two only: the cart line has no identity, hence no card. Its
  // edge starts from the cart's card, hoisted — exactly what the graph view has
  // to show.
  expect(await visibleCount(page)).toBe(2)

  // Aggregate membership has no public API: what can be observed here is that
  // the entity-level computation (aggregates, radial packing, inter-cluster
  // pull) crosses an edge whose source is NOT an entity without breaking
  // anything. The aggregate's content is checked in a core test.
  expect(errors).toEqual([])
})

test("in structure view, expanding the token renders the line card and its reference button", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await loadCart(page)
  const before = await visibleCount(page)

  // The `lines` array is elided: it lives as a token ROW on the cart's card, and
  // it is that token which expands the cart line's card.
  await page.evaluate(() => (window as any).__graph.expand("/carts/0/lines"))
  await expect.poll(() => visibleCount(page)).toBe(before + 1)

  const edges = await page.evaluate(() =>
    (window as any).__graph.refEdges("/carts/0/lines/0"),
  )
  expect(edges).toHaveLength(1)
  expect(edges[0].to).toBe("/products/0")

  // The host's detail panel has nothing special to know: the `productRef` row is
  // a row like any other of the selected node, and its button follows the
  // reference through to the product.
  await page.evaluate(() => (window as any).__graph.select("/carts/0/lines/0"))
  await expect(page.locator("#selection-path")).toContainText("/carts/0/lines/0")
  await page.click("#selection-rows .ref-btn:not([disabled])")
  await expect(page.locator("#selection-label")).toContainText("Product #p1")

  expect(errors).toEqual([])
})

test("clicking the line of a hoisted reference navigates to its target", async ({ page }) => {
  // The behavior is the same as for any reference — one gesture, one direction —
  // but it rests on a discreet link: the edge's click zone HOISTS its start just
  // as the drawn line does (`nearestCardRectFor`). Before that fix, the line of a
  // hidden value object was visible but inert, and nothing other than this test
  // covers the click end to end.
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoReady(page)
  await page.evaluate(() => {
    const g = (window as any).__graph
    ;(window as any).__followed = null
    g.on("followRef", (e: any) => ((window as any).__followed = e))
  })
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")
  await page.evaluate(() => (window as any).__graph.select("/products/1"))
  await page.evaluate(() => (window as any).__graph.focus("/customers/1"))
  await page.waitForTimeout(700)

  // No public API exposes edge geometry: we SWEEP a small grid where the layout
  // — deterministic — puts the p16 → c2 line, and stop at the first click that
  // touches it. Missed clicks select at worst a card or an envelope, without
  // moving the camera.
  //
  // The window has been recalibrated since the canvas took the whole viewport
  // (no more top bar or aside shrinking it): `focus` centres c2 on a 1280x800
  // canvas, so the line is pushed towards the right and the bottom.
  const box = (await page.locator("canvas").boundingBox())!
  let followed: any = null
  outer: for (let y = 220; y <= 350; y += 7) {
    for (let x = 630; x <= 710; x += 5) {
      await page.mouse.click(box.x + x, box.y + y)
      followed = await page.evaluate(() => (window as any).__followed)
      if (followed) break outer
    }
  }

  // The event carries the COMPLETE edge: the host knows which row of the array
  // it comes from, not merely where it goes.
  expect(followed).not.toBeNull()
  expect(followed.fromEntity).toBe("/products/1")
  expect(followed.from).toMatch(/^\/products\/1\/reviews\//)
  expect(followed.field).toBe("customerId")

  // And the click navigated: the target is selected.
  await expect(page.locator("#selection-label")).toContainText("Customer #c")
  expect(errors).toEqual([])
})
