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
// STATIC import of the graph view entry point, and it is allowed here: the rule
// in `bundle-purity.test.ts` covers `src/` only (the consumer's bundle is what it
// protects), and the controller itself still reaches it only through its dynamic
// `import()`. We read the constant instead of writing 18 into the test: that is
// exactly the invariant we want to assert — the renderer keeps NO copy of that
// number.
import { TWO_LEVEL_LAYOUT_DEFAULTS } from "@defsquare/data-graph-core/graph-layout";
import {
  createGraphViewController,
  type ClustersForArgs,
  type GraphViewController,
  type GraphViewHooks,
} from "../src/graph-view.js";
import { cartConfig, cartData, shopConfig, shopData } from "./fixtures.js";

/**
 * The shared fixtures have no `groups` — with no declared root, `buildAggregates`
 * returns an EMPTY index and the graph view would have no envelope to show. So we
 * add the one missing piece and nothing else: this is the minimal config that
 * produces aggregates.
 *
 * The result, on `shopData`: `Customer#c1` = {c1, o1} (o1 references c1),
 * `Customer#c2` = {c2}. `o2` references a phantom customer, therefore reaches no
 * root and belongs to no aggregate — which incidentally gives us a card with no
 * envelope.
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

/** A controller that has published `shopGraph`'s state: the starting point of
 * everything that tests a derived read. */
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
    // The entities, for their part, depend on no published state.
    expect(controller.entityIds(shopGraph).size).toBe(4);
  });

  it("publie index et mise en page d'un bloc : les deux décrivent le même graphe", async () => {
    const controller = await published();

    const positions = controller.positions();
    expect(positions).toBeDefined();
    const clusters = controller.clusters();
    expect(clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"]);

    // The invariant, spelled out: every envelope of the published layout resolves
    // in the published index, and every member it names has a position in that
    // same layout.
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

    // The computation did succeed…
    expect(state.layout.clusters).toHaveLength(2);
    // …and nothing moved on the controller's side.
    expect(controller.positions()).toBeUndefined();
    expect(controller.clusters()).toEqual([]);
    expect(controller.aggregateOf("Customer#c1")).toBeUndefined();
  });

  it("garde l'état PUBLIÉ, et pas celui du dernier calcul terminé", async () => {
    const controller = controllerFor();
    // Two interleaved computations on two different graphs, exactly the race the
    // compute/publish split exists to make survivable.
    const pending = Promise.all([
      controller.compute(shopGraph, graphConfig, false),
      controller.compute(cartGraph, cartGraphConfig, false),
    ]);
    const [shopState, cartState] = await pending;
    expect(cartState.layout.clusters).toHaveLength(1);

    // A single `publish`, the first one's: the caller judged the second stale.
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
    // Loading the engine is enough: the padding serves to recompute a disc during
    // a move, not to describe the published state.
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
    // `o1` is not its aggregate's root: what is being looked up really is
    // membership, not the root's identity.
    const owner = controller.memberIdsContaining("/orders/0");
    expect(owner?.cluster.aggregateId).toBe("Customer#c1");
    expect([...owner!.memberIds].sort()).toEqual(["/customers/0", "/orders/0"]);
    // The shape returned is THE engine's, not a copy: mutating it is how
    // `recomputeClusterCircle` brings the painted disc up to date.
    expect(controller.clusters()).toContain(owner!.cluster);
  });

  it("ne trouve rien pour une carte hors agrégat", async () => {
    const controller = await published();
    // `o2` references a customer that does not exist: it reaches no root.
    expect(controller.memberIdsContaining("/orders/1")).toBeUndefined();
    expect(controller.memberIdsContaining("/nope")).toBeUndefined();
  });
});

describe("graph view controller — extendBoundsToClusters", () => {
  it("unit les boîtes englobantes des disques aux bornes reçues", async () => {
    const controller = await published();
    // Deliberately tiny, centered bounds: every disc must push them out in all
    // four directions.
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
  /** The arguments at rest: no selection, no hover, nothing dimmed. Each test
   * overrides only what it is about. */
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

  /** The envelopes indexed by aggregate: the engine's ordering is not a contract,
   * and a test latching onto it would break at the first tweak. */
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
    // Selection on `c2`: its aggregate stays full, the other recedes.
    const paints = byId(controller.clustersFor(args({ keep: new Set(["/customers/1"]) })), controller);
    expect(paints.get("Customer#c2")!.dim).toBe(false);
    expect(paints.get("Customer#c1")!.dim).toBe(true);
  });

  it("garde pleine une enveloppe dès qu'UN membre est à garder", async () => {
    const controller = await published();
    // `o1` is not the root: any member at all is enough.
    const paints = byId(controller.clustersFor(args({ keep: new Set(["/orders/0"]) })), controller);
    expect(paints.get("Customer#c1")!.dim).toBe(false);
    expect(paints.get("Customer#c2")!.dim).toBe(true);
  });

  it("laisse PLEINE une enveloppe dont l'agrégat manque à l'index", async () => {
    const controller = controllerFor();
    const state = await controller.compute(shopGraph, graphConfig, false);
    // A truncated index under an intact layout: we no longer know anything about
    // the members, so we do not dim rather than dimming by default.
    controller.publish({
      index: { aggregates: new Map(), byNode: new Map() },
      layout: state.layout,
      // A truncated index has no membership left, hence no aggregated edge: the
      // field follows its index, it is not carried over from the intact state.
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
    // The `max`: the selection cannot be pulled below 1 by a hover falling back,
    // and another envelope's hover passes through unchanged.
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
    // The graph passed here is the caller's: a root no longer in it (a graph
    // replaced under a layout still standing) has no accent.
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
    // The drawing data must not alias the engine's shape: mutating it while
    // painting would corrupt the layout.
    expect(paint.circle).not.toBe(cluster);
  });
});

describe("graph view controller — tryCompute", () => {
  /** A REALISTIC failure: metrics are re-read at every layout, and `getMetrics` is
   * the hook the caller wires onto a font measurement. */
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
      // The call site's context is relayed verbatim: that is all it is for.
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
