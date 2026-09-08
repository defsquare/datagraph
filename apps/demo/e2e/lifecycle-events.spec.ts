import { test, expect, type Page } from "@playwright/test"

/** Same readiness protocol as `smoke.spec.ts`: `window.__graph` exists long
 * before `createDataGraph`'s async init has finished, so we await the public
 * `ready` promise rather than the handle. */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

/** Installs counters on the window so assertions read them after the fact —
 * a listener registered inside `page.evaluate` cannot report back otherwise. */
async function countEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any
    w.__events = { deselect: 0, statschange: 0 }
    w.__graph.on("deselect", () => w.__events.deselect++)
    w.__graph.on("statschange", () => w.__events.statschange++)
  })
}

test("deselect fires once, and only when a selection existed", async ({ page }) => {
  await gotoReady(page)
  await countEvents(page)

  // No selection yet: Escape must stay silent.
  await page.keyboard.press("Escape")
  expect(await page.evaluate(() => (window as any).__events.deselect)).toBe(0)

  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await page.keyboard.press("Escape")
  expect(await page.evaluate(() => (window as any).__events.deselect)).toBe(1)

  // A second Escape has nothing left to clear.
  await page.keyboard.press("Escape")
  expect(await page.evaluate(() => (window as any).__events.deselect)).toBe(1)
})

test("statschange fires when the visible set changes, not on a bare repaint", async ({ page }) => {
  await gotoReady(page)
  await countEvents(page)

  await page.evaluate(async () => { await (window as any).__graph.expand("/customers/0") })
  const afterExpand = await page.evaluate(() => (window as any).__events.statschange)
  expect(afterExpand).toBeGreaterThan(0)

  // A theme change repaints everything and changes no count.
  await page.evaluate(() => {
    (window as any).__graph.setTheme({ accent: { selection: "#00ff00" } });
  })
  expect(await page.evaluate(() => (window as any).__events.statschange)).toBe(afterExpand)
})

test("the event names are the four the contract promises", async ({ page }) => {
  await gotoReady(page)
  // `on` returns an unsubscribe function for every declared name; an unknown
  // name is not rejected at runtime (the emitter is generic), so this only
  // guards that the four documented names are wired without throwing.
  const ok = await page.evaluate(() => {
    const g = (window as any).__graph
    return ["select", "followRef", "deselect", "statschange"]
      .every((n) => typeof g.on(n, () => {}) === "function")
  })
  expect(ok).toBe(true)
})
