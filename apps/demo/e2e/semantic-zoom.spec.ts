import { test, expect, type Page } from "@playwright/test"

/**
 * The graph view's SEMANTIC ZOOM: below the LOD 2 threshold, cards disappear and
 * aggregates are painted as nodes — one named disc per aggregate, linked to the
 * others by the references folded onto the pairs.
 *
 * What this file proves and nothing else can: no renderer test mounts
 * `createDataGraph`, so the SWITCH itself — which cards exist, what the pointer
 * reaches, what zooming back gives — has no other place of verification. The
 * pure pieces (edge aggregation, the three drawing functions, the controller's
 * reads) are covered without a browser by
 * `packages/renderer/test/semantic.test.ts`.
 *
 * The observable is the POINTER, as in `culling.spec.ts`: a missing Pixi
 * container does not answer the hit-test. A click at the canvas centre — that
 * is, exactly at the centre of the card `focus` has just framed there — emits
 * `select` if and only if that card is drawn. It is the same probe on both sides
 * of the threshold, which makes the two halves of the test comparable.
 */

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

/** The demo's EXTENDED dataset, the one with aggregates in numbers: 350
 * entities, `groups: ["Customer", "Product"]`. The click only starts an async
 * handler, so we wait on the counter — the proof that `setData` has finished
 * both building AND laying out. Same wake-up as `view.spec.ts`. */
async function loadExtendedDataset(page: Page): Promise<void> {
  await page.click("#menu-toggle")
  await page.click("#toggle-dataset")
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.stats().logicalNodeCount), {
      timeout: 30_000,
    })
    .toBe(4061)
}

/** The probe entity: a Customer, hence the ROOT of its own aggregate — it is
 * certain to be a member of a disc, which is the test's precondition. */
const PROBE = "/customers/0"

test("below the threshold, aggregates replace the cards; above it, the cards come back", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  await loadExtendedDataset(page)
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // Selections are recorded THROUGH THE PUBLIC EVENT: it is what proves a real
  // container received the tap, rather than some internal state exposed for the
  // test. An aggregate, for its part, emits nothing — which is precisely what
  // tells the two regimes apart here.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
  const selectedCount = (): Promise<number> =>
    page.evaluate(() => (window as any).__selected.length)
  const lastSelected = (): Promise<string | undefined> =>
    page.evaluate(() => (window as any).__selected.at(-1))

  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // --- 1. Above the threshold: the card is there and answers -----------------
  // `focus` frames the probe at scale 1, hence at LOD 0: the canvas centre IS
  // the centre of its card.
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)
  await page.mouse.click(cx, cy)
  await expect.poll(lastSelected).toBe(PROBE)

  // --- 2. Below the threshold: no more card, but a disc -----------------------
  // We start again from an empty selection, otherwise the selected card's ring
  // would stay painted and blur the image comparison below.
  await page.keyboard.press("Escape")
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)

  // Zoom is anchored on the POINTER: zooming out from the centre keeps the probe
  // there, and its aggregate's disc — which contains it by construction —
  // therefore still covers that point. 14 notches take the scale from 1 to
  // ~0.07, well below the LOD 2 threshold (0.15). Ctrl is indispensable: a bare
  // wheel pans the canvas, zooming demands an explicit modifier
  // (`classifyWheel`), the only signal a trackpad swipe never produces.
  await page.mouse.move(cx, cy)
  await page.keyboard.down("Control")
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(40)
  }
  await page.keyboard.up("Control")
  // A nudge of the mouse to wake hover up. Pixi only hit-tests its scene on
  // pointer events: the disc arrived UNDER a motionless cursor, so no
  // `pointerover` has been emitted yet. Without this wake-up the reference image
  // would be taken without hover and the post-click one WITH — the comparison
  // would measure hover ramping up instead of the selection's effect. Hover is
  // animated: it is then left to settle.
  await page.mouse.move(cx + 2, cy + 2)
  await page.mouse.move(cx, cy)
  await page.waitForTimeout(1200)

  const before = await page.locator("canvas").screenshot()
  const marker = await selectedCount()
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(400)

  // The probe's card is no longer drawn: nothing received the tap on the card
  // side. This is the "never cards AND discs together" invariant, observed
  // through the only channel that does not lie.
  expect(await selectedCount()).toBe(marker)

  // …but something really was designated: selecting an aggregate lights its disc
  // up and pushes back everything that does not talk to it, so the scene
  // changes.
  const afterClick = await page.locator("canvas").screenshot()
  expect(afterClick.equals(before)).toBe(false)

  // And it comes undone: Escape gives back exactly the pre-click image. Without
  // the semantic regime that click would have landed on a card and this equality
  // would not hold.
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
  const afterEscape = await page.locator("canvas").screenshot()
  expect(afterEscape.equals(before)).toBe(true)

  // --- 3. Back above the threshold: the cards return -------------------------
  // `focus` from the semantic regime must redo the whole chain: camera to scale
  // 1, LOD change, rebuild, materialization of the targeted card. It is the path
  // search takes as well.
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)
  await page.mouse.click(cx, cy)
  await expect.poll(lastSelected).toBe(PROBE)
  expect(await selectedCount()).toBe(marker + 1)

  expect(errors).toEqual([])
})
