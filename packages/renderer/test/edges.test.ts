import { describe, it, expect } from "vitest";
import { buildGraph } from "@defsquare/data-graph-core";
import { drawEdges } from "../src/draw.js";
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
