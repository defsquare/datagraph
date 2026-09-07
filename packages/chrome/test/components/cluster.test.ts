import { describe, expect, it } from "vitest";
import { createCluster, createClusterSeparator } from "../../src/components/cluster.js";
import { createIconButton } from "../../src/components/icon-button.js";

describe("createCluster", () => {
  it("pose la surface flottante autour de ses enfants", () => {
    const sep = createClusterSeparator();
    const cluster = createCluster(createIconButton({ icon: "fit", label: "Ajuster" }), sep);
    // `float` en plus de `cluster` : un bouton du chrome n'apparaît jamais à nu
    // sur le canvas, sa teinte de survol se compose sur le verre.
    expect(cluster.className).toBe("cluster float");
    expect(cluster.children).toHaveLength(2);
  });
});

describe("createClusterSeparator", () => {
  it("est décoratif : il n'a rien à annoncer", () => {
    const sep = createClusterSeparator();
    expect(sep.className).toBe("cluster-sep");
    expect(sep.getAttribute("aria-hidden")).toBe("true");
  });
});
