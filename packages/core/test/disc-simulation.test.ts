import { describe, it, expect } from "vitest"
import { layoutDiscs, type Disc } from "../src/disc-simulation.js"

// Level 2 tested ON ITS OWN, without going through the engine:
// `graph-layout.test.ts` exercises it through graph fixtures, which caps out at
// a few hundred discs and mixes the packing's cost with the simulation's. Here
// we build the disc array directly, so we choose the cardinality — and the
// cardinality is the subject.
//
// The real data set that motivated the spatial grid (BNPP architecture audit,
// 6,251 entities) produces ~1,300 discs; we take 1,500 to stay above it.

/** The same FNV-1a as the module, copied here so that the fixture depends only
 * on its own index — no source of randomness, hence an identical input set from
 * one run to the next. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const COUNT = 1500
const CLUSTER_GAP = 160

/** Varied radii — from 40 to 200 px, the order of magnitude of real aggregate
 * envelopes — drawn from the hash of the index. */
function makeDiscs(): Disc[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    id: `d${i}`,
    r: 40 + (hash(`d${i}:r`) / 0xffffffff) * 160,
    x: 0,
    y: 0,
  }))
}

/** ~4,500 pairs: the coupling regime of a real architecture graph, where the
 * springs have as much say as the collision. */
function makePairs(): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = []
  for (let i = 0; i < COUNT; i++) {
    for (let k = 0; k < 3; k++) {
      const j = hash(`edge:${i}:${k}`) % COUNT
      if (j !== i) pairs.push([`d${i}`, `d${j}`] as const)
    }
  }
  return pairs
}

const OPTIONS = { clusterGap: CLUSTER_GAP, simIterations: 300, jitter: 32 }

describe("layoutDiscs à l'échelle du jeu réel", () => {
  it(
    "tient l'invariant de séparation sur 1 500 disques, en secondes",
    () => {
      const discs = makeDiscs()
      const t0 = Date.now()
      layoutDiscs(discs, makePairs(), OPTIONS)
      const elapsed = Date.now() - t0

      // The invariant checked by BRUTE FORCE on the result: this is a test, and
      // O(n²) is the right tool here — it shares no structure with the
      // implementation, so a grid bug (a pair never enumerated) falls out here
      // and nowhere else.
      let violations = 0
      let worst = 0
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + CLUSTER_GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            worst = Math.max(worst, min - d)
          }
        }
      }
      expect({ violations, worst, elapsed }).toEqual({ violations: 0, worst: 0, elapsed })

      // The time bound is not a micro-benchmark: it separates two regimes. With
      // the original O(k²) double loop this volume took several minutes (the
      // test timed out); with the grid it stays comfortably under a second or
      // two.
      expect(elapsed).toBeLessThan(20_000)
    },
    30_000,
  )

  it(
    "reste déterministe au bit près à cette échelle",
    () => {
      // The grid must borrow nothing from the iteration order of a Map or a Set:
      // its traversal derives from the array indices and the positions alone.
      // Two runs over copies of the same input must therefore yield exactly the
      // same floats.
      const a = makeDiscs()
      const b = makeDiscs()
      layoutDiscs(a, makePairs(), OPTIONS)
      layoutDiscs(b, makePairs(), OPTIONS)
      expect(a.map((c) => [c.x, c.y])).toEqual(b.map((c) => [c.x, c.y]))
    },
    30_000,
  )
})

describe("convergence en chaîne", () => {
  it(
    "sépare une chaîne de 200 disques dont chaque séparation en déclenche une autre",
    () => {
      // `hardSeparation`'s worst case is not density but PROPAGATION: a chain
      // where pushing i away from i+1 runs into i+2, whose separation runs into
      // i+3, and so on. Each pass only settles one end of the chain, many are
      // needed, and it is the convergence budget — not the enumeration — that is
      // on trial.
      //
      // `layoutDiscs` always re-seeds the positions, so a collinear chain cannot
      // be PLACED from outside. We have the engine produce it, which is the
      // realistic case anyway: a chain of heavily weighted springs compresses
      // the 200 discs onto a line, and the hard pass must reopen it link by
      // link.
      const N = 200
      const GAP = 24
      const discs: Disc[] = Array.from({ length: N }, (_, i) => ({
        id: `chain${i}`,
        r: 30,
        x: 0,
        y: 0,
      }))
      const pairs: Array<readonly [string, string]> = []
      for (let i = 0; i + 1 < N; i++) {
        // Heavy weight: the spring dominates by far, the chain compresses and
        // the hard pass must reopen it link by link.
        for (let k = 0; k < 4; k++) pairs.push([`chain${i}`, `chain${i + 1}`] as const)
      }

      layoutDiscs(discs, pairs, { clusterGap: GAP, simIterations: 200, jitter: 0 })

      let violations = 0
      let worst = 0
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            worst = Math.max(worst, min - d)
          }
        }
      }
      expect({ violations, worst }).toEqual({ violations: 0, worst: 0 })
    },
    30_000,
  )

  it("la cascade reste déterministe au bit près", () => {
    // A chain runs thousands of passes over the same buffers: this is the regime
    // where leftover state between passes would show up fastest, and it would
    // show up in the last bits.
    const build = (): Disc[] =>
      Array.from({ length: 120 }, (_, i) => ({ id: `casc${i}`, r: 25, x: 0, y: 0 }))
    const pairs: Array<readonly [string, string]> = []
    for (let i = 0; i + 1 < 120; i++) pairs.push([`casc${i}`, `casc${i + 1}`] as const)
    const a = build()
    const b = build()
    const o = { clusterGap: 30, simIterations: 150, jitter: 0 }
    layoutDiscs(a, pairs, o)
    layoutDiscs(b, pairs, o)
    expect(a.map((c) => [c.x, c.y])).toEqual(b.map((c) => [c.x, c.y]))
  })

  it("deux mises en page successives ne se marchent pas dessus par les tampons", () => {
    // The grid's buffers persist at module scope. A LARGE set followed by a
    // SMALL one therefore re-reads oversized arrays whose tail carries the
    // previous run's leftovers: if a reset were missing (`starts`, the cell
    // histogram, or `cellRMax`, the per-cell max radius that drives the
    // pruning), the second layout would produce something other than what it
    // would have produced alone. That is exactly what we compare.
    const small = (): Disc[] =>
      Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, r: 18 + (i % 5) * 7, x: 0, y: 0 }))
    const o = { clusterGap: 45, simIterations: 120, jitter: 6 }

    const alone = small()
    layoutDiscs(alone, [], o)

    const big = Array.from({ length: 900 }, (_, i) => ({ id: `b${i}`, r: 30, x: 0, y: 0 }))
    layoutDiscs(big, [], { clusterGap: 70, simIterations: 60, jitter: 12 })
    const after = small()
    layoutDiscs(after, [], o)

    expect(after.map((c) => [c.x, c.y])).toEqual(alone.map((c) => [c.x, c.y]))
  })
})

