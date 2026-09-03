import { test, expect, type Page } from "@playwright/test"

/**
 * Une reference portee par un VALUE OBJECT : `CartLine` n'a pas d'identite —
 * ce n'est pas une entite, elle n'a ni `id` ni carte en vue graphe — et elle
 * porte pourtant le `productRef`. Le cas etait inexprimable : le declarer sur
 * `Cart` avec un chemin (`lines[*].productRef`) est ce qui le rend exprimable.
 *
 * Ces cas vivent en e2e parce qu'ils traversent tout l'assemblage : resolution
 * a la construction, hissage du trace jusqu'a un ancetre visible, appartenance
 * d'agregat au niveau entite, et le panneau de detail de l'hote qui suit la
 * reference depuis la carte du value object.
 */
async function gotoReady(page: Page): Promise<void> {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
}

function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__graph.stats().visibleNodeCount)
}

const cartData = {
  carts: [{ id: "k1", lines: [{ sku: "A-1", productRef: "p1" }] }],
  products: [{ id: "p1", name: "Clavier" }],
}

const cartConfig = {
  entities: {
    Cart: { match: "$.carts[*]", id: "id" },
    Product: { match: "$.products[*]", id: "id" },
  },
  references: { Cart: { "lines[*].productRef": "Product" } },
  aggregates: ["Product"],
}

async function loadCart(page: Page): Promise<void> {
  await gotoReady(page)
  await page.evaluate(
    async ([d, c]: any[]) => (window as any).__graph.setData(d, c),
    [cartData, cartConfig],
  )
}

test("la reference d'un value object resout et porte son entite declarante", async ({ page }) => {
  await loadCart(page)

  // `refEdges(from)` reste indexe par le nœud QUI PORTE la ligne : c'est ce qui
  // laisse le panneau de detail poser son bouton sur la bonne ligne.
  const edges = await page.evaluate(() =>
    (window as any).__graph.refEdges("/carts/0/lines/0"),
  )
  expect(edges).toHaveLength(1)
  expect(edges[0].to).toBe("/products/0")
  expect(edges[0].fromEntity).toBe("/carts/0")
  expect(edges[0].field).toBe("productRef")

  // Aucun diagnostic : la declaration est satisfaite et la cible existe.
  const diagnostics = await page.evaluate(() => (window as any).__graph.diagnostics())
  expect(diagnostics).toEqual([])
})

test("en vue graphe l'arete est tracee sans erreur et les compteurs restent coherents", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await loadCart(page)
  await page.evaluate(() => (window as any).__graph.setView("graph"))
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.currentView()))
    .toBe("graph")

  // Deux cartes, et deux seulement : la ligne de panier n'a pas d'identite,
  // donc pas de carte. Son arete part de la carte du panier, hissee — c'est
  // exactement ce que la vue graphe doit montrer.
  expect(await visibleCount(page)).toBe(2)

  // L'appartenance d'agregat n'a pas d'API publique : ce qu'on peut en observer
  // ici, c'est que le calcul du niveau entite (agregats, packing radial, tirage
  // inter-clusters) traverse une arete dont la source n'est PAS une entite sans
  // rien casser. Le contenu de l'agregat, lui, est verifie en test de cœur.
  expect(errors).toEqual([])
})

test("en vue structure, deplier le jeton rend la carte de la ligne et son bouton de reference", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))

  await loadCart(page)
  const before = await visibleCount(page)

  // Le tableau `lines` est elide : il vit comme une LIGNE a jeton sur la carte
  // du panier, et c'est ce jeton qui deplie la carte de la ligne de panier.
  await page.evaluate(() => (window as any).__graph.expand("/carts/0/lines"))
  await expect.poll(() => visibleCount(page)).toBe(before + 1)

  const edges = await page.evaluate(() =>
    (window as any).__graph.refEdges("/carts/0/lines/0"),
  )
  expect(edges).toHaveLength(1)
  expect(edges[0].to).toBe("/products/0")

  // Le panneau de detail de l'hote n'a rien de special a savoir : la ligne
  // `productRef` est une ligne comme une autre du nœud selectionne, et son
  // bouton suit la reference jusqu'au produit.
  await page.evaluate(() => (window as any).__graph.select("/carts/0/lines/0"))
  await expect(page.locator("#selection-path")).toContainText("/carts/0/lines/0")
  await page.click("#selection-rows .ref-btn:not([disabled])")
  await expect(page.locator("#selection-label")).toContainText("Product #p1")

  expect(errors).toEqual([])
})
