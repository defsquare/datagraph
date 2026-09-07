import { describe, expect, it } from "vitest";
import { createFindbar } from "../../src/components/findbar.js";

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

  it("nomme ses chevrons sans leur raccourci pour l'ARIA, avec pour l'infobulle", () => {
    const bar = createFindbar();
    expect(bar.next.title).toBe("Résultat suivant (Entrée)");
    expect(bar.next.getAttribute("aria-label")).toBe("Résultat suivant");
  });

  it("retourne ses cinq parties, toutes dans la barre", () => {
    const bar = createFindbar();
    for (const part of [bar.input, bar.counter, bar.prev, bar.next]) {
      expect(bar.root.contains(part)).toBe(true);
    }
  });
});
