import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The main barrel must not reach the graph-view engine: that engine is reserved
 * for the `./graph-layout` entry point, loaded dynamically by the renderer.
 * Without this test, a plain `export … from "./graph-layout.js"` in `index.ts`
 * would re-merge the two entry points with nothing to flag it.
 *
 * WHAT THIS TEST GUARDS HAS CHANGED IN STAKES, and that is worth saying rather
 * than letting people believe it is still worth what it once was. It used to
 * guard ~178 kB gzip: the old engine imported `cytoscape` + `cytoscape-fcose`
 * statically, and re-exporting the entry point from `index.ts` forced them on
 * every consumer of the structure view alone. That engine and those two
 * dependencies are gone. The `graph-layout-*.js` chunk of `apps/demo`'s
 * production Vite build dropped from **180.28 kB gzip to 3.58 kB** — measured —
 * so an accidental merge would cost 3.58 kB on a 559 kB bundle today. In
 * kilobytes, this test no longer guards anything.
 *
 * It is kept all the same, for what remains checkable and has no substitute:
 * that the graph view is reachable ONLY through the separate entry point. That
 * is what makes its loading lazy by construction, and therefore what will make
 * the next weight added behind that view — a bigger engine, a solver, a worker —
 * lazy by default instead of dependent on someone re-reading the code. The day
 * someone judges the separation no longer worth it, this test is the thing to
 * delete knowingly, not to let rot into an empty assertion about a "cytoscape"
 * string that exists nowhere any more.
 *
 * The test follows RECURSIVELY every relative import/export reachable from
 * `dist/index.js`, instead of grepping that single file. This is indispensable,
 * and it is the part that must on no account be "simplified": this package
 * builds two entry points in the same tsup pass, which factors shared code into
 * chunks (`dist/chunk-*.js`). If `index.ts` starts re-exporting
 * `graph-layout.js`, it is the CHUNK that holds the engine — `dist/index.js`
 * itself then contains no more than an `import { … } from "./chunk-XXXX.js"`,
 * and a single-file grep would never see the symbol go by while letting the
 * merge happen.
 *
 * This test covers only the "core" HALF of the chain. The other half — the
 * renderer, which must reach `./graph-layout` only through a dynamic `import()`
 * — is guarded by `packages/renderer/test/bundle-purity.test.ts`.
 */
describe("bundle purity", () => {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url))
  const entry = join(distDir, "index.js")

  it("keeps the graph-view engine out of the main entry point's transitive closure", () => {
    if (!existsSync(entry)) {
      throw new Error("dist/index.js is missing — run `pnpm --filter @defsquare/data-graph-core build` before this test")
    }

    // Breadth-first walk over the relative specifiers, with a `visited` set that
    // serves both as a cycle guard and as memoization.
    const visited = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (visited.has(file)) continue
      visited.add(file)

      const source = readFileSync(file, "utf8")
      // The factory's name, not the module's: tsup renames and moves files, but
      // the exported symbol survives bundling.
      expect(source, `${file} reaches the graph-view engine`).not.toMatch(
        /createTwoLevelLayoutEngine/,
      )

      for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        const specifier = match[1]!
        queue.push(join(dirname(file), specifier))
      }
    }
  })

  it("still finds the engine on the other entry point", () => {
    // Counter-guard: without it, renaming the factory would make the assertion
    // above pass for the wrong reasons, and deleting the engine would make it
    // pass too.
    const graphEntry = join(distDir, "graph-layout.js")
    if (!existsSync(graphEntry)) {
      throw new Error("dist/graph-layout.js is missing — run the build before this test")
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
