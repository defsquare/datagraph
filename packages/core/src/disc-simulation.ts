// LEVEL 2 of the graph view engine — the disc separation — extracted from
// `graph-layout.ts` as-is.
//
// Like level 1's packing, it is a closed subsystem, and that is what justifies
// the module: it knows neither the `Graph`, nor the aggregates, nor the `Rect`s.
// Its universe is a list of discs `{ id, r, x, y }` and a list of id pairs to
// pull together. What it returns is each disc's position, written IN PLACE on
// the objects passed in — the caller hangs whatever it wants on them (see
// `LocalCluster` in `graph-layout.ts`).
//
// The `id` serves two purposes, and nothing else: identifying a spring pair, and
// feeding `hashOf`, which is the engine's entire source of pseudo-randomness.
// That is why it lives here and not in `graph-pack.ts`, which has no need for it
// — packing is entirely determined by the sizes and the adjacency.
//
// This module is imported ONLY by `graph-layout.ts`. It appears neither in the
// `index.ts` barrel nor in the package entry points: it lands in the lazy
// `./graph-layout` chunk through resolution, and the two bundle purity tests
// guard that invariant.

/** FNV-1a hash of the id — the SAME as the removed engine's, and for the same
 * reason: it is the engine's entire source of "randomness". No `Math.random` nor
 * `Date.now` appears anywhere here, or the bit-level determinism the tests
 * assert would fall. */
function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// The three simulation constants, lifted out of the loop body where they were
// hard-coded. They are not tunable: they are the first three of the sweep
// documented in `TWO_LEVEL_LAYOUT_DEFAULTS` (`graph-layout.ts`), which confirms
// them and gives the measurement tables. The fourth, `simIterations`, IS tunable
// and arrives through the options.

/** Spring force. Exact minimum on the sweep's dense fixture: beyond it, the
 * springs pull so hard that the hard pass contradicts them and the references
 * get LONGER. */
const SPRING_FORCE = 0.15
/** Denominator of the weight cap `min(1, w/N)` — the sweep's N=2. */
const WEIGHT_CAP_DIVISOR = 2
/** Gravity toward the origin, per unit of `alpha`. */
const GRAVITY = 0.02
/** Cap on hard passes. Raised from 1000 to 5000 during the port: see the
 * measured justification above `hardSeparation`. */
const MAX_HARD_PASSES = 5000
/** Divisor of the reach that gives the collision grid's cell size. This is a
 * COST knob and nothing else — the exhaustiveness of the enumeration holds
 * whatever its value, the window being recomputed from the cell size. Swept: see
 * the table above `collisionPass`. */
const CELL_DIVISOR = 3

/**
 * A level 2 disc. `x`/`y` are written in place by `layoutDiscs`; `id` and `r`
 * are inputs and are never modified.
 */
export interface Disc {
  id: string
  r: number
  x: number
  y: number
}

export interface DiscSimulationOptions {
  clusterGap: number
  simIterations: number
  jitter: number
}

/** An aggregated spring: two INDICES into the disc array, and a weight. */
interface Spring {
  a: number
  b: number
  w: number
}

/**
 * Deterministic seeding on a disc sized after the total area of the discs — same
 * idea as the removed engine's `seedPosition`, but at aggregate granularity
 * rather than card granularity.
 */
function seedDiscs(discs: Disc[], clusterGap: number): void {
  let discArea = 0
  for (const c of discs) discArea += (2 * c.r + clusterGap) ** 2
  const seedRadius = Math.sqrt(discArea) * 0.75
  for (const c of discs) {
    const h = hashOf(c.id)
    const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI
    const rr = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * seedRadius
    c.x = rr * Math.cos(angle)
    c.y = rr * Math.sin(angle)
  }
}

/**
 * Aggregated inter-disc edges: one per pair, weighted by the number of
 * references crossing it. Pairs whose two ends are the SAME disc are ignored —
 * they can pull nothing, the disc being rigid, and radial placement already
 * consumed them at level 1.
 *
 * `pairs` arrives in source order, and that is deliberately the only order that
 * enters here: the sort by key below erases it.
 */
