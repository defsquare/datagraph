import { test, expect, type Page } from "@playwright/test"

/**
 * The structure view's scale policy, proven end to end.
 *
 * Every brick has its unit tests — the opening budget and pagination on pure
 * data in `packages/core/test/collapse.test.ts`, the remainder tokens and the
 * `focus` cascade on the renderer side. What CANNOT be proven there, no package
 * test mounting `createDataGraph`, is the CHAIN: a document no human would open
 * flat opens bounded, paginates on a gesture, lets search dig deep into it, and
 * survives a "Ranger" (tidy).
 *
 * The only channel that proves a card really exists in the scene is the pointer
 * — a missing Pixi container does not answer the hit-test. So, as in
 * `culling.spec.ts`, we lean on the framing invariant: after `focus`, the canvas
 * centre IS the centre of the targeted card, so a click there can only select
 * it, and only if it is drawn.
 */

/** ~9,000 logical nodes: 3,000 objects (30 × PAGE_SIZE, ten times the opening
 * budget) plus their two scalars each. Enough for the policy to be forced to
 * bite, few enough for CI to stay fast. */
const data = {
  items: Array.from({ length: 3000 }, (_, i) => ({ id: `it${i}`, name: `Item ${i}` })),
}

/** No entity: the graph view would have nothing to show, so the structure view
 * stays current. This is exactly the CLI mode's config on a raw document, the
 * one this policy exists to make openable. */
const config = { ids: {} }

/** What `CollapseState` reveals in one go — one page of siblings. The deltas
 * expected below are expressed with it, so that any drift of the constant reads
 * here as a talkative failure rather than as a wrong magic number. */
const PAGE_SIZE = 100

/** The last card of the first page, the one the `+ 2900` token hangs under:
 * `hiddenGaps` anchors the token on the last card LAID OUT before the gap. */
const LAST_OF_FIRST_PAGE = "/items/99"

async function openBigDocument(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  // `ready` and not merely the handle's presence: `__graph` is set synchronously
  // at module load, long before the async init (build, fonts, layout, first
  // render) has finished — a `setData` racing ahead of it would be swallowed
  // silently.
  await page.evaluate(() => (window as any).__graph.ready)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
  // Selections are recorded THROUGH THE PUBLIC EVENT: it is what proves a real
  // container received the tap, rather than some internal state exposed for the
  // test.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
}

function stats(page: Page): Promise<{ logicalNodeCount: number; visibleNodeCount: number }> {
  return page.evaluate(() => (window as any).__graph.stats())
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

async function canvasCenter(page: Page): Promise<{ cx: number; cy: number }> {
  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  return { cx: box!.x + box!.width / 2, cy: box!.y + box!.height / 2 }
}

/**
 * Waits for `id` to be FRAMED AND DRAWN, retrying the click at the centre until
 * it selects it.
 *
 * The click sits inside the poll, not before it: `focus()` returns immediately,
 * its cascade of reveals and its framing follow, and a click fired too early at
 * the centre of the moment would not designate the target — waiting by the clock
 * would mean betting on the duration of a layout we do not control.
 *
 * Replaying the click is harmless, and that is what makes this poll legitimate:
 * `select` touches neither `opGen` nor the camera (`doSelect`), so it cannot
 * disturb the operation it is waiting on. A click off target selects at worst a
 * neighbouring card, which the next iteration corrects.
 */
async function proveDrawnAtCenter(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const { cx, cy } = await canvasCenter(page)
        await page.mouse.click(cx, cy)
        return page.evaluate(() => (window as any).__selected.at(-1))
      },
      { timeout: 20_000 },
    )
    .toBe(id)
}

/**
 * Frames the last card of the first page, then clicks the `+ n` token hanging
 * just below it.
 *
 * The token is not a node: it has neither a public id nor a `focus()`, and its
 * position depends on the card height MEASURED at runtime (the browser's real
 * fonts). Pinning a y coordinate would therefore pin a metric we do not control.
 * Instead we sweep the narrow band following the framed card — `anchor.y +
 * anchor.height + GAP`, some thirty pixels under its bottom edge at scale 1 —
 * and stop at the FIRST click that reveals, otherwise the sweep would keep
 * paginating afterwards.
 *
 * Clicking off target is harmless: at worst a card selection or a click into the
 * void, neither of which changes the visible count.
 */
async function revealByToken(page: Page, anchorId: string): Promise<boolean> {
  await page.evaluate((id) => (window as any).__graph.focus(id), anchorId)
  // The framing is awaited through its PROOF, not through a delay: as long as
  // the anchor card does not answer at the centre, the token's y is not yet the
  // one we are about to sweep.
  await proveDrawnAtCenter(page, anchorId)
  const { cx, cy } = await canvasCenter(page)
  const before = await visibleCount(page)
  for (let dy = 30; dy <= 78; dy += 3) {
    await page.mouse.click(cx, cy + dy)
    // The only fixed delay left here, and it carries no stakes: a reveal that
    // takes longer to show is simply observed on the next iteration, the
    // comparison being made against the count from BEFORE the sweep.
    await page.waitForTimeout(250)
    if ((await visibleCount(page)) > before) return true
  }
  return false
}

