import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Le barrel principal ne doit tirer ni cytoscape ni fcose : ils sont réservés
 * au point d'entrée `./graph-layout`, chargé dynamiquement par le renderer.
 * Sans ce test, un simple `export … from "./layout-graph.js"` dans index.ts
 * imposerait ~183 ko gzip à qui n'utilise que la vue structure. */
describe("bundle purity", () => {
  const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url))

  it("keeps cytoscape out of the main entry point", () => {
    if (!existsSync(dist)) {
      throw new Error("dist/index.js absent — lancer `pnpm --filter @defsquare/data-graph-core build` avant ce test")
    }
    const source = readFileSync(dist, "utf8")
    expect(source).not.toMatch(/cytoscape/)
  })
})
