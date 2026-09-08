import { test, expect, type Page } from "@playwright/test"

/**
 * Culling at creation time: the renderer only builds the cards in the screen's
 * neighbourhood, and materializes the others on demand. The policy itself is
 * proven on pure data on the renderer side
 * (`packages/renderer/test/culling.test.ts`); what CANNOT be proven there — no
 * renderer test mounts `createDataGraph` — is the end-to-end invariant:
 *
 *   the camera jumping onto a card must find it DRAWN on arrival.
 *
 * We check it through the only channel that proves a card really exists in the
 * scene: the pointer. A missing Pixi container does not answer the hit-test, so
 * a click at the canvas centre — that is, exactly at the centre of the card
 * `focus` has just framed there — would emit no `select`. Enough cards that at
 * `focus`'s zoom (scale 1) the overwhelming majority sits outside the
 * materialization window, and several scattered ones are visited.
 */

/** 60 customers, 60 orders: 120 entities, far more than a screen shows at scale
 * 1, so most of them are outside the window at any instant. */
const data = {
  customers: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}` })),
  orders: Array.from({ length: 60 }, (_, i) => ({ id: `o${i}`, customerId: `c${i}`, total: i })),
}

const config = {
  ids: { Customer: "$.customers[*].id", Order: "$.orders[*].id" },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

/** Zooms by `notches` steps. A BARE wheel pans the canvas: zooming demands a
 * modifier, the only signal no trackpad swipe produces by accident
 * (`classifyWheel`). Playwright applies the keyboard state to wheel events. */
async function zoom(page: Page, notches: number, deltaY: number): Promise<void> {
  await page.keyboard.down("Control")
  for (let i = 0; i < notches; i++) await page.mouse.wheel(0, deltaY)
  await page.keyboard.up("Control")
}

async function gotoGraphView(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")
  // Selections are recorded THROUGH THE PUBLIC EVENT: it is what proves a real
  // container received the tap, rather than some internal state exposed for the
  // test.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
}

test("focus sur une carte hors fenêtre la trouve dessinée à l'arrivée", async ({ page }) => {
  await gotoGraphView(page)

  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // A firm zoom at the centre: the global framing showed everything, scale 1
  // shows only a handful of cards. Everything else is then unmaterialized —
  // exactly the state culling introduces.
  await page.mouse.move(cx, cy)
  await zoom(page, 12, -100)
  await page.waitForTimeout(200)

  // Four targets scattered across the dataset: after a `focus`, the canvas
  // centre IS the centre of the targeted card (`camera.centerOn`), so a click
  // there can only select it — and only if it is drawn.
  for (const id of ["/customers/0", "/orders/59", "/customers/45", "/orders/7"]) {
    await page.evaluate((target) => (window as any).__graph.focus(target), id)
    await page.waitForTimeout(80)
    await page.mouse.click(cx, cy)
    await expect
      .poll(() => page.evaluate(() => (window as any).__selected.at(-1)))
      .toBe(id)
  }
})

test("select sur une carte hors fenêtre ne perd pas la sélection", async ({ page }) => {
  await gotoGraphView(page)

  const box = await page.locator("canvas").first().boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await zoom(page, 12, -100)
  await page.waitForTimeout(200)

  // `select()` does NOT move the camera: the card stays off screen. It is
  // materialized all the same and, above all, it is PINNED — the recycling pass
  // must never destroy it, however far away it is. We check that by coming back
  // to it afterwards: the selection holds, and the card still answers the
  // pointer.
  await page.evaluate(() => (window as any).__graph.select("/orders/33"))
  await page.waitForTimeout(300)
  await page.evaluate(() => (window as any).__graph.focus("/orders/33"))
  await page.waitForTimeout(80)
  await page.mouse.click(cx, cy)
  await expect
    .poll(() => page.evaluate(() => (window as any).__selected.at(-1)))
    .toBe("/orders/33")
})