describe("entrées dégénérées", () => {
  it("zéro ou un disque ne fait rien exploser", () => {
    const none: Disc[] = []
    layoutDiscs(none, [], OPTIONS)
    expect(none).toEqual([])

    const one: Disc[] = [{ id: "solo", r: 30, x: 999, y: -999 }]
    layoutDiscs(one, [], OPTIONS)
    expect(Number.isFinite(one[0]!.x)).toBe(true)
    expect(Number.isFinite(one[0]!.y)).toBe(true)
  })

  it("des rayons nuls et un gap nul ne demandent aucune séparation", () => {
    // The grid's edge case: cell size derives from the max diameter and the gap,
    // so it is 0 here. No pair can violate anything (`min` is 0, `d ≥ 0`); the
    // pass must see that and return 0.
    const discs: Disc[] = Array.from({ length: 40 }, (_, i) => ({
      id: `z${i}`,
      r: 0,
      x: 0,
      y: 0,
    }))
    layoutDiscs(discs, [], { clusterGap: 0, simIterations: 20, jitter: 0 })
    for (const c of discs) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
    }
  })

  it("sépare des disques empilés exactement au même point", () => {
    // Coincident centres: the push direction comes from the hash of the ids. The
    // grid puts them all in the SAME cell, which is the worst case for density,
    // and the invariant must hold all the same.
    const discs: Disc[] = Array.from({ length: 30 }, (_, i) => ({
      id: `stack${i}`,
      r: 20,
      x: 0,
      y: 0,
    }))
    // After `seedDiscs` they are no longer coincident; we force the case by
    // overriding the seeding with a zero jitter and a gap that makes them all
    // touch. The assertion is on the output.
    layoutDiscs(discs, [], { clusterGap: 50, simIterations: 50, jitter: 0 })
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!
        const b = discs[j]!
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r + 50 - 1e-6)
      }
    }
  })

  it("un disque géant parmi des petits reste séparé de tous", () => {
    // The search window must cover `r_i + r_max + gap` for EVERY disc, small
    // ones included: otherwise no small disc would ever see the giant, and the
    // invariant would break on exactly those pairs.
    const discs: Disc[] = [
      { id: "giant", r: 3000, x: 0, y: 0 },
      ...Array.from({ length: 120 }, (_, i) => ({ id: `small${i}`, r: 12, x: 0, y: 0 })),
    ]
    layoutDiscs(discs, [], { clusterGap: 40, simIterations: 100, jitter: 8 })
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!
        const b = discs[j]!
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r + 40 - 1e-6)
      }
    }
  })

  it(
    "les petits trouvent le géant alors que l'élagage par cellule coupe leur fenêtre",
    () => {
      // THE case that discriminates per-cell pruning, sized so that the grid
      // really exercises it — the previous test does not: with 120 small discs
      // around one giant, the grid amounts to a handful of cells and nothing is
      // ever pruned.
      //
      // Here: 600 small discs (r = 30) plus one giant (r = 2000), gap 60. The
      // cell size is (2·2000 + 60)/3 ≈ 1353 px and a small disc's window spans 2
      // rings. Ring 2's pruning threshold is (2−1)·1353 − (30 + 60) ≈ 1263 px:
      // every cell holding only small discs (max radius 30) is therefore skipped
      // at ring 2, while the giant's cell (max radius 2000) is NOT. That is
      // exactly the discrimination we want to see hold — a pruning that got the
      // max wrong would make every small disc two rings away miss the giant, and
      // the invariant would break on those pairs and only those.
      const GAP = 60
      const discs: Disc[] = [
        { id: "giant", r: 2000, x: 0, y: 0 },
        ...Array.from({ length: 600 }, (_, i) => ({ id: `tiny${i}`, r: 30, x: 0, y: 0 })),
      ]
      layoutDiscs(discs, [], { clusterGap: GAP, simIterations: 150, jitter: 10 })

      let violations = 0
      let worstGiant = 0
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            // We single out the pairs THAT INVOLVE THE GIANT: those are the ones
            // pruning would get wrong, and telling them apart makes the
            // diagnosis immediate on a regression.
            if (i === 0) worstGiant = Math.max(worstGiant, min - d)
          }
        }
      }
      expect({ violations, worstGiant }).toEqual({ violations: 0, worstGiant: 0 })
    },
    30_000,
  )
})
