import { describe, it, expect } from "vitest";
import { buildGraph } from "@defsquare/data-graph-core";
import { anchorOnRect, drawEdgeHitAreas, drawEdges, drawSelectionOverlay } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";
import { shopData, shopConfig } from "./fixtures.js";

/**
 * `EdgeMode` a deux effets, et un seul était couvert : le mode `"ref"` cessait
 * bien de tracer le containment, mais il continuait à tracer les références en
 * POINTILLÉ, alors que la spec de la vue graphe les veut PLEINES — le pointillé
 * y signifierait « décoration » dans la vue dont les références sont justement
 * tout le sujet.
 *
 * Ce que le test observe : le `GraphicsContext` de Pixi, comme le fait déjà
 * `hulls.test.ts`. Chaque appel à `stroke()`/`fill()` y pousse une instruction
 * portant le chemin accumulé ; le NOMBRE de commandes de ce chemin distingue
 * sans ambiguïté un trait plein (un seul `moveTo`+`lineTo`) d'un pointillé (un
 * couple par tiret). Aucun rendu n'est nécessaire.
 */
describe("drawEdges — mode structure vs mode graphe", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  // Positions étalées pour tous les nœuds : les arêtes de containment ne sont
  // dessinées que si LES DEUX bouts sont positionnés, et sans elles le mode
  // `"contain"` ne se distinguerait de rien. L'écart de 400 px garantit aussi
  // des segments assez longs pour porter plusieurs tirets.
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  /** Les commandes de chemin (`moveTo`, `lineTo`, …) portées par la n-ième
   * instruction du contexte. */
  function pathActions(g: ReturnType<typeof drawEdges>, index: number): string[] {
    const instruction = g.context.instructions[index] as any;
    return instruction.data.path.instructions.map((x: any) => x.action);
  }

  // Le fixture ne contient qu'UNE référence résolue (o1 → c1) et une cassée
  // (o2 → GHOST) : le chemin des références résolues décrit donc une seule
  // arête, ce qui rend le comptage lisible.
  const resolvedRefs = graph.refEdges.filter((e) => !e.dangling && e.to !== null);

  it("the fixture holds exactly one resolved and one dangling reference", () => {
    // Garde anti-test-creux : tous les comptages ci-dessous en dépendent.
    expect(resolvedRefs).toHaveLength(1);
    expect(graph.refEdges.filter((e) => e.dangling)).toHaveLength(1);
  });

  it('draws references dashed in "contain" mode', () => {
    const g = drawEdges(graph, positions, theme, 0, "contain");
    // stroke(containment) + stroke(références) + fill(têtes de flèche) +
    // stroke(moignons cassés).
    expect(g.context.instructions.length).toBe(4);
    expect((g.context.instructions[0] as any).action).toBe("stroke");
    // Le containment est bien tracé : une bézier par arête.
    expect(pathActions(g, 0)).toContain("bezierCurveTo");
    // Les références : bien plus de deux commandes pour une seule arête, donc
    // une suite de tirets.
    const ref = pathActions(g, 1);
    expect(ref.length).toBeGreaterThan(2);
    expect(ref.filter((a) => a === "lineTo").length).toBeGreaterThan(1);
  });

  it('draws the same references solid in "ref" mode', () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    // Une instruction de moins : plus aucun stroke de containment.
    expect(g.context.instructions.length).toBe(3);
    // Une seule arête résolue, tracée d'un seul segment : exactement
    // moveTo + lineTo, là où le mode "contain" en produit une dizaine.
    expect(pathActions(g, 0)).toEqual(["moveTo", "lineTo"]);
  });

  it("keeps the dangling stub dashed in both modes", () => {
    // Le pointillé d'un moignon ne dit pas « secondaire » mais « ne mène nulle
    // part » : il ne suit donc pas la bascule de mode.
    const contain = drawEdges(graph, positions, theme, 0, "contain");
    const ref = drawEdges(graph, positions, theme, 0, "ref");
    // Dernière instruction de chaque contexte : le stroke des moignons.
    const a = pathActions(contain, contain.context.instructions.length - 1);
    const b = pathActions(ref, ref.context.instructions.length - 1);
    expect(a).toEqual(b);
    expect(a.filter((x) => x === "lineTo").length).toBeGreaterThan(1);
  });

  it("keeps drawing the arrow heads in both modes", () => {
    // Le trait plein remplace le pointillé, il ne remplace pas la flèche : le
    // sens de lecture de la référence doit survivre à la bascule.
    for (const mode of ["contain", "ref"] as const) {
      const g = drawEdges(graph, positions, theme, 0, mode);
      const fills = (g.context.instructions as any[]).filter((x) => x.action === "fill");
      expect(fills).toHaveLength(1);
    }
  });

  it("draws nothing at LOD 2, whatever the mode", () => {
    for (const mode of ["contain", "ref"] as const) {
      expect(drawEdges(graph, positions, theme, 2, mode).context.instructions.length).toBe(0);
    }
  });
});

/**
 * L'ancrage d'une référence était FIXE : milieu-droit de la source vers
 * milieu-gauche de la cible. Comme les arêtes sont dessinées SOUS le calque des
 * cartes, une cible située en dessous ou à gauche faisait passer la ligne sous
 * la carte source : son départ était invisible, l'arête semblait sortir de
 * nulle part. L'ancrage suit désormais la direction réelle centre→centre.
 */
