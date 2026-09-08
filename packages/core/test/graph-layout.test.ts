import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates, type AggregateIndex } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { enclosingCircle } from "../src/hull.js"
import type { Rect } from "../src/structure-layout.js"
import type { GraphLayoutResult } from "../src/graph-layout.js"
import type { NodeId } from "../src/model.js"
import { createTwoLevelLayoutEngine } from "../src/graph-layout.js"
import {
  shopData,
  shopConfig,
  bigShop,
  twoRootsData,
  twoRootsConfig,
  deepAggregate,
  deepAggregateConfig,
  denseRefs,
  denseRefsConfig,
} from "./fixtures.js"
import type { Graph } from "../src/model.js"

/** The config in `fixtures.ts` declares no groups; the probe's bench adds
 * `groups: ["Customer"]` to it, and that is the config that produced the doc's
 * measurements. We take it as is. */
const config = { ...shopConfig, groups: ["Customer"] }

/** The three defaults of `createTwoLevelLayoutEngine`, restated here: a test
 * that read the engine's constants would no longer check anything. */
const PADDING = 18
const CARD_GAP = 16
const CLUSTER_GAP = 160

function setupOn(data: unknown, cfg: DataGraphConfig = config) {
  const graph = buildGraph(data, cfg)
  const aggregates = buildAggregates(graph, validateConfig(cfg))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

const setup = () => setupOn(shopData)

type Disk = { id: string; cx: number; cy: number; r: number }

/**
 * ALL of level 2's discs, not only the painted envelopes: the aggregates, plus
 * one singleton disc per entity outside any aggregate.
 *
 * This is the only way to test the real guarantee. The engine pushes apart discs
 * of which only some come back out in `clusters` — a singleton is a disc in its
 * own right during the simulation (otherwise it would land inside a neighbour's
 * envelope) but has nothing to paint. Asserting only on `result.clusters` would
 * therefore leave half the invariant out of the test.
 */
function disksOf(result: GraphLayoutResult, aggregates: AggregateIndex, padding = PADDING): Disk[] {
  const disks: Disk[] = result.clusters.map((c) => ({
    id: c.aggregateId,
    cx: c.cx,
    cy: c.cy,
    r: c.r,
  }))
  for (const [id, rect] of result.positions) {
    const owner = aggregates.byNode.get(id)
    if (owner && owner.length > 0) continue
    const circle = enclosingCircle([rect], padding)
    disks.push({ id, cx: circle.cx, cy: circle.cy, r: circle.r })
  }
  return disks
}

/** Edge-to-edge gap between two discs: negative if they overlap. Takes any
 * circular shape, `ClusterShape` included. */
function diskGap(a: { cx: number; cy: number; r: number }, b: { cx: number; cy: number; r: number }): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r
}

function cornersOf(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ]
}

/** Penetrations of a pair of rects on each axis. Negative when the rects are
 * disjoint along that axis: `-px` is then the horizontal gap. */
