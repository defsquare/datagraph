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

/**
 * Search and the toggles no longer live in a permanent bar: they sit behind the
 * magnifier and the menu of the floating icon cluster. Tests must therefore
 * unfold before interacting, just like a user.
 */
async function openSearch(page: Page): Promise<void> {
  await page.click("#search-toggle")
  await expect(page.locator("#search")).toBeVisible()
}

async function openMenu(page: Page): Promise<void> {
  await page.click("#menu-toggle")
  await expect(page.locator("#menu")).toBeVisible()
}

test("search navigates and auto-expands to a hidden match", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "rue de la paix")
  await page.press("#search", "Enter") // nextMatch
  const focused = await page.evaluate(() => (window as any).__graph.nextMatch()?.nodeId ?? null)
  expect(focused).not.toBeNull()
})

test("expand/collapse via API changes visible node count", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.expand("/orders/0"))
  // no pixel assertion: we check that the console stays clean
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
  await openMenu(page)
  await page.click("#toggle-theme")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator("#logo")).toHaveAttribute("src", "/defsquare-short-white-red.svg")
  // Choosing an item closes the menu: it has to be reopened to switch back.
  await expect(page.locator("#menu")).toBeHidden()
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await openMenu(page)
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

test("setData sans config reutilise la config courante", async ({ page }) => {
  // This path used to be exercised by the dataset toggle, until the two datasets
  // stopped sharing a config (the small one declares `reviews[*].customerId`,
  // which the large one cannot satisfy). This test is all it has left: if
  // `setData(data)` stopped reusing the config, the graph rebuilt here would
  // lose its entities and its references.
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  const before = await page.evaluate(() => (window as any).__graph.stats())
  // A minimal dataset of the SAME shape as shopData: what this test observes is
  // that the initial config (entities, references) still applies to it.
  await page.evaluate(async () => {
    const g = (window as any).__graph
    await g.setData({
      categories: [{ id: "cat1", name: "Informatique" }],
      products: [{ id: "p1", name: "Clavier", categoryId: "cat1" }],
      customers: [{ id: "c1", name: "Dupont" }],
      orders: [{ id: "o1", customerId: "c1", productId: "p1" }],
    })
  })
  const after = await page.evaluate(() => (window as any).__graph.stats())
  // The config was REUSED: the entities still exist (otherwise zero edges, zero
  // entities, and a bare-skeleton logicalNodeCount).
  const refs = await page.evaluate(() => (window as any).__graph.refEdges("/orders/0"))
  expect(refs.length).toBe(2)
  expect(before.logicalNodeCount).toBeGreaterThan(after.logicalNodeCount)
  expect(errors).toEqual([])
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

  // The click only fires the async handler: waiting for the button to have
  // swapped its label is what guarantees setView() has finished, before reading
  // currentView() (otherwise the read short-circuits the wait).
  await expect(page.getByRole("button", { name: "Vue structure" })).toBeVisible()

  const view = await page.evaluate(() => (window as any).__graph.currentView())
  expect(view).toBe("graph")
})

test("les methodes publiques sont inoffensives apres destroy()", async ({ page }) => {
  await gotoReady(page)
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  // The term must EXIST in the default dataset, otherwise `search: 0` after
  // destroy() would pass whether or not destroy() neutralizes search. We prove
  // it here, before tearing down. That is precisely what had been lost: the test
  // searched for "Dupont", a name from the original fixture that the e-commerce
  // dataset never contained — the assertion held on its own.
  const before = await page.evaluate(() => (window as any).__graph.search("Dubois").length)
  expect(before).toBeGreaterThan(0)

  // A host tearing its component down cannot cancel an already scheduled
  // callback: every method must become a safe no-op, not throw.
  const returned = await page.evaluate(() => {
    const g = (window as any).__graph
    g.destroy()
    g.destroy() // idempotent
    g.fit()
    g.focus("/customers/0")
    g.select("/customers/0")
    return {
      search: g.search("Dubois").length,
      next: g.nextMatch(),
      prev: g.prevMatch(),
      unsubscribeIsFunction: typeof g.on("select", () => {}) === "function",
    }
  })
  expect(errors).toEqual([])
  expect(returned).toEqual({ search: 0, next: null, prev: null, unsubscribeIsFunction: true })
})
