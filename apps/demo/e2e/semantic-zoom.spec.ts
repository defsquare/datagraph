import { test, expect, type Page } from "@playwright/test"

/**
 * Le ZOOM SÉMANTIQUE de la vue graphe : sous le seuil du LOD 2, les cartes
 * disparaissent et les agrégats sont peints comme des nœuds — un disque nommé
 * par agrégat, relié aux autres par les références repliées sur les paires.
 *
 * Ce que ce fichier prouve et que rien d'autre ne peut prouver : aucun test du
 * renderer ne monte `createDataGraph`, donc la BASCULE elle-même — quelles
 * cartes existent, ce que le pointeur atteint, ce que le retour au zoom rend —
 * n'a pas d'autre lieu de vérification. Les pièces pures (l'agrégation des
 * arêtes, les trois fonctions de dessin, les lectures du contrôleur) sont
 * couvertes sans navigateur par `packages/renderer/test/semantic.test.ts`.
 *
 * L'observable est le POINTEUR, comme dans `culling.spec.ts` : un container Pixi
 * absent ne répond pas au hit-test. Un clic au centre du canevas — c'est-à-dire
 * exactement au centre de la carte que `focus` vient d'y cadrer — émet `select`
 * si et seulement si cette carte est dessinée. C'est la même sonde des deux
 * côtés du seuil, ce qui rend les deux moitiés du test comparables.
 */

async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

/** Le jeu ÉTENDU de la démo, celui qui a des agrégats en nombre : 350 entités,
 * `groups: ["Customer", "Product"]`. Le clic ne fait que lancer un gestionnaire
 * async, donc on attend le compteur — la preuve que `setData` a fini de
 * construire ET de mettre en page. Même réveil que `view.spec.ts`. */
async function loadExtendedDataset(page: Page): Promise<void> {
  await page.click("#menu-toggle")
  await page.click("#toggle-dataset")
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.stats().logicalNodeCount), {
      timeout: 30_000,
    })
    .toBe(4061)
}

/** L'entité sonde : un Customer, donc la RACINE de son propre agrégat — elle est
 * membre d'un disque à coup sûr, ce qui est la condition du test. */
const PROBE = "/customers/0"

test("sous le seuil, les agrégats remplacent les cartes ; au-dessus, les cartes reviennent", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  await loadExtendedDataset(page)
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // On enregistre les sélections PAR L'ÉVÉNEMENT PUBLIC : c'est lui qui prouve
  // qu'un vrai container a reçu le tap, et non un état interne exposé pour le
  // test. Un agrégat, lui, n'émet rien — c'est justement ce qui distingue les
  // deux régimes ici.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
  const selectedCount = (): Promise<number> =>
    page.evaluate(() => (window as any).__selected.length)
  const lastSelected = (): Promise<string | undefined> =>
    page.evaluate(() => (window as any).__selected.at(-1))

  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // --- 1. Au-dessus du seuil : la carte est là et répond ---------------------
  // `focus` cadre la sonde à l'échelle 1, donc au LOD 0 : le centre du canevas
  // EST le centre de sa carte.
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)
  await page.mouse.click(cx, cy)
  await expect.poll(lastSelected).toBe(PROBE)

  // --- 2. Sous le seuil : plus de carte, mais un disque -----------------------
  // On repart d'une sélection vide, sinon l'anneau de la carte sélectionnée
  // resterait peint et brouillerait la comparaison d'images ci-dessous.
  await page.keyboard.press("Escape")
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)

  // Le zoom molette est ancré sur le POINTEUR : en dézoomant depuis le centre,
  // la sonde y reste, et le disque de son agrégat — qui la contient par
  // construction — couvre donc toujours ce point. 14 crans font passer l'échelle
  // de 1 à ~0,07, franchement sous le seuil du LOD 2 (0,15).
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(40)
  }
  // Un cran de souris pour réveiller le survol. Pixi ne teste sa scène qu'aux
  // événements de pointeur : le disque est arrivé SOUS un curseur immobile, donc
  // aucun `pointerover` n'a encore été émis. Sans ce réveil, l'image de
  // référence serait prise sans survol et celle d'après le clic AVEC — la
  // comparaison mesurerait la montée du survol au lieu de l'effet de la
  // sélection. Le survol est animé : on le laisse ensuite se poser.
  await page.mouse.move(cx + 2, cy + 2)
  await page.mouse.move(cx, cy)
  await page.waitForTimeout(1200)

  const before = await page.locator("canvas").screenshot()
  const marker = await selectedCount()
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(400)

  // La carte de la sonde n'est plus dessinée : rien n'a reçu le tap côté
  // cartes. C'est l'invariant « jamais de cartes ET de disques ensemble »,
  // observé par le seul canal qui ne mente pas.
  expect(await selectedCount()).toBe(marker)

  // …mais quelque chose a bien été désigné : la sélection d'agrégat allume son
  // disque et fait reculer tout ce qui ne lui parle pas, donc la scène change.
  const afterClick = await page.locator("canvas").screenshot()
  expect(afterClick.equals(before)).toBe(false)

  // Et elle se défait : Échap rend exactement l'image d'avant le clic. Sans le
  // régime sémantique, ce clic serait tombé sur une carte et cette égalité ne
  // tiendrait pas.
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
  const afterEscape = await page.locator("canvas").screenshot()
  expect(afterEscape.equals(before)).toBe(true)

  // --- 3. Retour au-dessus du seuil : les cartes reviennent ------------------
  // `focus` depuis le régime sémantique doit refaire toute la chaîne : caméra à
  // l'échelle 1, changement de LOD, reconstruction, matérialisation de la carte
  // visée. C'est le chemin qu'emprunte aussi la recherche.
  await page.evaluate(id => (window as any).__graph.focus(id), PROBE)
  await page.waitForTimeout(200)
  await page.mouse.click(cx, cy)
  await expect.poll(lastSelected).toBe(PROBE)
  expect(await selectedCount()).toBe(marker + 1)

  expect(errors).toEqual([])
})
