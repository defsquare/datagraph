import { describe, expect, it } from "vitest";
import { icon, ICON_NAMES } from "../src/icons.js";

describe("icon", () => {
  it("produit un SVG au gabarit du chrome", () => {
    const svg = icon("search");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    // Décoratif : le sens est porté par l'`aria-label` du bouton qui l'englobe.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.innerHTML).toContain("<circle");
  });

  it("pose la classe demandée, et aucune sinon", () => {
    expect(icon("graph", "icon-graph").getAttribute("class")).toBe("icon-graph");
    expect(icon("graph").hasAttribute("class")).toBe(false);
  });

  it("connaît les neuf icônes du chrome, toutes non vides", () => {
    expect([...ICON_NAMES]).toEqual([
      "search",
      "fit",
      "tidy",
      "graph",
      "structure",
      "dots",
      "close",
      "up",
      "down",
    ]);
    for (const name of ICON_NAMES) expect(icon(name).innerHTML.trim().length).toBeGreaterThan(0);
  });
});
