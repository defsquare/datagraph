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

  /** Les styles effectivement émis, dans l'ordre : c'est là que vivent l'alpha
   * et l'épaisseur, et les lire directement évite d'inférer un rendu depuis des
   * bornes. */
  function styles(g: ReturnType<typeof drawClusters>) {
    return g.context.instructions.map((instruction) => {
      const style = (instruction.data as { style: { alpha: number; width?: number } }).style;
      return { action: instruction.action, alpha: style.alpha, width: style.width };
    });
  }

  it("peint au repos quand aucune intensite de survol n'est donnee", () => {
    // Le champ est optionnel : tout appelant qui l'ignore doit obtenir
    // exactement le rendu d'avant le survol.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000" }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.08, 6);
    expect(stroke!.alpha).toBeCloseTo(0.35, 6);
    expect(stroke!.width).toBeCloseTo(1.5, 6);
  });

  it("renforce fond, contour et trait a l'intensite maximale", () => {
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000", hover: 1 }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.15, 6);
    expect(stroke!.alpha).toBeCloseTo(0.6, 6);
    expect(stroke!.width).toBeCloseTo(2, 6);
  });

  it("interpole lineairement entre les deux etats", () => {
    // L'intensite arrive deja adoucie par `attachHover` : interpoler une
    // seconde fois par une courbe ici doublerait l'easing et rendrait la montee
    // molle au depart.
    const [fill, stroke] = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#ff0000", hover: 0.5 }], theme),
    );
    expect(fill!.alpha).toBeCloseTo(0.115, 6);
    expect(stroke!.alpha).toBeCloseTo(0.475, 6);
    expect(stroke!.width).toBeCloseTo(1.75, 6);
  });

  it("borne une intensite hors de [0,1]", () => {
    // Aucune source ne devrait en produire, mais un alpha superieur a 1 ou
    // negatif serait un rendu invalide et pas seulement laid.
    const over = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: 4 }], theme),
    );
    const under = styles(
      drawClusters([{ circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: -2 }], theme),
    );
    expect(over[0]!.alpha).toBeCloseTo(0.15, 6);
    expect(under[0]!.alpha).toBeCloseTo(0.08, 6);
  });

  it("n'applique l'intensite qu'a l'enveloppe qui la porte", () => {
    // Le rendu est par enveloppe : survoler l'une ne doit pas allumer sa
    // voisine, qui reste peinte au repos dans le meme Graphics.
    const s = styles(
      drawClusters(
        [
          { circle: { cx: 0, cy: 0, r: 10 }, color: "#f00", hover: 1 },
          { circle: { cx: 100, cy: 0, r: 10 }, color: "#0f0" },
        ],
        theme,
      ),
    );
    expect(s[0]!.alpha).toBeCloseTo(0.15, 6);
    expect(s[2]!.alpha).toBeCloseTo(0.08, 6);
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
