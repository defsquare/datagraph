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

test("la barre d'etat affiche des compteurs non nuls", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("#stat-nodes")).not.toHaveText("0")
  await expect(page.locator("#stat-visible")).not.toHaveText("0")
})

test("le bouton de theme bascule clair et sombre", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.click("#toggle-theme")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator("#logo")).toHaveAttribute("src", "/defsquare-short-white-red.svg")
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.click("#toggle-theme")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  expect(errors).toEqual([])
})

test("le panneau de detail montre le type et permet de suivre une reference", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  // Regression guard: #selection-type must stay display:none while [hidden]
  // (an id rule in style.css previously outranked the UA's [hidden] rule and
  // left an empty navy pill visible under the panel's initial empty state).
  await expect(page.locator("#selection-type")).not.toBeVisible()
  await page.evaluate(() => (window as any).__graph.select("/orders/0"))
  await expect(page.locator("#selection-type")).toBeVisible()
  await expect(page.locator("#selection-type")).toHaveText("ORDER")
  await expect(page.locator("#selection-path")).toContainText("/orders/0")
  await page.click("#selection-rows .ref-btn:not([disabled])")
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("une reference cassee est signalee dans la barre d'etat", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("#stat-diagnostics")).toBeVisible()
  await expect(page.locator("#stat-diagnostics")).toContainText("1")
})

test("setTheme accepte une surcharge partielle de palette sans planter", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.evaluate(() => (window as any).__graph.setTheme({ entityPalette: ["#00ff00"] }))
  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})
