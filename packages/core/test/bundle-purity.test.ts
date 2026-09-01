import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/** Le barrel principal ne doit tirer ni cytoscape ni fcose : ils sont réservés
 * au point d'entrée `./graph-layout`, chargé dynamiquement par le renderer.
 * Sans ce test, un simple `export … from "./layout-graph.js"` dans index.ts
 * imposerait ~178 ko gzip à qui n'utilise que la vue structure.
 *
 * Le test suit RÉCURSIVEMENT tout import/export relatif atteint depuis
 * `dist/index.js`, au lieu de ne grepper que ce seul fichier. C'est
 * indispensable : ce package construit deux points d'entrée dans la même
 * passe tsup, qui factorise le code partagé dans des chunks
 * (`dist/chunk-*.js`). Si `index.ts` se met à réexporter `graph-layout.js`,
 * c'est le CHUNK qui importe cytoscape — `dist/index.js` lui-même ne
 * contient alors plus qu'un `import { … } from "./chunk-XXXX.js"`, et un
 * grep mono-fichier ne verrait jamais passer la chaîne "cytoscape" tout en
 * laissant fuiter ~178 ko gzip dans le bundle. Ne PAS « simplifier » cette
 * marche en un grep d'un seul fichier : c'est précisément la régression que
 * ce test doit attraper.
 *
 * Ce test ne couvre que la MOITIÉ « cœur » de la chaîne. L'autre moitié — le
 * renderer, qui doit n'atteindre `./graph-layout` que par `import()` dynamique
 * — est gardée par `packages/renderer/test/bundle-purity.test.ts`. */
describe("bundle purity", () => {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url))
  const entry = join(distDir, "index.js")

  it("keeps cytoscape out of the main entry point's transitive closure", () => {
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
      expect(source).not.toMatch(/cytoscape/)

      for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        const specifier = match[1]!
        queue.push(join(dirname(file), specifier))
      }
    }
  })
})
