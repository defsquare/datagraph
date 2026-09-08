import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

test("arrows move the selection to a visible neighbour", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.select("/orders/0"))
  const first = await page.locator("#selection-path").textContent()

  await page.keyboard.press("ArrowDown")
  await expect(page.locator("#selection-path")).not.toHaveText(first!)
})

test("arrows do nothing without a selection", async ({ page }) => {
  await gotoReady(page)
  await page.keyboard.press("ArrowDown")
  await expect(page.locator("#detail")).toBeHidden()
})

test("arrows stay out of the way while typing in the findbar", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.select("/orders/0"))
  const before = await page.locator("#selection-path").textContent()

  await page.click("#search-toggle")
  await page.fill("#search", "camille")
  await page.press("#search", "ArrowDown")
  // The caret moved, the selection did not: a text field owns its arrows.
  await expect(page.locator("#selection-path")).toHaveText(before!)
})

test("Escape closes the menu first, the findbar next, and only then deselects", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await page.click("#search-toggle")
  await expect(page.locator("#findbar")).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.locator("#findbar")).toBeHidden()
  // One level at a time: the selection survives the Escape that closed the bar.
  // Asserted on `#detail`'s own hidden attribute rather than `#selection-label`'s
  // text: `clear()` (apps/demo/src/detail-panel.ts) only ever HIDES that label,
  // it never blanks its `textContent`, so a text assertion would read
  // "Customer #c1" whether or not the cascade bug deselected underneath it —
  // proven by running this test against the pre-fix `chrome.ts` and watching it
  // pass regardless.
  await expect(page.locator("#detail")).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.locator("#detail")).toBeHidden()
})

test("Enter on a selected container toggles it", async ({ page }) => {
  await gotoReady(page)
  const before = await page.locator("#stat-visible").textContent()
  // `/customers/0` is an entity card with a nested `address` object child, so
  // toggling it genuinely changes the visible count — unlike `/categories`,
  // an elided array container already auto-expanded within the initial card
  // budget (`CollapseState`'s constructor), where `toggleExpand` would collapse
  // it back to the SAME count it started at only by coincidence, and expanding
  // an already-expanded container is a no-op in `doExpand`.
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await page.keyboard.press("Enter")
  await expect(page.locator("#stat-visible")).not.toHaveText(before!)
})
