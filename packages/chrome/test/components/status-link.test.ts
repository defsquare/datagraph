import { describe, expect, it } from "vitest";
import { createStatusLink } from "../../src/components/status-link.js";

describe("createStatusLink", () => {
  it("is a button, folded by default", () => {
    const link = createStatusLink({ id: "stat-diagnostics" });
    expect(link.className).toBe("status-link");
    expect(link.type).toBe("button");
    expect(link.id).toBe("stat-diagnostics");
    expect(link.hasAttribute("hidden")).toBe(true);
  });

  it("shows as soon as it has something to report", () => {
    const link = createStatusLink({ label: "3 diagnostics" });
    expect(link.textContent).toBe("3 diagnostics");
    expect(link.hasAttribute("hidden")).toBe(false);
  });
});
