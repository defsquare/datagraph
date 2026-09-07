import { describe, it, expect } from "vitest";
import type { Container } from "pixi.js";
import {
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type NodeId,
  type NodeMetrics,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { ClusterShape, GraphLayoutResult } from "@defsquare/data-graph-core/graph-layout";
import {
  aggregateRefEdges,
  createGraphViewController,
  dominantSegmentPrefix,
  type ClustersForArgs,
  type GraphViewController,
} from "../src/graph-view.js";
import {
  blendOver,
  bucketOf,
  drawSemanticDiscs,
  drawSemanticEdges,
  drawSemanticLabels,
  truncateMiddle,
  type SemanticNode,
} from "../src/draw.js";
import { DIM_ALPHA } from "../src/focus.js";
import { resolveTheme } from "../src/theme.js";
import { cartConfig, cartData } from "./fixtures.js";

// --------------------------------------------------------------------------
// L'AGRÉGATION DES ARÊTES — la fonction pure, testée sur des arêtes fabriquées
// à la main plutôt que sur un graphe construit : ce qui est en jeu ici est
// exactement le repli d'une liste d'arêtes sur une partition, et fabriquer un
// document JSON pour l'obtenir mettrait entre le test et son sujet tout le
// pipeline de construction.
// --------------------------------------------------------------------------

/** Une référence RÉSOLUE de `fromEntity` vers `to`. `from` vaut `fromEntity`
 * sauf quand le test s'intéresse justement à leur différence. */
function ref(fromEntity: NodeId, to: NodeId | null, from = fromEntity): RefEdge {
  return {
    kind: "ref",
    from,
    fromEntity,
    to,
    field: "ref",
    targetType: "T",
    targetId: "x",
    dangling: to === null,
  };
}

function byNodeOf(pairs: [NodeId, string][]): Map<NodeId, string[]> {
  return new Map(pairs.map(([id, aggregateId]) => [id, [aggregateId]]));
}

describe("aggregateRefEdges", () => {
  it("replie les références sur les paires d'agrégats, avec leur poids", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
      ["b2", "B"],
    ]);
    const edges = aggregateRefEdges([ref("a1", "b1"), ref("a2", "b2"), ref("a1", "b2")], byNode);
    expect(edges).toEqual([{ a: "A", b: "B", weight: 3 }]);
  });

  it("ignore les références INTRA-agrégat", () => {
    // Elles sont déjà dites par le disque lui-même ; les tracer poserait une
    // boucle sur place.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
    ]);
    const edges = aggregateRefEdges([ref("a1", "a2"), ref("a1", "b1")], byNode);
    expect(edges).toEqual([{ a: "A", b: "B", weight: 1 }]);
  });

  it("ignore une référence dont un bout est HORS agrégat", () => {
    // Une entité sans agrégat garde sa carte au régime sémantique : elle n'a pas
    // de disque, donc pas de bout à relier.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    const edges = aggregateRefEdges(
      [ref("a1", "orphan"), ref("orphan", "b1"), ref("a1", "b1")],
      byNode,
    );
    expect(edges).toEqual([{ a: "A", b: "B", weight: 1 }]);
  });

  it("ignore une référence cassée ou sans cible", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    const broken = { ...ref("a1", "b1"), dangling: true };
    expect(aggregateRefEdges([broken, ref("a1", null)], byNode)).toEqual([]);
  });

  it("compte par l'ENTITÉ déclarante, pas par le nœud porteur de la ligne", () => {
    // Une référence portée par un value object est celle de son entité : c'est
    // le seul niveau auquel `byNode` répond. Sans `fromEntity`, cette arête
    // disparaîtrait — le value object n'est dans aucun agrégat.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    expect(aggregateRefEdges([ref("a1", "b1", "a1/lines/0")], byNode)).toEqual([
      { a: "A", b: "B", weight: 1 },
    ]);
  });

  it("dédoublonne les deux SENS dans la même paire", () => {
    // L'arête est non orientée : à cette échelle, aucune tête de flèche n'est
    // lisible, et ce que la vue montre est le couplage.
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    expect(aggregateRefEdges([ref("a1", "b1"), ref("b1", "a1")], byNode)).toEqual([
      { a: "A", b: "B", weight: 2 },
    ]);
  });

  it("normalise la paire : `a` est toujours le plus petit id", () => {
    const byNode = byNodeOf([
      ["z1", "Z"],
      ["a1", "A"],
    ]);
    // Rencontrée dans le sens Z → A, elle ressort quand même A → Z.
    expect(aggregateRefEdges([ref("z1", "a1")], byNode)).toEqual([
      { a: "A", b: "Z", weight: 1 },
    ]);
  });

  it("rend les paires dans l'ordre de PREMIÈRE RENCONTRE, de façon déterministe", () => {
    const byNode = byNodeOf([
      ["a1", "A"],
      ["b1", "B"],
      ["c1", "C"],
    ]);
    const edges = [ref("c1", "b1"), ref("a1", "b1"), ref("b1", "c1"), ref("a1", "c1")];
    const first = aggregateRefEdges(edges, byNode);
    // B–C d'abord (rencontrée en premier), puis A–B, puis A–C.
    expect(first.map((e) => `${e.a}-${e.b}`)).toEqual(["B-C", "A-B", "A-C"]);
    expect(first.map((e) => e.weight)).toEqual([2, 1, 1]);
    // Deux appels sur la même entrée rendent exactement la même chose : c'est
    // ce dont dépend la stabilité du tracé d'une publication à l'autre.
    expect(aggregateRefEdges(edges, byNode)).toEqual(first);
  });

  it("ne confond pas deux paires dont les ids se recollent", () => {
    // Les ids d'agrégat sont `${type}#${entityId}`, et un id d'entité peut
    // contenir n'importe quel caractère imprimable : une clé de couple bâtie sur
    // un séparateur imprimable confondrait ces deux paires.
    const byNode = byNodeOf([
      ["x", "T#a"],
      ["y", "b#T"],
      ["z", "T#a b"],
      ["w", "T"],
    ]);
    const edges = aggregateRefEdges([ref("x", "y"), ref("z", "w")], byNode);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.weight === 1)).toBe(true);
  });

  it("rend un tableau vide sans agrégat", () => {
    expect(aggregateRefEdges([ref("a1", "b1")], new Map())).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// LE PRÉFIXE DOMINANT — la fonction pure, testée sur des listes de chaînes : ce
// qui est en jeu est un calcul sur des noms, pas sur un graphe.
// --------------------------------------------------------------------------

describe("dominantSegmentPrefix", () => {
  it("rend le plus long préfixe par SEGMENTS, terminé par son point", () => {
    // Le cas du jeu réel : ~1 300 packages d'une seule application, tous sous la
    // même racine. C'est la queue du chemin qui distingue.
    expect(
      dominantSegmentPrefix([
        "com.bnpparibas.bddf.fipro.domain.project",
        "com.bnpparibas.bddf.fipro.domain.contract",
        "com.bnpparibas.bddf.fipro.infra.jpa",
      ]),
    ).toBe("com.bnpparibas.bddf.fipro.");
  });

  it("coupe aux SEGMENTS et jamais au milieu de l'un d'eux", () => {
    // `credit` et `creditcard` partagent quatre caractères, pas un segment :
    // retirer `com.exemple.credit` laisserait `card…`, qui n'est plus un chemin.
    expect(dominantSegmentPrefix(["com.exemple.credit.a", "com.exemple.creditcard.b"])).toBe(
      "com.exemple.",
    );
  });

  it("tient malgré une minorité de noms d'une AUTRE famille", () => {
    // Le jeu réel exactement : des packages sous une racine unique, plus quelques
    // modules et packages étrangers. Exiger l'unanimité ne retirerait rien du
    // tout — c'est le cas qui a motivé le seuil.
    const packages = Array.from({ length: 20 }, (_, i) =>
      // Deux branches sous la racine : sans quoi la branche elle-même serait le
      // préfixe dominant, et à juste titre.
      i % 2 === 0 ? `com.bnpparibas.bddf.fipro.domain.p${i}` : `com.bnpparibas.bddf.fipro.infra.p${i}`,
    );
    expect(dominantSegmentPrefix([...packages, "bddf-fipro-domain", "com.axway.cft.client"])).toBe(
      "com.bnpparibas.bddf.fipro.",
    );
  });

  it("ne retire rien quand aucun préfixe n'atteint la majorité", () => {
    // Deux familles à parts égales : aucune n'est le bruit de l'autre.
    expect(
      dominantSegmentPrefix([
        "com.alpha.un.a",
        "com.alpha.un.b",
        "org.beta.deux.c",
        "org.beta.deux.d",
      ]),
    ).toBe("");
  });

  it("ne retire rien d'un SEUL libellé", () => {
    // Il n'y a alors aucune répétition à l'écran : le disque unique perdrait son
    // nom complet sans que rien ne le rende à la lecture.
    expect(dominantSegmentPrefix(["com.exemple.credit.domain"])).toBe("");
    expect(dominantSegmentPrefix([])).toBe("");
  });

  it("ne retire rien quand le préfixe commun tient en MOINS de deux segments", () => {
    // Retirer `com.` ne rend presque pas de place et coûte la racine du chemin.
    expect(dominantSegmentPrefix(["com.alpha.x", "com.beta.y"])).toBe("");
  });

  it("rend la chaîne vide quand les libellés n'ont rien en commun", () => {
    expect(dominantSegmentPrefix(["com.alpha.x", "org.beta.y"])).toBe("");
    // Des libellés sans point du tout : le cas des petits jeux, où le libellé
    // est un id court et non un chemin.
    expect(dominantSegmentPrefix(["k1", "p1"])).toBe("");
  });

  it("laisse toujours UN segment, même quand un libellé est le préfixe des autres", () => {
    // `a.b.c` est entièrement commun, mais le retirer rendrait le premier disque
    // anonyme : le préfixe est plafonné à un segment de moins que le libellé le
    // plus court.
    expect(dominantSegmentPrefix(["a.b.c", "a.b.c.d"])).toBe("a.b.");
  });

  it("laisse un segment même quand TOUS les libellés sont identiques", () => {
    // Rien ne peut les distinguer de toute façon ; ce qui compte est qu'aucun ne
    // devienne vide.
    const prefix = dominantSegmentPrefix(["a.b.c.d", "a.b.c.d"]);
    expect(prefix).toBe("a.b.c.");
    expect("a.b.c.d".slice(prefix.length)).toBe("d");
  });

  it("garantit un reste non vide sur un jeu hétérogène", () => {
    // La propriété qui autorise l'appelant à découper par simple `slice` : quel
    // que soit le jeu, aucun libellé ne devient vide.
    const labels = [
      "com.exemple.credit.domain.project.service",
      "com.exemple.credit.domain",
      "com.exemple.credit.infra",
      "com.exemple.credit",
    ];
    // Le commun est `com.exemple.credit`, mais le libellé le plus court n'a que
    // ces trois segments : le plafond ramène le préfixe à `com.exemple.`, qui en
    // couvre encore deux et est donc retiré.
    const prefix = dominantSegmentPrefix(labels);
    expect(prefix).toBe("com.exemple.");
    expect(labels.map((l) => l.slice(prefix.length))).toEqual([
      "credit.domain.project.service",
      "credit.domain",
      "credit.infra",
      "credit",
    ]);
  });
});

// --------------------------------------------------------------------------
// LE CONTRÔLEUR — ce que le régime sémantique dérive de l'état publié.
// --------------------------------------------------------------------------

/** `cartData` avec DEUX racines : le panier et le produit deviennent chacun leur
 * propre agrégat, et la référence `lines[*].productRef` — portée par un value
 * object — les relie. C'est le plus petit jeu qui produise une arête agrégée
 * INTER-agrégats, et il couvre au passage le cas `fromEntity`. */
const twoRootConfig: DataGraphConfig = { ...cartConfig, groups: ["Cart", "Product"] };
const twoRootGraph = buildGraph(cartData, twoRootConfig);

/** Le jeu réel en miniature : des entités dont l'id est un FQN, la grande
 * majorité sous une même racine et une étrangère au lot. C'est le seul jeu qui
 * exerce le retrait du préfixe dominant de bout en bout — les fixtures partagées
 * ont des ids courts, sans point. */
const fqnConfig: DataGraphConfig = {
  ids: { Package: "$.packages[*].id" },
  groups: ["Package"],
};
const fqnGraph = buildGraph(
  {
    packages: [
      ...["project", "contract", "party", "rule", "event"].map((name) => ({
        id: `com.exemple.credit.domain.${name}`,
      })),
      ...["jpa", "rest", "soap", "sql"].map((name) => ({
        id: `com.exemple.credit.infra.${name}`,
      })),
      { id: "autre.chose.ici" },
    ],
  },
  fqnConfig,
);

function controllerFor(): GraphViewController {
  return createGraphViewController({
    layoutOptions: undefined,
    getMetrics: (): NodeMetrics => DEFAULT_METRICS,
  });
}

async function published(): Promise<GraphViewController> {
  const controller = controllerFor();
  controller.publish(await controller.compute(twoRootGraph, twoRootConfig, false));
  return controller;
}

/** Les arguments de peinture au repos : rien de sélectionné, rien de survolé. */
function args(over: Partial<ClustersForArgs> = {}): ClustersForArgs {
  return {
    graph: twoRootGraph,
    accentFor: () => "#123456",
    fallbackColor: "#000000",
    selectedAggregateId: null,
    keep: null,
    hoverOf: () => 0,
    ...over,
  };
}

/** Publie un état FABRIQUÉ : deux disques aux coordonnées choisies et une arête
 * entre eux. C'est la seule façon d'asserter la géométrie du rognage sans
 * dépendre de ce que le moteur place où. */
function publishSynthetic(
  controller: GraphViewController,
  clusters: ClusterShape[],
  semanticEdges: { a: string; b: string; weight: number }[],
): void {
  const layout: GraphLayoutResult = { positions: new Map(), clusters };
  controller.publish({
    index: { aggregates: new Map(), byNode: new Map() },
    layout,
    semanticEdges,
    // Aucun libellé : ces disques n'existent que pour leur géométrie, et le
    // repli sur l'id d'agrégat suffit à les nommer.
    semanticLabels: new Map(),
  });
}

const shape = (aggregateId: string, cx: number, cy: number, r: number): ClusterShape => ({
  aggregateId,
  rootId: `/root/${aggregateId}`,
  cx,
  cy,
  r,
});

describe("graph view controller — régime sémantique", () => {
  it("publie les arêtes agrégées avec le reste de l'état", async () => {
    const controller = await published();
    // Un panier, un produit, une référence entre eux : une paire de poids 1.
    expect(controller.semanticEdges(null)).toHaveLength(1);
  });

  it("perd les arêtes agrégées à l'invalidation, avec le reste", async () => {
    const controller = await published();
    controller.invalidate();
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("résout l'appartenance d'une entité, et rend `undefined` hors agrégat", async () => {
    const controller = await published();
    expect(controller.aggregateIdOf("/carts/0")).toBe("Cart#k1");
    expect(controller.aggregateIdOf("/carts/0/lines/0")).toBeUndefined();
  });

  it("étiquette chaque disque par l'id d'ENTITÉ de sa racine, et compte ses membres", async () => {
    const controller = await published();
    const nodes = new Map(controller.semanticNodesFor(args()).map((n) => [n.id, n]));
    expect(nodes.get("Cart#k1")!.label).toBe("k1");
    expect(nodes.get("Product#p1")!.label).toBe("p1");
    expect(nodes.get("Cart#k1")!.count).toBe(1);
  });

  it("retire le préfixe commun des libellés PEINTS, en gardant l'id complet", async () => {
    // Le jeu réel en miniature : un seul arbre de packages, donc un préfixe que
    // tous les disques répéteraient. L'id, lui, ne bouge pas — c'est par lui que
    // passent la sélection, le panneau de détail et la recherche.
    const controller = controllerFor();
    controller.publish(await controller.compute(fqnGraph, fqnConfig, false));
    const nodes = new Map(
      controller.semanticNodesFor(args({ graph: fqnGraph })).map((n) => [n.id, n]),
    );
    expect(nodes.get("Package#com.exemple.credit.domain.project")!.label).toBe("domain.project");
    expect(nodes.get("Package#com.exemple.credit.infra.jpa")!.label).toBe("infra.jpa");
    // L'étrangère au lot garde son nom ENTIER : le préfixe est dominant, pas
    // universel, et l'amputer d'un préfixe qu'elle ne porte pas n'aurait aucun
    // sens.
    expect(nodes.get("Package#autre.chose.ici")!.label).toBe("autre.chose.ici");
  });

  it("perd les libellés à l'invalidation, avec le reste", async () => {
    // Le préfixe retiré est celui de CE jeu d'agrégats : gardé sous un autre
    // graphe, il nommerait des disques avec le raccourci d'un jeu disparu.
    const controller = controllerFor();
    controller.publish(await controller.compute(fqnGraph, fqnConfig, false));
    controller.invalidate();
    publishSynthetic(controller, [shape("Package#com.exemple.credit.infra.jpa", 0, 0, 10)], []);
    // Plus de table : le libellé retombe sur l'id d'agrégat, jamais sur une case
    // vide.
    expect(controller.semanticNodesFor(args({ graph: fqnGraph }))[0]!.label).toBe(
      "Package#com.exemple.credit.infra.jpa",
    );
  });

  it("résout couleur, estompage et survol EXACTEMENT comme les enveloppes", async () => {
    const controller = await published();
    const selected = args({ selectedAggregateId: "Cart#k1", keep: new Set(["/carts/0"]) });
    const hulls = new Map(controller.clustersFor(selected).map((p, i) => [i, p]));
    const discs = controller.semanticNodesFor(selected);
    // Le disque et l'enveloppe qu'il remplace décrivent le même agrégat : tout
    // ce qui n'est pas propre au régime sémantique doit être identique, sans
    // quoi les deux régimes ne s'allumeraient pas ensemble.
    discs.forEach((disc, i) => {
      const hull = hulls.get(i)!;
      expect(disc.circle).toEqual(hull.circle);
      expect(disc.color).toBe(hull.color);
      expect(disc.dim).toBe(hull.dim);
      expect(disc.hover).toBe(hull.hover);
    });
    expect(discs.some((d) => d.hover === 1)).toBe(true);
  });

  it("rogne le segment aux bords des deux disques", () => {
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 10), shape("B", 100, 0, 20)],
      [{ a: "A", b: "B", weight: 1 }],
    );
    expect(controller.semanticEdges(null)).toEqual([
      { x1: 10, y1: 0, x2: 80, y2: 0, weight: 1, dim: false },
    ]);
  });

  it("omet une paire dont les disques se touchent ou se recouvrent", () => {
    // Il ne reste alors aucun segment : un trait de longueur nulle ou négative
    // serait un trait retourné.
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 60), shape("B", 100, 0, 60)],
      [{ a: "A", b: "B", weight: 1 }],
    );
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("omet une paire dont un disque manque à la mise en page", () => {
    const controller = controllerFor();
    publishSynthetic(controller, [shape("A", 0, 0, 10)], [{ a: "A", b: "B", weight: 1 }]);
    expect(controller.semanticEdges(null)).toEqual([]);
  });

  it("garde PLEINE toute arête qui touche l'agrégat sélectionné", () => {
    const controller = controllerFor();
    publishSynthetic(
      controller,
      [shape("A", 0, 0, 10), shape("B", 200, 0, 10), shape("C", 400, 0, 10)],
      [
        { a: "A", b: "B", weight: 1 },
        { a: "B", b: "C", weight: 1 },
        { a: "A", b: "C", weight: 1 },
      ],
    );
    const dims = controller.semanticEdges("B").map((e) => e.dim);
    // A–B et B–C touchent la sélection, A–C ne dit rien d'elle.
    expect(dims).toEqual([false, false, true]);
    // Sans sélection, rien ne recule.
    expect(controller.semanticEdges(null).every((e) => e.dim === false)).toBe(true);
  });

  it("suit les disques déplacés, qui sont mutés EN PLACE", () => {
    const controller = controllerFor();
    const a = shape("A", 0, 0, 10);
    publishSynthetic(controller, [a, shape("B", 100, 0, 10)], [{ a: "A", b: "B", weight: 1 }]);
    a.cx = -100;
    // Le segment est recalculé à chaque lecture : c'est ce qui laisse un
    // déplacement d'agrégat entraîner ses arêtes sans rien republier.
    expect(controller.semanticEdges(null)[0]!.x1).toBe(-90);
  });
});

