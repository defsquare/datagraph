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

// La config de la demo declare `aggregates: ["Customer", "Product"]` (voir
// `src/sample-data.ts`), mais son jeu par defaut ne compte que 8 entites : les
// tests ci-dessous injectent par `setData` des jeux calibres pour ce qu'ils
// prouvent, avec leur PROPRE config a une seule racine — ils portent sur la
// bascule de vue et les compteurs, pas sur l'arbitrage entre racines, qui est
// couvert cote coeur (`aggregate.test.ts`). Le dernier test du fichier, lui,
// travaille sur le jeu etendu reel de la demo et sa vraie config, sans
// injection. Deux agregats (un par Customer), cinq entites au total, toutes
// visibles en vue graphe : elle ne plie rien.
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
  // 11 CARTES en vue structure : la racine plus 10 entites. Les deux tableaux
  // `customers` et `orders` sont elides — ils sont deux LIGNES de la carte
  // racine, pas deux cartes — et `stats()` compte ce qui est dessine.
  // `logicalNodeCount` ne bouge pas, lui : le nœud tableau existe toujours.
  // 10 entites en vue graphe. Avant correction : 5, herites du graphe precedent.
  expect(out.stats.visibleNodeCount).toBe(out.view === "graph" ? 10 : 11)
  expect(errors).toEqual([])
})

test("la vue graphe tient sur le jeu de donnees etendu de la demo", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text())
  })

  await gotoReady(page)

  // Les autres tests de ce fichier injectent des jeux minuscules (5 et 12
  // entites) : aucun ne met la vue graphe sous charge. C'est pourtant le jeu
  // etendu qui motive toute cette vue — c'est son rapport de bbox de 1:21 en
  // vue structure qu'elle existe pour corriger — et c'est le seul endroit ou la
  // passe de separation, le recouvrement des enveloppes et le temps de mise en
  // page travaillent pour de vrai. La config de la demo declare deja
  // `aggregates: ["Customer", "Product"]`, donc il suffit du bouton de bascule
  // de jeu.
  await page.click("#toggle-dataset")
  // Le clic ne fait que lancer un gestionnaire async. On attend le compteur
  // plutot que le libelle du bouton : c'est la preuve que `setData` a fini de
  // construire ET de mettre en page le nouveau jeu, et ca ne depend d'aucune
  // chaine d'interface.
  await expect
    .poll(() => page.evaluate(() => (window as any).__graph.stats().logicalNodeCount), {
      timeout: 30_000,
    })
    // `bigShop(4000)` produit EXACTEMENT 4061 noeuds logiques : 5 pour le
    // squelette (racine + 4 tableaux), 8 categories a 3, 30 produits a 7, 78
    // clients a 10 et 234 commandes a 13. Un chiffre exact plutot qu'un seuil,
    // pour que toute derive du generateur se voie ici.
    .toBe(4061)
  const logical = await page.evaluate(() => (window as any).__graph.stats().logicalNodeCount)

  const ms = await page.evaluate(async () => {
    const t0 = performance.now()
    await (window as any).__graph.setView("graph")
    return performance.now() - t0
  })

  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("graph")

  // `bigShop(4000)` de la demo produit 78 clients, 234 commandes, 30 produits
  // et 8 categories : 350 entites, toutes visibles puisque la vue graphe ne
  // plie rien. Elle ne montre QUE des entites, donc c'est exactement le compte
  // attendu — un chiffre exact plutot qu'une borne, pour que toute derive du
  // fixture se voie.
  expect(await visibleCount(page)).toBe(350)

  // Recadrage et rendu sous charge : le canvas doit rester peint, et rien ne
  // doit avoir ete jete dans la console.
  await expect(page.locator("canvas")).toBeVisible()
  expect(errors).toEqual([])

  // Temps mesure au passage : import dynamique du chunk, mise en page a deux
  // niveaux (packing intra-agregat + simulation sur les disques) et rendu.
  //
  // Pas d'assertion serree, et le plafond ne bouge pas : la machine de CI n'est
  // pas celle du developpeur, et ce plafond large n'est la que pour attraper un
  // effondrement franc. Ce qu'il vaut a change, en revanche, et c'est mesure ici
  // meme, dans ce test, sur cette machine, en runs isoles (3 chacun) :
  // l'ancien moteur (fcose + separateOverlaps + separateClusters) sortait a
  // 4310-4484 ms, le moteur a deux niveaux sort a 220-252 ms — environ x19. Le
  // plafond de 30 s couvrait l'ancien avec un facteur 7 ; il en couvre
  // largement plus aujourd'hui, donc il reste utile sans etre a re-serrer.
  expect(ms).toBeLessThan(30_000)
  console.log(`[e2e] setView("graph") sur ${logical} noeuds logiques / 350 entites : ${ms.toFixed(0)} ms`)

  // Retour en vue structure : la bascule doit rester reversible a cette echelle.
  await page.evaluate(() => (window as any).__graph.setView("structure"))
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")
  expect(errors).toEqual([])
})
