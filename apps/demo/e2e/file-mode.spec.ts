import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

/**
 * FILE MODE — `datagraph <data.json> [-c <config.json>]` — had until now no
 * proof on the TypeScript side: `cargo test` covers the argv parser and the disk
 * reads, but the Rust → `invoke("launch_payload")` → `resolveLaunch` →
 * `createDataGraph` path stopped at the binary's edge.
 *
 * Two things are therefore at stake here.
 *
 * 1. THE TAURI SEAM. `src/launch.ts` only tests `"__TAURI_INTERNALS__" in
 *    window`, then calls `invoke` from `@tauri-apps/api/core`, whose entire
 *    implementation amounts to `window.__TAURI_INTERNALS__.invoke(cmd, args,
 *    options)` (verified in the installed package, `core.js` v2.11.1). Setting
 *    that object BEFORE the modules load — hence `addInitScript` — is therefore
 *    enough to convince the page it runs inside the WebView. Nothing else in the
 *    bundle reaches the internals: `core.js` only touches them at call time, not
 *    at load time.
 *
 * 2. THE COMMITTED FIXTURES. The injected payload is the REAL CONTENT of
 *    `fixtures/shop.json` and `fixtures/shop.config.json`, read here from disk
 *    rather than copied. That is what finally puts them to work: `cargo test`
 *    proves they are JSON, this file proves their config is valid for the core
 *    and that their `ids`/`refs`/`groups` actually describe the data. Should the
 *    fixtures drift from the contract, these tests break — and this is the only
 *    place where that can show.
 */

const shopData = readFileSync(new URL("../fixtures/shop.json", import.meta.url), "utf8")
const shopConfig = readFileSync(new URL("../fixtures/shop.config.json", import.meta.url), "utf8")

/** Mirror of the Rust `LaunchPayload`: both files as RAW strings, parsing left
 * to the frontend. */
interface RawPayload {
  data: string
  config: string | null
}

/**
 * Installs the fake `__TAURI_INTERNALS__` then loads the page. The shim answers
 * `launch_payload` and nothing else — any other command becomes a loud error
 * rather than a silent `undefined` that would make a test pass for the wrong
 * reasons.
 */
async function gotoFileMode(page: Page, payload: RawPayload): Promise<void> {
  await page.addInitScript((p: RawPayload) => {
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke(cmd: string) {
        if (cmd !== "launch_payload") {
          return Promise.reject(new Error(`unexpected tauri command: ${cmd}`))
        }
        return Promise.resolve(p)
      },
    }
  }, payload)
  await page.goto("/")
}

/** Same wake-up as the other specs: `window.__graph` is set synchronously, long
 * before the graph is built and laid out. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

test("mode fichier : la fixture et sa config se chargent, le chrome de démo disparaît", async ({
  page,
}) => {
  await gotoFileMode(page, { data: shopData, config: shopConfig })
  await waitReady(page)

  await expect(page.locator("canvas")).toBeVisible()
  // The dataset button makes no sense once the user supplied their own data:
  // `main.ts` removes it from the DOM, not merely from view.
  await expect(page.locator("#toggle-dataset")).toHaveCount(0)
  // The config declares `ids`, so the graph view stays on offer.
  await expect(page.locator("#toggle-view")).toHaveCount(1)

  // The fixture's entities are indeed there, with the type and id the config
  // derives: what is proven here is `ids`, not merely that loading worked.
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
  await page.evaluate(() => (window as any).__graph.select("/orders/1"))
  await expect(page.locator("#selection-label")).toContainText("Order #o2")

  // And `refs`: order o1 points at customer c1 through `customerId`.
  const refs = await page.evaluate(() =>
    (window as any).__graph
      .refEdges("/orders/0")
      .map((e: any) => ({ field: e.field, to: e.to, dangling: e.dangling })),
  )
  expect(refs).toEqual([{ field: "customerId", to: "/customers/0", dangling: false }])

  // A fixture drifting from the contract would leave diagnostics behind
  // (dangling reference, missing id): they must stay empty.
  const diagnostics = await page.evaluate(() => (window as any).__graph.diagnostics())
  expect(diagnostics).toEqual([])
})

test("mode fichier sans config : vue structure seule", async ({ page }) => {
  await gotoFileMode(page, { data: shopData, config: null })
  await waitReady(page)

  await expect(page.locator("canvas")).toBeVisible()
  await expect(page.locator("#toggle-dataset")).toHaveCount(0)
  // Without `ids`, no entity, hence no aggregate: the graph view would have
  // nothing to show and `main.ts` removes its button.
  await expect(page.locator("#toggle-view")).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")

  // The document is explored all the same, as bare objects and arrays.
  expect(await page.evaluate(() => (window as any).__graph.stats().logicalNodeCount)).toBeGreaterThan(
    0,
  )
})

test("mode fichier : une config sémantiquement invalide s'affiche à l'écran", async ({ page }) => {
  // `groups` may only name declared `ids` — the fault is SEMANTIC: Rust lets it
  // through (it is valid JSON), only `validateConfig` sees it.
  const broken = JSON.stringify({ ...JSON.parse(shopConfig), groups: ["Ghost"] })
  await gotoFileMode(page, { data: shopData, config: broken })

  // `createDataGraph` fails synchronously, so `main.ts` rethrows after painting
  // the error screen: `window.__graph` will never be set and awaiting `ready`
  // would hang. The screen is what we wait for.
  await expect(page.locator("#load-error")).toBeVisible()
  await expect(page.locator("#load-error-message")).toContainText("Ghost")
})
