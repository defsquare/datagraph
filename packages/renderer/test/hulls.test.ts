import { describe, it, expect } from "vitest";
import { drawHulls } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

describe("drawHulls", () => {
  const theme = resolveTheme(undefined);

  it("returns an empty Graphics for no hulls", () => {
    const g = drawHulls([], theme);
    expect(g).toBeDefined();
    expect(g.destroyed).toBe(false);
    // Rien à peindre : le contexte Graphics ne contient aucune instruction.
    expect(g.context.instructions.length).toBe(0);
  });

  it("draws a fill and a stroke per hull, with bounds spanning both polygons", () => {
    const g = drawHulls(
      [
        { polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], color: "#ff0000" },
        { polygon: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 60 }, { x: 200, y: 60 }], color: "#00ff00" },
      ],
      theme,
    );
    // Un fill() + un stroke() par enveloppe : 2 enveloppes -> 4 instructions.
    expect(g.context.instructions.length).toBe(4);
    // Les bornes couvrent bien les deux polygones, pas seulement le premier.
    const bounds = g.getBounds();
    expect(bounds.minX).toBeLessThan(1);
    expect(bounds.maxX).toBeGreaterThan(299);
    expect(bounds.maxY).toBeGreaterThan(79);
  });

  it("skips a degenerate polygon of fewer than three points", () => {
    const g = drawHulls([{ polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#fff" }], theme);
    // Aucune instruction émise : le segment dégénéré n'a rien produit.
    expect(g.context.instructions.length).toBe(0);
  });

  it("keeps painting the following hulls after skipping a degenerate one", () => {
    const g = drawHulls(
      [
        { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#fff" },
        { polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], color: "#ff0000" },
      ],
      theme,
    );
    // La deuxième enveloppe, valide, est bien peinte malgré la première ignorée.
    expect(g.context.instructions.length).toBe(2);
  });
});