function penetrations(a: Rect, b: Rect) {
  return {
    px: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    py: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * The layout at scale, computed ONCE for the six assertions that exercise it.
 * 334 cards, 167 aggregates — the fixture behind `clusterGap`'s calibration and
 * behind the probe's table A. The engine costs ~143 ms on it, measured, so this
 * sharing is a convenience rather than a budget necessity; above all it keeps
 * six tests from measuring the same thing six times.
 */
let atScaleCache: Promise<{ result: GraphLayoutResult; aggregates: AggregateIndex }> | null = null
function atScale() {
  if (!atScaleCache) {
    atScaleCache = (async () => {
      const { graph, aggregates, visible } = setupOn(bigShop(3000))
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      return { result, aggregates }
    })()
  }
  return atScaleCache
}

describe("createTwoLevelLayoutEngine", () => {
  it("positions entities only — no root, no array, no object node", async () => {
    const { graph, aggregates, visible } = setup()
    // Root and array node added to `visible` so that the `kind !== "entity"`
    // filter is really exercised: without them, `visible` holds nothing but
    // entities and the filter never rejects anything.
    const visibleWithStructural = new Set([...visible, graph.rootId, "/customers"])
    const result = await createTwoLevelLayoutEngine().layout(
      graph,
      aggregates,
      visibleWithStructural,
    )
    for (const id of result.positions.keys()) {
      expect(graph.nodes.get(id)?.kind).toBe("entity")
    }
    expect(result.positions.has("/")).toBe(false)
    expect(result.positions.has("/customers")).toBe(false)
  })

  it("places every visible entity", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(visible.size)
  })

  it("normalizes the bbox to the origin", async () => {
    const { result } = await atScale()
    let minX = Infinity
    let minY = Infinity
    for (const rect of result.positions.values()) {
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
    }
    expect(minX).toBe(0)
    expect(minY).toBe(0)
  })
})

describe("determinism", () => {
  // Down to the BIT, not to the pixel: the engine has no source of randomness
  // (FNV-1a seeding on the ids, iterations in sorted order), so two runs walk
  // exactly the same sequence of floating-point operations. An approximate
  // equality would hide the introduction of a `Math.random` or of an iteration
  // depending on a Map's insertion order.
  it("returns bit-identical positions on the same input", async () => {
    const { graph, aggregates, visible } = setup()
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("stays deterministic when the simulation really works", async () => {
    // shopData counts only three discs: the simulation has almost nothing to do
    // there and determinism comes too easily. Here, several dozen discs go
    // through 400 iterations of springs, gravity and collisions before the hard
    // pass.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const first = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const second = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
    expect(first.clusters).toEqual(second.clusters)
  })

  it("does not depend on the iteration order of `visible`", async () => {
    // `visible` is a Set: its iteration order follows insertion. Sorting the ids
    // in the engine is what makes that detail inconsequential — removing the
    // sort would let the two tests above pass (they rebuild the Set identically)
    // but would break this one.
    const { graph, aggregates, visible } = setup()
    const reversed = new Set([...visible].reverse())
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, reversed)
    expect([...a.positions.entries()].sort()).toEqual([...b.positions.entries()].sort())
  })
})

describe("separation guarantees, at scale", () => {
  it(
    "leaves no pair of cards overlapping",
    async () => {
      const { result } = await atScale()
      const rects = [...result.positions.values()]
      expect(rects.length).toBeGreaterThan(300)

      // A count rather than one `expect` per pair: 334 cards make 55,611 pairs,
      // and a failure must say HOW MANY pairs are at fault, not just the first
      // one.
      let overlapping = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          if (px > 1e-6 && py > 1e-6) overlapping++
        }
      }
      expect(overlapping).toBe(0)
    },
    30_000,
  )

  it(
    "leaves at least cardGap between two cards of the same aggregate",
    async () => {
      // The tolerance is 1e-9 and not 0: the margin is exact in the packing's
      // LOCAL frame, then each card takes on its disc's translation and the
      // bbox's normalization. `(x₁ + d) − (x₂ + d)` does not give back exactly
      // `x₁ − x₂` — the probe measured pairs at 16 px − 10⁻¹² on the demo's
      // dataset, three orders of magnitude below this tolerance. It is the same
      // contract as `expectRigid` in `separateClusters`, removed along with the
      // pass, for the same reason.
      //
      // The assertion covers ALL pairs, not only the intra-aggregate ones: two
      // cards of different aggregates are separated by `clusterGap` edge to edge
      // of disc (160 px), hence a fortiori by `cardGap`. A packing regression as
      // much as a disc-separation regression falls out here.
      const { result, aggregates } = await atScale()
      const entries = [...result.positions.entries()]

      let tooClose = 0
      let intraTooClose = 0
      let worst = Infinity
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [idA, a] = entries[i]!
          const [idB, b] = entries[j]!
          const { px, py } = penetrations(a, b)
          if (px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9) {
            tooClose++
            const sameAggregate =
              aggregates.byNode.get(idA)?.[0] !== undefined &&
              aggregates.byNode.get(idA)?.[0] === aggregates.byNode.get(idB)?.[0]
            if (sameAggregate) intraTooClose++
          }
          worst = Math.min(worst, Math.max(-px, -py))
        }
      }
      expect(intraTooClose).toBe(0)
      expect(tooClose).toBe(0)

      // The minimum is reached, and at `cardGap` EXACTLY: the packing lays down
      // the margin, it does not exceed it "to be safe".
      //
      // This assertion made a round trip worth recording. Radial placement had
      // broken it — its guarantee is written on the enclosing discs, a
      // sufficient and not necessary condition, which adds a constant overhead
      // of 28.62 px — and it had been replaced by a bound plus the measured
      // figure (44.62 px). The switch on depth restores it to its original form:
      // every `bigShop` aggregate is FLAT (depth 1), hence packed in shelves,
      // where the margin is laid on one axis between two aligned rectangles and
      // equals `cardGap` exactly.
      //
      // The "bound + overhead" version is not lost: it moved to the path that
      // exercises it, in "includes the requested cardGap", which now runs on a
      // deep aggregate.
      expect(worst).toBeCloseTo(CARD_GAP, 6)
    },
    30_000,
  )

  it(
    "leaves no pair of discs overlapping, and opens clusterGap between each pair",
    async () => {
      // 167 aggregates of 2 cards, no inter-aggregate reference: this is the
      // fixture where the simulation has ONLY gravity and collisions to work
      // with, hence the one that exercises the final hard pass the most.
      const { result, aggregates } = await atScale()
      expect(result.clusters.length).toBeGreaterThan(150)

      const disks = disksOf(result, aggregates)
      let overlapping = 0
      let tooClose = 0
      let worst = Infinity
      for (let i = 0; i < disks.length; i++) {
        for (let j = i + 1; j < disks.length; j++) {
          const gap = diskGap(disks[i]!, disks[j]!)
          if (gap < -1e-6) overlapping++
          if (gap < CLUSTER_GAP - 1e-6) tooClose++
          worst = Math.min(worst, gap)
        }
      }
      expect(overlapping).toBe(0)
      // The gap is not merely "non-negative": it is `clusterGap` itself that is
      // an exit invariant, guaranteed by the final hard pass and not by the
      // simulation's convergence.
      //
      // 1e-6 is the collision guard's threshold, hence the engine's exact
      // contract — and this assertion is what forced the tightening of that
      // pass's exit criterion: with the probe's (`< 1e-3`), 176 of the 13,861
      // pairs fell out here, maximum residual 9.301e-4. That was not
      // floating-point noise but the threshold itself. See the pass's
      // documentation in `graph-layout.ts`. Maximum residual measured after
      // tightening, on this fixture: 9.987e-7.
      expect(tooClose).toBe(0)
      expect(worst).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
    },
    30_000,
  )

  it(
    "encloses the root and every member in its aggregate's envelope",
    async () => {
      const { result, aggregates } = await atScale()
      let checked = 0
      for (const cluster of result.clusters) {
        const aggregate = aggregates.aggregates.get(cluster.aggregateId)!
        // The root is a member in its own right (see `Aggregate.memberIds`), but
        // it is the one the packing lays down FIRST: should the packing order
        // and the circle-computation order ever diverge, it is the one that
        // would escape first.
        expect(aggregate.memberIds.has(cluster.rootId)).toBe(true)
        const rootRect = result.positions.get(cluster.rootId)!
        for (const corner of cornersOf(rootRect)) {
          expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeLessThanOrEqual(
            cluster.r + 1e-6,
          )
        }
        for (const memberId of aggregate.memberIds) {
          const rect = result.positions.get(memberId)
          if (!rect) continue
          for (const corner of cornersOf(rect)) {
            expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeLessThanOrEqual(
              cluster.r + 1e-6,
            )
          }
          checked++
        }
      }
      expect(checked).toBeGreaterThan(300)
    },
    30_000,
  )

  it(
    "emits an envelope for real aggregates only, and it is the circle actually separated",
    async () => {
      const { result, aggregates } = await atScale()
      // A `single:` leaking into `clusters` would have an envelope painted
      // around an isolated card — the counterpart of the `__agg:` that the
      // removed engine's test forbade in `positions`.
      for (const cluster of result.clusters) {
        expect(cluster.aggregateId.startsWith("single:")).toBe(false)
        expect(aggregates.aggregates.has(cluster.aggregateId)).toBe(true)
      }
      expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(
        [...aggregates.aggregates.keys()].sort(),
      )

      // The emitted disc is not recomputed after the fact from the positions: it
      // is the one the simulation pushed apart, translated along with its cards.
      // It must therefore coincide with the minimal enclosing circle of those
      // cards — were the two to diverge, the renderer would paint a shape other
      // than the one that was separated.
      for (const cluster of result.clusters) {
        const rects: Rect[] = []
        for (const memberId of aggregates.aggregates.get(cluster.aggregateId)!.memberIds) {
          const rect = result.positions.get(memberId)
          if (rect) rects.push(rect)
        }
        const recomputed = enclosingCircle(rects, PADDING)
        expect(recomputed.cx).toBeCloseTo(cluster.cx, 6)
        expect(recomputed.cy).toBeCloseTo(cluster.cy, 6)
        expect(recomputed.r).toBeCloseTo(cluster.r, 6)
      }
    },
    30_000,
  )
})

