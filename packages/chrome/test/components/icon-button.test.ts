import { describe, expect, it } from "vitest";
import { createIconButton } from "../../src/components/icon-button.js";

describe("createIconButton", () => {
  it("porte la classe, le type et les deux libellés", () => {
    const b = createIconButton({ icon: "search", label: "Rechercher", id: "search-toggle" });
    expect(b.className).toBe("ibtn");
    expect(b.type).toBe("button");
    expect(b.id).toBe("search-toggle");
    // `title` pour la souris, `aria-label` pour le reste : un bouton sans texte
    // n'a pas de nom accessible sans le second.
    expect(b.title).toBe("Rechercher");
    expect(b.getAttribute("aria-label")).toBe("Rechercher");
    expect(b.querySelectorAll("svg")).toHaveLength(1);
  });

  it("accepte la variante réduite et les attributs de panneau", () => {
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

  it("rend une icône par nom, chacune classée, pour les boutons à deux états", () => {
    const b = createIconButton({ icon: ["graph", "structure"], label: "Vue graphe" });
    const classes = [...b.querySelectorAll("svg")].map((s) => s.getAttribute("class"));
    expect(classes).toEqual(["icon-graph", "icon-structure"]);
  });

  it("ne pose ni disabled ni aria-busy : ce sont des états d'exécution", () => {
    const b = createIconButton({ icon: "fit", label: "Ajuster" });
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute("aria-busy")).toBe(false);
  });
});
