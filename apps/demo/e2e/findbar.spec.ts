import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

async function openSearch(page: Page): Promise<void> {
  await page.click("#search-toggle")
  await expect(page.locator("#search")).toBeVisible()
}

test("a query with results rests on 1/N", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "camille")
  // The counter is what proves the jump happened: `goToNextMatch` is the only
  // thing that moves the cursor off -1.
  await expect(page.locator("#match-counter")).toHaveText(/^1\/\d+$/)
})

test("a query with no result says so", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "zzzzzz")
  await expect(page.locator("#match-counter")).toHaveText("0 résultat")
})

test("an empty field leaves the counter empty", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "camille")
  await expect(page.locator("#match-counter")).toHaveText(/^1\//)
  await page.fill("#search", "")
  await expect(page.locator("#match-counter")).toHaveText("")
})
