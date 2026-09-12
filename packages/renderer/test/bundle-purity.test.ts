import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The renderer counterpart of `packages/core`'s purity test — and the chain's
 * missing half. The core one checks that the CORE's `dist/index.js` does not
 * reach the graph view engine; but that view's lazy loading does NOT hinge
 * there: it hinges on two lines of `src/graph-view.ts`, the `import type` of the
 * `./graph-layout` entry point and `ensureModule`'s dynamic `import()`. Turning
 * that `import type` into a value import is enough to pull everything that entry
 * point drags into EVERY consumer's bundle — and, before this test, the whole
 * suite (core, renderer, e2e), the build and the typecheck all stayed green.
 *
 * THE STAKES HAVE CHANGED BY AN ORDER OF MAGNITUDE, and saying so is part of the
 * test. Those two lines were holding back ~178 kB gzip as long as the old engine
 * imported `cytoscape` + `cytoscape-fcose`; that engine is gone and the chunk now
 * measures **3.58 kB gzip** instead of 180.28. A regression would therefore cost
 * 3.58 kB, not 178. What those two lines still hold, and what has no substitute,
 * is the SHAPE: the graph view is loaded on demand by construction, `setView` is
 * async for that reason, and any weight added behind that view inherits the
 * laziness instead of having to ask for it again. See the same clarification in
 * `packages/core/test/bundle-purity.test.ts`.
 *
 * Those two lines USED TO LIVE in `src/create.ts`; they followed the graph view's
 * state into `src/graph-view.ts` (step M2a of
 * `docs/superpowers/specs/2026-09-06-view-machine-design.md`), and this test with
 * them. Nothing about the rule changed: the first assertion sweeps ALL of the
 * renderer's sources and knows no file name, so the ban on a value import still
 * stands everywhere — `create.ts` included, which keeps an `import type` of the
 * same entry point to relay `TwoLevelLayoutOptions` to the public API. Only the
 * counter-guard, which must name the file where the dynamic `import()` lives,
 * changed target.
 *
 * The test is deliberately a regex examination of the SOURCE rather than an
 * inspection of the bundle: what has to be forbidden is a syntactic property
 * ("no static value import of this specifier"), which the renderer's `dist/` does
 * not reveal — tsup erases the `import type` just as it would preserve a value
 * import, and only the consumer's bundler, downstream, would see the difference.
 * Reading the source is the honest way to test this: it is exactly the invariant
 * one would ask a reviewer to hold by hand.
 */

/** Strips block and line comments. Indispensable: the comment that documents
 * this very rule above the import contains the words "`import type`", and an
 * early version of this test latched onto it — it read the comment, saw a
 * compliant `import type` there, and therefore let the VALUE import sitting just
 * below slip through. The `[^:]` guard avoids truncating an `https://` mistaken
 * for a comment. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * THE ONE EXEMPTION, and it is named so that nobody can add another by
 * inattention.
 *
 * `src/graph-layout-worker.ts` STATICALLY imports the `./graph-layout` entry
 * point — it has no choice: it is the body of a Web Worker, and a dynamic
 * `import()` there would add a round trip and buy nothing. The rule it breaks
 * does not concern it, because that rule protects the CONSUMER's bundle: this
 * file is a build ENTRY of its own (see `tsup.config.ts`), published as
 * `@defsquare/datagraph/graph-layout-worker` and referred to by URL, never
 * imported.
 *
 * The exemption therefore has a PRICE, checked right below: nobody imports this
 * file. The day a module of `src/` refers to it, it would drag the engine into
 * every consumer's bundle exactly as the forbidden import would, and this is the
 * test that would say so.
 */
const WORKER_ENTRY = "graph-layout-worker.ts";

