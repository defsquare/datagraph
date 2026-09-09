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

/**
 * `unresolved-reference` is the one code whose `path` is a config declaration,
 * not a node pointer (see the design note in the task brief and `Diagnostic`'s
 * doc comment in `model.ts`): it must render as a plain, unclickable row.
 *
 * `A` has one instance and no `bId` field on it at all — not even `null` — which
 * is what makes the declaration unsatisfied rather than merely dangling: per
 * `buildGraph` (`packages/core/src/build.ts`), a row that EXISTS but resolves to
 * nothing is `dangling-ref`; a declaration with no matching row anywhere, on a
 * type that does have instances, is `unresolved-reference`.
 */
test("an unresolved-reference diagnostic renders as an inert, non-clickable entry", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() =>
    (window as any).__graph.setData(
      { as: [{ id: "a1" }], bs: [{ id: "b1" }] },
      { ids: { A: "$.as[*].id", B: "$.bs[*].id" }, refs: [{ from: "$.as[*].bId", to: "$.bs[*].id" }] },
    ),
  )

  const diagnostics = await page.evaluate(() => (window as any).__graph.diagnostics())
  expect(diagnostics).toEqual([
    {
      code: "unresolved-reference",
      path: "$.as[*].bId",
      message: 'Reference "$.as[*].bId" declared on A matches no row on any A',
    },
  ])

  await page.click("#stat-diagnostics")
  await expect(page.locator("#selection-rows .row")).toHaveCount(1)
  await expect(page.locator("#selection-rows")).toContainText("unresolved-reference")
  await expect(page.locator("#selection-rows")).toContainText("matches no row on any A")

  // Readable, but inert: no button, no `.diag-entry` affordance.
  await expect(page.locator("#selection-rows .diag-entry")).toHaveCount(0)
  await expect(page.locator("#selection-rows button")).toHaveCount(0)
})

/**
 * The two kinds in ONE list, which is the only configuration where an
 * inconsistency between them shows. The navigable entries used to carry the
 * layout (and to lose the divider) on their own `.diag-entry` class, while the
 * inert ones kept the detail rows' three-column flex: one list, two shapes.
 *
 * `cs` declares a `bId` that points at nothing (`dangling-ref`, navigable — the
 * path is a node), `as` declares one no row carries at all
 * (`unresolved-reference`, inert — the path is a config declaration).
 */
test("both diagnostic kinds share one entry shape", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() =>
    (window as any).__graph.setData(
      { as: [{ id: "a1" }], bs: [{ id: "b1" }], cs: [{ id: "c1", bId: "ghost" }] },
      {
        ids: { A: "$.as[*].id", B: "$.bs[*].id", C: "$.cs[*].id" },
        refs: [
          { from: "$.as[*].bId", to: "$.bs[*].id" },
          { from: "$.cs[*].bId", to: "$.bs[*].id" },
        ],
      },
    ),
  )
  const codes = await page.evaluate(() =>
    (window as any).__graph.diagnostics().map((d: any) => d.code).sort(),
  )
  expect(codes).toEqual(["dangling-ref", "unresolved-reference"])

  await page.click("#stat-diagnostics")
  await expect(page.locator("#selection-rows .row")).toHaveCount(2)
  // The layout class is worn by BOTH; only one of them is a button.
  await expect(page.locator("#selection-rows .diag-body")).toHaveCount(2)
  await expect(page.locator("#selection-rows .diag-entry")).toHaveCount(1)
  await expect(page.locator("#selection-rows button")).toHaveCount(1)

  // The `dl`'s content model: `dt`, `dd` and `div` only — never a `button`.
  const children = await page.evaluate(() =>
    [...document.querySelectorAll("#selection-rows > *")].map((el) => el.tagName),
  )
  expect(children).toEqual(["DIV", "DIV"])
})

test("the fixture still carries the dangling reference these tests rest on", async ({ page }) => {
  await gotoReady(page)
  // If this ever goes empty, the test below would pass for the wrong reason:
  // no dangling edge means no `followRef` with `dangling: true` to react to.
  const broken = await page.evaluate(() =>
    (window as any).__graph.refEdges("/orders/1").filter((e: any) => e.dangling).length,
  )
  expect(broken).toBe(1)
})

test("the GHOST row on the card opens the diagnostics panel with its entry marked", async ({ page }) => {
  await gotoReady(page)
  await page.evaluate(() => (window as any).__graph.focus("/orders/1"))
  await page.waitForTimeout(400)

  // `focus` centres the CARD, not any particular row (`doFocus` → `camera.centerOn`
  // on the full card rect from `anchorRectFor`). `#o2` has 8 rows (id, customerId,
  // productId, quantity, total, status, payment, date) at `DEFAULT_METRICS`
  // (`headerHeight: 30, rowHeight: 19, paddingBottom: 7`), so its card is
  // 30 + 8*19 + 7 = 189px tall and its vertical centre sits at local y 94.5 from
  // the card's top. `customerId` is row index 1, its band [49, 68) centred at
  // 58.5 — 36px above the card's (and so the canvas's) centre. Row index 3
  // (`quantity`, centred at 94.5) is what a plain centre click lands on instead,
  // which is exactly what `culling.spec.ts` relies on to land on a non-ref row.
  const box = (await page.locator("canvas").boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 36)

  await expect(page.locator("#selection-label")).toHaveText("Diagnostics")
  await expect(page.locator("#selection-rows .diag-current")).toHaveCount(1)
})
