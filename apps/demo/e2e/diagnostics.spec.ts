import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

/** The reduced dataset carries exactly one diagnostic: the GHOST ref on `#o2`
 * (`/orders/1`). Both assertions below lean on that count. */
test("the diagnostics link opens the panel and lists the diagnostic", async ({ page }) => {
  await gotoReady(page)
  await expect(page.locator("#stat-diagnostics")).toContainText("1 diagnostic")

  await page.click("#stat-diagnostics")
  await expect(page.locator("#detail")).toBeVisible()
  await expect(page.locator("#selection-label")).toHaveText("Diagnostics")
  await expect(page.locator("#selection-rows .row")).toHaveCount(1)
  await expect(page.locator("#selection-rows")).toContainText("dangling-ref")
})

test("a diagnostic entry selects and frames the offending node", async ({ page }) => {
  await gotoReady(page)
  await page.click("#stat-diagnostics")
  await page.click("#selection-rows .diag-entry")

  // Clicking an entry hands the panel back to the selection: last render wins.
  await expect(page.locator("#selection-label")).toContainText("#o2")
  await expect(page.locator("#selection-path")).toContainText("/orders/1")
})

test("a later select re-renders the panel in detail mode", async ({ page }) => {
  await gotoReady(page)
  await page.click("#stat-diagnostics")
  await expect(page.locator("#selection-label")).toHaveText("Diagnostics")

  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
  await expect(page.locator("#selection-rows .diag-entry")).toHaveCount(0)
})