describe("options", () => {
  it("leaves exactly hullPadding between the farthest corner and the envelope's edge", async () => {
    // "At least" would not do: the circle is MINIMAL, so the farthest corner
    // sits on the unpadded circle, exactly `hullPadding` from the edge.
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine({ hullPadding: 40 }).layout(
      graph,
      aggregates,
      visible,
    )
    for (const cluster of result.clusters) {
      let farthest = 0
      for (const memberId of aggregates.aggregates.get(cluster.aggregateId)!.memberIds) {
        const rect = result.positions.get(memberId)
        if (!rect) continue
        for (const corner of cornersOf(rect)) {
          farthest = Math.max(farthest, Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy))
        }
      }
      expect(cluster.r - farthest).toBeCloseTo(40, 6)
    }
  })

  it("opens the requested clusterGap, not the default one", async () => {
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const result = await createTwoLevelLayoutEngine({ clusterGap: 400 }).layout(
      graph,
      aggregates,
      visible,
    )
    const disks = disksOf(result, aggregates)
    let worst = Infinity
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) worst = Math.min(worst, diskGap(disks[i]!, disks[j]!))
    }
    expect(worst).toBeGreaterThanOrEqual(400 - 1e-6)
  })

  it("includes the requested cardGap in the shelf packing, EXACTLY", async () => {
    // SHELF path: `bigShop` has nothing but flat aggregates. Customer#c0 holds
    // two cards there, the root and its order, laid one under the other and
    // separated by exactly `cardGap`.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const result = await createTwoLevelLayoutEngine({ cardGap: 64 }).layout(
      graph,
      aggregates,
      visible,
    )
    const members = [...aggregates.aggregates.get("Customer#c0")!.memberIds]
    expect(members).toHaveLength(2)
    const { px, py } = penetrations(
      result.positions.get(members[0]!)!,
      result.positions.get(members[1]!)!,
    )
    expect(Math.max(-px, -py)).toBeCloseTo(64, 6)
  })

  it("includes the requested cardGap in the radial placement, ADDITIVELY", async () => {
    // RADIAL path, the one that CANNOT reach exact equality: its guarantee is
    // written on the cards' enclosing discs, a sufficient and not necessary
    // condition, which adds a geometric overhead.
    //
    // The property that matters stays testable, and in a stronger form than
    // equality: `cardGap` enters the placement ADDITIVELY. Raising the requested
    // margin by 48 px moves the obtained gap by exactly 48 px — the overhead
    // does not scale with it. An engine that used only half of `cardGap`, or
    // multiplied it by a factor, would fail here while passing a plain lower
    // bound.
    //
    // The fixture must be DEEP to take this path — that is the whole point of
    // the switch. `deepAggregate(1, 1, 0)` gives the smallest possible deep
    // shape: root ← order ← line, one card per ring, hence a geometry where the
    // minimal gap is that of two consecutive rings, exactly `ρ₁ + ρ₂ + cardGap`
    // by construction.
    const { graph, aggregates, visible } = setupOn(deepAggregate(1, 1, 0), deepAggregateConfig)
    const members = [...aggregates.aggregates.get("Customer#c0")!.memberIds]
    expect(members).toHaveLength(3)

    const minSeparationWith = async (cardGap: number) => {
      const result = await createTwoLevelLayoutEngine({ cardGap }).layout(graph, aggregates, visible)
      const rects = members.map((id) => result.positions.get(id)!)
      let worst = Infinity
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          worst = Math.min(worst, Math.max(-px, -py))
        }
      }
      return worst
    }

    const small = await minSeparationWith(16)
    const large = await minSeparationWith(64)

    // Each gap exceeds the requested margin — the guarantee — and the excess is
    // the SAME on both sides: that is the overhead of the per-disc criterion.
    expect(small).toBeGreaterThanOrEqual(16 - 1e-9)
    expect(large).toBeGreaterThanOrEqual(64 - 1e-9)
    expect(large - small).toBeCloseTo(64 - 16, 6)
    expect(small - 16).toBeCloseTo(large - 64, 6)
    // And the overhead is real, otherwise this test would say nothing more than
    // the previous one: it is 45.5 px on these cards.
    expect(small - 16).toBeGreaterThan(1)
  })
})