// --------------------------------------------------------------------------
// LE DESSIN — donnée nue seulement, comme le reste de `draw.ts`.
// --------------------------------------------------------------------------

describe("truncateMiddle", () => {
  it("laisse un texte qui tient", () => {
    expect(truncateMiddle("abcd", 100, 10)).toBe("abcd");
  });

  it("mange le MILIEU et garde la fin, qui est ce qui distingue", () => {
    // Une troncature par la fin rendrait « com.exemp… » pour tout le jeu.
    expect(truncateMiddle("com.exemple.credit.domain", 110, 10)).toBe("com.e…omain");
  });

  it("donne le caractère en trop à la TÊTE quand le budget est impair", () => {
    expect(truncateMiddle("abcdefgh", 40, 10)).toBe("ab…h");
  });

  it("retombe sur l'ellipse seule quand il ne reste qu'un caractère", () => {
    expect(truncateMiddle("abcdef", 10, 10)).toBe("…");
  });

  it("rend la chaîne vide sans place", () => {
    expect(truncateMiddle("abc", 0, 10)).toBe("");
    expect(truncateMiddle("abc", -5, 10)).toBe("");
  });
});

describe("bucketOf", () => {
  it("répartit les poids en quatre paliers", () => {
    expect(bucketOf(1)).toBe(0);
    expect(bucketOf(2)).toBe(1);
    expect(bucketOf(4)).toBe(2);
    expect(bucketOf(6)).toBe(3);
  });

  it("plafonne : au-delà du poids plein, tout est au palier maximal", () => {
    expect(bucketOf(8)).toBe(3);
    expect(bucketOf(800)).toBe(3);
  });

  it("borne un poids absurde par le bas", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(-3)).toBe(0);
  });
});

