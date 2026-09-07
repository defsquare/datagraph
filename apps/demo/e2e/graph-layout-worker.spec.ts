import { test, expect, type Page } from "@playwright/test"

/**
 * LA PREUVE QUE LE WORKER DE MISE EN PAGE EST RÉELLEMENT EXERCÉ.
 *
 * Les tests du renderer couvrent le PROTOCOLE avec un faux worker : appariement
 * des générations, repli, destruction. Ce qu'ils ne peuvent pas couvrir, et qui
 * est justement la partie fragile, c'est la RÉSOLUTION D'URL — que
 * `graphLayoutWorkerUrl` désigne un fichier qu'un vrai `new Worker(url, { type:
 * "module" })` sait charger. Cette résolution passe par Vite et diffère selon le
 * mode ; les e2e tournent en `vite dev`, donc sur la SOURCE aliasée du worker
 * (voir le pavé du `vite.config.ts`). C'est le mode le plus exigeant des quatre
 * — le script servi est transformé à la volée et garde ses imports — et c'est
 * celui qui casserait en premier.
 *
 * La preuve est faite de deux façons qui ne se recouvrent pas :
 *  - un `Worker` a bien été construit sur l'URL du worker de layout ;
 *  - AUCUN avertissement de repli n'a été émis. Sans ce second point le premier
 *    ne prouverait rien : le renderer se replie silencieusement (à un
 *    `console.warn` près) sur le moteur en processus dès que le worker échoue,
 *    donc la vue graphe s'afficherait quand même et un test qui ne regarderait
 *    que le résultat resterait vert sur un worker mort.
 */

/**
 * Instrumente `Worker` AVANT le chargement des modules, et récolte les
 * avertissements de la console. La sous-classe laisse le vrai `Worker` faire son
 * travail : on observe, on ne simule pas.
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

test("la vue graphe se met en page dans un vrai Web Worker, sans repli", async ({ page }) => {
  const warnings = await gotoInstrumented(page)

  await page.locator("#toggle-view").click()
  await expect(page.locator("#toggle-view")).toHaveAttribute("data-target", "structure")
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")

  // Le worker a bien été construit, sur l'URL que `main.ts` a passée.
  const urls: string[] = await page.evaluate(() => (window as any).__workerUrls)
  expect(urls.some((u) => u.includes("graph-layout-worker"))).toBe(true)

  // Et il a répondu : aucun repli. Le message est celui de `retireWorker`.
  expect(warnings.filter((w) => w.includes("falling back to in-process layout"))).toEqual([])

  // La vue est réellement peinte : des agrégats, donc une mise en page arrivée
  // jusqu'au bout. La config de la démo déclare `groups`, donc il y en a.
  expect(await page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)).toBeGreaterThan(
    0,
  )

  // Aller-retour : le worker est réutilisé, pas rouvert, et le retour en vue
  // structure marche toujours.
  await page.locator("#toggle-view").click()
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  await page.locator("#toggle-view").click()
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
  const after: string[] = await page.evaluate(() => (window as any).__workerUrls)
  expect(after.filter((u) => u.includes("graph-layout-worker"))).toHaveLength(1)
})

test("le bouton de bascule passe en état occupé, puis en sort", async ({ page }) => {
  await gotoInstrumented(page)

  // Un OBSERVATEUR posé avant le clic, et pas une assertion après : sur le jeu
  // par défaut de la démo le calcul dure quelques millisecondes, et guetter
  // l'attribut depuis le harnais serait une course perdue d'avance. Ce qu'on
  // veut prouver n'est de toute façon pas la DURÉE de l'état mais sa présence et
  // sa levée — il tient aussi longtemps que `setView`, par construction.
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
  // Posé puis retiré, dans cet ordre.
  expect(log).toEqual([true, false])
  await expect(page.locator("#toggle-view")).not.toHaveAttribute("aria-busy", "true")
  // Et le bouton est bien réutilisable.
  await expect(page.locator("#toggle-view")).toBeEnabled()
})

test("la vue structure reste interactive pendant le calcul de la vue graphe", async ({ page }) => {
  await gotoInstrumented(page)

  // Le bénéfice du worker, mis à l'épreuve : on lance la bascule SANS l'attendre
  // et on déplace la caméra pendant ce temps. Si le calcul tenait le thread
  // principal, aucune de ces images ne serait produite — c'est exactement le
  // symptôme des ~4,4 s de gel sur le jeu réel.
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

  // Plus d'une image : le thread principal a rendu la main au moins une fois
  // entre le départ du calcul et son retour.
  expect(framesDuringLayout).toBeGreaterThan(1)
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
})
