import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("brand assets", () => {
  it("draws the mark out of axis-aligned rectangles only", () => {
    // The parent logo's rule, and the one thing a careless edit would break:
    // a path or a rounded corner would put datagraph outside the family.
    const mark = read("../brand/datagraph-mark.svg");
    expect(mark).not.toMatch(/<(path|circle|ellipse|polygon|line)\b/);
    expect(mark).not.toMatch(/\brx=/);
  });

  it("holds to the two brand colours", () => {
    const colors = new Set(read("../brand/datagraph-mark.svg").match(/#[0-9a-f]{6}/g) ?? []);
    expect([...colors].sort()).toEqual(["#1a2a36", "#f65e5e"]);
  });

  it("keeps the mark drawn as rectangles inside the lockups too", () => {
    // The single path in each lockup is the outlined wordmark. A second one
    // would mean the mark itself had been converted, and the grid lost with it.
    for (const file of ["datagraph-lockup.svg", "datagraph-lockup-stacked.svg"]) {
      expect(read(`../brand/${file}`).match(/<path\b/g)).toHaveLength(1);
    }
  });

  it("is up to date in the apps that serve it (freshness of the copies)", () => {
    const copies = [
      ["datagraph-favicon.svg", "apps/demo/public/datagraph-favicon.svg"],
      ["datagraph-favicon.svg", "apps/design/public/datagraph-favicon.svg"],
      ["datagraph-lockup.svg", "apps/demo/public/datagraph-lockup.svg"],
      ["datagraph-lockup-inverse.svg", "apps/demo/public/datagraph-lockup-inverse.svg"],
    ] as const;
    for (const [source, target] of copies) {
      expect(read(`../../../${target}`), target).toBe(read(`../brand/${source}`));
    }
  });
});