function aggregateSprings(discs: Disc[], pairs: Iterable<readonly [string, string]>): Spring[] {
  const edgeWeight = new Map<string, Spring>()
  const index = new Map<string, number>()
  discs.forEach((c, i) => index.set(c.id, i))
  for (const [ca, cb] of pairs) {
    if (ca === cb) continue
    const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca]
    const key = `${lo} ${hi}`
    const found = edgeWeight.get(key)
    if (found) found.w++
    else edgeWeight.set(key, { a: index.get(lo)!, b: index.get(hi)!, w: 1 })
  }
  // Sort by key: a Map's iteration order follows insertion, hence the order of
  // the pairs received. It is stable in practice, but since floating-point
  // addition is not associative, we do not rely on it.
  return [...edgeWeight.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, v]) => v)
}

/**
 * VIRTUAL INFLATION — the deterministic noise that breaks the tiling.
 *
 * The problem: gravity and collision, on discs of the SAME radius, converge to
 * hexagonal packing, which is the density optimum for equal circles. On
 * `bigShop(3000)` — 167 identical aggregates, no edge between them — the result
 * is a near-perfectly regular hexagonal tiling, and it reads as a grid rather
 * than as a graph. The quantified signature of that regularity: the
 * nearest-neighbor gap between discs has a standard deviation of **0.00 px**,
 * everyone exactly at `clusterGap`.
 *
 * The mechanism: each cluster is assigned an INFLATED radius, `r + jitter_i`,
 * with `jitter_i` drawn from the hash of its id — hence stable from run to run,
 * and unrelated to its seeding position (the hash carries a distinct suffix, or
 * the two draws would be correlated). The SIMULATION ALONE works with that
 * inflated radius.
 *
 * Three properties, in order of importance:
 *
 * 1. **The guarantees are rigorously unchanged.** The final hard pass uses the
 *    REAL radius and the real `clusterGap`; it is that pass, and it alone, that
 *    carries the exit invariant. An arbitrarily large jitter could not produce
 *    an overlap, only an airier layout.
 * 2. **The painted shape is never inflated.** `jitter` enters neither
 *    `LocalCluster.r`, nor the enclosing circle, nor `ClusterShape`: the shape
 *    drawn stays exactly the minimal shape of the cards.
 * 3. **It is the variance that breaks the tiling**, not a displacement.
 *    Neighbors land at a gap spread over
 *    `[clusterGap, clusterGap + jitter_i + jitter_j]` instead of all falling on
 *    `clusterGap`: the discs can no longer form a regular lattice since they no
 *    longer all ask for the same room.
 *
 * This is the engine's ONLY source of noise. No angle, no position, no constant
 * is perturbed anywhere else, and there is still neither `Math.random` nor
 * `Date.now`: bit-level determinism remains tested.
 */
function virtualRadii(discs: Disc[], jitter: number): number[] {
  return discs.map((c) => {
    if (jitter <= 0) return c.r
    // The `:jitter` suffix: decorrelates this draw from the seeding one, which
    // hashes the same id just above.
    return c.r + (hashOf(`${c.id}:jitter`) / 0xffffffff) * jitter
  })
}

// ─── THE PASS BUFFERS, REUSED FROM ONE CALL TO THE NEXT ───
//
// `collisionPass` is called thousands of times per layout — 400 by `simulate`,
// ~4,000 by `hardSeparation` on the real audit. Re-allocating its arrays on
// every call made garbage collection the second item in the BROWSER profile
// (~0.8 s on that dataset); under Node, whose young GC is far cheaper, the same
// change only reads as a few percent. They therefore live at module scope, grow
// only when too small, and are reset — not reallocated — where the algorithm
// assumes zeros.
//
// The change is BIT-IDENTICAL, and that is verifiable: on the real audit, the
// 6,251 positions produced are exactly the same with and without reuse. That is
// the contract to preserve when touching this block — a buffer whose tail is not
// zeroed would break it silently, hence the test "two successive layouts do not
// tread on each other through the buffers".
//
// ASSUMPTION, and it is the only one that makes this sharing safe: the module is
// SINGLE-THREADED and NON-REENTRANT. No function here is `async`, no loop yields,
// and `layoutDiscs` is the only entry point: two concurrent layouts would corrupt
// each other. Should level 2 ever move into a worker, or should a pass become
// interruptible, this is the paragraph to re-read before touching the rest.

/** CSR grid: each disc's cell, cell bounds, fill cursor, indices grouped by
 * cell. */
let bufCellOf: Int32Array = new Int32Array(0)
let bufStarts: Int32Array = new Int32Array(0)
let bufCursor: Int32Array = new Int32Array(0)
let bufItems: Int32Array = new Int32Array(0)
/** The largest radius present in each cell, and the per-ring pruning threshold
 * of the disc being processed. Cf. the "per-cell reach" section of
 * `collisionPass`'s doc. */
