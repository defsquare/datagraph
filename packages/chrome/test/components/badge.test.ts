import { describe, expect, it } from "vitest";
import { createBadge } from "../../src/components/badge.js";

describe("createBadge", () => {
  it("is folded as long as it has nothing to say", () => {
    const empty = createBadge({ id: "selection-type" });
    expect(empty.className).toBe("badge");
    expect(empty.id).toBe("selection-type");
    expect(empty.hasAttribute("hidden")).toBe(true);
  });

  it("shows as soon as a type is given to it", () => {
    const filled = createBadge({ text: "ORDER" });
    expect(filled.textContent).toBe("ORDER");
    expect(filled.hasAttribute("hidden")).toBe(false);
  });
});