describe("blendOver", () => {
  const black = "#000000";
  const white = "#ffffff";

  it("rend la base à intensité nulle et la surcouche à intensité pleine", () => {
    expect(blendOver(black, white, 0)).toBe(0x000000);
    expect(blendOver(black, white, 1)).toBe(0xffffff);
  });

  it("mélange linéairement, et rend une couleur OPAQUE", () => {
    // C'est le point : le pixel est calculé une fois ici plutôt que par un
    // second remplissage translucide à chaque image.
    expect(blendOver(black, white, 0.5)).toBe(0x808080);
  });

  it("borne une intensité hors de [0,1]", () => {
    expect(blendOver(black, white, 2)).toBe(0xffffff);
    expect(blendOver(black, white, -1)).toBe(0x000000);
  });
});

const theme = resolveTheme(undefined);

function node(over: Partial<SemanticNode> = {}): SemanticNode {
  return {
    id: "A",
    circle: { cx: 0, cy: 0, r: 100 },
    color: "#ff0000",
    label: "alpha",
    count: 3,
    ...over,
  };
}

/** Les styles effectivement émis, dans l'ordre. Même lecture que
 * `clusters.test.ts` : l'alpha et l'épaisseur vivent là. */
function styles(g: { context: { instructions: unknown[] } }) {
  return (g.context.instructions as { action: string; data: unknown }[]).map((instruction) => {
    const style = (instruction.data as { style: { color?: number; alpha: number; width?: number } })
      .style;
    return { action: instruction.action, color: style.color, alpha: style.alpha, width: style.width };
  });
}

