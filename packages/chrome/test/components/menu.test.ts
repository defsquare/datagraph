import { describe, expect, it } from "vitest";
import { createMenu, createMenuItem } from "../../src/components/menu.js";

describe("createMenu", () => {
  it("est un panneau de rôle menu, replié, portant ses entrées", () => {
    const item = createMenuItem({ label: "Thème sombre", id: "toggle-theme" });
    const menu = createMenu({ id: "menu", labelledBy: "menu-toggle" }, item);
    expect(menu.className).toBe("menu float");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe("menu-toggle");
    expect(menu.hasAttribute("hidden")).toBe(true);
    expect(menu.contains(item)).toBe(true);
  });

  it("s'ouvre sans être nommé par personne si aucun déclencheur n'est donné", () => {
    expect(createMenu().hasAttribute("aria-labelledby")).toBe(false);
  });
});

describe("createMenuItem", () => {
  it("est un bouton de rôle menuitem, du texte seul", () => {
    const item = createMenuItem({ label: "Jeu de données étendu (4000)" });
    expect(item.className).toBe("menu-item");
    expect(item.type).toBe("button");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toBe("Jeu de données étendu (4000)");
    // Pas d'icône : l'application réécrit le `textContent` pour refléter l'état
    // courant, ce qu'un enfant ne survivrait pas.
    expect(item.children).toHaveLength(0);
  });
});
