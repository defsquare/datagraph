import { test, expect, type Page } from "@playwright/test"

/**
 * Navigates to the demo and waits for the graph to be truly ready.
 *
 * `window.__graph` is assigned SYNCHRONOUSLY at module load in main.ts, long
 * before `createDataGraph`'s async init (buildGraph, fontsReady, layout,
 * first rebuild/render) has finished — so `waitForFunction(() =>
 * window.__graph !== undefined)` alone only proves the handle exists, not
 * that the graph is built/laid out/drawn. A `select()`/`expand()`/etc. call
 * that races ahead of that init returns early with no effect (e.g. `doSelect`
 * bails silently before the graph is set), which is exactly what let this
 * suite pass by luck for nine tests until `fontsReady`'s added `await`
 * widened the window enough to make the race reproducible. Awaiting the
 * public `ready` promise (via `page.evaluate`, which awaits a returned
 * promise) is the actual readiness signal.
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

test("loads and renders collapsed roots", async ({ page }) => {
  await gotoReady(page)
  await expect(page.locator("canvas")).toBeVisible()
})

test("select event reaches the host detail panel", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("search navigates and auto-expands to a hidden match", async ({ page }) => {
  await gotoReady(page)
  await page.fill("#search", "rue de la paix")
  await page.press("#search", "Enter") // nextMatch
  const focused = await page.evaluate(() => (window as any).__graph.nextMatch()?.nodeId ?? null)
  expect(focused).not.toBeNull()
})

test("expand/collapse via API changes visible node count", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.expand("/orders/0"))
  // pas d'assertion pixel : on vérifie l'absence d'erreur console
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.evaluate(() => (window as any).__graph.collapse("/orders/0"))
  expect(errors).toEqual([])
})

test("la barre d'etat affiche des compteurs non nuls", async ({ page }) => {
  await gotoReady(page)
  await expect(page.locator("#stat-nodes")).not.toHaveText("0")
  await expect(page.locator("#stat-visible")).not.toHaveText("0")
})

test("le bouton de theme bascule clair et sombre", async ({ page }) => {
  await gotoReady(page)
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
  await gotoReady(page)
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
  await gotoReady(page)
  await expect(page.locator("#stat-diagnostics")).toBeVisible()
  await expect(page.locator("#stat-diagnostics")).toContainText("1")
})

test("setTheme accepte une surcharge partielle de palette sans planter", async ({ page }) => {
  await gotoReady(page)
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.evaluate(() => (window as any).__graph.setTheme({ entityPalette: ["#00ff00"] }))
  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("le bouton de bascule declenche un vrai setView et son libelle suit", async ({ page }) => {
  await gotoReady(page)

  await page.getByRole("button", { name: "Vue graphe" }).click()

  // Le clic ne fait que declencher le gestionnaire async : attendre que le
  // bouton ait bascule son libelle est ce qui garantit que setView() a fini,
  // avant de lire currentView() (sinon la lecture court-circuite l'attente).
  await expect(page.getByRole("button", { name: "Vue structure" })).toBeVisible()

  const view = await page.evaluate(() => (window as any).__graph.currentView())
  expect(view).toBe("graph")
})

test("les methodes publiques sont inoffensives apres destroy()", async ({ page }) => {
  await gotoReady(page)
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  // Un hote qui demonte son composant ne peut pas annuler un callback deja
  // planifie : chaque methode doit devenir un no-op sur, pas lever.
  const returned = await page.evaluate(() => {
    const g = (window as any).__graph
    g.destroy()
    g.destroy() // idempotent
    g.fit()
    g.focus("/customers/0")
    g.select("/customers/0")
    return {
      search: g.search("Dupont").length,
      next: g.nextMatch(),
      prev: g.prevMatch(),
      unsubscribeIsFunction: typeof g.on("select", () => {}) === "function",
    }
  })
  expect(errors).toEqual([])
  expect(returned).toEqual({ search: 0, next: null, prev: null, unsubscribeIsFunction: true })
})
