import { describe, it, expect, vi } from "vitest";
import {
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type Graph,
  type NodeId,
  type NodeMetrics,
  type Rect,
} from "@defsquare/data-graph-core";
// Import STATIQUE du point d'entrée de la vue graphe, et c'est permis ici : la
// règle de `bundle-purity.test.ts` ne porte que sur `src/` (c'est le bundle du
// consommateur qu'elle protège), et le contrôleur lui-même n'y touche toujours
// que par son `import()` dynamique. On lit la constante plutôt que d'écrire 18
// dans le test : c'est exactement l'invariant qu'on veut asserter — le renderer
// ne garde AUCUNE copie de ce nombre.
import { TWO_LEVEL_LAYOUT_DEFAULTS } from "@defsquare/data-graph-core/graph-layout";
import {
  createGraphViewController,
  type ClustersForArgs,
  type GraphViewController,
  type GraphViewHooks,
} from "../src/graph-view.js";
import { cartConfig, cartData, shopConfig, shopData } from "./fixtures.js";

/**
 * Les fixtures partagées n'ont pas de `groups` — sans racine déclarée,
 * `buildAggregates` rend un index VIDE et la vue graphe n'aurait aucune
 * enveloppe à montrer. On ajoute donc le seul morceau qui manque, et rien
 * d'autre : c'est la config minimale qui produit des agrégats.
 *
 * Le résultat, sur `shopData` : `Customer#c1` = {c1, o1} (o1 référence c1),
 * `Customer#c2` = {c2}. `o2` référence un client fantôme, n'atteint donc aucune
 * racine et n'appartient à aucun agrégat — ce qui donne au passage une carte
 * sans enveloppe.
 */
const graphConfig: DataGraphConfig = { ...shopConfig, groups: ["Customer"] };
const cartGraphConfig: DataGraphConfig = { ...cartConfig, groups: ["Cart"] };

const shopGraph = buildGraph(shopData, graphConfig);
const cartGraph = buildGraph(cartData, cartGraphConfig);

function controllerFor(hooks: Partial<GraphViewHooks> = {}): GraphViewController {
  return createGraphViewController({
    layoutOptions: undefined,
    getMetrics: (): NodeMetrics => DEFAULT_METRICS,
    ...hooks,
  });
}

/** Un contrôleur qui a publié l'état de `shopGraph` : le point de départ de tout
 * ce qui teste une lecture dérivée. */
async function published(hooks: Partial<GraphViewHooks> = {}): Promise<GraphViewController> {
  const controller = controllerFor(hooks);
  controller.publish(await controller.compute(shopGraph, graphConfig, false));
  return controller;
}

