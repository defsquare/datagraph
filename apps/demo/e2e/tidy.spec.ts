import { test, expect, type Page } from "@playwright/test"

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

test("Ranger announces itself busy while the layout runs", async ({ page }) => {
  await gotoReady(page)

  // The reduced dataset tidies almost instantly, so the state is read from a
  // paused promise rather than raced against: `tidy` is wrapped so the test
  // controls when it resolves.
  await page.evaluate(() => {
    const g = (window as any).__graph
    const real = g.tidy.bind(g)
    ;(window as any).__releaseTidy = () => {}
    g.tidy = () =>
      new Promise<void>((resolve) => {
        ;(window as any).__releaseTidy = () => real().then(resolve)
      })
  })

  await page.click("#tidy")
  await expect(page.locator("#tidy")).toHaveAttribute("aria-busy", "true")
  await expect(page.locator("#tidy")).toBeDisabled()

  await page.evaluate(() => (window as any).__releaseTidy())
  await expect(page.locator("#tidy")).not.toHaveAttribute("aria-busy", "true")
  await expect(page.locator("#tidy")).toBeEnabled()
})
