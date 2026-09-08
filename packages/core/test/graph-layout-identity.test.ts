import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import {
  createTwoLevelLayoutEngine,
  extractGraphLayoutInput,
  layoutFromInput,
  type GraphLayoutResult,
} from "../src/graph-layout.js"
import {
  shopConfig,
  bigShop,
  deepAggregate,
  deepAggregateConfig,
  denseRefs,
  denseRefsConfig,
} from "./fixtures.js"

/**
 * THE NON-REGRESSION TEST FOR THE extraction / pure-core SPLIT.
 *
 * `createTwoLevelLayoutEngine` was cut in two — `extractGraphLayoutInput`, the
 * only part that reads the `Graph`, and `layoutFromInput`, which is all of the
 * computation and knows nothing but a flat serializable object (see the header
 * of `graph-layout.ts`). That was REORDERED code, not a rewrite: the promise
 * kept here is that the positions come out IDENTICAL DOWN TO THE BIT.
 *
 * That promise is not vanity. All of the engine's documentation — the
 * calibration tables of `TWO_LEVEL_LAYOUT_DEFAULTS`, the fill measurements, the
 * neighbourhood standard deviations — was measured on one precise output, and
 * the determinism tests (`graph-layout.test.ts`) require that the same graph
 * render the same thing twice. One ulp of drift somewhere in the simulation, and
 * that whole ecosystem of numbers silently stops describing the engine.
 *
 * HOW THE PROOF IS MADE, and why this is not a snapshot to refresh: the three
 * digests below were CAPTURED ON THE PRE-SPLIT IMPLEMENTATION, before a single
 * line of the engine moved, and have not been touched since. They therefore do
 * not say "here is what the engine produces today" but "here is what the engine
 * produced before anyone touched it". A digest turning red signals an OUTPUT
 * CHANGE; if that change is intended (a setting deliberately moved), the whole
 * body of measurements in the file must be re-measured, and the line then
 * updates AT THE SAME TIME as those measurements. Updating it alone to make the
 * suite pass is exactly the mistake this test exists to make visible.
 *
 * Three fixtures, because they exercise three disjoint paths through the engine:
 *  - `bigShop(3000)` — 167 flat aggregates, ZERO inter-aggregate reference: SHELF
 *    packing and level 2 reduced to gravity + collision;
 *  - `deepAggregate()` — one deep aggregate of 41 cards: RADIAL packing, hence
 *    the intra-cluster reverse adjacency, which is precisely what the extraction
 *    must carry over without distorting it;
 *  - `denseRefs()` — 80 discs, inter-cluster degree 12: level 2's SPRINGS, hence
 *    the order and multiplicity of `refs`, which the extraction flattens out of
 *    `graph.refEdges` and on which each spring's weight depends.
 */

const shopGroupsConfig: DataGraphConfig = { ...shopConfig, groups: ["Customer"] }

