import { test, expect, type Page } from "@playwright/test"

/**
 * La bascule de vue ne peut pas etre couverte par un test unitaire du
 * renderer : aucun test de `packages/renderer` ne monte `createDataGraph`
 * (pas de DOM, pas de jsdom configure), et maquetter Pixi ne prouverait rien.
 * C'est donc ici que vit la preuve durable du comportement de la vue graphe.
 *
 * Meme reveil que `smoke.spec.ts` : on attend la promesse publique `ready`, et
 * pas seulement l'existence de `window.__graph`, qui est assignee
 * synchroniquement au chargement du module bien avant que le graphe soit
 * construit et mis en page.
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

// La config de la demo ne declare pas encore d'agregats : on injecte par
// `setData` un jeu minimal qui en a. Deux agregats (un par Customer), cinq
// entites au total ; replier celui de c1 doit retirer o1 et o2 et n'en laisser
// que trois : c1 (racine, toujours visible), c2 et o3.
const data = {
  customers: [
    { id: "c1", name: "Dupont", address: { city: "Paris" } },
    { id: "c2", name: "Martin" },
  ],
  orders: [
    { id: "o1", customerId: "c1", total: 99.5 },
    { id: "o2", customerId: "c1", total: 12 },
    { id: "o3", customerId: "c2", total: 4 },
  ],
}

const config = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
  aggregates: ["Customer"],
}

async function loadAggregateData(page: Page): Promise<void> {
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [data, config],
  )
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

test("setView bascule entre structure et graphe, et revient", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  await loadAggregateData(page)

  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  const structureVisible = await visibleCount(page)

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")
  // La vue graphe ne montre que des entites : 2 clients + 3 commandes.
  expect(await visibleCount(page)).toBe(5)

  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  expect(await visibleCount(page)).toBe(structureVisible)

  expect(errors).toEqual([])
  await expect(page.locator("canvas")).toBeVisible()
})

test("basculer avec un noeud imbrique selectionne ne casse rien", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await loadAggregateData(page)

  // Un objet imbrique sous une entite n'existe pas dans la vue graphe : la
  // bascule doit reporter la selection sur le Customer qui le contient. Le
  // RESULTAT de ce report n'est pas observable de l'exterieur (aucun getter de
  // selection, et `setView` n'emet pas "select"), donc ce test ne couvre que le
  // fait que ce chemin s'execute sans casser ; la fonction elle-meme est
  // couverte unitairement par `packages/renderer/test/view.test.ts`
  // (`nearestEntityAncestor`).
  await page.evaluate(() => (window as any).__graph.select("/customers/0/address"))
  await expect(page.locator("#selection-path")).toContainText("/customers/0/address")

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await visibleCount(page)).toBe(5)
  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(errors).toEqual([])
})

test("expand() de la vue structure ne deplace rien en vue graphe", async ({ page }) => {
  await gotoReady(page)

  // Six clients, chacun avec une adresse : dans la mise en page de la vue
  // STRUCTURE, deplier /customers/0 decale /customers/1 de 19 px vers le bas
  // (mesure faite sur le moteur ELK). C'est la condition necessaire du defaut
  // teste ici — avec un jeu plus petit, aucune position ne bouge et le test ne
  // prouverait rien.
  const wide = {
    customers: Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: `Client ${i}`,
      address: { city: "Paris", street: "rue", zip: "75000" },
    })),
    orders: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, customerId: `c${i}`, total: i })),
  }
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [wide, config],
  )
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await visibleCount(page)).toBe(12)

  // `expand`/`collapse` agissent sur l'arbre de containment. En vue graphe leur
  // effet doit etre strictement invisible : leur animation de position part de
  // rects de la vue STRUCTURE et, si elle n'est pas neutralisee, elle teleporte
  // les cartes vers l'autre repere en laissant enveloppes, aretes et zones de
  // clic sur place. On compare donc le canvas avant/apres, au pixel pres.
  const before = await page.locator("canvas").screenshot()
  await page.evaluate(() => (window as any).__graph.expand("/customers/0"))
  // Plus long que TRANSITION_MS (200 ms) : une animation parasite aurait fini.
  await page.waitForTimeout(600)
  const after = await page.locator("canvas").screenshot()

  expect(after.equals(before)).toBe(true)
  expect(await visibleCount(page)).toBe(12)
})

test("un setData concurrent d'un setView laisse des compteurs coherents", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await loadAggregateData(page)

  // `setView("graph")` dure un import dynamique plus une passe de force : un
  // `setData` peut atterrir pendant. Quel que soit celui qui gagne, l'etat
  // publie doit decrire le MEME graphe — le defaut corrige ici publiait une
  // mise en page calculee sur l'ancien.
  const other = {
    customers: Array.from({ length: 5 }, (_, i) => ({ id: `k${i}` })),
    orders: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, customerId: `k${i}` })),
  }
  const out = await page.evaluate(
    async ([d, c]: any[]) => {
      const g = (window as any).__graph
      const switching = g.setView("graph")
      await g.setData(d, c)
      await switching
      return { view: g.currentView(), stats: g.stats() }
    },
    [other, config],
  )

  expect(out.stats.logicalNodeCount).toBe(28)
  // 13 noeuds d'arbre en vue structure (racine + 2 tableaux + 10 entites),
  // 10 entites en vue graphe. Avant correction : 5, herites du graphe precedent.
  expect(out.stats.visibleNodeCount).toBe(out.view === "graph" ? 10 : 13)
  expect(errors).toEqual([])
})

test("le chevron de la carte racine plie puis deplie son agregat", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await loadAggregateData(page)
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  expect(await visibleCount(page)).toBe(5)

  // `focus` recentre la carte a l'echelle 1 : son centre tombe donc au centre
  // du canvas. La hauteur exacte de la carte depend des polices mesurees a
  // l'execution et n'est pas exposee, d'ou ce balayage vers le haut depuis le
  // centre : le premier clic qui tombe dans l'en-tete plie l'agregat. Les
  // clics precedents atterrissent dans le corps de la carte, ou ils ne font
  // que selectionner (aucune ligne de Customer ne porte de reference).
  await page.evaluate(() => (window as any).__graph.focus("/customers/0"))
  const box = (await page.locator("canvas").boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  let headerDy: number | null = null
  for (let dy = -10; dy >= -80; dy -= 5) {
    await page.mouse.click(cx, cy + dy)
    await page.waitForTimeout(250)
    if ((await visibleCount(page)) === 3) {
      headerDy = dy
      break
    }
  }

  // Repli : c1 reste seule, o1 et o2 disparaissent ; c2 et o3 sont intacts.
  expect(headerDy).not.toBeNull()
  expect(await visibleCount(page)).toBe(3)

  // Depli : le meme chevron ramene les membres.
  await page.mouse.click(cx, cy + headerDy!)
  await expect.poll(() => visibleCount(page), { timeout: 5000 }).toBe(5)

  expect(errors).toEqual([])
})
