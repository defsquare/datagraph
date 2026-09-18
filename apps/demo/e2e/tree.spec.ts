import { test, expect, type Page } from "@playwright/test"

/**
 * TREE VIEW — a containment re-derived from the references, with a machinery of
 * its own (ADR-0042, ADR-0043). Like `view.spec.ts`, this is the only place where
 * the switch can be proved end to end: no renderer unit test mounts
 * `createDataGraph`.
 *
 * The dataset is generated inline, like `view.spec.ts`'s, and it has the shape
 * the view exists for: a normalised export — flat tables joined by foreign keys,
 * whose JSON nesting is `root → table → row` and whose meaning is entirely in
 * the references. Its config declares a SINGLE root type, so the derived tree is
 * group → item → {relation, penalty} and the tables nobody claims (types,
 * venues) sit under the root as leaves.
 */
const GROUP_NAMES = ["A", "B", "C"]
const ITEMS_PER_GROUP = 2
const TYPE_COUNT = 5
const VENUE_COUNT = 2
const PENALTIES_PER_ITEM = 2

const groups = GROUP_NAMES.map((name, i) => ({
  id: `g${i + 1}`,
  ordre: i + 1,
  description: `Group ${name}`,
}))

const items = groups.flatMap((group, gi) =>
  Array.from({ length: ITEMS_PER_GROUP }, (_, k) => ({
    id: `i${gi + 1}-${k + 1}`,
    groupId: group.id,
    label: `Item ${GROUP_NAMES[gi]}${k + 1}`,
  })),
)

const types = Array.from({ length: TYPE_COUNT }, (_, i) => ({
  id: `t${i + 1}`,
  label: `Type ${i + 1}`,
}))

const venues = Array.from({ length: VENUE_COUNT }, (_, i) => ({
  id: `v${i + 1}`,
  name: `Venue ${i + 1}`,
}))

// The many-to-many join: 2 or 3 types per item, alternating, so the table is not
// a uniform multiple of the items. Each row carries TWO references, and only the
// one leading back to a declared root decides its parent.
const relations = items.flatMap((item, i) =>
  Array.from({ length: 2 + (i % 2) }, (_, k) => ({
    id: `r${i + 1}-${k + 1}`,
    itemId: item.id,
    typeId: types[(i + k) % TYPE_COUNT].id,
  })),
)

// A second child table, with an OPTIONAL reference: `venueId` is null on all but
// two rows, which is what keeps `venues` claimed by nobody.
const penalties = items.flatMap((item, i) =>
  Array.from({ length: PENALTIES_PER_ITEM }, (_, k) => ({
    id: `p${i + 1}-${k + 1}`,
    itemId: item.id,
    amount: 100 * (k + 1),
    venueId: i === 0 && k === 0 ? venues[0].id : i === 3 && k === 1 ? venues[1].id : null,
  })),
)

const data = { groups, items, types, relations, penalties, venues }

const config = {
  ids: {
    Group: "$.groups[*].id",
    Item: "$.items[*].id",
    Type: "$.types[*].id",
    Relation: "$.relations[*].id",
    Penalty: "$.penalties[*].id",
    Venue: "$.venues[*].id",
  },
  refs: [
    { from: "$.items[*].groupId", to: "$.groups[*].id" },
    { from: "$.relations[*].itemId", to: "$.items[*].id" },
    { from: "$.relations[*].typeId", to: "$.types[*].id" },
    { from: "$.penalties[*].itemId", to: "$.items[*].id" },
    { from: "$.penalties[*].venueId", to: "$.venues[*].id" },
  ],
  groups: ["Group"],
  rootLabel: "Registry",
}

// Every row of every table is an entity, and no row holds a nested object, so
// the tree graph is exactly the rows — MINUS its synthetic root, which the layout
// drops (see the assertion below).
const CARDS =
  groups.length +
  items.length +
  types.length +
  relations.length +
  penalties.length +
  venues.length

