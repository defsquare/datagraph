import { test, expect, type Page } from "@playwright/test"

/**
 * Le culling à la création : le renderer ne fabrique plus que les cartes du
 * voisinage de l'écran, et matérialise les autres à la demande. La politique
 * elle-même est prouvée en donnée pure côté renderer
 * (`packages/renderer/test/culling.test.ts`) ; ce qui ne peut PAS l'être là-bas
 * — aucun test du renderer ne monte `createDataGraph` — est l'invariant de bout
 * en bout :
 *
 *   la caméra qui saute sur une carte doit la trouver DESSINÉE à l'arrivée.
 *
 * On le vérifie par le seul canal qui prouve qu'une carte existe vraiment dans
 * la scène : le pointeur. Un container Pixi absent ne répond pas au hit-test,
 * donc le clic au centre du canevas — c'est-à-dire exactement au centre de la
 * carte que `focus` vient d'y cadrer — n'émettrait aucun `select`. Assez de
 * cartes pour qu'au zoom de `focus` (échelle 1) l'écrasante majorité soit hors
 * de la fenêtre de matérialisation, et on en visite plusieurs, éparpillées.
 */

/** 60 clients, 60 commandes : 120 entités, largement plus que ce qu'un écran
 * montre à l'échelle 1, donc la plupart hors fenêtre à tout instant. */
const data = {
  customers: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}` })),
  orders: Array.from({ length: 60 }, (_, i) => ({ id: `o${i}`, customerId: `c${i}`, total: i })),
}

const config = {
  ids: { Customer: "$.customers[*].id", Order: "$.orders[*].id" },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

/** Zoome de `notches` crans. La molette NUE déplace la toile : le zoom exige un
 * modificateur, seul signal qu'aucun balayage trackpad ne produit par accident
 * (`classifyWheel`). Playwright applique l'état clavier aux événements molette. */
async function zoom(page: Page, notches: number, deltaY: number): Promise<void> {
  await page.keyboard.down("Control")
  for (let i = 0; i < notches; i++) await page.mouse.wheel(0, deltaY)
  await page.keyboard.up("Control")
}

async function gotoGraphView(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")
  // On enregistre les sélections PAR L'ÉVÉNEMENT PUBLIC : c'est lui qui prouve
  // qu'un vrai container a reçu le tap, et non un état interne qu'on aurait
  // exposé pour le test.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
}

test("focus sur une carte hors fenêtre la trouve dessinée à l'arrivée", async ({ page }) => {
  await gotoGraphView(page)

  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // Zoom franc au centre : le cadrage global montrait tout, l'échelle 1 ne
  // montre plus qu'une poignée de cartes. Tout le reste est alors non
  // matérialisé — c'est précisément l'état que le culling introduit.
  await page.mouse.move(cx, cy)
  await zoom(page, 12, -100)
  await page.waitForTimeout(200)

  // Quatre cibles éparpillées dans le jeu : après un `focus`, le centre du
  // canevas EST le centre de la carte visée (`camera.centerOn`), donc un clic
  // là ne peut sélectionner qu'elle — et seulement si elle est dessinée.
  for (const id of ["/customers/0", "/orders/59", "/customers/45", "/orders/7"]) {
    await page.evaluate((target) => (window as any).__graph.focus(target), id)
    await page.waitForTimeout(80)
    await page.mouse.click(cx, cy)
    await expect
      .poll(() => page.evaluate(() => (window as any).__selected.at(-1)))
      .toBe(id)
  }
})

test("select sur une carte hors fenêtre ne perd pas la sélection", async ({ page }) => {
  await gotoGraphView(page)

  const box = await page.locator("canvas").first().boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await zoom(page, 12, -100)
  await page.waitForTimeout(200)

  // `select()` ne déplace PAS la caméra : la carte reste hors écran. Elle est
  // quand même matérialisée et, surtout, elle est ÉPINGLÉE — le passage de
  // recyclage ne doit jamais la détruire, aussi loin soit-elle. On le vérifie
  // en revenant dessus après coup : la sélection tient, et la carte répond
  // toujours au pointeur.
  await page.evaluate(() => (window as any).__graph.select("/orders/33"))
  await page.waitForTimeout(300)
  await page.evaluate(() => (window as any).__graph.focus("/orders/33"))
  await page.waitForTimeout(80)
  await page.mouse.click(cx, cy)
  await expect
    .poll(() => page.evaluate(() => (window as any).__selected.at(-1)))
    .toBe("/orders/33")
})
