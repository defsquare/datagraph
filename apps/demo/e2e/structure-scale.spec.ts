import { test, expect, type Page } from "@playwright/test"

/**
 * La politique d'échelle de la vue structure, prouvée de bout en bout.
 *
 * Chaque brique a ses tests unitaires — le budget d'ouverture et la pagination
 * en donnée pure dans `packages/core/test/collapse.test.ts`, les jetons de reste
 * et la cascade de `focus` côté renderer. Ce qui ne peut PAS s'y prouver, aucun
 * test de package ne montant `createDataGraph`, c'est la CHAÎNE : un document
 * qu'aucun humain n'ouvrirait à plat s'ouvre borné, se pagine au geste, se
 * laisse fouiller en profondeur par la recherche, et survit à un « Ranger ».
 *
 * Le seul canal qui prouve qu'une carte existe vraiment dans la scène est le
 * pointeur — un container Pixi absent ne répond pas au hit-test. On s'appuie
 * donc, comme `culling.spec.ts`, sur l'invariant du cadrage : après `focus`, le
 * centre du canevas EST le centre de la carte visée, donc un clic là ne peut
 * sélectionner qu'elle, et seulement si elle est dessinée.
 */

/** ~9 000 nœuds logiques : 3 000 objets (30 × PAGE_SIZE, dix fois le budget
 * d'ouverture) plus leurs deux scalaires chacun. Assez pour que la politique
 * soit obligée de mordre, assez peu pour que la CI reste rapide. */
const data = {
  items: Array.from({ length: 3000 }, (_, i) => ({ id: `it${i}`, name: `Item ${i}` })),
}

/** Aucune entité : la vue graphe n'aurait rien à montrer, donc la vue structure
 * reste la vue courante. C'est exactement la config du mode CLI sur un document
 * brut, celui que cette politique existe pour rendre ouvrable. */
const config = { ids: {} }

/** Ce que `CollapseState` révèle d'un coup — une page de fratrie. Les deltas
 * attendus plus bas sont exprimés avec, pour que toute dérive de la constante se
 * lise ici comme un échec parlant plutôt que comme un nombre magique faux. */
const PAGE_SIZE = 100

/** La carte de tête de la première page, celle sous laquelle pend le jeton
 * `+ 2900` : `hiddenGaps` ancre le jeton sur la dernière carte POSÉE avant le
 * trou. */
const LAST_OF_FIRST_PAGE = "/items/99"

async function openBigDocument(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  // `ready` et non la seule présence du handle : `__graph` est posé
  // synchronement au chargement du module, bien avant que l'init async (build,
  // polices, mise en page, premier rendu) n'ait fini — un `setData` qui la
  // devance se ferait avaler en silence.
  await page.evaluate(() => (window as any).__graph.ready)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
  // On enregistre les sélections PAR L'ÉVÉNEMENT PUBLIC : c'est lui qui prouve
  // qu'un vrai container a reçu le tap, et non un état interne exposé pour le
  // test.
  await page.evaluate(() => {
    ;(window as any).__selected = []
    ;(window as any).__graph.on("select", (n: any) => (window as any).__selected.push(n.id))
  })
}

function stats(page: Page): Promise<{ logicalNodeCount: number; visibleNodeCount: number }> {
  return page.evaluate(() => (window as any).__graph.stats())
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

async function canvasCenter(page: Page): Promise<{ cx: number; cy: number }> {
  const box = await page.locator("canvas").first().boundingBox()
  expect(box).not.toBeNull()
  return { cx: box!.x + box!.width / 2, cy: box!.y + box!.height / 2 }
}

/**
 * Attend que `id` soit CADRÉ ET DESSINÉ, en réessayant le clic au centre jusqu'à
 * ce qu'il le sélectionne.
 *
 * Le clic est dans le poll, et pas avant lui : un `focus()` rend la main tout de
 * suite, sa cascade de révélations et son cadrage suivent, et un clic tiré trop
 * tôt sur le centre d'alors ne désignerait pas la cible — l'attendre à la montre
 * reviendrait à parier sur la durée d'une mise en page qu'on ne contrôle pas.
 *
 * Rejouer le clic est sans danger, et c'est ce qui rend ce poll légitime :
 * `select` ne touche ni à `opGen` ni à la caméra (`doSelect`), donc il ne peut
 * pas perturber l'opération qu'il attend. Un clic à côté sélectionne au pire une
 * carte voisine, ce que l'itération suivante corrige.
 */
async function proveDrawnAtCenter(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const { cx, cy } = await canvasCenter(page)
        await page.mouse.click(cx, cy)
        return page.evaluate(() => (window as any).__selected.at(-1))
      },
      { timeout: 20_000 },
    )
    .toBe(id)
}