function setupOn(data: unknown, cfg: DataGraphConfig) {
  const graph = buildGraph(data, cfg)
  const aggregates = buildAggregates(graph, validateConfig(cfg))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

/**
 * The digest of one layout, at FULL PRECISION.
 *
 * `toExponential(17)` rather than `String(x)`: two distinct doubles can share
 * their short decimal spelling, and that is precisely the drift we want to
 * forbid here. Positions are sorted by id — the `Map`'s insertion order is not
 * what we guard — and the envelopes are taken in the engine's order, which IS a
 * result.
 */
function digestOf(result: GraphLayoutResult): string {
  const hash = createHash("sha256")
  const num = (x: number): string => x.toExponential(17)
  for (const id of [...result.positions.keys()].sort()) {
    const rect = result.positions.get(id)!
    hash.update(`${id}|${num(rect.x)}|${num(rect.y)}|${num(rect.width)}|${num(rect.height)}\n`)
  }
  for (const cluster of result.clusters) {
    hash.update(
      `${cluster.aggregateId}|${cluster.rootId}|${num(cluster.cx)}|${num(cluster.cy)}|${num(cluster.r)}\n`,
    )
  }
  return hash.digest("hex")
}

const CASES: { name: string; data: unknown; config: DataGraphConfig; digest: string }[] = [
  {
    name: "bigShop(3000) — étagères, aucun ressort",
    data: bigShop(3000),
    config: shopGroupsConfig,
    digest: "9b47dfc74e2e8e61d6ed7268c0e21df4579a543ca8704e2ec1d7a35b08dc5113",
  },
  {
    name: "deepAggregate() — packing radial",
    data: deepAggregate(),
    config: deepAggregateConfig,
    digest: "a893d3ba3c05f653ddb2fcd56ba4d9f3c5afeac756ce36712dd511d69af72894",
  },
  {
    name: "denseRefs() — ressorts inter-agrégats",
    data: denseRefs(),
    config: denseRefsConfig,
    digest: "d583f911ddf5f29f5f8a918f9d3e3fe66e7b2f73a471c1406c1b20d91aa738b1",
  },
]

describe("scission extraction / cœur pur — identité bit-près", () => {
  for (const { name, data, config, digest } of CASES) {
    it(`${name} : le moteur rend exactement la sortie d'avant la scission`, async () => {
      const { graph, aggregates, visible } = setupOn(data, config)
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      expect(digestOf(result)).toBe(digest)
    })

    it(`${name} : extraction puis cœur pur rendent la MÊME chose que le moteur`, async () => {
      const { graph, aggregates, visible } = setupOn(data, config)
      const viaEngine = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      const viaInput = layoutFromInput(extractGraphLayoutInput(graph, aggregates, visible))

      // The comparison is on the numbers themselves, not on the digest: that is
      // what makes the diff readable when it breaks.
      expect([...viaInput.positions.entries()].sort()).toEqual(
        [...viaEngine.positions.entries()].sort(),
      )
      expect(viaInput.clusters).toEqual(viaEngine.clusters)
    })
  }
})

describe("extractGraphLayoutInput — ce qui traverse, et rien d'autre", () => {
  const { graph, aggregates, visible } = setupOn(bigShop(600), shopGroupsConfig)

  it("ne retient des entités que leur id et la taille de leur carte", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)

    // One entity per VISIBLE node of entity kind, and nothing else: no root, no
    // array, no object.
    const entityCount = [...graph.nodes.values()].filter((n) => n.kind === "entity").length
    expect(input.entities).toHaveLength(entityCount)
    // Sorted: this is a CONDITION of the engine's determinism, not a reading
    // convenience — `visible`'s order is that of a `Set` built by the caller.
    expect(input.entities.map((e) => e.id)).toEqual([...input.entities.map((e) => e.id)].sort())
    for (const entity of input.entities) {
      expect(Object.keys(entity).sort()).toEqual(["h", "id", "w"])
      expect(entity.w).toBeGreaterThan(0)
      expect(entity.h).toBeGreaterThan(0)
    }
  })

  it("ne retient des références que les paires (source, cible) qui relient deux entités placées", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    const placed = new Set(input.entities.map((e) => e.id))

    // One pair PER reference, duplicates included: multiplicity is what makes
    // the weight of level 2's springs.
    const kept = graph.refEdges.filter(
      (e) => e.to !== null && !e.dangling && placed.has(e.fromEntity) && placed.has(e.to),
    )
    expect(input.refs).toHaveLength(kept.length)
    expect(input.refs).toEqual(kept.map((e) => ({ from: e.fromEntity, to: e.to })))
    // Anti-hollow-test: the fixture must really carry references.
    expect(input.refs.length).toBeGreaterThan(0)
  })

  it("ne retient des agrégats que leur id, leur racine et leurs membres visibles", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    for (const agg of input.aggregates) {
      expect(Object.keys(agg).sort()).toEqual(["id", "memberIds", "rootId"])
      expect(agg.rootId).toBe(aggregates.aggregates.get(agg.id)!.rootId)
      for (const memberId of agg.memberIds) {
        expect(aggregates.byNode.get(memberId)?.[0]).toBe(agg.id)
      }
    }
    expect(input.aggregates.length).toBeGreaterThan(0)
  })

  it("ne laisse fuir AUCUNE référence au graphe : l'entrée survit à un structured clone", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    // The real property sought, and the only one that matters for the worker:
    // the object survives structured cloning. A leaked `Graph`, `GraphNode` or
    // node `Map` would show up there — the functions nodes do not yet carry
    // would not, but the WEIGHT would show immediately.
    const clone = structuredClone(input)
    expect(clone).toEqual(input)
    // And the clone is enough to lay out: the end-to-end proof that nothing of
    // the graph is needed beyond the extraction.
    expect(layoutFromInput(clone).positions.size).toBe(input.entities.length)
  })

  it("porte les options RÉSOLUES, défauts compris", () => {
    const withDefaults = extractGraphLayoutInput(graph, aggregates, visible)
    expect(withDefaults.options.hullPadding).toBe(18)
    expect(withDefaults.options.clusterGap).toBe(160)

    const tuned = extractGraphLayoutInput(graph, aggregates, visible, undefined, { clusterGap: 42 })
    expect(tuned.options.clusterGap).toBe(42)
    // The others stay at their defaults: the pure core never re-reads them.
    expect(tuned.options.hullPadding).toBe(18)
  })
})