let bufCellRMax: Float64Array = new Float64Array(0)
let bufRingThreshold: Float64Array = new Float64Array(0)

function growI32(buf: Int32Array, len: number): Int32Array {
  return buf.length >= len ? buf : new Int32Array(len)
}
function growF64(buf: Float64Array, len: number): Float64Array {
  return buf.length >= len ? buf : new Float64Array(len)
}

/**
 * ONE disc-disc collision pass, over the NEARBY pairs only, enumerated through a
 * uniform grid rebuilt at the start of the pass.
 *
 * A single body for the engine's TWO uses — the collision embedded in the
 * simulation and the final hard pass — which differ only in three parameters:
 * the radii (virtual and inflated during the simulation, real in the hard pass),
 * the guard (`0` during the simulation, `1e-6` in the hard pass, which needs a
 * convergence threshold), and what the return value is used for.
 *
 * Returns the worst violation encountered, or `0` if no pair crossed the guard.
 *
 * ─── WHY A GRID ───
 *
 * This pass used to be the double loop over all pairs, called up to 400 times by
 * `simulate` and 5000 times by `hardSeparation`: it is level 2's only hot spot,
 * springs and gravity being linear already. At 167 discs the O(k²) did not show;
 * on a real architecture audit — ~1,300 discs — the layout took over a minute.
 * See `graph-layout.ts`'s header for the before/after measurements.
 *
 * ─── THE REACH, THE WINDOW, AND WHAT MAKES ENUMERATION EXHAUSTIVE ───
 *
 * The REACH of a disc i, `r_i + r_max + gap`, upper-bounds the `min` of EVERY
 * pair containing it — `r_max` being the maximum of the CURRENT radius array,
 * hence the INFLATED radii when `simulate` calls and the real ones when
 * `hardSeparation` calls: the sizing follows the contract the pass applies, not
 * some other. The inequality `min ≤ reach` holds bit-for-bit and not only "in
 * math": round-to-nearest is monotone, so `fl(radii[j]) ≤ fl(r_max)` implies
 * `fl(radii[i] + radii[j] + gap) ≤ fl(radii[i] + r_max + gap)`.
 *
 * The window of i is then `ceil(reach_i / cell)` rings around its cell, and it is
 * exhaustive: a violating pair has `d < min − slack ≤ min ≤ reach_i`, so
 * `|Δx| ≤ d ≤ reach_i`, so the two cell indices in x — floors of two reals at
 * most `reach_i / cell` apart — differ by at most `ceil(reach_i / cell)`. Same in
 * y.
 *
 * ─── THE CELL SIZE: A TRADE-OFF, AND IT WAS MEASURED ───
 *
 * `cell = (2·r_max + gap) / 3`, i.e. a window of 2 to 3 rings. Neither
 * correctness nor exhaustiveness depends on it — only the cost, and the cost has
 * two terms pulling in opposite directions: a finer cell visits more cells (the
 * window covers the same reach) but examines fewer out-of-reach candidates. The
 * divisor 3 is the measured optimum, and it is so on both radius regimes the
 * engine meets, which do not share the same theoretical optimum — hence the
 * trade-off (ms of a full `layout()`):
 *
 *   divisor                              1        2        3        4
 *   real audit, 1,300 discs          10,205    8,045    5,940    6,434
 *     (spread radii: median 306 px, max 1,856 px)
 *   same audit without groups, 1,955  3,688    3,691    3,749    3,832
 *     (one disc per entity, near-uniform radii)
 *
 * The first regime pays dearly for a coarse cell — 16 discs per cell, ~144
 * candidates per disc — while the second only gains 1.7% from it. A cell sized on
 * the MEAN diameter rather than the max was also measured: better on the first
 * regime (6.4 s) but markedly worse on the second (6.1 s against 3.7 s), because
 * a handful of very large cards there crushes the mean without reducing the
 * reach. The divisor of the max is the only setting that loses on neither.
 *
 * ─── THE PER-CELL REACH: THE SAME LEMMA, BUT LOCAL ───
 *
 * The trade-off above left a hole, and it was THE hot spot of the real audit:
 * `r_max` is a GLOBAL maximum, so a single giant disc lengthens the reach — and
 * the window — of every other. Measured on that dataset: `r_max` is 1,856 px for
 * a median radius of 306 px, hence `cell` = 1,291 px, 360 cells of which 285 are
 * occupied (4.6 discs per cell), an average window of 2.13 rings, and **112
 * candidates examined per disc per pass** — while the TRUE reach of a median disc
 * against another median disc is 772 px, i.e. less than one ring. We were walking
 * the giant's suburbs on everyone's behalf.
 *
 * The fix does not touch the window — which stays sized on `r_max`, hence
 * exhaustive — but prunes CELL BY CELL inside it, with exactly the lemma above
 * where `r_max` is replaced by `cellRMax[c]`, the largest radius actually present
 * in cell `c`:
 *
 *   for every j in cell c, `radii[j] ≤ cellRMax[c]` by construction, so
 *   (monotone round-to-nearest, same argument as above)
 *   `min_ij ≤ fl(radii[i] + cellRMax[c] + gap) =: reach_i,c`. A violating pair
 *   (i, j) with j in c therefore has `|Δx| ≤ d < min_ij ≤ reach_i,c`, so the cell
 *   indices in x differ by at most `ceil(reach_i,c / cell)`; same in y; so the
 *   ring distance `R = max(|Δcx|, |Δcy|)` satisfies `R ≤ ceil(reach_i,c / cell)`.
 *
 * Contrapositive: if `R > ceil(reach_i,c / cell)`, cell c cannot contain any
 * violating partner of i, and its items can be skipped without a look. The test
 * is written division-free, in the equivalent form `reach_i,c < (R − 1)·cell` —
 * for integer R, `ceil(x) ≥ R ⟺ x > R − 1` — which gives a per-ring threshold
 * precomputed once per disc i in `bufRingThreshold`: one comparison and two
 * indexings per visited cell, against the dozen candidates it holds.
 *
 * `cellRMax` is filled in the SAME loop as the grid, from the CURRENT radius
 * array — inflated when `simulate` calls, real when `hardSeparation` calls —
 * exactly like `r_max`: the sizing still follows the contract the pass applies.
 * It borrows nothing from an outside order (a max is commutative, and the fill
 * order is that of the indices), so determinism is intact.
 *
 * MEASUREMENT (full `layout()`, median of 3 runs, same machine, before → after
 * pruning) — and BOTH lines must be read, as for the cell divisor:
 *
 *   real audit with groups, 1,300 discs     6,096 ms → 4,224 ms   (−31%)
 *     (spread radii: median 306 px, max 1,856 px)
 *   same audit without groups, 6,251 discs 21,416 ms → 21,626 ms  (+1%)
 *     (one disc per entity, near-uniform radii)
 *
 * The second regime gains nothing, and that is expected: with no giant,
 * `cellRMax[c]` is roughly `r_max` everywhere and nothing ever prunes. What
 * matters is that it does not LOSE — and a first version lost 12% on it, because
 * it paid the pruning comparison on empty cells, which are the overwhelming
 * majority when the grid is sparse. Hence the emptiness test placed before it, in
 * the body.
 *
 * The divisor sweep table above was measured BEFORE this pruning: its absolute
 * times no longer hold, and its verdict (divisor 3, max rather than mean) has not
 * been re-swept since — pruning changes precisely the trade-off that settled it,
 * so that is a sweep to redo should the question come up again.
 *
 * WHAT PRUNING DOES NOT PROMISE: the sequence of pushes is NOT identical to the
 * previous one. At FIXED positions it only removes candidates proved
 * non-violating, but the pushes move the discs during the pass, so a cell pruned
 * on the indexed state may host a partner that has become close in the meantime.
 * This is the same phenomenon as the stale index handled just below, and it is
 * settled by the same argument: only the `worst === 0` pass concludes, and on
 * that one nothing moved, so pruning is exact there. The trajectories differ —
 * the real audit's envelope grows by 2.5% — which the tests allow since they
 * assert properties.
 *
 * A practical corollary, because it is costly when forgotten: `cellRMax` MUST be
 * fed from the `radii` array of the current pass — inflated under `simulate`,
 * real under `hardSeparation`. Taking it from `Disc.r` would work under
 * `hardSeparation`, where the two coincide, and would underestimate the
 * simulation's inflated radii, breaking the bound `radii[j] ≤ cellRMax[c]`
 * without any test being able to see it — the simulation carries no guarantee.
 *
 * ─── THE INDEX CAN GO STALE, AND THE EXIT INVARIANT STAYS PROVED ───
 *
 * The grid is built at the start of the pass, but the pushes move the discs
 * DURING the pass: from the first push on, the index describes positions that no
 * longer exist and the enumeration may miss a pair. That is acceptable during
 * convergence — the next pass rebuilds the index and sees it — and it changes
 * nothing to the exit guarantee:
 *
 *   a pass returning `worst === 0` pushed NO pair (that is the definition of
 *   `worst`), hence moved no disc, hence its index stayed valid from the first
 *   candidate to the last. On that pass, and it is the only one `hardSeparation`
 *   draws a conclusion from, "no violation found" is an EXACT statement about the
 *   final positions.
 *
 * Exhaustiveness at fixed positions is therefore not a performance detail: it is
 * the hypothesis of this proof. Shrinking the window "to go faster" would break
 * the invariant the tests verify by brute force.
 *
 * ─── DETERMINISM ───
 *
 * The index must borrow NOTHING from an order coming from outside, or bit-level
 * determinism would fall. It borrows only from the array indices and the
 * positions, themselves deterministic: the cells are filled walking `i` upward
 * (so each cell lists its discs in index order), the outer loop goes by
 * increasing `i`, the window is walked in a fixed scan order, and `j > i` makes
 * each pair seen exactly once. No Map, no Set, no insertion order. Per-cell
 * pruning does not touch that: `cellRMax` is a maximum, hence independent of the
 * fill order, and the per-ring threshold depends only on `radii[i]`, `gap` and
 * `cell`.
 *
 * What CHANGES relative to the double loop: the order of the floating-point
 * additions is no longer the same (a distant pair is no longer evaluated at all,
 * and nearby pairs are no longer seen in lexicographic order). The positions
 * produced therefore differ in the last bits from the old version's — which the
 * tests allow, because they assert PROPERTIES (separation invariant, run-to-run
 * determinism, jitter monotonicity) and not reference values. The skip predicate,
 * on the other hand, is unchanged bit-for-bit: same `Math.hypot`, same
 * `min - slack`, no squared comparison that would move the 1e-6 boundary.
 */
