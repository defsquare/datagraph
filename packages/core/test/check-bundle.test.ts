import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { buildCheckBundle } from "../scripts/check-bundle.js"

/**
 * Layer 1 of the `--check` test plan: the closure of `validate.ts` must stay
 * narrow. Without this, an import added there brings elkjs into the binary — an
 * 18,798-byte bundle becomes 1.5 MB — with nothing to signal it.
 *
 * The march is RECURSIVE over relative imports, the same shape as
 * `bundle-purity.test.ts`, and it walks the SOURCES rather than `dist/`:
 * `validate.ts` is not a tsup entry point, it only ever exists as a bundle.
 */
describe("check bundle purity", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url))

  function closureOf(entry: string): Map<string, string> {
    const files = new Map<string, string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (files.has(file)) continue
      const source = readFileSync(file, "utf8")
      files.set(file, source)
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1]!
        expect(specifier.startsWith("."), `${file} imports the package "${specifier}"`).toBe(true)
        queue.push(join(dirname(file), specifier.replace(/\.js$/, ".ts")))
      }
    }
    return files
  }

  it("reaches build, config, selector and model — and nothing else", () => {
    const closure = closureOf(join(srcDir, "validate.ts"))
    const names = [...closure.keys()].map((file) => file.slice(srcDir.length + 1)).sort()
    expect(names).toEqual(["build.ts", "config.ts", "model.ts", "selector.ts", "validate.ts"])
  })

  it("expects no host global", () => {
    // The engine that runs this bundle starts on a bare ES: `console`, timers and
    // `fetch` exist only if someone adds them. The measurement that made the whole
    // design viable was that there is nothing to add — this test is what keeps it
    // true.
    const closure = closureOf(join(srcDir, "validate.ts"))
    for (const [file, source] of closure) {
      expect(source, `${file} expects a host global`).not.toMatch(
        /\b(console|process|structuredClone|Proxy|Symbol|setTimeout|fetch)\b/,
      )
      expect(source, `${file} uses an async construct`).not.toMatch(/\b(async|await)\b|function\*/)
    }
  })
})

/**
 * Layer 2: the committed file is the one the binary embeds. Same contract as
 * `apps/demo/src/tokens.css` (ADR-0027) — generated AND committed, because
 * `include_str!` needs it at Rust compile time and cargo must never depend on
 * pnpm. This test is the guard against forgetting to regenerate.
 */
describe("generated check.js", () => {
  const committed = fileURLToPath(
    new URL("../../../apps/demo/src-tauri/generated/check.js", import.meta.url),
  )

  it("is up to date (byte for byte)", () => {
    expect(readFileSync(committed, "utf8")).toBe(buildCheckBundle())
  })

  it("exposes the boundary the binary calls", () => {
    const bundle = readFileSync(committed, "utf8")
    expect(bundle).toContain("globalThis.__datagraph_check")
    expect(bundle).toContain("GENERATED FILE")
  })

  it("stays small enough that nobody has to wonder", () => {
    // Not minified on purpose: 18,798 bytes weighs nothing against a 9.2 MB
    // binary, and buys a diff that can be reviewed plus a test failure that
    // can be read. The ceiling is here to catch a dependency creeping in, not to
    // police bytes.
    expect(readFileSync(committed, "utf8").length).toBeLessThan(64 * 1024)
  })
})
