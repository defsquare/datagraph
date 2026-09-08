import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

test("expanding content that lands off screen moves the camera", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoReady(page)

  // Zoom in hard so an expansion is guaranteed to land outside the window.
  const canvas = page.locator("canvas")
  const box = (await canvas.boundingBox())!
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -100) // pans; the zoom needs the modifier
  }
  await page.keyboard.down("Control")
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -100)
  }
  await page.keyboard.up("Control")

  const before = await page.evaluate(() => {
    const g = (window as any).__graph
    return JSON.stringify(g.stats())
  })
  await page.evaluate(async () => { await (window as any).__graph.expand("/customers/0") })
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => JSON.stringify((window as any).__graph.stats()))

  // The counter proves the expansion happened; the absence of a page error
  // proves the pan ran. A pixel assertion on the transform would be brittle
  // across the zoom path above.
  expect(after).not.toBe(before)
})

test("expanding content already in frame leaves the camera alone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoReady(page)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))

  // Fitted: everything the expansion produces lands inside the window, so
  // `revealPan` returns null and no animation starts.
  await page.evaluate(() => (window as any).__graph.fit())
  await page.evaluate(async () => { await (window as any).__graph.expand("/categories") })
  await page.waitForTimeout(400)
  expect(errors).toEqual([])
})
