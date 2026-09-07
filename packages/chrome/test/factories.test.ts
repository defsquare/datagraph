import { describe, expect, it } from "vitest";
import {
  createBadge,
  createCluster,
  createClusterSeparator,
  createFindbar,
  createIconButton,
  createMenu,
  createMenuItem,
  createRefButton,
  createStatusLink,
} from "../src/factories.js";

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
});

describe("createFindbar", () => {
  it("assemble icône, champ, compteur et navigation, replié", () => {
    const bar = createFindbar({
      id: "findbar",
      inputId: "search",
      counterId: "match-counter",
      prevId: "prev-match",
      nextId: "next-match",
    });
    expect(bar.root.className).toBe("findbar float");
    expect(bar.root.hasAttribute("hidden")).toBe(true);
    expect(bar.input.type).toBe("search");
    expect(bar.input.className).toBe("findbar-input");
    expect(bar.input.id).toBe("search");
    expect(bar.counter.className).toBe("findbar-counter");
    // Le compteur s'annonce quand il change : c'est le seul retour de recherche
    // pour qui ne voit pas le canvas.
    expect(bar.counter.getAttribute("aria-live")).toBe("polite");
    expect(bar.prev.className).toBe("findbar-nav");
    expect(bar.next.id).toBe("next-match");
    expect(bar.root.querySelector(".findbar-icon")).not.toBeNull();
  });
});

describe("createMenu", () => {
  it("est un panneau de rôle menu, replié, portant ses entrées", () => {
    const item = createMenuItem({ label: "Thème sombre", id: "toggle-theme" });
    const menu = createMenu({ id: "menu", labelledBy: "menu-toggle" }, item);
    expect(menu.className).toBe("menu float");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe("menu-toggle");
    expect(menu.hasAttribute("hidden")).toBe(true);
    expect(item.className).toBe("menu-item");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toBe("Thème sombre");
    expect(menu.contains(item)).toBe(true);
  });
});

describe("primitives d'un seul élément", () => {
  it("createCluster pose la surface flottante autour de ses enfants", () => {
    const sep = createClusterSeparator();
    const cluster = createCluster(createIconButton({ icon: "fit", label: "Ajuster" }), sep);
    expect(cluster.className).toBe("cluster float");
    expect(sep.className).toBe("cluster-sep");
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    expect(cluster.children).toHaveLength(2);
  });

  it("createBadge est replié tant qu'il n'a rien à dire", () => {
    expect(createBadge({ id: "selection-type" }).hasAttribute("hidden")).toBe(true);
    const filled = createBadge({ text: "ORDER" });
    expect(filled.className).toBe("badge");
    expect(filled.textContent).toBe("ORDER");
    expect(filled.hasAttribute("hidden")).toBe(false);
  });

  it("createStatusLink est un bouton, replié par défaut", () => {
    const link = createStatusLink({ id: "stat-diagnostics" });
    expect(link.className).toBe("status-link");
    expect(link.type).toBe("button");
    expect(link.hasAttribute("hidden")).toBe(true);
  });

  it("createRefButton dit où il mène, et se désactive s'il ne mène nulle part", () => {
    const ok = createRefButton({ title: "Aller à Customer#c1" });
    expect(ok.className).toBe("ref-btn");
    expect(ok.textContent).toBe("→");
    expect(ok.disabled).toBe(false);
    expect(createRefButton({ title: "Référence cassée", disabled: true }).disabled).toBe(true);
  });
});
