import { describe, it, expect } from "vitest"
import * as index from "../src/index.js"
import * as graphLayout from "../src/graph-layout.js"

/**
 * THIS TEST IS THE CONTRACT of the core's two public entry points (`.` and
 * `./graph-layout`, see the `exports` field of `package.json`). The lists below
 * are not an observation to refresh whenever they turn red: they state what the
 * package promises. Any change must therefore be DELIBERATE — adding a line
 * commits you to maintaining the symbol; removing one owns a break for
 * consumers.
 *
 * Only RUNTIME exports can be checked this way: types vanish at compile time and
 * never show up in `Object.keys`. That costs nothing for what this test guards —
 * a runtime surface growing by accident (an internal symbol raised "just in
 * case") is exactly what we want to see.
 *
 * The import goes through the entry point's SOURCE PATH rather than the package
 * name, to stay in the folder's vitest regime (no up-to-date `dist/` required);
 * it is indeed the same file `package.json` publishes.
 */
describe("api surface", () => {
  it("the `.` entry point exports exactly these runtime symbols", () => {
    expect(Object.keys(index).sort()).toEqual([
      "CollapseState",
      "ConfigError",
      "DEFAULT_METRICS",
      "GraphTooLargeError",
      // DELIBERATE addition: the initial expansion budget is the default a
      // caller overrides (`new CollapseState(g, { initialCardBudget })`); it
      // must be nameable outside the core rather than copied as a literal.
      "INITIAL_CARD_BUDGET",
      // DELIBERATE addition: card-children pagination is a contract shared with
      // the renderer, which draws the gap tokens — it needs the page size and
      // the function that names the page of an index.
      "PAGE_SIZE",
      "VERSION",
      "anchorRectFor",
      "arrayTokenTextFor",
      "arrayTokenWidth",
      "badgeTextFor",
      "buildAggregates",
      "buildGraph",
      "buildSearchIndex",
      "buildTreeGraph",
      "createStructureLayoutEngine",
      // DELIBERATE addition: the tree view has its own GLOBAL layout, which
      // the renderer instantiates directly — it is not a mode of
      // `createStructureLayoutEngine` (ADR-0043).
      "createTreeLayout",
      "enclosingCircle",
      "headerTextFor",
      "isValueOnlyRow",
      "measureNode",
      "nearestCardRectFor",
      "pageOf",
      "rowRectFor",
      "validateConfig",
    ])
  })

  /**
   * The two added symbols — `extractGraphLayoutInput` and `layoutFromInput` —
   * are DELIBERATE, in the exact sense of the paragraph above: they carry half
   * the contract of the graph view's Web Worker. The renderer extracts on the
   * main thread (the only place where the `Graph` exists) and runs the pure core
   * inside the worker; without these two exports, the boundary could only be
   * crossed by a copy of the engine.
   *
   * They do not replace `createTwoLevelLayoutEngine`, which stays the in-process
   * path and the worker's fallback — the three live together and are maintained
   * together.
   */
  it("the `./graph-layout` entry point exports exactly these runtime symbols", () => {
    expect(Object.keys(graphLayout).sort()).toEqual([
      "TWO_LEVEL_LAYOUT_DEFAULTS",
      "createTwoLevelLayoutEngine",
      "extractGraphLayoutInput",
      "layoutFromInput",
    ])
  })
})