describe("intra-aggregate radial placement", () => {
  /**
   * Reference distance to the root, RECOMPUTED HERE from the graph.
   *
   * The engine runs the same BFS to build its rings; redoing it in the test is
   * what makes the assertions below independent. Comparing the engine's rings to
   * its own rings would check nothing.
   *
   * Traversal direction: from target to source, as in `buildAggregates`.
   */
  function refDistances(graph: Graph, rootId: NodeId, members: Set<NodeId>): Map<NodeId, number> {
    const incoming = new Map<NodeId, NodeId[]>()
    for (const edge of graph.refEdges) {
      if (edge.to === null || edge.dangling) continue
      if (!members.has(edge.from) || !members.has(edge.to)) continue
      const list = incoming.get(edge.to)
      if (list) list.push(edge.from)
      else incoming.set(edge.to, [edge.from])
    }
    const dist = new Map<NodeId, number>([[rootId, 0]])
    const queue = [rootId]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!
      for (const source of incoming.get(current) ?? []) {
        if (dist.has(source)) continue
        dist.set(source, dist.get(current)! + 1)
        queue.push(source)
      }
    }
    return dist
  }

  async function deepSetup(orders?: number, lines?: number, serials?: number) {
    const data = deepAggregate(orders, lines, serials)
    const { graph, aggregates, visible } = setupOn(data, deepAggregateConfig)
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const aggregate = aggregates.aggregates.get("Customer#c0")!
    const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
    const dist = refDistances(graph, aggregate.rootId, aggregate.memberIds)
    const radiusOf = (id: NodeId) => {
      const r = result.positions.get(id)!
      return Math.hypot(r.x + r.width / 2 - shape.cx, r.y + r.height / 2 - shape.cy)
    }
    return { graph, aggregates, visible, result, aggregate, shape, dist, radiusOf }
  }

  it("the fixture really does produce a large deep aggregate", async () => {
    // Anti-hollow-test guard: were `deepAggregate` to stop producing depth,
    // every radial assertion below would pass without exercising anything — a
    // flat aggregate satisfies them trivially.
    const { aggregate, dist } = await deepSetup()
    expect(aggregate.memberIds.size).toBe(41)
    expect(Math.max(...dist.values())).toBe(3)
    const perRing = [0, 1, 2, 3].map((d) => [...dist.values()].filter((x) => x === d).length)
    expect(perRing).toEqual([1, 4, 12, 24])
  })

  it("the root is the card closest to its envelope's centre", async () => {
    // This is the flaw radial placement fixes, and it was spectacular: under
    // shelf packing the root came out **40th of 41**, 597.7 px from the centre
    // of its own disc, because sorting by id put it at the head of the first
    // row, that is, in a corner of the block.
    const { aggregate, radiusOf } = await deepSetup()
    const ranked = [...aggregate.memberIds]
      .map((id) => ({ id, r: radiusOf(id) }))
      .sort((a, b) => a.r - b.r)
    expect(ranked[0]!.id).toBe(aggregate.rootId)
    // And not merely tied for first: markedly closer than the next one.
    // Measured: 16.4 px against 291.6 px.
    expect(ranked[0]!.r).toBeLessThan(ranked[1]!.r / 2)
  })

  it("the distance to the centre grows with the reference distance", async () => {
    // The property that defines radial placement. Asserted on the per-ring MEAN
    // and not card by card: the enclosing circle's centre is not exactly the
    // root's centre (it is computed on the corners of every card), so two cards
    // of the same ring do not have exactly the same radius, and a card of one
    // ring can overtake a card of the next by a few pixels without the ring
    // structure being at fault.
    const { aggregate, dist, radiusOf } = await deepSetup()
    const sums = new Map<number, { total: number; n: number }>()
    for (const id of aggregate.memberIds) {
      const d = dist.get(id)!
      const acc = sums.get(d) ?? { total: 0, n: 0 }
      acc.total += radiusOf(id)
      acc.n++
      sums.set(d, acc)
    }
    const means = [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.total / v.n)
    expect(means).toHaveLength(4)
    for (let i = 1; i < means.length; i++) {
      expect(means[i]!).toBeGreaterThan(means[i - 1]!)
    }
    // Strictly increasing would not do: a one-pixel gap would pass. Each ring
    // must move out by at least half a card.
    for (let i = 1; i < means.length; i++) {
      expect(means[i]! - means[i - 1]!).toBeGreaterThan(70)
    }
  })

  it("holds its guarantees on the large aggregate, at 66 cards included", async () => {
    // The repo-scale guarantees are checked on `bigShop`, EVERY aggregate of
    // which holds 2 cards: radial placement never lays more than a single ring
    // of a single card there. None of that exercises the circumference
    // computation, the splitting of an overfull ring, or the stacking of several
    // rings. That is what this test covers.
    for (const [o, l, s] of [
      [4, 3, 2], // 41 cards, 3 rings
      [5, 3, 3], // 66 cards, including a ring of 45 — the one that must split
    ] as [number, number, number][]) {
      const { result, aggregate, shape } = await deepSetup(o, l, s)
      const rects = [...result.positions.values()]

      let overlapping = 0
      let tooClose = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          if (px > 1e-6 && py > 1e-6) overlapping++
          if (px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9) tooClose++
        }
      }
      expect(overlapping).toBe(0)
      expect(tooClose).toBe(0)

      // Every card fits inside the painted envelope.
      for (const id of aggregate.memberIds) {
        for (const corner of cornersOf(result.positions.get(id)!)) {
          expect(Math.hypot(corner.x - shape.cx, corner.y - shape.cy)).toBeLessThanOrEqual(
            shape.r + 1e-6,
          )
        }
      }
    }
  }, 30_000)

  it("stays bit-deterministic on a deep aggregate", async () => {
    // Radial placement adds a BFS, a sort by parent angle and trigonometry whose
    // order of operations must be reproducible. The determinism asserted
    // elsewhere on `bigShop` exercises none of that: a one-card ring has neither
    // sort nor wrap-around.
    const data = deepAggregate()
    const first = setupOn(data, deepAggregateConfig)
    const second = setupOn(data, deepAggregateConfig)
    const a = await createTwoLevelLayoutEngine().layout(first.graph, first.aggregates, first.visible)
    const b = await createTwoLevelLayoutEngine().layout(
      second.graph,
      second.aggregates,
      second.visible,
    )
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("picks the mode by DEPTH, not by card count", async () => {
    // The criterion: radial if and only if some member sits at reference
    // distance ≥ 2 from the root. The two cases below have the SAME number of
    // cards (5) and different depths — which is why a test on cardinality could
    // not tell them apart, and why this one can.
    //
    // Each mode's observable signature: in radial the root is at the centre of
    // its disc; in shelves it is at the head of the first row, hence in a
    // corner, far from the centre. We measure the root's rank by proximity to
    // the centre rather than inspecting internals.
    const rootRankIn = async (data: unknown) => {
      const { graph, aggregates, visible } = setupOn(data, deepAggregateConfig)
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      const aggregate = aggregates.aggregates.get("Customer#c0")!
      const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
      const ranked = [...aggregate.memberIds]
        .map((id) => {
          const r = result.positions.get(id)!
          return { id, d: Math.hypot(r.x + r.width / 2 - shape.cx, r.y + r.height / 2 - shape.cy) }
        })
        .sort((a, b) => a.d - b.d)
      return { rank: ranked.findIndex((x) => x.id === aggregate.rootId) + 1, r: shape.r, n: ranked.length }
    }

    // FLAT: 4 orders under the root, depth 1. Nothing to encode as distance to
    // the centre, hence shelves — and the root ends up in a corner.
    const flat = await rootRankIn(deepAggregate(4, 0, 0))
    expect(flat.n).toBe(5)
    expect(flat.rank).toBeGreaterThan(1)

    // DEEP: 2 orders, 1 line each, depth 2. Same cardinality, different mode —
    // the root moves to the centre.
    const deep = await rootRankIn(deepAggregate(2, 1, 0))
    expect(deep.n).toBe(5)
    expect(deep.rank).toBe(1)

    // And radial's price is visible on this pair: at equal cardinality, the deep
    // disc is markedly bigger. Measured: 258 px against 602.
    expect(deep.r).toBeGreaterThan(flat.r * 1.5)
  })

  it("an orphan does not tip a flat aggregate into radial mode", async () => {
    // A member the local BFS never reaches — here because the intermediate link
    // is HIDDEN — is given, in radial mode, a synthetic ring beyond the last
    // one. That ring translates no reference depth, only an absence of
    // information, so it must NOT trigger radial mode. Without excluding
    // orphans from the criterion, this aggregate would switch over and pay
    // radial's price for nothing.
    //
    // Setup: `deepAggregate(2, 1, 0)` is deep (root ← order ← line). Removing
    // the two ORDERS from `visible` orphans the two lines, and what is left —
    // root + 2 lines — is flat.
    const data = deepAggregate(2, 1, 0)
    const { graph, aggregates } = setupOn(data, deepAggregateConfig)
    const visible = new Set(
      [...graph.nodes.values()]
        .filter((n) => n.kind === "entity" && !n.id.startsWith("/orders/"))
        .map((n) => n.id),
    )
    expect(visible.size).toBe(3)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(3)

    const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
    const rootRect = result.positions.get("/customers/0")!
    const rootDistance = Math.hypot(
      rootRect.x + rootRect.width / 2 - shape.cx,
      rootRect.y + rootRect.height / 2 - shape.cy,
    )

    // The shelves' signature: the root is not at the centre. Were the criterion
    // to count orphans, it would be, and this disc would be far bigger.
    expect(rootDistance).toBeGreaterThan(20)

    // The guarantees hold all the same on this degenerate path.
    const rects = [...result.positions.values()]
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const { px, py } = penetrations(rects[i]!, rects[j]!)
        expect(px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9).toBe(false)
      }
    }
  })

  it("shortens intra-aggregate references", async () => {
    // The whole point of the change. Figures measured under shelf packing, on
    // this same fixture: mean 591.4 px, max 976.3 px. Under radial: 363.0 and
    // 488.1. The bounds below sit halfway, loose enough not to break over a
    // pixel and tight enough that a return to shelves would knock them down.
    const { graph, aggregate, result } = await deepSetup()
    const centreOf = (id: NodeId) => {
      const r = result.positions.get(id)!
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    let total = 0
    let max = 0
    let n = 0
    for (const edge of graph.refEdges) {
      if (edge.to === null || edge.dangling) continue
      if (!aggregate.memberIds.has(edge.from) || !aggregate.memberIds.has(edge.to)) continue
      const p = centreOf(edge.from)
      const q = centreOf(edge.to)
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      total += d
      n++
      if (d > max) max = d
    }
    expect(n).toBe(40)
    expect(total / n).toBeLessThan(470)
    expect(max).toBeLessThan(730)
  })
})

