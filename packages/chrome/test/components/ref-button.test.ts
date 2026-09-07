import { describe, expect, it } from "vitest";
import { createRefButton } from "../../src/components/ref-button.js";

describe("createRefButton", () => {
  it("dit où il mène", () => {
    const ok = createRefButton({ title: "Aller à Customer#c1" });
    expect(ok.className).toBe("ref-btn");
    expect(ok.type).toBe("button");
    expect(ok.textContent).toBe("→");
    expect(ok.title).toBe("Aller à Customer#c1");
    expect(ok.disabled).toBe(false);
  });

  it("se désactive s'il ne mène nulle part, sans disparaître", () => {
    // Une référence cassée est une information : masquer le bouton ferait
    // disparaître la ligne fautive.
    const broken = createRefButton({ title: "Référence cassée : Customer#GHOST", disabled: true });
    expect(broken.disabled).toBe(true);
    expect(broken.textContent).toBe("→");
  });
});
