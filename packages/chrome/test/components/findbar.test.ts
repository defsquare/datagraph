import { describe, expect, it } from "vitest";
import { createFindbar } from "../../src/components/findbar.js";

describe("createFindbar", () => {
  it("assembles icon, field, counter and navigation, folded", () => {
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
    // The counter announces itself when it changes: it is the only search
    // feedback for anyone who cannot see the canvas.
    expect(bar.counter.getAttribute("aria-live")).toBe("polite");
    expect(bar.prev.className).toBe("findbar-nav");
    expect(bar.next.id).toBe("next-match");
    expect(bar.root.querySelector(".findbar-icon")).not.toBeNull();
  });

  it("names its chevrons without the shortcut for ARIA, with it for the tooltip", () => {
    const bar = createFindbar();
    expect(bar.next.title).toBe("Next result (Enter)");
    expect(bar.next.getAttribute("aria-label")).toBe("Next result");
  });

  it("returns its five parts, all inside the bar", () => {
    const bar = createFindbar();
    for (const part of [bar.input, bar.counter, bar.prev, bar.next]) {
      expect(bar.root.contains(part)).toBe(true);
    }
  });
});
