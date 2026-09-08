import { describe, it, expect } from "vitest";
import * as index from "../src/index.js";

/**
 * THIS TEST IS THE CONTRACT of the renderer's public entry point (`.`, see the
 * `exports` field of `package.json`). The list below is not an observation to
 * refresh whenever it turns red: it states what the package promises. Any change
 * to it must therefore be DELIBERATE — adding a line commits you to maintaining
 * the symbol; removing one means accepting a break for consumers.
 *
 * It matters here even more than on the core side: low-level drawing
 * (`draw.ts`), `Camera`, `Emitter` and font measurement stay exported from THEIR
 * own modules for the tests in this folder, and nothing stops someone from
 * mechanically hoisting them into the barrel under the impression of "exporting
 * cleanly". This test refuses that.
 *
 * Only RUNTIME exports can be checked this way: types vanish at compile time and
 * never show up in `Object.keys`.
 *
 * The import goes through the entry point's SOURCE PATH rather than the package
 * name, so as to stay within the folder's vitest regime; it is indeed the same
 * file `package.json` publishes.
 */
describe("api surface", () => {
  it("le point d'entrée `.` exporte exactement ces symboles d'exécution", () => {
    expect(Object.keys(index).sort()).toEqual([
      "arrayTokenTextFor",
      "createDataGraph",
      "defsquareDark",
      "defsquareLight",
      "entityAccentMap",
      "neutralDark",
      "neutralLight",
      "resolveTheme",
    ]);
  });
});
