import { describe, expect, it } from "vitest";
import { createBadge } from "../../src/components/badge.js";

describe("createBadge", () => {
  it("est replié tant qu'il n'a rien à dire", () => {
    const empty = createBadge({ id: "selection-type" });
    expect(empty.className).toBe("badge");
    expect(empty.id).toBe("selection-type");
    expect(empty.hasAttribute("hidden")).toBe(true);
  });

  it("s'affiche dès qu'un type lui est donné", () => {
    const filled = createBadge({ text: "ORDER" });
    expect(filled.textContent).toBe("ORDER");
    expect(filled.hasAttribute("hidden")).toBe(false);
  });
});
