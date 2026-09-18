import { describe, expect, it } from "vitest";
import { icon, ICON_NAMES } from "../src/icons.js";

describe("icon", () => {
  it("produces an SVG in the chrome's template", () => {
    const svg = icon("search");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    // Decorative: the meaning is carried by the `aria-label` of the enclosing
    // button.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.innerHTML).toContain("<circle");
  });

  it("sets the requested class, and none otherwise", () => {
    expect(icon("graph", "icon-graph").getAttribute("class")).toBe("icon-graph");
    expect(icon("graph").hasAttribute("class")).toBe(false);
  });

  it("knows the chrome's ten icons, all of them non-empty", () => {
    expect([...ICON_NAMES]).toEqual([
      "search",
      "fit",
      "tidy",
      "graph",
      "structure",
      "tree",
      "dots",
      "close",
      "up",
      "down",
    ]);
    for (const name of ICON_NAMES) expect(icon(name).innerHTML.trim().length).toBeGreaterThan(0);
  });
});