describe("dense inter-cluster graph", () => {
  /**
   * The engine probe's caveat #5: "the final hard pass can undo a spring; a very
   * dense inter-aggregate graph could degrade — not probed". It is probed here.
   *
   * What these assertions are worth: they say NOTHING about the calibration of
   * the simulation's constants, and that is deliberate. The engine's guarantees
   * are carried by the packing and by the final hard pass, never by the
   * simulation — so they must hold at any setting, and especially where the
   * springs pull hardest against the constraint. A constant sweep that broke
   * these tests would signal a design flaw, not a bad setting.
   *
   * Average degree 12.0 and max 12 over 80 clusters, against 4.6 on the demo's
   * dataset — see `denseRefs` for the exact shape.
   */
  let dense: { result: GraphLayoutResult; aggregates: AggregateIndex } | null = null
  async function atDensity() {
    if (!dense) {
      const { graph, aggregates, visible } = setupOn(denseRefs(), denseRefsConfig)
      dense = { result: await createTwoLevelLayoutEngine().layout(graph, aggregates, visible), aggregates }
    }
    return dense
  }

  it("the fixture really is dense", async () => {
    // Anti-hollow-test guard: without it, a regression in the generator would
    // make the assertions below true on any graph whatsoever.
    const { result, aggregates } = await atDensity()
    expect(result.positions.size).toBe(200)
    expect(result.clusters.length).toBe(80)
    const pairs = new Set<string>()
    for (const [id] of result.positions) {
      const own = aggregates.byNode.get(id)?.[0]
      expect(own).toBeDefined()
    }
    // 480 linked cluster pairs, counted from the index: the figure the fixture's
    // doc announces.
    for (const aggregate of aggregates.aggregates.values()) pairs.add(aggregate.id)
    expect(pairs.size).toBe(80)
  })

  it(
    "holds all its guarantees under high reference density",
    async () => {
      const { result, aggregates } = await atDensity()

      const rects = [...result.positions.values()]
      let overlapping = 0
      let tooClose = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          if (px > 1e-6 && py > 1e-6) overlapping++
          if (px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9) tooClose++
        }
      }
      expect(overlapping).toBe(0)
      expect(tooClose).toBe(0)

      const disks = disksOf(result, aggregates)
      let worst = Infinity
      for (let i = 0; i < disks.length; i++) {
        for (let j = i + 1; j < disks.length; j++) {
          worst = Math.min(worst, diskGap(disks[i]!, disks[j]!))
        }
      }
      // The point of the caveat: even when 480 springs pull against it, the
      // final hard pass keeps the last word.
      expect(worst).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
    },
    60_000,
  )

  it("stays bit-deterministic under high density", async () => {
    const data = denseRefs()
    const a = setupOn(data, denseRefsConfig)
    const b = setupOn(data, denseRefsConfig)
    const first = await createTwoLevelLayoutEngine().layout(a.graph, a.aggregates, a.visible)
    const second = await createTwoLevelLayoutEngine().layout(b.graph, b.aggregates, b.visible)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
    expect(first.clusters).toEqual(second.clusters)
  })

  it("holds too when the references concentrate on hubs", async () => {
    // The other half of the caveat: `denseRefs(40, 8)` funnels the 480
    // references onto 8 products only — max degree 40 instead of 12. A hub is
    // pulled in all directions at once, which is the case where the hard pass
    // has the most springs to contradict at a time.
    const { graph, aggregates, visible } = setupOn(denseRefs(40, 8), denseRefsConfig)
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const disks = disksOf(result, aggregates)
    let worst = Infinity
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) {
        worst = Math.min(worst, diskGap(disks[i]!, disks[j]!))
      }
    }
    expect(worst).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)

    const rects = [...result.positions.values()]
    let overlapping = 0
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const { px, py } = penetrations(rects[i]!, rects[j]!)
        if (px > 1e-6 && py > 1e-6) overlapping++
      }
    }
    expect(overlapping).toBe(0)
  }, 60_000)
})