describe("drawSemanticDiscs", () => {
  it("émet un remplissage et un contour par disque", () => {
    const g = drawSemanticDiscs([node(), node({ id: "B", circle: { cx: 300, cy: 0, r: 50 } })], theme);
    expect(g.context.instructions.length).toBe(4);
  });

  it("peint OPAQUE : la couleur est pré-mélangée, pas posée en alpha", () => {
    // C'est ce qui masque les arêtes agrégées qui passent dessous — et ce qui
    // évite le second remplissage qui doublait la surface peinte.
    const [fill, stroke] = styles(drawSemanticDiscs([node()], theme));
    expect(fill!.alpha).toBe(1);
    expect(stroke!.alpha).toBe(1);
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3));
    expect(stroke!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.75));
  });

  it("renforce accent et contour au survol", () => {
    const [fill, stroke] = styles(drawSemanticDiscs([node({ hover: 1 })], theme));
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.5));
    expect(stroke!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 1));
  });

  it("borne une intensité hors de [0,1]", () => {
    const over = styles(drawSemanticDiscs([node({ hover: 4 })], theme));
    const under = styles(drawSemanticDiscs([node({ hover: -2 })], theme));
    expect(over[0]!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.5));
    expect(under[0]!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3));
  });

  it("estompe en ramenant le disque VERS le canevas, sans le rendre transparent", () => {
    // Un disque estompé recule, mais continue de masquer les arêtes qui passent
    // dessous : sinon le fond du dessin remonterait par les blocs qu'on vient
    // justement d'écarter du regard.
    const [fill] = styles(drawSemanticDiscs([node({ dim: true })], theme));
    expect(fill!.alpha).toBe(1);
    expect(fill!.color).toBe(blendOver(theme.surface.canvas, "#ff0000", 0.3 * DIM_ALPHA));
  });

  it("garde l'épaisseur du contour PROPORTIONNELLE au rayon", () => {
    // C'est la condition d'un zoom sémantique : le disque grandit avec la
    // caméra, donc son contour doit grandir avec lui.
    const [, stroke] = styles(drawSemanticDiscs([node()], theme));
    expect(stroke!.width).toBeCloseTo(100 * 0.03, 6);
    const [, hovered] = styles(drawSemanticDiscs([node({ hover: 1 })], theme));
    expect(hovered!.width).toBeCloseTo(100 * 0.05, 6);
  });

  it("laisse l'épaisseur intacte en estompant", () => {
    const [, stroke] = styles(drawSemanticDiscs([node({ dim: true })], theme));
    expect(stroke!.width).toBeCloseTo(100 * 0.03, 6);
  });

  it("ignore un rayon non positif et continue", () => {
    const g = drawSemanticDiscs([node({ circle: { cx: 0, cy: 0, r: 0 } }), node()], theme);
    expect(g.context.instructions.length).toBe(2);
  });

  it("ne peint rien sans disque", () => {
    expect(drawSemanticDiscs([], theme).context.instructions.length).toBe(0);
  });
});