test("a large document opens bounded and paginates on clicking a token", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)

  // Without entities no toggle is possible: it really is the structure view that
  // carries everything that follows.
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")

  const opened = await stats(page)
  // The WHOLE document is there — the logical graph folds nothing.
  expect(opened.logicalNodeCount).toBeGreaterThan(5000)
  // But the opening stops at the budget: two orders of magnitude lower. That is
  // the entire policy, in one inequality.
  expect(opened.visibleNodeCount).toBeLessThan(500)

  // The pagination gesture: the remainder token reveals EXACTLY one page.
  expect(await revealByToken(page, LAST_OF_FIRST_PAGE)).toBe(true)
  const paginated = await stats(page)
  expect(paginated.visibleNodeCount).toBe(opened.visibleNodeCount + PAGE_SIZE)
  // Revealing builds nothing: the logical graph is the same document.
  expect(paginated.logicalNodeCount).toBe(opened.logicalNodeCount)

  expect(errors).toEqual([])
})

test("search reveals a deep page and centers the target", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)
  const opened = await stats(page)

  // Item 2777 lives on the 28th page of its sibling list: neither its expanded
  // parent nor the first revealed page shows it. This is the case the `focus`
  // cascade has to cover — expanding the ancestors IS NO LONGER ENOUGH since
  // pagination.
  const target = "/items/2777"
  const results = await page.evaluate(() => (window as any).__graph.search("Item 2777"))
  expect(results.length).toBeGreaterThan(0)
  // The term designates a single node: the centre click below therefore has only
  // one possible answer.
  expect([...new Set(results.map((r: any) => r.nodeId))]).toEqual([target])

  const first = await page.evaluate(() => (window as any).__graph.nextMatch())
  expect(first.nodeId).toBe(target)

  // `nextMatch()` returns its result without waiting for the framing: revealing
  // the page is a sequence of awaited layouts, watched through the counter
  // rather than by the clock.
  await expect
    .poll(() => visibleCount(page), { timeout: 20_000 })
    .toBeGreaterThan(opened.visibleNodeCount)

  const revealed = await stats(page)
  // Reaching the 2777th child does NOT cost 2,778 cards: only its page is open.
  // This is the invariant that makes deep search usable.
  expect(revealed.visibleNodeCount).toBeLessThan(800)
  expect(revealed.visibleNodeCount).toBe(opened.visibleNodeCount + PAGE_SIZE)

  // Proof of the reveal through the only channel that does not lie: the camera
  // jumped onto the target, and found it drawn on arrival.
  await proveDrawnAtCenter(page, target)

  expect(errors).toEqual([])
})

test("tidy keeps a consistent view after reveals", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)
  const opened = await stats(page)

  // Two reveals FAR APART from each other: precisely the drifted state `tidy()`
  // exists to repair — two blocks inserted into a layout no global computation
  // has ever seen whole.
  //
  // Each reveal is awaited through TWO polls, no fixed delay. The first watches
  // the counter: the page is then DECIDED. The second watches the pointer: the
  // layout is then LAID OUT and drawn.
  //
  // The second one is not zeal. Between the two, `collapseState` has already
  // revealed the page but `engine.layoutAfterReveal` is still in flight, and any
  // operation incrementing `opGen` during that flight — the next `nextMatch()`,
  // the click on "Ranger" — makes the cascade bail out, which then UNDOES its
  // own reveal (`doFocus`, `gen !== opGen` branch). Stopping at the counter
  // would therefore leave a race that removes every other page.
  const reveals = [
    ["Item 2777", "/items/2777"],
    ["Item 1500", "/items/1500"],
  ] as const
  for (const [term, target] of reveals) {
    const before = await visibleCount(page)
    await page.evaluate((q) => (window as any).__graph.search(q), term)
    await page.evaluate(() => (window as any).__graph.nextMatch())
    await expect.poll(() => visibleCount(page), { timeout: 20_000 }).toBe(before + PAGE_SIZE)
    await proveDrawnAtCenter(page, target)
  }
  const drifted = await stats(page)
  expect(drifted.visibleNodeCount).toBe(opened.visibleNodeCount + 2 * PAGE_SIZE)

  await page.click("#tidy")
  // The click only starts an async handler: `tidy()` redoes the COMPLETE layout
  // of everything visible, then frames and animates. We give it slack — the
  // assertion that follows only holds on a settled layout.
  await page.waitForTimeout(3000)

  const tidied = await stats(page)
  // Tidy changes neither the document nor what is expanded: it is a
  // repositioning, not a collapse operation.
  expect(tidied.logicalNodeCount).toBe(opened.logicalNodeCount)
  expect(tidied.visibleNodeCount).toBe(drifted.visibleNodeCount)

  // And the view stays ALIVE: the card revealed before tidying still answers the
  // pointer, at its new place. A `tidy()` that had published a layout without
  // rebuilding the cards would leave this click hitting nothing.
  await page.evaluate(() => (window as any).__graph.focus("/items/2777"))
  await proveDrawnAtCenter(page, "/items/2777")

  expect(errors).toEqual([])
})
