import { describe, it, expect } from "vitest";
import { Color } from "pixi.js";
import { buildGraph } from "@defsquare/data-graph-core";
import { anchorOnRect, drawEdgeHitAreas, drawEdges, drawSelectionOverlay } from "../src/draw.js";
import { DIM_ALPHA } from "../src/focus.js";
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
 * L'estompage : quand une carte est sélectionnée, une arête qui ne la touche
 * pas recule au second plan. Un `stroke()` ne porte qu'un seul style, donc
 * l'alpha ne peut pas se poser arête par arête : chaque groupe de couleur se
 * scinde en DEUX passes, l'estompée puis la pleine, et c'est ce découpage que
 * le test observe — le nombre d'instructions et l'alpha de chacune.
 *
 * Le focus est un ENSEMBLE d'ids depuis que l'agrégat est lui aussi
 * sélectionnable. Ce bloc-ci ne passe que des SINGLETONS : c'est la sélection
 * d'une carte, et il tient qu'elle rend exactement ce qu'elle rendait quand la
 * signature portait un id unique. Le cas à plusieurs ids a son propre bloc plus
 * bas.
 */
describe("drawEdges — estompage autour du focus", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  /** L'action et l'alpha de chaque instruction, dans l'ordre d'émission. */
  function passes(g: ReturnType<typeof drawEdges>): [string, number][] {
    return (g.context.instructions as any[]).map((x) => [x.action, x.data.style.alpha]);
  }

  // La seule référence résolue du fixture part de `/orders/0`, la seule cassée
  // de `/orders/1` : focaliser l'une ou l'autre suffit à couvrir les deux
  // côtés de chaque groupe.
  const SOURCE = "/orders/0";
  const ELSEWHERE = "/customers/1";

  it("draws exactly as before when nothing is focused", () => {
    // Garde de non-régression : `focusIds` est optionnel, et l'omettre ou passer
    // `null` doit rendre le tracé d'avant la fonctionnalité, à l'instruction
    // près — donc aucune passe estompée, puisqu'il n'y a rien à estomper.
    const none = drawEdges(graph, positions, theme, 0, "contain");
    const explicit = drawEdges(graph, positions, theme, 0, "contain", null);
    expect(passes(explicit)).toEqual(passes(none));
    expect(passes(none)).toEqual([
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
      ["stroke", 1],
    ]);
  });

  it("splits containment into a dimmed and a full pass around the focus", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set([SOURCE]));
    // Containment estompé puis plein, la référence sortante du focus (trait +
    // tête de flèche) à pleine opacité, et le moignon d'`/orders/1`, qui ne
    // touche pas le focus, estompé.
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("dims a reference that touches neither end of the focus", () => {
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set([ELSEWHERE]));
    // `/customers/1` n'est ni la source ni la cible de la référence résolue :
    // trait ET tête de flèche reculent, y compris le moignon.
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("keeps a reference at full opacity from its TARGET as well", () => {
    // Une référence entrante lie autant que sortante : la cible sélectionnée
    // doit garder son arête au premier plan.
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set(["/customers/0"]));
    expect(passes(g)).toEqual([
      ["stroke", 1],
      ["fill", 1],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("still draws no containment in ref mode, focused or not", () => {
    const g = drawEdges(graph, positions, theme, 0, "ref", new Set([SOURCE]));
    // Trois instructions : la référence du focus (trait + flèche) et le
    // moignon estompé. Aucune passe de containment, ni pleine ni estompée.
    expect(passes(g)).toHaveLength(3);
  });

  it("draws nothing at LOD 2, focus or not", () => {
    expect(drawEdges(graph, positions, theme, 2, "contain", new Set([SOURCE])).context.instructions).toHaveLength(0);
  });
});

/**
 * Le focus à PLUSIEURS ids : c'est ce que passe la sélection d'un agrégat, dont
 * l'ensemble est celui de ses MEMBRES. La règle est la même qu'au singleton —
 * une arête est pleine si l'un de ses bouts est dans l'ensemble —, mais elle
 * produit alors une lecture que le singleton ne peut pas donner : les arêtes
 * INTERNES au bloc et celles qui le TRAVERSENT restent pleines, et seules celles
 * dont aucun bout n'appartient au bloc reculent.
 */
describe("drawEdges — estompage autour d'un ensemble de membres", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let i = 0;
  for (const id of graph.nodes.keys()) {
    positions.set(id, { x: (i % 4) * 400, y: Math.floor(i / 4) * 200, width: 160, height: 60 });
    i++;
  }

  function passes(g: ReturnType<typeof drawEdges>): [string, number][] {
    return (g.context.instructions as any[]).map((x) => [x.action, x.data.style.alpha]);
  }

  it("garde pleine chaque arête dont UN bout est dans l'ensemble", () => {
    // Un bloc qui tiendrait les deux commandes : la référence résolue part de
    // l'un, le moignon de l'autre, donc plus rien n'est estompé — là où le
    // singleton `/orders/0` laissait le moignon d'`/orders/1` en arrière (voir
    // le bloc précédent).
    const both = new Set(["/orders/0", "/orders/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", both))).toEqual([
      ["stroke", 1],
      ["fill", 1],
      ["stroke", 1],
    ]);
    // La preuve que c'est bien l'appartenance du SECOND id qui l'a rendu plein.
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", new Set(["/orders/0"])))).toEqual([
      ["stroke", 1],
      ["fill", 1],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("garde pleine une arête TRAVERSANTE, prise par sa cible", () => {
    // Un bloc côté clients : la référence entre dans le bloc sans en partir, et
    // reste pleine. Le moignon, lui, ne le touche par aucun bout.
    const customers = new Set(["/customers/0", "/customers/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", customers))).toEqual([
      ["stroke", 1],
      ["fill", 1],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("estompe tout quand l'ensemble ne touche aucune arête", () => {
    // Un bloc de nœuds sans aucune référence : rien ne lui parle, donc tout
    // recule — y compris la tête de flèche, qui suit l'alpha de sa passe.
    const unrelated = new Set(["/orders/0/lines/0", "/orders/0/lines/1"]);
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", unrelated))).toEqual([
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
      ["stroke", DIM_ALPHA],
    ]);
  });

  it("scinde aussi le containment en deux passes", () => {
    // Même découpage qu'au singleton : un ensemble non nul suffit à ouvrir la
    // passe estompée, quel que soit son cardinal.
    const g = drawEdges(graph, positions, theme, 0, "contain", new Set(["/orders/0", "/orders/1"]));
    expect(passes(g)).toEqual([
      ["stroke", DIM_ALPHA],
      ["stroke", 1],
      ["stroke", 1],
      ["fill", 1],
      ["stroke", 1],
    ]);
  });

  it("estompe tout avec un ensemble VIDE, qui n'est pas l'absence de focus", () => {
    // `null` dit « aucune sélection », l'ensemble vide dirait « une sélection
    // que personne ne touche ». Les deux ne peuvent pas se confondre, sans quoi
    // un agrégat introuvable rendrait le graphe entier au premier plan.
    expect(passes(drawEdges(graph, positions, theme, 0, "ref", new Set()))).toEqual([
      ["stroke", DIM_ALPHA],
      ["fill", DIM_ALPHA],
      ["stroke", DIM_ALPHA],
    ]);
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
    // Le DERNIER stroke, et non la dernière instruction : depuis que le
    // surlignage repeint aussi la tête de flèche, le contexte se termine par un
    // `fill()`, pas par le tracé des références sortantes.
    const actions = (g.context.instructions as any[]).map((x) => x.action);
    const path = firstPath(g, actions.lastIndexOf("stroke"));
    expect(path[0].action).toBe("moveTo");
    expect(path[0].data).toEqual(START);
    // Pointillé s'arrêtant au pied de la flèche : le dernier point tracé tombe
    // où le dernier tiret s'arrête, donc à moins d'un motif (tiret + espace)
    // plus la longueur de la flèche de l'ancrage de la cible.
    const last = path[path.length - 1].data;
    expect(last[0]).toBeCloseTo(END[0], 10);
    expect(Math.abs(last[1] - END[1])).toBeLessThanOrEqual(20);
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

/**
 * Le surlignage de sélection ne doit PAS ajouter un tracé par-dessus l'arête
 * existante : il doit lui faire changer de STYLE. Il reprend donc la géométrie
 * de `drawEdges` (mêmes ancrages, arrêt au pied de la flèche, tête repeinte) et
 * son trait suit le mode — plein en vue graphe, pointillé en vue structure.
 * Le pointillé surajouté sur une arête pleine était le défaut signalé.
 */
describe("drawSelectionOverlay — le surlignage suit le style de l'arête", () => {
  const theme = resolveTheme(undefined);
  const graph = buildGraph(shopData, shopConfig);

  const SOURCE = "/orders/0"; // référence résolue vers /customers/0
  const TARGET = "/customers/0";
  const DANGLING = "/orders/1"; // référence cassée, donc moignon
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>([
    [SOURCE, { x: 0, y: 0, width: 160, height: 60 }],
    [TARGET, { x: 0, y: 300, width: 160, height: 60 }],
    [DANGLING, { x: 600, y: 0, width: 160, height: 60 }],
  ]);

  /** Action et commandes de chemin de chaque instruction, dans l'ordre. */
  function shape(g: ReturnType<typeof drawSelectionOverlay>): { action: string; path: string[] }[] {
    return (g.context.instructions as any[]).map((x) => ({
      action: x.action,
      path: x.data.path.instructions.map((p: any) => p.action),
    }));
  }

  it('trace la référence PLEINE en mode "ref"', () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE, "ref");
    const s = shape(g);
    // Anneau de la carte, trait de la référence, tête de flèche. Aucune chaîne
    // de parenté : les parents ne sont pas positionnés ici.
    expect(s.map((x) => x.action)).toEqual(["stroke", "stroke", "fill"]);
    // Un seul segment, comme `drawEdges` en mode "ref" — pas les N tirets.
    expect(s[1]!.path).toEqual(["moveTo", "lineTo"]);
  });

  it('garde la référence POINTILLÉE en mode "contain" (et par défaut)', () => {
    const explicit = drawSelectionOverlay(graph, positions, theme, SOURCE, "contain");
    const implicit = drawSelectionOverlay(graph, positions, theme, SOURCE);
    expect(shape(implicit)).toEqual(shape(explicit));
    const s = shape(explicit);
    expect(s.map((x) => x.action)).toEqual(["stroke", "stroke", "fill"]);
    expect(s[1]!.path.filter((a) => a === "lineTo").length).toBeGreaterThan(1);
  });

  it("repeint la tête de flèche dans la couleur de sélection, dans les deux modes", () => {
    for (const mode of ["contain", "ref"] as const) {
      const g = drawSelectionOverlay(graph, positions, theme, SOURCE, mode);
      const fills = (g.context.instructions as any[]).filter((x) => x.action === "fill");
      expect(fills).toHaveLength(1);
      expect(fills[0].data.style.color).toBe(new Color(theme.accent.selection).toNumber());
      // La pointe est posée sur l'ancrage de la cible, comme dans `drawEdges`.
      expect(fills[0].data.path.instructions[0].data).toEqual([80, 300]);
    }
  });

  it("arrête le trait au pied de la flèche au lieu de la traverser", () => {
    const g = drawSelectionOverlay(graph, positions, theme, SOURCE, "ref");
    const line = (g.context.instructions[1] as any).data.path.instructions;
    const [ex, ey] = line[1].data;
    expect(ex).toBeCloseTo(80, 10);
    expect(ey).toBeGreaterThan(280);
    expect(ey).toBeLessThan(300);
  });

  it("laisse le moignon cassé pointillé dans les deux modes", () => {
    // Le pointillé d'un moignon ne dit pas « secondaire » mais « ne mène nulle
    // part » : il ne suit donc pas la bascule de mode (même argument que
    // `drawEdges`).
    const contain = shape(drawSelectionOverlay(graph, positions, theme, DANGLING, "contain"));
    const ref = shape(drawSelectionOverlay(graph, positions, theme, DANGLING, "ref"));
    expect(ref).toEqual(contain);
    // Anneau + moignon, et AUCUN fill : un moignon ne vise rien, donc pas de
    // tête de flèche.
    expect(ref.map((x) => x.action)).toEqual(["stroke", "stroke"]);
    expect(ref[1]!.path.filter((a) => a === "lineTo").length).toBeGreaterThan(1);
  });

  it("peint le trait dans la couleur et l'épaisseur de la sélection", () => {
    for (const mode of ["contain", "ref"] as const) {
      const g = drawSelectionOverlay(graph, positions, theme, SOURCE, mode);
      const style = (g.context.instructions[1] as any).data.style;
      expect(style.color).toBe(new Color(theme.accent.selection).toNumber());
      expect(style.width).toBe(theme.strokes.selection);
    }
  });
});
