import { describe, expect, it } from "vitest";
import { createMenu, createMenuItem } from "../../src/components/menu.js";

describe("createMenu", () => {
  it("is a menu-role panel, folded, carrying its entries", () => {
    const item = createMenuItem({ label: "Dark theme", id: "toggle-theme" });
    const menu = createMenu({ id: "menu", labelledBy: "menu-toggle" }, item);
    expect(menu.className).toBe("menu float");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe("menu-toggle");
    expect(menu.hasAttribute("hidden")).toBe(true);
    expect(menu.contains(item)).toBe(true);
  });

  it("opens unnamed by anyone if no trigger is given", () => {
    expect(createMenu().hasAttribute("aria-labelledby")).toBe(false);
  });
});

describe("createMenuItem", () => {
  it("is a menuitem-role button, text alone", () => {
    const item = createMenuItem({ label: "Extended dataset (4000)" });
    expect(item.className).toBe("menu-item");
    expect(item.type).toBe("button");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toBe("Extended dataset (4000)");
    // No icon: the application rewrites the `textContent` to reflect the current
    // state, which a child would not survive.
    expect(item.children).toHaveLength(0);
  });
});