describe("jitter — deterministic noise against the regularity of the tiling", () => {
  /**
   * Standard deviation of the edge-to-edge NEAREST-NEIGHBOUR gap, over every
   * disc. This is the metric that makes "the tiling is regular" objective: in a
   * lattice every neighbour sits at the same distance, so the standard deviation
   * is zero. The jitter exists only to raise it.
   */
  function nearestNeighbourSd(result: GraphLayoutResult, aggregates: AggregateIndex): number {
    const disks = disksOf(result, aggregates)
    const gaps: number[] = []
    for (let i = 0; i < disks.length; i++) {
      let best = Infinity
      for (let j = 0; j < disks.length; j++) {
        if (i === j) continue
        best = Math.min(best, diskGap(disks[i]!, disks[j]!))
      }
      gaps.push(best)
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    return Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length)
  }

  // `bigShop(3000)` is THE fixture that isolates the effect: 167 aggregates of
  // identical size and NO edge between them, so the simulation has only gravity
  // and collision, and converges towards hexagonal packing — the density optimum
  // for equal circles. On a dataset with springs, the topology would blur the
  // measurement.
  const flatSetup = () => setupOn(bigShop(3000))

  it(
    "without jitter, every neighbour sits exactly at clusterGap — the lattice",
    async () => {
      const { graph, aggregates, visible } = flatSetup()
      const result = await createTwoLevelLayoutEngine({ jitter: 0 }).layout(
        graph,
        aggregates,
        visible,
      )
      // Measured: 0.00 px. That is the definition of a regular tiling, and it is
      // the state the default fixes.
      expect(nearestNeighbourSd(result, aggregates)).toBeLessThan(0.5)
    },
    30_000,
  )

  it(
    "the default jitter breaks that lattice, and the amplitude grades the effect",
    async () => {
      const { graph, aggregates, visible } = flatSetup()
      const sdOf = async (jitter: number) => {
        const result = await createTwoLevelLayoutEngine({ jitter }).layout(
          graph,
          aggregates,
          visible,
        )
        return nearestNeighbourSd(result, aggregates)
      }
      // Measured: 0.00 / 6.36 / 12.02 / 17.65 px. Monotonicity is the property
      // that matters — `jitter` really grades the variance, it does not trigger
      // it all or nothing.
      const [none, small, mid, large] = [await sdOf(0), await sdOf(16), await sdOf(32), await sdOf(48)]
      expect(none!).toBeLessThan(0.5)
      expect(small!).toBeGreaterThan(3)
      expect(mid!).toBeGreaterThan(small!)
      expect(large!).toBeGreaterThan(mid!)
      // And the default is really in force: with no argument, we get the 32
      // regime.
      const byDefault = nearestNeighbourSd(
        await createTwoLevelLayoutEngine().layout(graph, aggregates, visible),
        aggregates,
      )
      expect(byDefault).toBeCloseTo(mid!, 6)
    },
    60_000,
  )

  it(
    "the jitter touches NEITHER the guarantees NOR the painted shapes",
    async () => {
      // The two invariants this mechanism must never dent, and the reason it is
      // safe to make it a default.
      //
      // 1. The final hard pass works on the REAL radius, so the guaranteed gap
      //    stays `clusterGap` whatever the amplitude. Measured: min nn =
      //    160.00 px at 0, 16, 32, 48 and 64.
      // 2. The inflation does not enter the enclosing circle: at identical
      //    packing, the emitted radii must be IDENTICAL from one amplitude to
      //    the next. Only the positions move.
      const { graph, aggregates, visible } = flatSetup()
      const quiet = await createTwoLevelLayoutEngine({ jitter: 0 }).layout(graph, aggregates, visible)
      const loud = await createTwoLevelLayoutEngine({ jitter: 64 }).layout(graph, aggregates, visible)

      for (const result of [quiet, loud]) {
        const disks = disksOf(result, aggregates)
        for (let i = 0; i < disks.length; i++) {
          for (let j = i + 1; j < disks.length; j++) {
            expect(diskGap(disks[i]!, disks[j]!)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
          }
        }
      }

      // Radii identical down to the bit: the jitter is purely transient.
      const radiiOf = (r: GraphLayoutResult) =>
        [...r.clusters].sort((a, b) => (a.aggregateId < b.aggregateId ? -1 : 1)).map((c) => c.r)
      expect(radiiOf(loud)).toEqual(radiiOf(quiet))

      // Counter-guard: the POSITIONS, for their part, must have moved —
      // otherwise the test above would pass with an inert jitter too.
      expect([...loud.positions.entries()]).not.toEqual([...quiet.positions.entries()])
    },
    60_000,
  )

  it("stays bit-deterministic with the jitter on", async () => {
    // The jitter is the engine's only source of "randomness", and it derives
    // entirely from the hash of the ids. Two runs must therefore stay identical
    // down to the bit — that is what sets this mechanism apart from a
    // `Math.random`, which would give the same look and break this property.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("two different amplitudes give two different layouts", async () => {
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const a = await createTwoLevelLayoutEngine({ jitter: 16 }).layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine({ jitter: 48 }).layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).not.toEqual([...b.positions.entries()])
  })
})