/**
 * Cadre la dernière carte de la première page, puis clique le jeton `+ n` qui
 * pend juste dessous.
 *
 * Le jeton n'est pas un nœud : il n'a ni id public, ni `focus()`, et sa position
 * dépend de la hauteur de carte MESURÉE à l'exécution (polices réelles du
 * navigateur). Figer une ordonnée serait donc figer une métrique qu'on ne
 * contrôle pas. On balaie plutôt la bande étroite qui suit la carte cadrée —
 * `anchor.y + anchor.height + GAP`, soit une trentaine de pixels sous son bord
 * bas à l'échelle 1 — et on s'arrête au PREMIER clic qui révèle, sinon le
 * balayage continuerait de paginer après coup.
 *
 * Cliquer à côté est inoffensif : c'est au pire une sélection de carte ou un
 * clic dans le vide, ni l'un ni l'autre ne changeant le compte visible.
 */
async function revealByToken(page: Page, anchorId: string): Promise<boolean> {
  await page.evaluate((id) => (window as any).__graph.focus(id), anchorId)
  // Le cadrage est attendu par sa PREUVE, pas par une temporisation : tant que
  // la carte d'ancrage ne répond pas au centre, l'ordonnée du jeton n'est pas
  // encore celle qu'on s'apprête à balayer.
  await proveDrawnAtCenter(page, anchorId)
  const { cx, cy } = await canvasCenter(page)
  const before = await visibleCount(page)
  for (let dy = 30; dy <= 78; dy += 3) {
    await page.mouse.click(cx, cy + dy)
    // Le seul délai fixe qui reste ici, et il est sans enjeu : une révélation qui
    // met plus longtemps à se voir est simplement constatée à l'itération
    // suivante, la comparaison étant faite avec le compte D'AVANT le balayage.
    await page.waitForTimeout(250)
    if ((await visibleCount(page)) > before) return true
  }
  return false
}

test("un gros document s'ouvre borne et se pagine au clic sur un jeton", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)

  // Sans entités, aucune bascule possible : c'est bien la vue structure qui
  // porte tout ce qui suit.
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")

  const opened = await stats(page)
  // Le document ENTIER est là — le graphe logique ne plie rien.
  expect(opened.logicalNodeCount).toBeGreaterThan(5000)
  // Mais l'ouverture s'arrête au budget : deux ordres de grandeur plus bas.
  // C'est toute la politique, en une inégalité.
  expect(opened.visibleNodeCount).toBeLessThan(500)

  // Le geste de pagination : le jeton de reste révèle EXACTEMENT une page.
  expect(await revealByToken(page, LAST_OF_FIRST_PAGE)).toBe(true)
  const paginated = await stats(page)
  expect(paginated.visibleNodeCount).toBe(opened.visibleNodeCount + PAGE_SIZE)
  // Révéler ne construit rien : le graphe logique est le même document.
  expect(paginated.logicalNodeCount).toBe(opened.logicalNodeCount)

  expect(errors).toEqual([])
})

