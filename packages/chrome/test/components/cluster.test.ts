import { describe, expect, it } from "vitest";
import { createCluster, createClusterSeparator } from "../../src/components/cluster.js";
import { createIconButton } from "../../src/components/icon-button.js";

describe("createCluster", () => {
  it("puts the floating surface around its children", () => {
    const sep = createClusterSeparator();
    const cluster = createCluster(createIconButton({ icon: "fit", label: "Fit to view" }), sep);
    // `float` on top of `cluster`: a chrome button never appears bare over the
    // canvas, its hover tint composes onto the glass.
    expect(cluster.className).toBe("cluster float");
    expect(cluster.children).toHaveLength(2);
  });
});

describe("createClusterSeparator", () => {
  it("is decorative: it has nothing to announce", () => {
    const sep = createClusterSeparator();
    expect(sep.className).toBe("cluster-sep");
    expect(sep.getAttribute("aria-hidden")).toBe("true");
  });
});
