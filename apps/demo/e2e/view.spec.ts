import { test, expect, type Page } from "@playwright/test"

/**
 * The view toggle cannot be covered by a renderer unit test: no test in
 * `packages/renderer` mounts `createDataGraph` (no DOM, no jsdom configured),
 * and mocking Pixi would prove nothing. So this is where the durable proof of
 * the graph view's behavior lives.
 *
 * Same wake-up as `smoke.spec.ts`: we await the public `ready` promise, not
 * merely the existence of `window.__graph`, which is assigned synchronously at
 * module load long before the graph is built and laid out.
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

// The demo's config declares `groups: ["Customer", "Product"]` (see
// `src/sample-data.ts`), but its default dataset holds only 8 entities: the
// tests below inject via `setData` datasets calibrated for what they prove, with
// their OWN single-root config — they are about the view toggle and the
// counters, not about arbitration between roots, which is covered on the core
// side (`aggregate.test.ts`). The file's last test, for its part, works on the
// demo's real extended dataset and its real config, with no injection. Two
// aggregates (one per Customer), five entities in total, all visible in graph
// view: it folds nothing.
const data = {
  customers: [
    { id: "c1", name: "Dupont", address: { city: "Paris" } },
    { id: "c2", name: "Martin" },
  ],
  orders: [
    { id: "o1", customerId: "c1", total: 99.5 },
    { id: "o2", customerId: "c1", total: 12 },
    { id: "o3", customerId: "c2", total: 4 },
  ],
}

const config = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

async function loadAggregateData(page: Page): Promise<void> {
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

test("setView bascule entre structure et graphe, et revient", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  await loadAggregateData(page)

  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
  // The graph view shows entities only: 2 customers + 3 orders.
  expect(await visibleCount(page)).toBe(5)

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
})

test("basculer avec un noeud imbrique selectionne ne casse rien", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await loadAggregateData(page)

  // An object nested under an entity does not exist in the graph view: the
  // toggle must move the selection onto the Customer that contains it. The
  // RESULT of that move is not observable from outside (no selection getter, and
  // `setView` does not emit "select"), so this test only covers the fact that
  // this path runs without breaking; the function itself is covered by a unit
  // test in `packages/renderer/test/view.test.ts` (`nearestEntityAncestor`).
  await page.evaluate(() => (window as any).__graph.select("/customers/0/address"))
  await expect(page.locator("#selection-path")).toContainText("/customers/0/address")

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await visibleCount(page)).toBe(5)
  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(errors).toEqual([])
})

test("expand() de la vue structure ne deplace rien en vue graphe", async ({ page }) => {
  await gotoReady(page)

  // Six customers, each with an address: in the STRUCTURE view's layout,
  // expanding /customers/0 shifts /customers/1 down by 19 px (measured on the
  // ELK engine). This is the necessary condition of the defect tested here —
  // with a smaller dataset no position moves and the test would prove nothing.
  const wide = {
    customers: Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: `Client ${i}`,
      address: { city: "Paris", street: "rue", zip: "75000" },
    })),
    orders: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, customerId: `c${i}`, total: i })),
  }
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [wide, config],
  )
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await visibleCount(page)).toBe(12)

  // `expand`/`collapse` act on the containment tree. In graph view their effect
  // must be strictly invisible: their position animation starts from STRUCTURE
  // view rects and, if not neutralized, teleports the cards towards the other
  // frame while leaving envelopes, edges and click zones in place. So we compare
  // the canvas before/after, to the pixel.
  const before = await page.locator("canvas").screenshot()
  await page.evaluate(() => (window as any).__graph.expand("/customers/0"))
  // Longer than TRANSITION_MS (200 ms): a stray animation would have finished.
  await page.waitForTimeout(600)
  const after = await page.locator("canvas").screenshot()

  expect(after.equals(before)).toBe(true)
  expect(await visibleCount(page)).toBe(12)
})

test("un setData concurrent d'un setView laisse des compteurs coherents", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await loadAggregateData(page)

  // `setView("graph")` lasts a dynamic import plus a force pass: a `setData` can
  // land during it. Whichever wins, the published state must describe the SAME
  // graph — the defect fixed here published a layout computed on the old one.
  const other = {
    customers: Array.from({ length: 5 }, (_, i) => ({ id: `k${i}` })),
    orders: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, customerId: `k${i}` })),
  }
  const out = await page.evaluate(
    async ([d, c]: any[]) => {
      const g = (window as any).__graph
      const switching = g.setView("graph")
      await g.setData(d, c)
      await switching
      return { view: g.currentView(), stats: g.stats() }
    },
    [other, config],
  )

  expect(out.stats.logicalNodeCount).toBe(28)
  // 11 CARDS in structure view: the root plus 10 entities. The two arrays
  // `customers` and `orders` are elided — they are two ROWS of the root card,
  // not two cards — and `stats()` counts what is drawn. `logicalNodeCount`, for
  // its part, does not move: the array node still exists. 10 entities in graph
  // view. Before the fix: 5, inherited from the previous graph.
  expect(out.stats.visibleNodeCount).toBe(out.view === "graph" ? 10 : 11)
  expect(errors).toEqual([])
})

test("la vue graphe tient sur le jeu de donnees etendu de la demo", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)

  // The other tests in this file inject tiny datasets (5 and 12 entities): none
  // puts the graph view under load. Yet it is the extended dataset that motivates
  // this whole view — its 1:21 bbox ratio in structure view is what the view
  // exists to fix — and it is the only place where the separation pass, envelope
  // overlap and layout time really work. The demo's config already declares
  // `groups: ["Customer", "Product"]`, so the dataset toggle button suffices —
  // now tucked into the ⋮ menu of the floating cluster.
  await page.click("#menu-toggle")
  await page.click("#toggle-dataset")
  // The click only starts an async handler. We wait on the counter rather than
  // on the button's label: it is the proof that `setData` has finished both
  // building AND laying out the new dataset, and it depends on no interface
  // string.
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.stats().logicalNodeCount), {
      timeout: 30_000,
    })
    // `bigShop(4000)` produces EXACTLY 4061 logical nodes: 5 for the skeleton
    // (root + 4 arrays), 8 categories at 3, 30 products at 7, 78 customers at 10
    // and 234 orders at 13. An exact figure rather than a threshold, so that any
    // drift of the generator shows here.
    .toBe(4061)
  const logical = await page.evaluate(() => (window as any).__graph.stats().logicalNodeCount)

  const ms = await page.evaluate(async () => {
    const t0 = performance.now()
    await (window as any).__graph.setView("graph")
    return performance.now() - t0
  })

  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")

  // The demo's `bigShop(4000)` produces 78 customers, 234 orders, 30 products
  // and 8 categories: 350 entities, all visible since the graph view folds
  // nothing. It shows ONLY entities, so this is exactly the expected count — an
  // exact figure rather than a bound, so that any drift of the fixture shows.
  expect(await visibleCount(page)).toBe(350)

  // Reframing and rendering under load: the canvas must stay painted, and
  // nothing must have been thrown into the console.
  await expect(page.locator("canvas")).toBeVisible()
  expect(errors).toEqual([])

  // Time measured along the way: dynamic import of the chunk, two-level layout
  // (intra-aggregate packing + simulation over the discs) and rendering.
  //
  // No tight assertion, and the ceiling does not move: the CI machine is not the
  // developer's, and this wide ceiling is only there to catch an outright
  // collapse. What it is worth has changed, though, and that is measured right
  // here, in this test, on this machine, in isolated runs (3 each): the old
  // engine (fcose + separateOverlaps + separateClusters) came out at
  // 4310-4484 ms, the two-level engine comes out at 220-252 ms — roughly x19.
  // The 30 s ceiling covered the old one with a factor of 7; it covers far more
  // today, so it stays useful without needing to be tightened again.
  expect(ms).toBeLessThan(30_000)
  console.log(`[e2e] setView("graph") sur ${logical} noeuds logiques / 350 entites : ${ms.toFixed(0)} ms`)

  // Back to structure view: the toggle must stay reversible at this scale.
  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  expect(errors).toEqual([])
})