describe("bundle purity (renderer sources)", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const SPECIFIER = "@defsquare/datagraph-core/graph-layout";
  const SPEC_RE = SPECIFIER.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: stripComments(readFileSync(join(srcDir, name), "utf8")) }));

  it("has sources to scan", () => {
    // Guard against a hollow test: were the folder empty or wrongly resolved,
    // every assertion below would pass while checking nothing.
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.map((s) => s.name)).toContain("create.ts");
    // The carrier of the lazy loading: a rename or a deletion must fail THIS
    // test, not quietly make the counter-guard below vacuous.
    expect(sources.map((s) => s.name)).toContain("graph-view.ts");
    // Same for the exempted entry: were the file to disappear, the exemption
    // would become a named hole in thin air.
    expect(sources.map((s) => s.name)).toContain(WORKER_ENTRY);
  });

  it("never statically imports the graph-layout entry point as a value", () => {
    for (const { name, code } of sources.filter((s) => s.name !== WORKER_ENTRY)) {
      // `import <clause> from "<specifier>"` — the clause must start with
      // `type`. Anchored at the start of a line (`^[ \t]*`, `m` flag): an import
      // declaration always is. The clause may run over several lines (named
      // imports) but must not cross another `from`, otherwise the capture would
      // start at an earlier import in the file and swallow everything between
      // the two.
      const withClause = new RegExp(
        `^[ \\t]*import\\s+((?:(?!\\bfrom\\b)[\\s\\S])*?)from\\s+["']${SPEC_RE}["']`,
        "gm",
      );
      for (const match of code.matchAll(withClause)) {
        expect(
          match[1]!.trimStart().startsWith("type"),
          `${name}: import de VALEUR vers ${SPECIFIER} — la vue graphe entrerait dans le bundle de tout consommateur`,
        ).toBe(true);
      }

      // Bare import (`import "<specifier>"`) and re-export (`export … from`):
      // two forms that admit no `type` clause, hence forbidden outright.
      expect(code, `${name}: import nu de ${SPECIFIER}`).not.toMatch(
        new RegExp(`^[ \\t]*import\\s+["']${SPEC_RE}["']`, "m"),
      );
      expect(code, `${name}: réexport de ${SPECIFIER}`).not.toMatch(
        new RegExp(`^[ \\t]*export\\s+(?:(?!\\bfrom\\b)[\\s\\S])*?from\\s+["']${SPEC_RE}["']`, "m"),
      );
    }
  });

  it("still reaches the engine through a dynamic import", () => {
    // Counter-guard for the previous assertion: without it, simply deleting both
    // imports would make that one pass while breaking the graph view. The ONLY
    // runtime path to the engine must remain this dynamic `import()`, and the
    // types must come from an `import type`.
    const graphView = sources.find((s) => s.name === "graph-view.ts")!.code;
    expect(graphView).toMatch(new RegExp(`import\\(\\s*["']${SPEC_RE}["']`));
    expect(graphView).toMatch(
      new RegExp(
        `^[ \\t]*import\\s+type\\s+(?:(?!\\bfrom\\b)[\\s\\S])*?from\\s+["']${SPEC_RE}["']`,
        "m",
      ),
    );

    // And NOWHERE else: a second `import()` of the same entry point would mean a
    // second loading path, which nothing would keep in agreement with this one —
    // and that path is precisely what `graph-view.ts` owns outright since M2a.
    // `create.ts` in particular no longer keeps any.
    const dynamicImporters = sources
      .filter(({ code }) => new RegExp(`import\\(\\s*["']${SPEC_RE}["']`).test(code))
      .map((s) => s.name);
    expect(dynamicImporters).toEqual(["graph-view.ts"]);
  });
});

/**
 * THE OTHER HALF OF THE EXEMPTION. What the worker is allowed to do (import the
 * engine) is settled; what is checked here is the price it pays for that right.
 *
 * Three properties, and each would break the worker silently if it fell:
 *
 *  - NOBODY IMPORTS IT. This is what makes the exemption harmless: an
 *    `import "./graph-layout-worker.js"` from `create.ts` or `index.ts` would
 *    drag the engine into every consumer's bundle, without any other test
 *    flinching.
 *  - NO PIXI. A worker has no canvas; importing Pixi would make it fail at load,
 *    and the in-process fallback would hide the failure behind a mere warning —
 *    the graph view would work, without a worker, without anyone knowing.
 *  - NO DOM. Same mechanics: `document` and `window` do not exist over there.
 *    The examination is syntactic and coarse, but it catches the real mistake we
 *    fear — a piece of renderer code copied into the worker.
 */
describe("bundle purity (layout worker)", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: stripComments(readFileSync(join(srcDir, name), "utf8")) }));
  const worker = sources.find((s) => s.name === WORKER_ENTRY)!;

  it("is imported by NOBODY: it is a build entry point, not a package module", () => {
    const importers = sources
      .filter((s) => s.name !== WORKER_ENTRY)
      .filter(({ code }) => /["']\.\/graph-layout-worker(\.js)?["']/.test(code))
      .map((s) => s.name);
    expect(importers).toEqual([]);
  });

  it("does import the engine, and statically", () => {
    // Counter-guard: without it, emptying the file would make all the rest pass.
    expect(worker.code).toMatch(
      /^[ \t]*import\s+\{[^}]*layoutFromInput[^}]*\}\s+from\s+["']@defsquare\/datagraph-core\/graph-layout["']/m,
    );
  });

  it("imports neither Pixi nor anything from the rendering", () => {
    expect(worker.code).not.toMatch(/from\s+["']pixi\.js["']/);
    // The only renderer import allowed is the PROTOCOL's, and it must be an
    // `import type` — the worker must drag no code out of here.
    for (const match of worker.code.matchAll(
      /^[ \t]*import\s+((?:(?!\bfrom\b)[\s\S])*?)from\s+["'](\.\/[^"']+)["']/gm,
    )) {
      expect(match[1]!.trimStart().startsWith("type"), `import de valeur vers ${match[2]}`).toBe(
        true,
      );
    }
  });

  it("touches no document API", () => {
    // `self` is legitimate (it is the worker's scope); `document` and `window`
    // are not.
    expect(worker.code).not.toMatch(/\bdocument\b/);
    expect(worker.code).not.toMatch(/\bwindow\b/);
  });
});
