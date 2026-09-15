import { describe, expect, it } from "vitest";
import { createRefButton } from "../../src/components/ref-button.js";

describe("createRefButton", () => {
  it("says where it leads", () => {
    const ok = createRefButton({ title: "Go to Customer#c1" });
    expect(ok.className).toBe("ref-btn");
    expect(ok.type).toBe("button");
    expect(ok.textContent).toBe("→");
    expect(ok.title).toBe("Go to Customer#c1");
    expect(ok.disabled).toBe(false);
  });

  it("disables itself if it leads nowhere, without disappearing", () => {
    // A broken reference is information: hiding the button would make the
    // offending row disappear.
    const broken = createRefButton({ title: "Broken reference: Customer#GHOST", disabled: true });
    expect(broken.disabled).toBe(true);
    expect(broken.textContent).toBe("→");
  });
});