describe("graph view controller — cycle de vie", () => {
  it("ne publie rien avant le premier calcul", () => {
    const controller = controllerFor();
    expect(controller.positions()).toBeUndefined();
    expect(controller.clusters()).toEqual([]);
    expect(controller.aggregateOf("Customer#c1")).toBeUndefined();
    expect(controller.memberIdsContaining("/customers/0")).toBeUndefined();
    // Les entités, elles, ne dépendent d'aucun état publié.
    expect(controller.entityIds(shopGraph).size).toBe(4);
  });

  it("publie index et mise en page d'un bloc : les deux décrivent le même graphe", async () => {
    const controller = await published();

    const positions = controller.positions();
    expect(positions).toBeDefined();
    const clusters = controller.clusters();
    expect(clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"]);

    // L'invariant, écrit tel quel : toute enveloppe de la mise en page publiée
    // se résout dans l'index publié, et tous les membres qu'elle nomme ont une
    // position dans cette même mise en page.
    for (const cluster of clusters) {
      const aggregate = controller.aggregateOf(cluster.aggregateId);
      expect(aggregate, cluster.aggregateId).toBeDefined();
      expect(aggregate!.rootId).toBe(cluster.rootId);
      for (const memberId of aggregate!.memberIds) {
        expect(positions!.has(memberId), memberId).toBe(true);
      }
    }
  });

  it("invalide index et mise en page d'un bloc", async () => {
    const controller = await published();
    controller.invalidate();

    expect(controller.positions()).toBeUndefined();
    expect(controller.clusters()).toEqual([]);
    expect(controller.aggregateOf("Customer#c1")).toBeUndefined();
    expect(controller.memberIdsContaining("/customers/0")).toBeUndefined();
  });
});

describe("graph view controller — compute ne publie jamais", () => {
  it("laisse l'état vide après un calcul réussi non publié", async () => {
    const controller = controllerFor();
    const state = await controller.compute(shopGraph, graphConfig, false);

    // Le calcul a bien abouti…
    expect(state.layout.clusters).toHaveLength(2);
    // …et rien n'a bougé chez le contrôleur.
    expect(controller.positions()).toBeUndefined();
    expect(controller.clusters()).toEqual([]);
    expect(controller.aggregateOf("Customer#c1")).toBeUndefined();
  });

  it("garde l'état PUBLIÉ, et pas celui du dernier calcul terminé", async () => {
    const controller = controllerFor();
    // Deux calculs entrelacés sur deux graphes différents, exactement la course
    // que la séparation compute/publish existe pour rendre survivable.
    const pending = Promise.all([
      controller.compute(shopGraph, graphConfig, false),
      controller.compute(cartGraph, cartGraphConfig, false),
    ]);
    const [shopState, cartState] = await pending;
    expect(cartState.layout.clusters).toHaveLength(1);

    // Un seul `publish`, celui du premier : l'appelant a jugé le second périmé.
    controller.publish(shopState);

    expect([...controller.positions()!.keys()]).toContain("/customers/0");
    expect([...controller.positions()!.keys()]).not.toContain("/carts/0");
    expect(controller.aggregateOf("Customer#c1")).toBeDefined();
    expect(controller.aggregateOf("Cart#k1")).toBeUndefined();
  });
});

describe("graph view controller — hullPadding", () => {
  it("vaut 0 tant que le moteur n'a pas été chargé", () => {
    expect(controllerFor().hullPadding()).toBe(0);
  });

  it("prend la valeur du MOTEUR dès le premier calcul, publié ou non", async () => {
    const controller = controllerFor();
    await controller.compute(shopGraph, graphConfig, false);
    // Le chargement du moteur suffit : la marge sert à recalculer un disque
    // pendant un déplacement, pas à décrire l'état publié.
    expect(controller.hullPadding()).toBe(TWO_LEVEL_LAYOUT_DEFAULTS.hullPadding);
  });

  it("suit les options passées au moteur", async () => {
    const controller = controllerFor({ layoutOptions: { hullPadding: 42 } });
    expect(controller.hullPadding()).toBe(0);
    await controller.compute(shopGraph, graphConfig, false);
    expect(controller.hullPadding()).toBe(42);
  });
});

describe("graph view controller — memberIdsContaining", () => {
  it("retrouve l'enveloppe et les membres de l'agrégat d'une carte", async () => {
    const controller = await published();
    // `o1` n'est pas la racine de son agrégat : c'est bien l'appartenance qui
    // est cherchée, pas l'identité de la racine.
    const owner = controller.memberIdsContaining("/orders/0");
    expect(owner?.cluster.aggregateId).toBe("Customer#c1");
    expect([...owner!.memberIds].sort()).toEqual(["/customers/0", "/orders/0"]);
    // La forme rendue est CELLE du moteur, pas une copie : c'est en la mutant
    // que `recomputeClusterCircle` met le disque peint à jour.
    expect(controller.clusters()).toContain(owner!.cluster);
  });

  it("ne trouve rien pour une carte hors agrégat", async () => {
    const controller = await published();
    // `o2` référence un client qui n'existe pas : il n'atteint aucune racine.
    expect(controller.memberIdsContaining("/orders/1")).toBeUndefined();
    expect(controller.memberIdsContaining("/nope")).toBeUndefined();
  });
});

describe("graph view controller — extendBoundsToClusters", () => {
  it("unit les boîtes englobantes des disques aux bornes reçues", async () => {
    const controller = await published();
    // Des bornes volontairement minuscules et centrées : chaque disque doit les
    // pousser dans les quatre directions.
    const bounds: Rect = { x: 0, y: 0, width: 1, height: 1 };
    controller.extendBoundsToClusters(bounds);

    for (const cluster of controller.clusters()) {
      expect(bounds.x).toBeLessThanOrEqual(cluster.cx - cluster.r);
      expect(bounds.y).toBeLessThanOrEqual(cluster.cy - cluster.r);
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(cluster.cx + cluster.r);
      expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(cluster.cy + cluster.r);
    }
  });

  it("ne touche à rien tant que rien n'est publié", () => {
    const bounds: Rect = { x: 3, y: 4, width: 5, height: 6 };
    controllerFor().extendBoundsToClusters(bounds);
    expect(bounds).toEqual({ x: 3, y: 4, width: 5, height: 6 });
  });
});

describe("graph view controller — clustersFor", () => {
  /** Les arguments au repos : pas de sélection, pas de survol, rien d'estompé.
   * Chaque test ne surcharge que ce dont il parle. */
  function args(overrides: Partial<ClustersForArgs> = {}): ClustersForArgs {
    return {
      graph: shopGraph,
      accentFor: (node) => `accent:${node.id}`,
      fallbackColor: "#fallback",
      selectedAggregateId: null,
      keep: null,
      hoverOf: () => 0,
      ...overrides,
    };
  }

  /** Les enveloppes indexées par agrégat : l'ordre du moteur n'est pas un
   * contrat, et un test qui s'y accrocherait casserait au premier réglage. */
  function byId(paints: ReturnType<GraphViewController["clustersFor"]>, controller: GraphViewController) {
    const ids = controller.clusters().map((c) => c.aggregateId);
    return new Map(paints.map((paint, i) => [ids[i]!, paint]));
  }

  it("rend un tableau vide tant que rien n'est publié", () => {
    expect(controllerFor().clustersFor(args())).toEqual([]);
  });

  it("n'estompe RIEN quand il n'y a pas de sélection", async () => {
    const controller = await published();
    const paints = controller.clustersFor(args({ keep: null }));
    expect(paints).toHaveLength(2);
    expect(paints.every((p) => p.dim === false)).toBe(true);
  });

  it("estompe la seule enveloppe dont aucun membre n'est à garder", async () => {
    const controller = await published();
    // Sélection sur `c2` : son agrégat reste plein, l'autre recule.
    const paints = byId(controller.clustersFor(args({ keep: new Set(["/customers/1"]) })), controller);
    expect(paints.get("Customer#c2")!.dim).toBe(false);
    expect(paints.get("Customer#c1")!.dim).toBe(true);
  });

  it("garde pleine une enveloppe dès qu'UN membre est à garder", async () => {
    const controller = await published();
    // `o1` n'est pas la racine : un membre quelconque suffit.
    const paints = byId(controller.clustersFor(args({ keep: new Set(["/orders/0"]) })), controller);
    expect(paints.get("Customer#c1")!.dim).toBe(false);
    expect(paints.get("Customer#c2")!.dim).toBe(true);
  });

  it("laisse PLEINE une enveloppe dont l'agrégat manque à l'index", async () => {
    const controller = controllerFor();
    const state = await controller.compute(shopGraph, graphConfig, false);
    // Un index amputé sous une mise en page intacte : on ne sait plus rien des
    // membres, donc on n'estompe pas plutôt que d'estomper par défaut.
    controller.publish({
      index: { aggregates: new Map(), byNode: new Map() },
      layout: state.layout,
      // Un index amputé n'a plus d'appartenance, donc plus d'arête agrégée : le
      // champ suit son index, il n'est pas repris de l'état intact.
      semanticEdges: [],
      semanticLabels: state.semanticLabels,
    });

    const paints = controller.clustersFor(args({ keep: new Set<NodeId>() }));
    expect(paints).toHaveLength(2);
    expect(paints.every((p) => p.dim === false)).toBe(true);
  });

  it("peint l'enveloppe sélectionnée à l'intensité de survol PLEINE", async () => {
    const controller = await published();
    const paints = byId(
      controller.clustersFor(args({ selectedAggregateId: "Customer#c1", hoverOf: () => 0.3 })),
      controller,
    );
    // Le `max` : la sélection ne peut pas être ramenée sous 1 par un survol qui
    // retombe, et le survol d'une autre enveloppe passe tel quel.
    expect(paints.get("Customer#c1")!.hover).toBe(1);
    expect(paints.get("Customer#c2")!.hover).toBe(0.3);
  });

  it("relaie le survol de chaque enveloppe sans sélection", async () => {
    const controller = await published();
    const paints = byId(
      controller.clustersFor(args({ hoverOf: (id) => (id === "Customer#c2" ? 0.7 : 0) })),
      controller,
    );
    expect(paints.get("Customer#c1")!.hover).toBe(0);
    expect(paints.get("Customer#c2")!.hover).toBe(0.7);
  });

  it("colore par l'accent de la racine, et retombe sur la couleur de repli sans elle", async () => {
    const controller = await published();
    // Le graphe passé ici est celui de l'appelant : une racine qui n'y est plus
    // (un graphe remplacé sous une mise en page encore debout) n'a pas d'accent.
    const amputated: Graph = buildGraph(shopData, graphConfig);
    amputated.nodes.delete("/customers/0");

    const paints = byId(controller.clustersFor(args({ graph: amputated })), controller);
    expect(paints.get("Customer#c1")!.color).toBe("#fallback");
    expect(paints.get("Customer#c2")!.color).toBe("accent:/customers/1");
  });

  it("recopie le disque plutôt que de le relayer", async () => {
    const controller = await published();
    const paint = controller.clustersFor(args())[0]!;
    const cluster = controller.clusters()[0]!;
    expect(paint.circle).toEqual({ cx: cluster.cx, cy: cluster.cy, r: cluster.r });
    // La donnée de dessin ne doit pas être un alias de la forme du moteur : la
    // muter en peignant corromprait la mise en page.
    expect(paint.circle).not.toBe(cluster);
  });
});

describe("graph view controller — tryCompute", () => {
  /** Un échec RÉALISTE : les métriques sont relues à chaque mise en page, et
   * `getMetrics` est le hook que l'appelant branche sur une mesure de police. */
  const failing: Partial<GraphViewHooks> = {
    getMetrics: (): NodeMetrics => {
      throw new Error("metrics unavailable");
    },
  };

  it("propage l'échec sur `compute`", async () => {
    await expect(controllerFor(failing).compute(shopGraph, graphConfig, false)).rejects.toThrow(
      "metrics unavailable",
    );
  });

  it("rend null et avertit, sans rien publier", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const controller = controllerFor(failing);
      const state = await controller.tryCompute(shopGraph, graphConfig, false, "contexte de test");

      expect(state).toBeNull();
      expect(controller.positions()).toBeUndefined();
      expect(controller.clusters()).toEqual([]);
      // Le contexte du site d'appel est relayé tel quel : c'est tout ce qu'il
      // sert à faire.
      expect(warn.mock.calls[0]?.[0]).toContain("contexte de test");
    } finally {
      warn.mockRestore();
    }
  });

  it("rend l'état calculé quand tout va bien, toujours sans publier", async () => {
    const controller = controllerFor();
    const state = await controller.tryCompute(shopGraph, graphConfig, false, "contexte de test");
    expect(state?.layout.clusters).toHaveLength(2);
    expect(controller.positions()).toBeUndefined();
  });
});
