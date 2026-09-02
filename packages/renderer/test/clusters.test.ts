import { describe, it, expect } from "vitest";
import { Circle } from "pixi.js";
import { drawClusterHitAreas, drawClusters } from "../src/draw.js";
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

describe("drawClusterHitAreas", () => {
  it("rend un container par enveloppe, centre sur elle", () => {
    // Le container est POSITIONNE sur le centre et sa `hitArea` est centree sur
    // l'origine locale : deplacer le cluster revient alors a bouger sa
    // position, exactement comme une carte. Une `hitArea` en coordonnees monde
    // obligerait a muter le cercle a chaque image.
    const hits = drawClusterHitAreas([
      { cx: 50, cy: 40, r: 30 },
      { cx: 250, cy: 30, r: 60 },
    ]);
    expect(hits.length).toBe(2);
    expect(hits[0]!.container.position.x).toBe(50);
    expect(hits[0]!.container.position.y).toBe(40);
    const area = hits[0]!.container.hitArea as Circle;
    expect(area.x).toBe(0);
    expect(area.y).toBe(0);
    expect(area.radius).toBe(30);
  });

  it("rend l'objet d'entree tel quel, sans copie", () => {
    // C'est ce qui permet a l'appelant de muter le `ClusterShape` du layout
    // pendant le drag et d'en voir l'effet au repeint suivant.
    const cluster = { cx: 0, cy: 0, r: 10 };
    expect(drawClusterHitAreas([cluster])[0]!.cluster).toBe(cluster);
  });

  it("est saisissable et affiche une main ouverte", () => {
    const hit = drawClusterHitAreas([{ cx: 0, cy: 0, r: 10 }])[0]!.container;
    expect(hit.eventMode).toBe("static");
    expect(hit.cursor).toBe("grab");
  });

  it("n'ecoute aucun tap : une enveloppe ne se selectionne pas", () => {
    // Un tap sur une enveloppe doit rester inerte. Le prouver par l'absence
    // d'ecouteur plutot que par un clic simule : c'est la propriete qu'on veut
    // tenir, et elle ne depend d'aucun seuil.
    const hit = drawClusterHitAreas([{ cx: 0, cy: 0, r: 10 }])[0]!.container;
    expect(hit.listenerCount("pointertap")).toBe(0);
  });

  it("ignore un rayon non positif", () => {
    // Meme garde que `drawClusters` : un disque de rayon nul n'est pas une
    // surface, et une `hitArea` de rayon nul serait insaisissable de toute
    // facon.
    expect(drawClusterHitAreas([{ cx: 10, cy: 10, r: 0 }])).toEqual([]);
  });
});
