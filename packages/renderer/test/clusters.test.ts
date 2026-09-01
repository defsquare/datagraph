import { describe, it, expect } from "vitest";
import { drawClusters } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

describe("drawClusters", () => {
  const theme = resolveTheme(undefined);

  it("returns an empty Graphics for no clusters", () => {
    const g = drawClusters([], theme);
    expect(g).toBeDefined();
    expect(g.destroyed).toBe(false);
    // Rien à peindre : le contexte Graphics ne contient aucune instruction.
    expect(g.context.instructions.length).toBe(0);
  });

  it("draws a fill and a stroke per cluster, with bounds spanning both circles", () => {
    const g = drawClusters(
      [
        { circle: { cx: 50, cy: 40, r: 50 }, color: "#ff0000" },
        { circle: { cx: 250, cy: 30, r: 30 }, color: "#00ff00" },
      ],
      theme,
    );
    // Un fill() + un stroke() par enveloppe : 2 enveloppes -> 4 instructions.
    expect(g.context.instructions.length).toBe(4);
    // Les bornes couvrent bien les deux disques, pas seulement le premier.
    const bounds = g.getBounds();
    expect(bounds.minX).toBeLessThan(1);
    expect(bounds.maxX).toBeGreaterThan(279);
    expect(bounds.maxY).toBeGreaterThan(89);
  });

  it("skips a circle of non-positive radius", () => {
    const g = drawClusters([{ circle: { cx: 10, cy: 10, r: 0 }, color: "#fff" }], theme);
    // Aucune instruction émise : un disque de rayon nul n'est pas une surface.
    expect(g.context.instructions.length).toBe(0);
  });

  it("keeps painting the following clusters after skipping a degenerate one", () => {
    const g = drawClusters(
      [
        { circle: { cx: 10, cy: 10, r: 0 }, color: "#fff" },
        { circle: { cx: 50, cy: 40, r: 50 }, color: "#ff0000" },
      ],
      theme,
    );
    // La deuxième enveloppe, valide, est bien peinte malgré la première ignorée.
    expect(g.context.instructions.length).toBe(2);
  });
});
