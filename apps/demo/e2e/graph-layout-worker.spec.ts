import { test, expect, type Page } from "@playwright/test"

/**
 * THE PROOF THAT THE LAYOUT WORKER IS REALLY EXERCISED.
 *
 * The renderer tests cover the PROTOCOL with a fake worker: generation matching,
 * fallback, teardown. What they cannot cover, and what is precisely the fragile
 * part, is URL RESOLUTION — that `graphLayoutWorkerUrl` designates a file a real
 * `new Worker(url, { type: "module" })` knows how to load. That resolution goes
 * through Vite and differs per mode; the e2e run in `vite dev`, hence on the
 * worker's aliased SOURCE (see the block in `vite.config.ts`). It is the most
 * demanding of the four modes — the served script is transformed on the fly and
 * keeps its imports — and the one that would break first.
 *
 * The proof is made in two ways that do not overlap:
 *  - a `Worker` really was constructed on the layout worker's URL;
 *  - NO fallback warning was emitted. Without this second point the first would
 *    prove nothing: the renderer falls back silently (bar a `console.warn`) to
 *    the in-process engine as soon as the worker fails, so the graph view would
 *    show up anyway and a test looking only at the result would stay green on a
 *    dead worker.
 */

/**
 * Instruments `Worker` BEFORE the modules load, and collects console warnings.
 * The subclass lets the real `Worker` do its job: we observe, we do not
 * simulate.
 */
async function gotoInstrumented(page: Page): Promise<string[]> {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text())
  })
  await page.addInitScript(() => {
    const Original = window.Worker
    ;(window as any).__workerUrls = []
    ;(window as any).Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        ;(window as any).__workerUrls.push(String(url))
        super(url, options)
      }
    }
  })
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
  return warnings
}

test("the graph view lays out in a real Web Worker, with no fallback", async ({ page }) => {
  const warnings = await gotoInstrumented(page)

  await page.locator("#toggle-view").click()
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "structure")
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")

  // The worker really was constructed, on the URL `main.ts` passed.
  const urls: string[] = await page.evaluate(() => (window as any).__workerUrls)
  expect(urls.some((u) => u.includes("graph-layout-worker"))).toBe(true)

  // And it answered: no fallback. The message is `retireWorker`'s.
  expect(warnings.filter((w) => w.includes("falling back to in-process layout"))).toEqual([])

  // The view is really painted: aggregates, hence a layout that ran to
  // completion. The demo's config declares `groups`, so there are some.
  expect(await page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)).toBeGreaterThan(
    0,
  )

  // Round trip: the worker is reused, not reopened, and going back to structure
  // view still works.
  await page.locator("#toggle-view").click()
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  await page.locator("#toggle-view").click()
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
  const after: string[] = await page.evaluate(() => (window as any).__workerUrls)
  expect(after.filter((u) => u.includes("graph-layout-worker"))).toHaveLength(1)
})

test("the toggle button enters the busy state, then leaves it", async ({ page }) => {
  await gotoInstrumented(page)

  // An OBSERVER set up before the click, not an assertion after it: on the
  // demo's default dataset the computation lasts a few milliseconds, and
  // watching the attribute from the harness would be a race lost in advance.
  // What we want to prove is not the state's DURATION anyway but its appearance
  // and its lifting — it holds exactly as long as `setView`, by construction.
  await page.evaluate(() => {
    const button = document.getElementById("toggle-view")!
    ;(window as any).__busyLog = [] as boolean[]
    new MutationObserver(() => {
      ;(window as any).__busyLog.push(button.getAttribute("aria-busy") === "true")
    }).observe(button, { attributes: true, attributeFilter: ["aria-busy"] })
  })

  await page.locator("#toggle-view").click()
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "structure")

  const log: boolean[] = await page.evaluate(() => (window as any).__busyLog)
  // Set then removed, in that order.
  expect(log).toEqual([true, false])
  await expect(page.locator("#toggle-view")).not.toHaveAttribute("aria-busy", "true")
  // And the button is usable again.
  await expect(page.locator("#toggle-view")).toBeEnabled()
})

test("the structure view stays interactive while the graph view computes", async ({ page }) => {
  await gotoInstrumented(page)

  // The worker's benefit, put to the test: the toggle is started WITHOUT
  // awaiting it and the camera moves meanwhile. If the computation held the main
  // thread, none of these frames would be produced — exactly the symptom of the
  // ~4.4 s freeze on the real dataset.
  const framesDuringLayout = await page.evaluate(async () => {
    const graph = (window as any).__graph
    const switching = graph.setView("graph")
    let frames = 0
    let done = false
    void switching.then(() => (done = true))
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        frames++
        if (done || frames > 240) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await switching
    return frames
  })

  // More than one frame: the main thread yielded at least once between the start
  // of the computation and its return.
  expect(framesDuringLayout).toBeGreaterThan(1)
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
})