// Collapsing the SECOND group hides its own items and everything the references
// hung under them: their relations and their penalties. The group's card stays.
const collapsedItems = items.filter((i) => i.groupId === groups[1].id)
const collapsedItemIds = new Set(collapsedItems.map((i) => i.id))
const HIDDEN_BY_COLLAPSE =
  collapsedItems.length +
  relations.filter((r) => collapsedItemIds.has(r.itemId)).length +
  penalties.filter((p) => collapsedItemIds.has(p.itemId)).length

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

async function loadNormalised(page: Page): Promise<void> {
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
  await loadNormalised(page)
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await currentView(page)).toBe("tree")
  // The tree opens FULLY expanded: the groups, their items, and under those the
  // relations and the penalties, plus the two tables nothing claims. No nested
  // objects anywhere, so that is every node of the tree graph MINUS its synthetic
  // root, under the 300-card opening budget.
  //
  // CARDS AND NOT CARDS + 1, and that is the assertion: the root stays in the
  // model — the collapse state and the search index need a node to start from —
  // but the layout drops it, so no card is drawn for it and `stats()` does not
  // count it. `visibleNodeCount` reports what the user can COUNT ON SCREEN
  // (ADR-0003).
  expect(await visibleCount(page)).toBe(CARDS)

  // So the gesture worth proving is now the opposite one: collapsing the second
  // group takes its whole subtree with it — the items the references gave it, and
  // their relations and penalties. The collapse lays the whole tree out again, so
  // the count is only settled once its promise has resolved.
  await page.evaluate(async () => await (window as any).__graph.collapse("/groups/1"))
  expect(await visibleCount(page)).toBe(CARDS - HIDDEN_BY_COLLAPSE)

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await currentView(page)).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
})

test("the tree view lays out top-to-bottom without losing a card", async ({ page }) => {
  // The DOWN layout's GEOMETRY is proven in the core, on positions this API does
  // not expose: `packages/core/test/tree-layout.test.ts`. What is proven end to
  // end here is that the tree's own layout reaches the real ELK and that every
  // card survives each trip through it.
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadNormalised(page)

  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await visibleCount(page)).toBe(CARDS)

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await currentView(page)).toBe("tree")
  expect(await visibleCount(page)).toBe(CARDS)

  await page.evaluate(() => (window as any).__graph.fit())
  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
})

test("returning from graph view to structure swaps the folded graph back", async ({ page }) => {
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadNormalised(page)
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("tree"))
  expect(await visibleCount(page)).toBe(CARDS)

  // Graph view leaves the folded state alone; coming back to STRUCTURE — not to
  // the tree it was folded into — has to rebuild it from the source document.
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await currentView(page)).toBe("graph")

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await currentView(page)).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
})

test("the toolbar's three buttons switch views and mark the active one", async ({ page }) => {
  const errors = watchErrors(page)

  await gotoReady(page)
  await loadNormalised(page)

  const pressed = async () => ({
    structure: await page.locator("#view-structure").getAttribute("aria-pressed"),
    tree: await page.locator("#view-tree").getAttribute("aria-pressed"),
    graph: await page.locator("#view-graph").getAttribute("aria-pressed"),
  })

  await page.locator("#view-tree").click()
  await expect.poll(() => currentView(page)).toBe("tree")
  expect(await pressed()).toEqual({ structure: "false", tree: "true", graph: "false" })

  await page.locator("#view-graph").click()
  await expect.poll(() => currentView(page)).toBe("graph")
  // THE POINT of this test: the pressed state MOVES, it does not accumulate.
  expect(await pressed()).toEqual({ structure: "false", tree: "false", graph: "true" })

  await page.locator("#view-tree").click()
  await expect.poll(() => currentView(page)).toBe("tree")
  expect(await pressed()).toEqual({ structure: "false", tree: "true", graph: "false" })

  expect(errors).toEqual([])
})
