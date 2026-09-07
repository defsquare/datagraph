import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * Le barrel principal ne doit pas atteindre le moteur de la vue graphe : il est
 * réservé au point d'entrée `./graph-layout`, chargé dynamiquement par le
 * renderer. Sans ce test, un simple `export … from "./graph-layout.js"` dans
 * `index.ts` refusionnerait les deux points d'entrée sans que rien ne le
 * signale.
 *
 * CE QUE CE TEST GARDE A CHANGÉ D'ENJEU, et il faut le dire plutôt que de
 * laisser croire qu'il vaut toujours ce qu'il valait. Il gardait ~178 ko gzip :
 * l'ancien moteur importait `cytoscape` + `cytoscape-fcose` statiquement, et
 * réexporter le point d'entrée depuis `index.ts` les imposait à tout
 * consommateur de la seule vue structure. Ce moteur et ces deux dépendances
 * sont retirés. Le chunk `graph-layout-*.js` du build Vite de production
 * d'`apps/demo` est tombé de **180,28 ko gzip à 3,58 ko** — mesuré —, et une
 * fusion accidentelle coûterait donc aujourd'hui 3,58 ko sur un bundle de
 * 559 ko. En kilo-octets, ce test ne garde plus rien.
 *
 * Il est gardé quand même, pour ce qui reste vérifiable et qui n'a pas de
 * substitut : que la vue graphe est atteignable UNIQUEMENT par le point
 * d'entrée séparé. C'est ce qui rend son chargement paresseux par construction,
 * donc ce qui fera que le prochain poids ajouté derrière cette vue — un moteur
 * plus gros, un solveur, un worker — sera paresseux par défaut au lieu de
 * dépendre d'une relecture. Le jour où quelqu'un juge que la séparation ne vaut
 * plus la peine, c'est ce test qu'il faut supprimer sciemment, pas laisser
 * pourrir en assertion vide sur une chaîne « cytoscape » qui n'existe plus nulle
 * part.
 *
 * Le test suit RÉCURSIVEMENT tout import/export relatif atteint depuis
 * `dist/index.js`, au lieu de ne grepper que ce seul fichier. C'est
 * indispensable, et c'est la partie qu'il ne faut surtout pas « simplifier » :
 * ce package construit deux points d'entrée dans la même passe tsup, qui
 * factorise le code partagé dans des chunks (`dist/chunk-*.js`). Si `index.ts`
 * se met à réexporter `graph-layout.js`, c'est le CHUNK qui contient le moteur —
 * `dist/index.js` lui-même ne contient alors plus qu'un
 * `import { … } from "./chunk-XXXX.js"`, et un grep mono-fichier ne verrait
 * jamais passer le symbole tout en laissant la fusion se faire.
 *
 * Ce test ne couvre que la MOITIÉ « cœur » de la chaîne. L'autre moitié — le
 * renderer, qui doit n'atteindre `./graph-layout` que par `import()` dynamique
 * — est gardée par `packages/renderer/test/bundle-purity.test.ts`.
 */
describe("bundle purity", () => {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url))
  const entry = join(distDir, "index.js")

  it("keeps the graph-view engine out of the main entry point's transitive closure", () => {
    if (!existsSync(entry)) {
      throw new Error("dist/index.js absent — lancer `pnpm --filter @defsquare/data-graph-core build` avant ce test")
    }

    // Parcours en largeur des specifiers relatifs, avec un ensemble `visited`
    // qui sert à la fois de garde anti-cycle et de mémoïsation.
    const visited = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (visited.has(file)) continue
      visited.add(file)

      const source = readFileSync(file, "utf8")
      // Le nom de la factory, et non celui du module : tsup renomme et déplace
      // les fichiers, mais le symbole exporté survit au bundling.
      expect(source, `${file} atteint le moteur de la vue graphe`).not.toMatch(
        /createTwoLevelLayoutEngine/,
      )

      for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        const specifier = match[1]!
        queue.push(join(dirname(file), specifier))
      }
    }
  })

  it("still finds the engine on the other entry point", () => {
    // Contre-garde : sans elle, renommer la factory ferait passer l'assertion
    // ci-dessus pour de mauvaises raisons, et supprimer le moteur la ferait
    // passer aussi.
    const graphEntry = join(distDir, "graph-layout.js")
    if (!existsSync(graphEntry)) {
      throw new Error("dist/graph-layout.js absent — lancer le build avant ce test")
    }
    const visited = new Set<string>()
    const queue = [graphEntry]
    let found = false
    while (queue.length > 0) {
      const file = queue.pop()!
      if (visited.has(file) || !existsSync(file)) continue
      visited.add(file)
      const source = readFileSync(file, "utf8")
      if (/createTwoLevelLayoutEngine/.test(source)) found = true
      for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        queue.push(join(dirname(file), match[1]!))
      }
    }
    expect(found).toBe(true)
  })
})