describe("degenerate inputs", () => {
  it("a graph with no entity returns an empty result", async () => {
    const graph = buildGraph({}, config)
    const aggregates = buildAggregates(graph, validateConfig(config))
    const entities = [...graph.nodes.values()].filter((n) => n.kind === "entity")
    expect(entities).toHaveLength(0)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, new Set())
    expect(result.positions.size).toBe(0)
    expect(result.clusters).toEqual([])
  })

  it("no visible entity: nothing is laid down, and the normalization does not drift", async () => {
    // `minX` is then `Infinity`: the normalization must be short-circuited,
    // otherwise it would propagate `NaN`s — there is nothing to observe here, so
    // it is the absence of a throw and the empty result that pin the guard.
    const { graph, aggregates } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, new Set())
    expect(result.positions.size).toBe(0)
    expect(result.clusters).toEqual([])
  })

  it("an entity outside any aggregate becomes a singleton disc, separated like the others", async () => {
    // /orders/1 references the GHOST customer: the edge is dangling, so no root
    // reaches it and it belongs to no aggregate. Without the singleton disc it
    // would stay placed INSIDE a neighbour's envelope, which does not contain it
    // — exactly the case `separateClusters` handled on its side.
    const { graph, aggregates, visible } = setup()
    expect(aggregates.byNode.has("/orders/1")).toBe(false)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.has("/orders/1")).toBe(true)
    expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"])

    const disks = disksOf(result, aggregates)
    expect(disks).toHaveLength(3)
    const lone = disks.find((d) => d.id === "/orders/1")!
    for (const cluster of result.clusters) {
      expect(diskGap(lone, cluster)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
    }

    // And the isolated card is indeed OUTSIDE every painted envelope.
    const rect = result.positions.get("/orders/1")!
    for (const cluster of result.clusters) {
      for (const corner of cornersOf(rect)) {
        expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeGreaterThan(cluster.r)
      }
    }
  })

  it("a single-card aggregate has an envelope, and it is that card's circumscribed circle", async () => {
    // Customer#c2 (/customers/1) has no valid order: its aggregate reduces to
    // its root. Packing a single rect must give that rect's circumscribed
    // circle, padding included — not a degenerate circle of zero radius, nor an
    // overflow of `Math.max(...[])`.
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)

    const single = result.clusters.find((c) => c.aggregateId === "Customer#c2")!
    expect(aggregates.aggregates.get("Customer#c2")!.memberIds.size).toBe(1)
    const rect = result.positions.get(single.rootId)!
    expect(single.r).toBeCloseTo(Math.hypot(rect.width, rect.height) / 2 + PADDING, 6)
    expect(single.cx).toBeCloseTo(rect.x + rect.width / 2, 6)
    expect(single.cy).toBeCloseTo(rect.y + rect.height / 2, 6)
  })

  it("a config with no `aggregates`: every entity is its own disc, zero envelopes", async () => {
    // Bare `shopConfig` declares no root, so `buildAggregates` returns an empty
    // index. The engine must then paint nothing — and above all keep pushing
    // apart the four cards, which are four singleton discs.
    const { graph, aggregates, visible } = setupOn(shopData, shopConfig)
    expect(aggregates.aggregates.size).toBe(0)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toEqual([])
    expect(result.positions.size).toBe(4)

    const disks = disksOf(result, aggregates)
    expect(disks).toHaveLength(4)
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) {
        expect(diskGap(disks[i]!, disks[j]!)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
      }
    }
  })

  it("an arbitrated entity falls into ONE envelope only", async () => {
    // /orders/0 is one hop from Customer#c1 and from Product#p9; `Customer`
    // being declared first, it wins (partition rule, `aggregate.ts`).
    // Geometrically, the card must be OUTSIDE Product#p9's disc — which disc
    // separation guarantees here by construction, since the card was never part
    // of that cluster.
    const { graph, aggregates, visible } = setupOn(twoRootsData, twoRootsConfig)
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toHaveLength(2)

    const owning = result.clusters.filter((c) =>
      aggregates.aggregates.get(c.aggregateId)!.memberIds.has("/orders/0"),
    )
    expect(owning.map((c) => c.aggregateId)).toEqual(["Customer#c1"])

    const other = result.clusters.find((c) => c.aggregateId === "Product#p9")!
    const rect = result.positions.get("/orders/0")!
    for (const corner of cornersOf(rect)) {
      expect(Math.hypot(corner.x - other.cx, corner.y - other.cy)).toBeGreaterThan(other.r)
    }
    expect(diskGap(owning[0]!, other)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
  })
})
