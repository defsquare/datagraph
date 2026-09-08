import { test, expect, chromium } from "@playwright/test"

for (const dpr of [1, 2]) {
  test(`the canvas backing store matches a device scale factor of ${dpr}`, async () => {
    const browser = await chromium.launch()
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1000, height: 700 } })
    const page = await context.newPage()
    await page.goto("http://localhost:5173/")
    await page.waitForFunction(() => (window as any).__graph !== undefined)
    await page.evaluate(() => (window as any).__graph.ready)

    const ratio = await page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement
      return c.width / c.getBoundingClientRect().width
    })
    // `resolution` is capped at 2 by `createDataGraph`.
    expect(ratio).toBeCloseTo(Math.min(dpr, 2), 1)
    await browser.close()
  })
}