/**
 * Le libellé et la pastille d'un disque, dans l'ordre où `drawSemanticLabels`
 * les monte : c'est le contrat de la fonction, et le lire ici évite de répéter
 * la même descente typée à chaque test.
 */
function partsOf(
  layer: Container,
  index = 0,
): { text: string; y: number; scale: { x: number } }[] {
  return (layer.children[index] as Container).children as unknown as {
    text: string;
    y: number;
    scale: { x: number };
  }[];
}

describe("drawSemanticLabels", () => {
  it("groupe le libellé et sa pastille dans un conteneur étiqueté par l'agrégat", () => {
    // C'est ce qui laisse `dragCluster` déplacer le seul libellé concerné.
    const layer = drawSemanticLabels([node({ id: "Package#alpha" })], theme, false);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]!.label).toBe("Package#alpha");
    expect(partsOf(layer)).toHaveLength(2);
  });

  it("n'intercepte jamais le pointeur : le disque en dessous porte le geste", () => {
    expect(drawSemanticLabels([node()], theme, false).eventMode).toBe("none");
  });

  it("donne le MÊME budget de caractères à tous les disques, quelle que soit leur taille", () => {
    // Le rayon s'élimine entre la largeur utile et la taille de police : c'est
    // ce qui fait lire la taille d'un disque comme une quantité de membres et
    // non comme une quantité de texte.
    const long = "com.exemple.credit.domain.model.request";
    const small = drawSemanticLabels([node({ label: long, circle: { cx: 0, cy: 0, r: 40 } })], theme, false);
    const big = drawSemanticLabels([node({ label: long, circle: { cx: 0, cy: 0, r: 900 } })], theme, false);
    const textOf = (layer: Container): string => partsOf(layer)[0]!.text;
    expect(textOf(small)).toBe(textOf(big));
    expect(textOf(small).length).toBeLessThan(long.length);
    expect(textOf(small)).toContain("…");
  });

  it("met à l'échelle plutôt que de changer de taille de police", () => {
    // Créer 1 300 textes à 1 300 tailles demanderait autant d'atlas ; la mise à
    // l'échelle laisse les libellés partager celui des cartes.
    const layer = drawSemanticLabels([node({ circle: { cx: 0, cy: 0, r: 100 } })], theme, false);
    const label = partsOf(layer)[0]!;
    expect(label.scale.x).toBeCloseTo((100 * 0.2) / theme.typography.header.size, 6);
  });

  it("écrit le compte de membres sous le libellé", () => {
    const layer = drawSemanticLabels([node({ count: 42 })], theme, false);
    const [label, badge] = partsOf(layer);
    expect(badge!.text).toBe("42");
    expect(badge!.y).toBeGreaterThan(label!.y);
  });

  it("ignore un rayon non positif", () => {
    expect(
      drawSemanticLabels([node({ circle: { cx: 0, cy: 0, r: 0 } })], theme, false).children,
    ).toHaveLength(0);
  });
});

