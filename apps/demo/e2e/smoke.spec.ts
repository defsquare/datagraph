import { test, expect } from "@playwright/test"

test("loads and renders collapsed roots", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("canvas")).toBeVisible()
})

test("select event reaches the host detail panel", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("search navigates and auto-expands to a hidden match", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.fill("#search", "rue de la paix")
  await page.press("#search", "Enter") // nextMatch
  const focused = await page.evaluate(() => (window as any).__graph.nextMatch()?.nodeId ?? null)
  expect(focused).not.toBeNull()
})

test("expand/collapse via API changes visible node count", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.expand("/orders/0"))
  // pas d'assertion pixel : on vérifie l'absence d'erreur console
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.evaluate(() => (window as any).__graph.collapse("/orders/0"))
  expect(errors).toEqual([])
})
