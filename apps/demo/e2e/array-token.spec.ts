import { test, expect, type Page } from "@playwright/test"

/**
 * Un tableau n'est plus une carte : c'est une LIGNE de la carte de son parent,
 * dont la valeur est un jeton `[ n items ]` qui plie et deplie ses elements.
 *
 * Ces cas vivent en e2e et non en test unitaire parce qu'ils traversent tout ce
 * que le renderer assemble — routage du clic par `rowIndexAt`, `CollapseState`,
 * mise en page incrementale, redessin — et qu'aucun test de `packages/renderer`
 * ne monte `createDataGraph` (ni DOM, ni jsdom configure).
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

const TAGS = "/products/0/tags"

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

/**
 * Amene le jeton de `arrayId` au centre du viewport, puis clique dessus.
 *
 * `focus()` sur un tableau centre la BANDE DE SA LIGNE — un tableau elide n'a
 * pas de rect a lui — donc le centre du canvas tombe sur le jeton. C'est ce qui
 * rend ce clic robuste sans coordonnee en dur : aucune capture d'ecran n'a servi
 * a le calibrer, et une carte qui changerait de hauteur ne le casserait pas.
 *
 * L'abscisse n'a d'ailleurs pas d'importance pour le routage : `rowIndexAt` ne
 * lit que l'ordonnee. La centrer garantit seulement qu'on reste dans la carte.
 */
async function clickToken(page: Page, arrayId: string): Promise<void> {
  await page.evaluate((id) => (window as any).__graph.focus(id), arrayId)
  await page.waitForTimeout(600)
  const box = (await page.locator("canvas").boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(600)
}

test("le jeton d'un tableau deplie une carte par element, puis les replie", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)
  const before = await visibleCount(page)

  await clickToken(page, TAGS)
  // `tags` compte trois elements SCALAIRES : c'est le cas qui ne rendait qu'une
  // seule carte avant cette refonte, les scalaires y etant des lignes du
  // tableau et non des nœuds.
  expect(await visibleCount(page)).toBe(before + 3)

  await clickToken(page, TAGS)
  expect(await visibleCount(page)).toBe(before)
  expect(errors).toEqual([])
})

test("un tableau elide ne compte pas comme une carte", async ({ page }) => {
  await gotoReady(page)

  // Les quatre collections racine sont elidees et DEPLIEES d'entree : la racine
  // plus les huit entites font neuf cartes. Les quatre nœuds tableau sont bien
  // visibles — leurs lignes le sont — mais ils ne sont pas dessines, et
  // `stats()` compte ce qui est a l'ecran.
  expect(await visibleCount(page)).toBe(9)

  const counts = await page.evaluate(() => {
    const g = (window as any).__graph
    return { logical: g.stats().logicalNodeCount }
  })
  // `logicalNodeCount` ne bouge pas, lui : le nœud tableau existe toujours, et
  // un element scalaire coute exactement ce que coutait la ligne qu'il remplace.
  expect(counts.logical).toBe(76)
})

/**
 * Une ENTITE imbriquee dans un tableau elide reste pleinement presente en vue
 * graphe, sans qu'aucun depliage soit necessaire.
 *
 * C'est l'invariant qui rend l'elision sans danger, et il n'a rien d'evident :
 * on pourrait croire qu'un tableau sans carte cache ce qu'il contient. Il n'en
 * cache rien, parce que la vue graphe ne trouve pas ses entites en descendant
 * l'arbre de containment — `entityIdsOf` balaie tous les nœuds — et parce
 * qu'une reference ne naît que d'une entite (`buildGraph` ignore les autres
 * nœuds). Un objet ordinaire imbrique ne peut donc pas cacher de reference, et
 * une entite imbriquee n'est jamais cachee.
 */
const nestedData = {
  customers: [{ id: "c1", name: "Dubois" }],
  orders: [
    {
      id: "o1",
      total: 10,
      lines: [
        { id: "l1", customerId: "c1", sku: "A-1" },
        { id: "l2", customerId: "c1", sku: "B-7" },
      ],
    },
  ],
}

const nestedConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    Line: { match: "$.orders[*].lines[*]", id: "id" },
  },
  references: { Line: { customerId: "Customer" } },
  aggregates: ["Customer"],
}

test("une entite imbriquee dans un tableau elide garde sa reference en vue graphe", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await gotoReady(page)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [nestedData, nestedConfig],
  )

  // La reference existe bien sur l'entite imbriquee, et elle resout.
  const line = await page.evaluate(() => (window as any).__graph.refEdges("/orders/0/lines/0"))
  expect(line).toHaveLength(1)
  expect(line[0].to).toBe("/customers/0")

  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // Quatre entites : c1, o1, l1, l2. Les deux `Line` sont dans un tableau sans
  // carte, et elles sont pourtant la — c'est tout l'enjeu de ce test.
  expect(await visibleCount(page)).toBe(4)
  expect(errors).toEqual([])
})
