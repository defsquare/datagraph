import { test, expect, type Page } from "@playwright/test"

/**
 * An array is no longer a card: it is a ROW of its parent's card, whose value is
 * a `[ n items ]` token that collapses and expands its items.
 *
 * These cases live in e2e rather than in a unit test because they cross
 * everything the renderer assembles — click routing through `rowIndexAt`,
 * `CollapseState`, incremental layout, redraw — and because no test in
 * `packages/renderer` mounts `createDataGraph` (no DOM, no jsdom configured).
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

const TAGS = "/products/0/tags"

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

/**
 * Brings `arrayId`'s token to the centre of the viewport, then clicks it.
 *
 * `focus()` on an array centres ITS ROW BAND — an elided array has no rect of
 * its own — so the canvas centre lands on the token. That is what makes this
 * click robust with no hardcoded coordinate: no screenshot was used to calibrate
 * it, and a card changing height would not break it.
 *
 * The x coordinate is in fact irrelevant to routing: `rowIndexAt` only reads the
 * y. Centring it merely guarantees we stay within the card.
 */
async function clickToken(page: Page, arrayId: string): Promise<void> {
  await page.evaluate((id) => (window as any).__graph.focus(id), arrayId)
  await page.waitForTimeout(600)
  const box = (await page.locator("canvas").boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(600)
}

test("an array token expands one card per element, then collapses them", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  const before = await visibleCount(page)

  await clickToken(page, TAGS)
  // `tags` holds three SCALAR items: this is the case that used to render a
  // single card before this rework, scalars being rows of the array rather than
  // nodes.
  expect(await visibleCount(page)).toBe(before + 3)

  await clickToken(page, TAGS)
  expect(await visibleCount(page)).toBe(before)
  expect(errors).toEqual([])
})

test("an elided array does not count as a card", async ({ page }) => {
  await gotoReady(page)

  // The four root collections are elided and EXPANDED from the start: the root
  // plus the eight entities make nine cards. The four array nodes are indeed
  // visible — their rows are — but they are not drawn, and `stats()` counts what
  // is on screen.
  expect(await visibleCount(page)).toBe(9)

  const counts = await page.evaluate(() => {
    const g = (window as any).__graph
    return { logical: g.stats().logicalNodeCount }
  })
  // `logicalNodeCount`, for its part, does not move with elision: the array node
  // still exists, and a scalar item costs exactly what the row it replaces cost.
  // 78 = the original 76 + the two `customerId` rows added to the reviews for the
  // value-object-borne reference example.
  expect(counts.logical).toBe(78)
})

/**
 * An ENTITY nested inside an elided array stays fully present in graph view,
 * with no expansion needed.
 *
 * This is the invariant that makes elision safe, and it is not obvious at all:
 * one could believe that an array without a card hides what it contains. It
 * hides nothing, because the graph view does not find its entities by walking
 * down the containment tree — `entityIdsOf` sweeps every node — and because a
 * reference only ever originates from an entity (`buildGraph` ignores the other
 * nodes). A nested plain object therefore cannot hide a reference, and a nested
 * entity is never hidden.
 */
const nestedData = {
  customers: [{ id: "c1", name: "Dubois" }],
  orders: [
    {
      id: "o1",
      total: 10,
      lines: [
        { id: "l1", customerId: "c1", sku: "A-1" },
        { id: "l2", customerId: "c1", sku: "B-7" },
      ],
    },
  ],
}

const nestedConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    Line: "$.orders[*].lines[*].id",
  },
  refs: [{ from: "$.orders[*].lines[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

test("an entity nested in an elided array keeps its reference in graph view", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [nestedData, nestedConfig],
  )

  // The reference does exist on the nested entity, and it resolves.
  const line = await page.evaluate(() => (window as any).__graph.refEdges("/orders/0/lines/0"))
  expect(line).toHaveLength(1)
  expect(line[0].to).toBe("/customers/0")

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // Four entities: c1, o1, l1, l2. The two `Line`s sit in an array with no card,
  // and they are there all the same — that is the whole point of this test.
  expect(await visibleCount(page)).toBe(4)
  expect(errors).toEqual([])
})
