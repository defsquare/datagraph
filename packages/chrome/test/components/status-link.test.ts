import { describe, expect, it } from "vitest";
import { createStatusLink } from "../../src/components/status-link.js";

describe("createStatusLink", () => {
  it("est un bouton, replié par défaut", () => {
    const link = createStatusLink({ id: "stat-diagnostics" });
    expect(link.className).toBe("status-link");
    expect(link.type).toBe("button");
    expect(link.id).toBe("stat-diagnostics");
    expect(link.hasAttribute("hidden")).toBe(true);
  });

  it("s'affiche dès qu'il a quelque chose à signaler", () => {
    const link = createStatusLink({ label: "3 diagnostics" });
    expect(link.textContent).toBe("3 diagnostics");
    expect(link.hasAttribute("hidden")).toBe(false);
  });
});