test("la recherche revele une page profonde et centre la cible", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)
  const opened = await stats(page)

  // L'élément 2777 vit sur la 28ᵉ page de sa fratrie : ni son parent déplié, ni
  // la première page révélée ne le montrent. C'est le cas que la cascade de
  // `focus` doit couvrir — déplier les ancêtres NE SUFFIT PLUS depuis la
  // pagination.
  const target = "/items/2777"
  const results = await page.evaluate(() => (window as any).__graph.search("Item 2777"))
  expect(results.length).toBeGreaterThan(0)
  // Le terme ne désigne qu'un nœud : le clic au centre plus bas n'a donc qu'une
  // seule réponse possible.
  expect([...new Set(results.map((r: any) => r.nodeId))]).toEqual([target])

  const first = await page.evaluate(() => (window as any).__graph.nextMatch())
  expect(first.nodeId).toBe(target)

  // `nextMatch()` rend son résultat sans attendre le cadrage : la révélation de
  // la page est une suite de mises en page attendues, qu'on guette au compteur
  // plutôt qu'à la montre.
  await expect
    .poll(() => visibleCount(page), { timeout: 20_000 })
    .toBeGreaterThan(opened.visibleNodeCount)

  const revealed = await stats(page)
  // Atteindre le 2777ᵉ enfant ne coûte PAS 2 778 cartes : seule sa page est
  // ouverte. C'est l'invariant qui rend la recherche profonde utilisable.
  expect(revealed.visibleNodeCount).toBeLessThan(800)
  expect(revealed.visibleNodeCount).toBe(opened.visibleNodeCount + PAGE_SIZE)

  // La preuve de la révélation par le seul canal qui ne ment pas : la caméra a
  // sauté sur la cible, et elle l'a trouvée dessinée à l'arrivée.
  await proveDrawnAtCenter(page, target)

  expect(errors).toEqual([])
})

test("Ranger garde une vue coherente apres des revelations", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await openBigDocument(page)
  const opened = await stats(page)

  // Deux révélations ÉLOIGNÉES l'une de l'autre : c'est précisément l'état
  // dérivé que `tidy()` existe pour réparer — deux blocs insérés dans une pose
  // qu'aucun calcul global n'a jamais vue en entier.
  //
  // Chaque révélation est attendue par DEUX polls, aucune temporisation fixe.
  // Le premier guette le compteur : la page est alors DÉCIDÉE. Le second guette
  // le pointeur : la mise en page est alors POSÉE et dessinée.
  //
  // Le second n'est pas du zèle. Entre les deux, `collapseState` a déjà révélé
  // la page mais `engine.layoutAfterReveal` est encore en vol, et toute
  // opération qui incrémente `opGen` pendant ce vol — le `nextMatch()` suivant,
  // le clic sur « Ranger » — fait abandonner la cascade, qui ANNULE alors sa
  // propre révélation (`doFocus`, branche `gen !== opGen`). S'arrêter au
  // compteur laisserait donc une course qui retire une page sur deux.
  const reveals = [
    ["Item 2777", "/items/2777"],
    ["Item 1500", "/items/1500"],
  ] as const
  for (const [term, target] of reveals) {
    const before = await visibleCount(page)
    await page.evaluate((q) => (window as any).__graph.search(q), term)
    await page.evaluate(() => (window as any).__graph.nextMatch())
    await expect.poll(() => visibleCount(page), { timeout: 20_000 }).toBe(before + PAGE_SIZE)
    await proveDrawnAtCenter(page, target)
  }
  const drifted = await stats(page)
  expect(drifted.visibleNodeCount).toBe(opened.visibleNodeCount + 2 * PAGE_SIZE)

  await page.click("#tidy")
  // Le clic ne fait que lancer un gestionnaire async : `tidy()` refait la mise
  // en page COMPLÈTE de l'ensemble visible, puis cadre et anime. On lui laisse
  // de la marge — l'assertion qui suit ne vaut que sur une pose posée.
  await page.waitForTimeout(3000)

  const tidied = await stats(page)
  // Ranger ne change ni le document, ni ce qui est déplié : c'est un
  // repositionnement, pas une opération de pli.
  expect(tidied.logicalNodeCount).toBe(opened.logicalNodeCount)
  expect(tidied.visibleNodeCount).toBe(drifted.visibleNodeCount)

  // Et la vue reste VIVANTE : la carte révélée avant le rangement répond
  // toujours au pointeur, à sa nouvelle place. Un `tidy()` qui aurait publié
  // une pose sans reconstruire les cartes laisserait ce clic dans le vide.
  await page.evaluate(() => (window as any).__graph.focus("/items/2777"))
  await proveDrawnAtCenter(page, "/items/2777")

  expect(errors).toEqual([])
})