describe("anchorOnRect", () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 }; // centre (200, 150)

  it("lands on the right edge for a target to the right", () => {
    expect(anchorOnRect(rect, 1000, 150)).toEqual({ x: 300, y: 150 });
  });

  it("lands on the left edge for a target to the left", () => {
    expect(anchorOnRect(rect, -1000, 150)).toEqual({ x: 100, y: 150 });
  });

  it("lands on the bottom edge for a target below", () => {
    expect(anchorOnRect(rect, 200, 900)).toEqual({ x: 200, y: 200 });
  });

  it("lands on the top edge for a target above", () => {
    expect(anchorOnRect(rect, 200, -900)).toEqual({ x: 200, y: 100 });
  });

  it("stays on the perimeter and on the centre→target ray in diagonal", () => {
    // Cible en diagonale « molle » (pente 1/4) : c'est le bord VERTICAL qui est
    // atteint le premier, pas le coin.
    const p = anchorOnRect(rect, 200 + 400, 150 + 100);
    expect(p.x).toBeCloseTo(300, 10); // sur le bord droit
    expect(p.y).toBeGreaterThan(100);
    expect(p.y).toBeLessThan(200); // …et dans la hauteur du rect
    // Colinéaire au segment centre→cible.
    expect((p.y - 150) / (p.x - 200)).toBeCloseTo(100 / 400, 10);

    // Cible en diagonale « raide » (pente 4) : cette fois c'est le bord
    // HORIZONTAL du bas qui est atteint le premier.
    const q = anchorOnRect(rect, 200 + 100, 150 + 400);
    expect(q.y).toBeCloseTo(200, 10);
    expect(q.x).toBeGreaterThan(100);
    expect(q.x).toBeLessThan(300);
    expect((q.y - 150) / (q.x - 200)).toBeCloseTo(400 / 100, 10);
  });

  it("falls back to the centre for a target inside the rect", () => {
    // Repli propre : l'arête sera cachée sous les cartes qui se chevauchent,
    // ce qui est acceptable — il n'y a pas de « bon » point de sortie ici.
    expect(anchorOnRect(rect, 210, 160)).toEqual({ x: 200, y: 150 });
    expect(anchorOnRect(rect, 200, 150)).toEqual({ x: 200, y: 150 });
  });
});

describe("edge anchoring follows the direction to the target", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  // La seule référence résolue du fixture est /orders/0 → /customers/0. On la
  // place ici en pile VERTICALE : c'est précisément le cas que l'ancrage fixe
  // milieu-droit / milieu-gauche rendait illisible.
  const SOURCE = "/orders/0";
  const TARGET = "/customers/0";
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>([
    [SOURCE, { x: 0, y: 0, width: 160, height: 60 }], // centre (80, 30)
    [TARGET, { x: 0, y: 300, width: 160, height: 60 }], // centre (80, 330)
  ]);
  // Départ attendu : bord INFÉRIEUR de la source. Arrivée : bord SUPÉRIEUR de
  // la cible.
  const START: [number, number] = [80, 60];
  const END: [number, number] = [80, 300];

  function firstPath(g: { context: { instructions: unknown[] } }, index: number): any[] {
    return (g.context.instructions[index] as any).data.path.instructions;
  }

  it("starts the resolved reference on the source edge facing the target", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    const path = firstPath(g, 0);
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual(START);
    // La ligne s'arrête au pied de la flèche : même direction, un peu avant.
    const [ex, ey] = path[1].data;
    expect(ex).toBeCloseTo(80, 10);
    expect(ey).toBeGreaterThan(280);
    expect(ey).toBeLessThan(300);
  });

  it("puts the arrow head tip on the target edge facing the source", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref");
    // Dernière instruction : le fill des têtes de flèche.
    const fill = (g.context.instructions as any[]).filter((x) => x.action === "fill");
    expect(fill).toHaveLength(1);
    const tip = fill[0].data.path.instructions[0];
    expect(tip.action).toBe("moveTo");
    expect(tip.data).toEqual(END);
  });

  it("uses the same anchors for the dashed reference in contain mode", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain");
    // Aucune arête de containment ici (les deux bouts d'aucune paire ne sont
    // positionnés) : les références sont donc la première instruction.
    const path = firstPath(g, 0);
    expect(path[0].data).toEqual(START);
  });

  it("aligns the hit area with the drawn reference", () => {
    const hits = drawEdgeHitAreas(graph, positions);
    const hit = hits.find((h) => h.edge.from === SOURCE);
    expect(hit).toBeDefined();
    const path = firstPath(hit!.graphics, 0);
    expect(path[0].data).toEqual(START);
    expect(path[1].data).toEqual(END);
  });

  it("aligns the selection overlay with the drawn reference", () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE);
    // Dernière instruction : le stroke des références sortantes.
    const path = firstPath(g, g.context.instructions.length - 1);
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual(START);
    // Pointillé : le dernier point tracé tombe où le dernier tiret s'arrête,
    // donc à moins d'un motif (tiret + espace) de l'ancrage de la cible.
    const last = path[path.length - 1].data;
    expect(last[0]).toBeCloseTo(END[0], 10);
    expect(Math.abs(last[1] - END[1])).toBeLessThanOrEqual(10);
  });

  it("keeps the dangling stub horizontal, anchored mid-right", () => {
    // Un moignon ne vise rien : il n'a pas de direction à suivre et reste
    // construit à l'horizontale depuis le milieu du bord droit.
    const stubPositions = new Map(positions);
    stubPositions.set("/orders/1", { x: 0, y: 600, width: 160, height: 60 });
    const hits = drawEdgeHitAreas(graph, stubPositions);
    const hit = hits.find((h) => h.edge.dangling);
    expect(hit).toBeDefined();
    const path = firstPath(hit!.graphics, 0);
    expect(path[0].data).toEqual([160, 630]);
    expect(path[1].data[1]).toBe(630);
  });
});
