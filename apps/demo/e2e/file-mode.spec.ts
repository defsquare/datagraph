import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

/**
 * Le MODE FICHIER — `datagraph <data.json> [-c <config.json>]` — n'avait
 * jusqu'ici aucune preuve côté TypeScript : `cargo test` couvre le parseur argv
 * et la lecture disque, mais le chemin Rust → `invoke("launch_payload")` →
 * `resolveLaunch` → `createDataGraph` s'arrêtait à la frontière du binaire.
 *
 * Deux choses se jouent donc ici.
 *
 * 1. LE SEAM TAURI. `src/launch.ts` ne teste que `"__TAURI_INTERNALS__" in
 *    window` puis appelle `invoke` de `@tauri-apps/api/core`, dont toute
 *    l'implémentation tient en `window.__TAURI_INTERNALS__.invoke(cmd, args,
 *    options)` (vérifié dans le paquet installé, `core.js` v2.11.1). Poser cet
 *    objet AVANT le chargement des modules — d'où `addInitScript` — suffit
 *    donc à faire croire à la page qu'elle tourne dans la WebView. Rien
 *    d'autre du bundle n'atteint les internals : `core.js` ne les touche qu'à
 *    l'appel, pas au chargement.
 *
 * 2. LES FIXTURES COMMITTÉES. Le payload injecté est le CONTENU RÉEL de
 *    `fixtures/shop.json` et `fixtures/shop.config.json`, lu ici sur le disque
 *    et non recopié. C'est ce qui les fait enfin travailler : `cargo test`
 *    prouve qu'elles sont du JSON, ce fichier prouve que leur config est
 *    valide pour le cœur et que leurs `ids`/`refs`/`groups` décrivent bien la
 *    donnée. Si les fixtures dérivent du contrat, ces tests cassent — et c'est
 *    le seul endroit où cela peut se voir.
 */

const shopData = readFileSync(new URL("../fixtures/shop.json", import.meta.url), "utf8")
const shopConfig = readFileSync(new URL("../fixtures/shop.config.json", import.meta.url), "utf8")

/** Miroir du `LaunchPayload` Rust : les deux fichiers en chaînes BRUTES, le
 * parsing restant au frontend. */
interface RawPayload {
  data: string
  config: string | null
}

/**
 * Installe le faux `__TAURI_INTERNALS__` puis charge la page. Le shim ne
 * répond qu'à `launch_payload` — toute autre commande devient une erreur
 * bruyante plutôt qu'un `undefined` silencieux qui ferait passer un test pour
 * de mauvaises raisons.
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

/** Même réveil que les autres specs : `window.__graph` est posé
 * synchroniquement bien avant que le graphe soit construit et mis en page. */
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
  // Le bouton « jeu de données » n'a plus de sens quand l'utilisateur a fourni
  // le sien : `main.ts` le retire du DOM, pas seulement de la vue.
  await expect(page.locator("#toggle-dataset")).toHaveCount(0)
  // La config déclare des `ids`, donc la vue graphe reste offerte.
  await expect(page.locator("#toggle-view")).toHaveCount(1)

  // Les entités de la fixture sont bien là, avec le type et l'id que la config
  // en déduit : c'est `ids` qui est prouvé ici, pas seulement le chargement.
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
  await page.evaluate(() => (window as any).__graph.select("/orders/1"))
  await expect(page.locator("#selection-label")).toContainText("Order #o2")

  // Et `refs` : la commande o1 pointe vers le client c1 par `customerId`.
  const refs = await page.evaluate(() =>
    (window as any).__graph
      .refEdges("/orders/0")
      .map((e: any) => ({ field: e.field, to: e.to, dangling: e.dangling })),
  )
  expect(refs).toEqual([{ field: "customerId", to: "/customers/0", dangling: false }])

  // Une fixture qui dériverait du contrat laisserait des diagnostics derrière
  // elle (référence pendante, id manquant) : ils doivent rester vides.
  const diagnostics = await page.evaluate(() => (window as any).__graph.diagnostics())
  expect(diagnostics).toEqual([])
})

test("mode fichier sans config : vue structure seule", async ({ page }) => {
  await gotoFileMode(page, { data: shopData, config: null })
  await waitReady(page)

  await expect(page.locator("canvas")).toBeVisible()
  await expect(page.locator("#toggle-dataset")).toHaveCount(0)
  // Sans `ids`, aucune entité, donc aucun agrégat : la vue graphe n'aurait rien
  // à montrer et `main.ts` retire son bouton.
  await expect(page.locator("#toggle-view")).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__graph.currentView())).toBe("structure")

  // Le document est tout de même exploré, en objets et tableaux nus.
  expect(await page.evaluate(() => (window as any).__graph.stats().logicalNodeCount)).toBeGreaterThan(
    0,
  )
})

test("mode fichier : une config sémantiquement invalide s'affiche à l'écran", async ({ page }) => {
  // `groups` ne peut nommer que des `ids` déclarés — la faute est SÉMANTIQUE :
  // Rust la laisse passer (c'est du JSON valide), seul `validateConfig` la voit.
  const broken = JSON.stringify({ ...JSON.parse(shopConfig), groups: ["Ghost"] })
  await gotoFileMode(page, { data: shopData, config: broken })

  // `createDataGraph` échoue de façon synchrone, donc `main.ts` relance après
  // avoir peint l'écran d'erreur : `window.__graph` ne sera jamais posé et
  // attendre `ready` bloquerait. C'est l'écran qu'on attend.
  await expect(page.locator("#load-error")).toBeVisible()
  await expect(page.locator("#load-error-message")).toContainText("Ghost")
})