function collisionPass(discs: Disc[], radii: number[], gap: number, slack: number): number {
  const n = discs.length
  if (n < 2) return 0

  let rMax = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const r = radii[i]!
    if (r > rMax) rMax = r
    const c = discs[i]!
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }

  // The reach of the WORST disc. Zero ⇒ every radius AND the gap are zero, so
  // `min` is 0 for every pair and `d ≥ 0 ≥ min − slack`: no pair can cross the
  // guard. Returning 0 without walking anything is then the EXACT result, not a
  // defensive short-circuit — and it is also what guarantees `cell > 0`, hence a
  // grid of finite dimensions.
  const maxReach = 2 * rMax + gap
  if (!(maxReach > 0)) return 0

  // The divisor 3: the measured optimum on both radius regimes, cf. the table in
  // the doc above.
  let cell = maxReach / CELL_DIVISOR

  const spanX = maxX - minX
  const spanY = maxY - minY
  let nx = Math.floor(spanX / cell) + 1
  let ny = Math.floor(spanY / cell) + 1
  // Memory bound: the grid stays at O(k) cells. It should only bite on very
  // heterogeneous radii with a zero gap — seeding fits inside a disc sized after
  // the total area and gravity pulls back — but a very spread out dataset would
  // otherwise allocate an array unrelated to the number of discs. ENLARGING the
  // cell is always safe: since the ring count is recomputed FROM the final cell
  // size, the window still covers the reach; a bigger cell only adds candidates,
  // never loses any.
  if (nx * ny > 4 * n) {
    cell *= Math.sqrt((nx * ny) / (4 * n))
    nx = Math.floor(spanX / cell) + 1
    ny = Math.floor(spanY / cell) + 1
  }

  // CSR grid: `starts` gives the beginning of each cell in `items`, which lists
  // the disc indices grouped by cell. Two flat arrays rather than a Map of lists
  // — it is the same walk, with no per-cell allocation and no insertion order to
  // argue about.
  //
  // The arrays are the module's persistent buffers (cf. their doc block).
  // `starts` and `cellRMax` are accumulated in place, hence zeroed over the
  // useful slice — the algorithm never reads beyond it, and 0 is indeed the
  // identity for both (a counter, and a max over radii all ≥ 0). `cellOf` and
  // `items` are rewritten in full, `cursor` is copied from `starts`: no residue
  // of the previous pass is readable in them.
  const cells = nx * ny
  const cellOf = (bufCellOf = growI32(bufCellOf, n))
  const starts = (bufStarts = growI32(bufStarts, cells + 1))
  const cellRMax = (bufCellRMax = growF64(bufCellRMax, cells))
  starts.fill(0, 0, cells + 1)
  cellRMax.fill(0, 0, cells)
  for (let i = 0; i < n; i++) {
    const c = discs[i]!
    // The clamp should never bite (`minX ≤ x ≤ maxX` by construction); it covers
    // the rounding of the division.
    let cx = Math.floor((c.x - minX) / cell)
    if (cx < 0) cx = 0
    else if (cx >= nx) cx = nx - 1
    let cy = Math.floor((c.y - minY) / cell)
    if (cy < 0) cy = 0
    else if (cy >= ny) cy = ny - 1
    const k = cy * nx + cx
    cellOf[i] = k
    starts[k + 1]!++
    // The max of the cell's CURRENT radii: it is what will replace `rMax` in the
    // pruning threshold, so it must come from the same array the pass applies. A
    // max is commutative: the fill order is not readable in the result.
    if (radii[i]! > cellRMax[k]!) cellRMax[k] = radii[i]!
  }
  for (let k = 0; k < cells; k++) starts[k + 1]! += starts[k]!
  const cursor = (bufCursor = growI32(bufCursor, cells))
  for (let k = 0; k < cells; k++) cursor[k] = starts[k]!
  const items = (bufItems = growI32(bufItems, n))
  // Increasing `i`: each cell therefore lists its discs by increasing index.
  for (let i = 0; i < n; i++) items[cursor[cellOf[i]!]!++] = i

  // The per-ring pruning threshold, precomputed once per disc i: the cell at ring
  // distance R is skippable as soon as the largest radius it hosts satisfies
  // `cellRMax < (R − 1)·cell − (r_i + gap)`, that is, as soon as the local reach
  // `r_i + cellRMax + gap` falls below `(R − 1)·cell`. Rings 0 and 1 give a
  // negative threshold, so are never pruned — as expected, they are the immediate
  // neighbors.
  const ringThreshold = (bufRingThreshold = growF64(bufRingThreshold, (nx > ny ? nx : ny) + 2))

  let worst = 0
  for (let i = 0; i < n; i++) {
    const a = discs[i]!
    const k = cellOf[i]!
    const cx = k % nx
    const cy = (k - cx) / nx
    // Disc i's window: enough rings to cover `r_i + r_max + gap`, which
    // upper-bounds `min` for EVERY partner j. Two reals at most t apart have
    // floors at most `ceil(t)` apart — hence the ring count. It is this window
    // that carries exhaustiveness; the pruning below only replays the same lemma
    // cell by cell, never shrinks it.
    const rings = Math.ceil((radii[i]! + rMax + gap) / cell)
    const localReach = radii[i]! + gap
    for (let R = 0; R <= rings; R++) ringThreshold[R] = (R - 1) * cell - localReach
    const gx0 = cx - rings > 0 ? cx - rings : 0
    const gx1 = cx + rings < nx ? cx + rings : nx - 1
    const gy0 = cy - rings > 0 ? cy - rings : 0
    const gy1 = cy + rings < ny ? cy + rings : ny - 1
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = gy * nx
      const ry = gy > cy ? gy - cy : cy - gy
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = row + gx
        const end = starts[c + 1]!
        let p = starts[c]!
        // Empty cell: nothing to prune nor to examine. This test comes BEFORE
        // the pruning and that is not cosmetic — on a dataset with near-uniform
        // radii the grid is sparse (≈ 0.25 disc per cell, cf. the memory bound
        // above), so the overwhelming majority of visited cells are empty and
        // paying the pruning on them cost more than it returned — measured at
        // +12% on that regime before this reordering.
        if (p === end) continue
        const rx = gx > cx ? gx - cx : cx - gx
        // The local pruning. One comparison per POPULATED cell against the few
        // discs it holds: this is what stops a single giant disc from charging
        // its suburbs to everyone.
        if (cellRMax[c]! < ringThreshold[rx > ry ? rx : ry]!) continue
        for (; p < end; p++) {
          const j = items[p]!
          // Each pair once, and never a disc against itself.
          if (j <= i) continue
          const b = discs[j]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const min = radii[i]! + radii[j]! + gap
          // Bounding-box rejection BEFORE the `hypot`, which on its own costs
          // most of the pass. This is not an approximation of the predicate:
          // `hypot(dx, dy) ≥ |dx|` for any faithfully rounded implementation (the
          // exact value bounds `|dx|`, which is representable, and
          // round-to-nearest is monotone), so `|dx| ≥ min` implies
          // `d ≥ min ≥ min − slack`: the pair would have been skipped anyway, and
          // the sequence of pushes is identical bit-for-bit.
          if (dx >= min || dx <= -min || dy >= min || dy <= -min) continue
          const d = Math.hypot(dx, dy)
          if (d >= min - slack) continue
          // Two coincident centers: the push direction is undetermined. We draw
          // it from the ids rather than dividing by zero — the old
          // `separateClusters`, removed from the repo, settled the same case with
          // a fixed axis.
          const ux = d > 1e-9 ? dx / d : Math.cos((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
          const uy = d > 1e-9 ? dy / d : Math.sin((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
          const push = (min - d) / 2
          if (min - d > worst) worst = min - d
          a.x -= ux * push
          a.y -= uy * push
          b.x += ux * push
          b.y += uy * push
        }
      }
    }
  }
  return worst
}

/**
 * Springs + gravity + disc-disc collision, over k discs.
 * `alpha` decreases linearly: plain annealing, the large displacements early in
 * the simulation, the adjustments at the end.
 */
function simulate(
  discs: Disc[],
  springs: Spring[],
  simR: number[],
  iterations: number,
  clusterGap: number,
): void {
  const I = iterations
  for (let it = 0; it < I; it++) {
    const alpha = 1 - it / I

    for (const s of springs) {
      const a = discs[s.a]!
      const b = discs[s.b]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      // Ideal length = the rest position allowed by the collision constraint. A
      // spring therefore never asks for the impossible.
      const ideal = simR[s.a]! + simR[s.b]! + clusterGap
      // CAPPED weight: ten references between two aggregates must not pull ten
      // times harder than one, or a heavily coupled pair crushes the rest of the
      // graph.
      const k = Math.min(1, s.w / WEIGHT_CAP_DIVISOR)
      const f = ((d - ideal) / d) * SPRING_FORCE * alpha * k
      a.x += dx * f
      a.y += dy * f
      b.x -= dx * f
      b.y -= dy * f
    }

    // Gravity toward the origin: without it, the disjoint components (167
    // aggregates with no edge between them, cf. bigShop) would have no reason to
    // come closer and the bbox would explode.
    const g = GRAVITY * alpha
    for (const c of discs) {
      c.x -= c.x * g
      c.y -= c.y * g
    }

    collisionPass(discs, simR, clusterGap, 0)
  }
}

/**
 * Final hard pass. The collision embedded in the simulation is only one force
 * among others: springs and gravity may contradict it on the next iteration.
 * This pass does NOTHING but separate, until convergence, which makes
 * dist ≥ r₁ + r₂ + `clusterGap` an exit invariant and not a hope of convergence.
 * It is the pass that carries the guarantee the tests assert, and it deliberately
 * takes precedence over spring length.
 *
 * TWO DEPARTURES FROM THE PROBE, the only ones of the port, both MEASURED.
 *
 * 1. The probe exited on `worst < 1e-3` while its collision guard ignores pairs
 *    within `1e-6` of the goal: the loop therefore stopped three orders of
 *    magnitude BEFORE what its own guard considers separated, and the real
 *    invariant was `clusterGap − 1e-3`, not `clusterGap − 1e-6`. Measured on
 *    bigShop(3000) — 167 discs: exit at pass 338, residual 9.301e-4; at
 *    `clusterGap: 400`, pass 424, residual 6.617e-4. That is not floating-point
 *    noise, that is the threshold talking.
 *
 *    The exit therefore happens here on `worst === 0`, that is, "NO pair crosses
 *    the guard any more" — the only threshold that makes the exit invariant equal
 *    to the one the guard applies. Residuals then measured: 9.987e-7 at 167
 *    discs, 9.758e-7 at 34, 4.914e-7 on `shopData` — all under 1e-6, which is
 *    indeed the contract the tests assert.
 *
 *    What it costs: 338 → 538 passes at 167 discs, i.e. a full `layout()` from
 *    157 to 194 ms — **+24%**, and that is the only figure in this paragraph
 *    comparing two measurements taken here, on the same machine. The 143 ms and
 *    1,624 ms quoted at the top of `graph-layout.ts` are the probe's, on its own:
 *    the speedup factor remains an order of magnitude, but we do not recompute it
 *    by dividing measurements from different machines. The overhead buys an
 *    invariant that is no longer approximate.
 *
 * 2. The cap goes from 1000 to 5000 passes. At 167 discs it is not a cost — the
 *    early exit fires at 538, i.e. 11% of the cap, and the counter reaches it on
 *    NO input in the repo. But it was not a mere safety net either: measured on
 *    bigShop(9000) — 1,000 cards, 500 discs — convergence takes 1,722 passes, so
 *    a cap of 1000 cuts it short and leaves a residual of 2.925e-3, a hundred
 *    times above the threshold. In other words the "exit invariant" silently
 *    stopped being one beyond ~200 discs. With 5000 it holds (residual 9.988e-7),
 *    for 3.6 s instead of 2.4 s at that scale.
 *
 * WHAT A PASS COSTS, SINCE THE GRID. The number of passes is roughly unchanged —
 * that is a property of the geometry, not of the enumeration — but their price is
 * not: on the real audit at 1,300 discs, convergence takes 3,942 passes in 3.3 s
 * with the grid against 4,241 passes in 51.6 s with the double loop, and 4,003
 * passes since the per-cell pruning. The counting differences are of the same
 * order as the noise of the floating-point trajectories, which differ from one
 * version to the next anyway.
 *
 * THE CAP, HOWEVER, HAS BECOME REACHABLE, and that is a measured result, not a
 * hypothesis: the number of passes grows roughly linearly with the number of
 * discs (538 at 167, 1,722 at 500, 3,942 at 1,300), so the cap of 5000 saturates
 * somewhere above ~1,700 discs. Verified on the same audit without groups — one
 * disc per entity, i.e. 6,251 discs: the loop exits on the cap and leaves a
 * residual of **4.27 px**, seven orders of magnitude above the contract. At that
 * scale, `dist ≥ r₁ + r₂ + clusterGap` is therefore NO LONGER an exit invariant.
 * It is not the grid that broke it — the double loop returned the same verdict,
 * in 23 minutes instead of 21 s, which is precisely why nobody had measured it.
 * Raising the cap would suffice, at the price of a time that follows; it was not
 * settled here, the question asked being the enumeration and not the convergence
 * budget.
 *
 * A LEAD TRIED AND DROPPED, so it is not retried blindly: examining, from one
 * pass to the next, only the pairs one end of which was pushed by the previous
 * one (alternating incremental passes and full confirmation passes). The
 * reasoning is sound — a healthy pair only becomes violating again if one of its
 * ends moved — but the measurement empties it of interest: on a dense pile under
 * global relaxation, the "dirty" set never empties (~1,291 discs out of 1,300
 * during 90% of the real audit's passes), and the alternation then cost 1.6% MORE
 * candidates, for a gain capped at 12% on the homogeneous-radius regimes. Dropped:
 * the hot spot's lever was not there but in the per-cell reach, cf.
 * `collisionPass`.
 *
 * The loop below therefore only exits on `worst === 0`, and it is that pass — the
 * one that pushed nothing, hence whose index and pruning stayed exact from end to
 * end — that carries the entire invariant.
 */
function hardSeparation(discs: Disc[], clusterGap: number): void {
  const realR = discs.map((c) => c.r)
  for (let pass = 0; pass < MAX_HARD_PASSES; pass++) {
    const worst = collisionPass(discs, realR, clusterGap, 1e-6)
    // `worst` only takes violations that cross the guard, so it is either exactly
    // 0 (converged) or more than 1e-6. Comparing to 0 is exact here, not fragile:
    // it is not a floating-point sum we hope is null, it is a counter that was
    // never assigned.
    if (worst === 0) break
  }
}

/**
 * Level 2 in full: seeding, springs, simulation, final hard pass.
 *
 * `discs` is modified IN PLACE (`x`/`y` only). `pairs` is the list, in any order,
 * of the id pairs linked by a reference — one pair per reference, the duplicates
 * being what gives the spring its weight.
 *
 * On exit, `dist ≥ r_i + r_j + clusterGap` for every pair of discs is an
 * INVARIANT, not a hope of convergence: see `hardSeparation`.
 */
export function layoutDiscs(
  discs: Disc[],
  pairs: Iterable<readonly [string, string]>,
  o: DiscSimulationOptions,
): void {
  seedDiscs(discs, o.clusterGap)
  const springs = aggregateSprings(discs, pairs)
  const simR = virtualRadii(discs, o.jitter)
  simulate(discs, springs, simR, o.simIterations, o.clusterGap)
  hardSeparation(discs, o.clusterGap)
}
