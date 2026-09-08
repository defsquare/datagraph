import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

async function openSearch(page: Page): Promise<void> {
  await page.click("#search-toggle")
  await expect(page.locator("#search")).toBeVisible()
}

test("a query with results rests on 1/N", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "camille")
  // The counter is what proves the jump happened: `goToNextMatch` is the only
  // thing that moves the cursor off -1.
  await expect(page.locator("#match-counter")).toHaveText(/^1\/\d+$/)
})

test("a query with no result says so", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "zzzzzz")
  await expect(page.locator("#match-counter")).toHaveText("0 résultat")
})

test("an empty field leaves the counter empty", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "camille")
  await expect(page.locator("#match-counter")).toHaveText(/^1\//)
  await page.fill("#search", "")
  await expect(page.locator("#match-counter")).toHaveText("")
})

test("Enter pressed inside the debounce window steps once, not twice", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  // `page.fill` then `page.press` are two separate CDP round-trips: on a loaded
  // machine the 150ms debounce can elapse between them, and the race would never
  // be exercised. Dispatching both DOM events from one `page.evaluate` keeps them
  // in the same synchronous tick, so the debounce timer has no chance to fire
  // between the keystroke and the Enter — the window is entered deterministically.
  await page.evaluate(() => {
    const input = document.getElementById("search") as HTMLInputElement
    input.value = "camille"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
  await expect(page.locator("#match-counter")).toHaveText(/^1\/\d+$/)
})

test("the magnifier carries a badge while a query survives the fold", async ({ page }) => {
  await gotoReady(page)
  await openSearch(page)
  await page.fill("#search", "camille")
  await expect(page.locator("#match-counter")).toHaveText(/^1\//)

  // Escape folds the bar without cancelling anything: the highlights stay on
  // screen, which is the assumed behaviour — so the magnifier has to say so.
  await page.keyboard.press("Escape")
  await expect(page.locator("#findbar")).toBeHidden()
  await expect(page.locator("#search-toggle")).toHaveAttribute("data-badge", "true")

  await openSearch(page)
  await page.fill("#search", "")
  await page.keyboard.press("Escape")
  await expect(page.locator("#search-toggle")).not.toHaveAttribute("data-badge", "true")
})

test("Cmd/Ctrl+F opens the findbar and focuses the field", async ({ page }) => {
  await gotoReady(page)
  await expect(page.locator("#findbar")).toBeHidden()

  // ControlOrMeta resolves to the platform's own modifier, which is exactly the
  // pair the handler accepts.
  await page.keyboard.press("ControlOrMeta+f")
  await expect(page.locator("#findbar")).toBeVisible()
  await expect(page.locator("#search")).toBeFocused()
})

test("Cmd/Ctrl+F inside the open field does not fight the browser", async ({ page }) => {
  await gotoReady(page)
  await page.click("#search-toggle")
  await page.fill("#search", "camille")
  // Collapse the caret to a known interior offset. The normal open path calls
  // `search.focus()`, which also does `select()` — so a SELECTED value after
  // the shortcut would mean the exemption's early return was skipped and the
  // ordinary open/refocus path ran instead. A still-collapsed caret is the
  // only observable proof the early return actually fired.
  await page.evaluate(() => {
    const input = document.getElementById("search") as HTMLInputElement
    input.setSelectionRange(3, 3)
  })
  // Already open with the field focused: the shortcut is not ours to intercept,
  // so the field must keep its content and its focus.
  await page.keyboard.press("ControlOrMeta+f")
  await expect(page.locator("#search")).toBeFocused()
  await expect(page.locator("#search")).toHaveValue("camille")
  const selection = await page.evaluate(() => {
    const input = document.getElementById("search") as HTMLInputElement
    return [input.selectionStart, input.selectionEnd]
  })
  expect(selection).toEqual([3, 3])
})
