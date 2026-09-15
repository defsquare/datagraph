import { describe, expect, it } from "vitest";
import { createIconButton } from "../../src/components/icon-button.js";

describe("createIconButton", () => {
  it("carries the class, the type and both labels", () => {
    const b = createIconButton({ icon: "search", label: "Search", id: "search-toggle" });
    expect(b.className).toBe("ibtn");
    expect(b.type).toBe("button");
    expect(b.id).toBe("search-toggle");
    // `title` for the mouse, `aria-label` for everything else: a button with no
    // text has no accessible name without the second.
    expect(b.title).toBe("Search");
    expect(b.getAttribute("aria-label")).toBe("Search");
    expect(b.querySelectorAll("svg")).toHaveLength(1);
  });

  it("accepts the small variant and the panel attributes", () => {
    const b = createIconButton({
      icon: "dots",
      label: "Menu",
      small: true,
      controls: "menu",
      expanded: false,
    });
    expect(b.className).toBe("ibtn ibtn-sm");
    expect(b.getAttribute("aria-controls")).toBe("menu");
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders one classed icon per name, for two-state buttons", () => {
    const b = createIconButton({ icon: ["graph", "structure"], label: "Graph view" });
    const classes = [...b.querySelectorAll("svg")].map((s) => s.getAttribute("class"));
    expect(classes).toEqual(["icon-graph", "icon-structure"]);
  });

  it("sets neither disabled nor aria-busy: those are runtime states", () => {
    const b = createIconButton({ icon: "fit", label: "Fit to view" });
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute("aria-busy")).toBe(false);
  });

  it("carries no badge attribute at construction", () => {
    // `data-badge` is a RUNTIME state, like `disabled` and `aria-busy`: the
    // factory produces inert DOM and must not invent one.
    const button = createIconButton({ icon: "search", label: "Search" });
    expect(button.hasAttribute("data-badge")).toBe(false);
  });
});
