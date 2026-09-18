import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

/**
 * TREE VIEW — the structure view's machinery over a containment re-derived from
 * the references. Like `view.spec.ts`, this is the only place where the switch
 * can be proved end to end: no renderer unit test mounts `createDataGraph`.
 *
 * The dataset is the committed `fixtures/sanctions.*`, read from disk rather
 * than copied, and it is the reason the view exists: six flat tables joined by
 * foreign keys, whose JSON nesting is `root → table → row` and whose meaning is
 * entirely in the references. Its `groups` declares a single root type, so the
 * derived tree is groupe → infraction → {relation, sanction financière} and the
 * tables nobody claims sit under the root.
 */
const data = JSON.parse(readFileSync(new URL("../fixtures/sanctions.json", import.meta.url), "utf8"))
const config = JSON.parse(
  readFileSync(new URL("../fixtures/sanctions.config.json", import.meta.url), "utf8"),
)

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

async function loadSanctions(page: Page): Promise<void> {
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
}

function currentView(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__graph.currentView())
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })
  return errors
}

test("setView('tree') folds the tables into a hierarchy, and back", async ({ page }) => {
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadSanctions(page)
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await currentView(page)).toBe("tree")
  // The tree opens FULLY expanded: the synthetic root, the 5 groups, their 14
  // infractions, and under those the 98 relations and 52 financial sanctions,
  // plus the two tables nothing claims — 23 sanction types and 14 competitions.
  // No nested objects anywhere, so that is EVERY node of the tree graph: 207
  // cards, under the 300-card opening budget.
  expect(await visibleCount(page)).toBe(207)

  // So the gesture worth proving is now the opposite one: collapsing the second
  // group takes its whole subtree with it — the 5 infractions the references
  // gave it, and their 28 relations and 20 financial sanctions.
  await page.evaluate(() => (window as any).__graph.collapse("/groupesInfraction/1"))
  expect(await visibleCount(page)).toBe(207 - 53)

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await currentView(page)).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
})

test("returning from graph view to structure swaps the folded graph back", async ({ page }) => {
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadSanctions(page)
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await visibleCount(page)).toBe(207)

  // Graph view leaves the folded state alone; coming back to STRUCTURE — not to
  // the tree it was folded into — has to rebuild it from the source document.
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await currentView(page)).toBe("graph")

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await currentView(page)).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
})

test("the chrome reaches the tree view and the toggle remembers it", async ({ page }) => {
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadSanctions(page)

  await page.locator("#menu-toggle").click()
  await page.locator("#toggle-tree").click()
  await expect.poll(() => currentView(page)).toBe("tree")
  // In a folded view the toggle offers the graph.
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "graph")

  await page.locator("#toggle-view").click()
  await expect.poll(() => currentView(page)).toBe("graph")
  // THE POINT of this test: the toggle now offers the tree, not structure.
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "tree")

  await page.locator("#toggle-view").click()
  await expect.poll(() => currentView(page)).toBe("tree")
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "graph")

  expect(errors).toEqual([])
})