describe("drawSemanticEdges", () => {
  const edge = (weight: number, dim = false) => ({ x1: 0, y1: 0, x2: 100, y2: 0, weight, dim });

  it("ne peint rien sans arête, ni sans unité d'épaisseur", () => {
    expect(drawSemanticEdges([], theme, 100).context.instructions.length).toBe(0);
    expect(drawSemanticEdges([edge(1)], theme, 0).context.instructions.length).toBe(0);
  });

  it("émet UN tracé par palier occupé, et non un par arête", () => {
    // Un `stroke()` ne porte qu'un style : une épaisseur par arête voudrait dire
    // des milliers d'appels de tracé.
    const same = drawSemanticEdges([edge(1), edge(1), edge(1)], theme, 100);
    expect(same.context.instructions.length).toBe(1);
    const spread = drawSemanticEdges([edge(1), edge(3), edge(5), edge(7)], theme, 100);
    expect(spread.context.instructions.length).toBe(4);
  });

  it("gradue épaisseur ET alpha du palier le plus faible au plus fort", () => {
    const s = styles(drawSemanticEdges([edge(1), edge(7)], theme, 100));
    expect(s[0]!.width!).toBeLessThan(s[1]!.width!);
    expect(s[0]!.alpha).toBeLessThan(s[1]!.alpha);
  });

  it("met l'épaisseur en fraction de l'unité reçue", () => {
    const small = styles(drawSemanticEdges([edge(1)], theme, 100));
    const large = styles(drawSemanticEdges([edge(1)], theme, 200));
    expect(large[0]!.width!).toBeCloseTo(small[0]!.width! * 2, 6);
  });

  it("peint les estompées AVANT les pleines, donc en dessous", () => {
    // Dans un Graphics unique, seul l'ordre d'émission règle le recouvrement :
    // la sélection doit passer par-dessus le reste.
    const s = styles(drawSemanticEdges([edge(1), edge(1, true)], theme, 100));
    expect(s).toHaveLength(2);
    expect(s[0]!.alpha).toBeLessThan(s[1]!.alpha);
    expect(s[0]!.alpha).toBeCloseTo(s[1]!.alpha * DIM_ALPHA, 6);
  });
});
