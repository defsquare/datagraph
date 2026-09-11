import { describe, expect, it } from "vitest";
import { chrome, defsquare, neutral } from "../src/index.js";
import { contrastRatio } from "../src/contrast.js";

/**
 * The shell's text on the canvas it floats over.
 *
 * WCAG 2.x AA for body text is 4.5:1, and every string here is 11px — none of
 * them qualifies as large text. The status bar is the only chrome that sits
 * DIRECTLY on the canvas with no floating surface underneath, so it is the only
 * one whose contrast can be computed against an opaque background: everything
 * else stands on `--float-bg`, which is translucent and would give a wrong
 * number (see `contrast.ts`).
 */
const AA = 4.5;

describe("status bar contrast on the canvas", () => {
  for (const [name, brand, ui] of [
    ["defsquare light", defsquare.light, chrome.light],
    ["defsquare dark", defsquare.dark, chrome.dark],
    ["neutral light", neutral.light, chrome.light],
    ["neutral dark", neutral.dark, chrome.dark],
  ] as const) {
    it(`reaches AA for the counters in ${name}`, () => {
      expect(contrastRatio(brand.ink.muted, brand.surface.canvas)).toBeGreaterThanOrEqual(AA);
    });

    it(`reaches AA for the diagnostics link in ${name}`, () => {
      expect(contrastRatio(ui.link, brand.surface.canvas)).toBeGreaterThanOrEqual(AA);
    });
  }
});
