// INTRA-AGGREGATE PACKING — level 1 of the graph view engine, extracted from
// `graph-layout.ts` as-is.
//
// It is a CLOSED subsystem, and that is the reason for the split: it knows
// neither the `Graph`, nor the aggregates, nor level 2's options. It takes only
// card sizes, an already sorted `childrenOf` adjacency and a `gap`, and returns
// local `Rect`s. Everything it guarantees — non-overlap with margin `gap`, by
// construction — is proved without knowing anything about the caller; the proofs
// sit above `packRadial` and `packCluster`.
//
// This module is imported ONLY by `graph-layout.ts`. It appears neither in the
// `index.ts` barrel nor in the package entry points: it lands in the lazy
// `./graph-layout` chunk through resolution, and the two bundle purity tests
// guard that invariant.
import type { NodeId } from "./model.js"
import type { Rect } from "./structure-layout.js"

/**
 * Radius of a card's bounding disc: the half-diagonal.
 *
 * This is the piece that makes the ring geometry tractable. A card is an
 * axis-aligned rectangle placed at an arbitrary angle around a center; testing
 * whether two rectangles arranged that way overlap requires reasoning about four
 * projections and two angular positions. Replacing them with their bounding
 * discs turns the condition into a single distance inequality, independent of
 * the angle: two cards whose discs are at least `gap` apart are themselves at
 * least `gap` apart.
 *
 * It is a SUFFICIENT condition, not a necessary one — hence conservative. What
 * it costs is bounded and small on these cards: the disc overshoots the
 * rectangle by `(diagonal − width) / 2`, i.e. 7.1 px for a 340×100 card and
 * 4.6 px for a 140×49 one. An exact test would win those few pixels at the price
 * of a guarantee no longer writable in one line.
 */
function discRadiusOf(size: { width: number; height: number }): number {
  return Math.hypot(size.width, size.height) / 2
}

/**
 * Reference distance of each member to the root, by local BFS over the
 * INTRA-aggregate references.
 *
 * The traversal walks from the TARGET back to the SOURCE, like
 * `buildAggregates`: an order points at its customer, so it is at distance 1
 * from it. That is what makes the ring distance coincide with the membership
 * distance that formed the cluster. Since the adjacency lists are sorted, the
 * queue is deterministic and ties are broken by id.
 *
 * The UNREACHED members do not appear in `dist`. They exist: membership is
 * computed over the whole graph, layout over the VISIBLE entities, so a hidden
 * intermediate link detaches everything that hung below it. They are returned
 * separately because the two consumers treat them differently — radial placement
 * gives them an extra ring, the selection CRITERION ignores them.
 */
function referenceDepths(
  memberIds: NodeId[],
  childrenOf: Map<NodeId, NodeId[]>,
): { dist: Map<NodeId, number>; parent: Map<NodeId, NodeId>; maxDist: number; orphans: NodeId[] } {
  const rootId = memberIds[0]!
  const memberSet = new Set(memberIds)
  const dist = new Map<NodeId, number>([[rootId, 0]])
  const parent = new Map<NodeId, NodeId>()
  const queue: NodeId[] = [rootId]
  let maxDist = 0

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const next = dist.get(current)! + 1
    for (const child of childrenOf.get(current) ?? []) {
      if (!memberSet.has(child) || dist.has(child)) continue
      dist.set(child, next)
      parent.set(child, current)
      queue.push(child)
      if (next > maxDist) maxDist = next
    }
  }

  const orphans: NodeId[] = []
  for (const id of memberIds) if (!dist.has(id)) orphans.push(id)
  return { dist, parent, maxDist, orphans }
}

/**
 * SHELF packing: rows filled left to right up to a target width of √(total
 * area), each row centered.
 *
 * Trivial, deterministic, dense — and non-overlapping by construction, the `gap`
 * margin being laid between two row neighbors as between two rows. The rows are
 * CENTERED rather than left-aligned: a centered block yields a tighter enclosing
 * circle, hence a smaller disc to push apart at level 2.
 *
 * The √(area) target width aims at a roughly square block; `maxW` bounds it from
 * below so that a card wider than the target never goes off alone on an
 * overflowing row.
 *
 * It is the DENSER of the two modes, and that is its only reason to be here: it
 * says nothing about connectivity, and puts the root at the head of the first
 * row, that is, in a corner. See `packCluster` for when it wins.
 */
function packShelf(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
): Map<NodeId, Rect> {
  let totalArea = 0
  let maxW = 0
  for (const id of memberIds) {
    const s = sizes.get(id)!
    totalArea += (s.width + gap) * (s.height + gap)
    if (s.width > maxW) maxW = s.width
  }
  const targetW = Math.max(maxW, Math.sqrt(totalArea))

  const rows: { ids: NodeId[]; width: number; height: number }[] = []
  let current: { ids: NodeId[]; width: number; height: number } = { ids: [], width: 0, height: 0 }
  for (const id of memberIds) {
    const s = sizes.get(id)!
    const w = s.width + (current.ids.length > 0 ? gap : 0)
    if (current.ids.length > 0 && current.width + w > targetW) {
      rows.push(current)
      current = { ids: [], width: 0, height: 0 }
    }
    current.ids.push(id)
    current.width += current.ids.length > 1 ? s.width + gap : s.width
    current.height = Math.max(current.height, s.height)
  }
  if (current.ids.length > 0) rows.push(current)

  const blockW = Math.max(...rows.map((r) => r.width))
  const local = new Map<NodeId, Rect>()
  let y = 0
  for (const row of rows) {
    let x = (blockW - row.width) / 2
    for (const id of row.ids) {
      const s = sizes.get(id)!
      local.set(id, { x, y, width: s.width, height: s.height })
      x += s.width + gap
    }
    y += row.height + gap
  }
  return local
}

/**
 * RADIAL placement: the root at the center, the other members on concentric
 * rings, one ring per reference distance to the root.
 *
 * What it fixes, measured on `deepAggregate()` — 41 cards, four levels deep —
 * against shelf packing: the root came out **40th out of 41** by proximity to
 * the center of its own disc, 597.7 px from that center, and an intra-aggregate
 * reference measured 591.4 px on average. Sorting by id put the root at the head
 * of the first row, that is, in a CORNER of the block — the point farthest from
 * the center of the enclosing circle. In radial: root 1st, 16.4 px from the
 * center, average reference 363.0 px and max 976.3 → 488.1 px.
 *
 * ── THE GUARANTEE ──────────────────────────────────────────────────────────
 *
 * Non-overlap with margin `gap`, by construction, from two independent
 * conditions. We reason about the bounding discs (`discRadiusOf`), hence about
 * center-to-center distances.
 *
 * **1. Between two cards of the same ring.** A card with disc ρ placed at
 * distance R from the center is allotted the angular width
 *
 *     α = 2·asin((ρ + gap/2) / R)
 *
 * which is exactly the angle under which a disc of radius `ρ + gap/2` centered
 * at distance R is seen from the center. Two consecutive cards i and j are
 * placed at an angular gap of at least `α_i/2 + α_j/2`. Their center-to-center
 * distance is the chord `2R·sin(Δθ/2)`, and
 *
 *     2R·sin((x + y)/2)  ≥  R·sin x + R·sin y     with x = asin(a/R), y = asin(b/R)
 *
 * because `sin x + sin y = 2·sin((x+y)/2)·cos((x−y)/2)` and the cosine is at most
 * 1. The right-hand side equals `a + b = ρ_i + ρ_j + gap`. The chord is
 * therefore always at least the sum of the radii plus the margin. It is this
 * trigonometric identity, and nothing else, that carries the intra-ring
 * guarantee — it holds for every pair, not only for neighbors, since the angular
 * gap only grows between non-neighbors.
 *
 * The wrap-around condition is therefore `Σα_i ≤ 2π`: it is what guarantees that
 * the LAST card and the FIRST one, which meet on the other side, are far enough
 * apart too.
 *
 * **2. Between two cards of different rings.** A ring's radius is set to
 * `R_k = R_{k−1} + ρmax_{k−1} + ρmax_k + gap`. Two cards of different rings are
 * therefore at least `R_k − R_{k−1}` apart (the worst case is radial alignment),
 * i.e. at least `ρ_i + ρ_j + gap`. Non-consecutive rings are so a fortiori,
 * since R increases.
 *
 * ── SPLITTING A RING ───────────────────────────────────────────────────────
 *
 * A ring of N cards never "overflows" in the sense of failing: we could always
 * grow R until `Σα ≤ 2π`. But that R grows linearly in N, whereas splitting it
 * into two half-rings grows two radii by N/2 each — and two rings separated by
 * one card height cost far less than twice the radius. So the ring is filled
 * GREEDILY at the minimal radius condition 2 allows, and whatever does not fit
 * goes onto a following ring, at the SAME logical distance. Sub-rings behave in
 * every respect like rings for condition 2, so the guarantee crosses the split
 * unchanged.
 *
 * The filling always terminates: `α ≤ π` for every card (the `asin` is bounded
 * by π/2), so at least one card fits on each sub-ring.
 *
 * ── ORDER ──────────────────────────────────────────────────────────────────
 *
 * Inside a ring, cards are ordered by PARENT ANGLE then by id: a child lands
 * near its parent, which is what shortens the reference chains. The ORPHANS (see
 * `referenceDepths`) form an extra ring beyond the last one; they have no
 * parent, fall back on angle 0, and their id decides.
 */
function packRadial(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  depths: ReturnType<typeof referenceDepths>,
): Map<NodeId, Rect> {
  const local = new Map<NodeId, Rect>()
  const rootId = memberIds[0]!

  const rectFor = (id: NodeId, cx: number, cy: number) => {
    const s = sizes.get(id)!
    local.set(id, { x: cx - s.width / 2, y: cy - s.height / 2, width: s.width, height: s.height })
  }

  rectFor(rootId, 0, 0)
  if (memberIds.length === 1) return local

  const { dist, parent, orphans } = depths
  let maxDist = depths.maxDist
  if (orphans.length > 0) {
    maxDist++
    for (const id of orphans) dist.set(id, maxDist)
  }

  const rings: NodeId[][] = Array.from({ length: maxDist + 1 }, () => [])
  for (const id of memberIds) {
    if (id !== rootId) rings[dist.get(id)!]!.push(id)
  }

  const angleOf = new Map<NodeId, number>([[rootId, 0]])
  let prevR = 0
  let prevMaxRho = discRadiusOf(sizes.get(rootId)!)

  for (let k = 1; k <= maxDist; k++) {
    const pending = rings[k]!.slice().sort((a, b) => {
      const pa = angleOf.get(parent.get(a) ?? rootId) ?? 0
      const pb = angleOf.get(parent.get(b) ?? rootId) ?? 0
      return pa !== pb ? pa - pb : a < b ? -1 : 1
    })

    let from = 0
    while (from < pending.length) {
      // ρmax is taken over everything LEFT to place, not over what will fit on
      // this sub-ring: you need R to know what fits, and ρmax to know R. Taking
      // the max of the remainder is the conservative choice, hence a safe one.
      let maxRho = 0
      for (let i = from; i < pending.length; i++) {
        maxRho = Math.max(maxRho, discRadiusOf(sizes.get(pending[i]!)!))
      }
      const R = prevR + prevMaxRho + maxRho + gap

      const widths: number[] = []
      let sum = 0
      let to = from
      while (to < pending.length) {
        const rho = discRadiusOf(sizes.get(pending[to]!)!)
        const a = 2 * Math.asin(Math.min(1, (rho + gap / 2) / R))
        if (to > from && sum + a > 2 * Math.PI) break
        widths.push(a)
        sum += a
        to++
      }

      // The leftover slack is spread evenly across the N intervals (the N−1
      // internal ones plus the wrap-around): the cards spread out instead of
      // bunching up on one arc and leaving a hole. This only INCREASES the gaps,
      // so the guarantee is intact.
      const n = to - from
      const slack = (2 * Math.PI - sum) / n

      // Rigid rotation of the whole sub-ring so its first card lands at its
      // parent's angle. Rigid, hence with no effect on the guarantee.
      const firstParent = parent.get(pending[from]!)
      const offset = (firstParent !== undefined ? (angleOf.get(firstParent) ?? 0) : 0) - widths[0]! / 2

      let theta = offset
      let placedMaxRho = 0
      for (let i = from; i < to; i++) {
        const id = pending[i]!
        const a = widths[i - from]!
        theta += i === from ? a / 2 : a / 2 + slack
        angleOf.set(id, theta)
        rectFor(id, R * Math.cos(theta), R * Math.sin(theta))
        theta += a / 2
        placedMaxRho = Math.max(placedMaxRho, discRadiusOf(sizes.get(id)!))
      }

      prevR = R
      prevMaxRho = placedMaxRho
      from = to
    }
  }

  return local
}

/**
 * Switch between the two placement modes, per cluster.
 *
 * ── THE CRITERION: DEPTH, NOT CARDINALITY ──────────────────────────────────
 *
 * Radial if and only if **at least one member is at reference distance ≥ 2 from
 * the root**. Shelves otherwise.
 *
 * What radial does is ENCODE REFERENCE DEPTH AS DISTANCE TO THE CENTER. At depth
 * ≤ 1 there is nothing to encode: every non-root is at the same distance, they
 * all end up on a single ring, and the structure the eye reads says nothing more
 * than "these cards belong to this root" — which the envelope already said.
 * Radial brings only its cost there.
 *
 * And that cost is measured. Radial is less dense everywhere, because a ring
 * pays one card diameter of radius even when it carries a single card. Disc
 * radius, shelves → radial: 2 cards 162 → 209 px (×1.29), 3 cards 225 → 335
 * (×1.49), 5 cards on one ring 258 → 371 (×1.44). Carried over to the real
 * datasets, with radial everywhere: fill rate 12.3 → 7.8% on `bigShop(3000)` and
 * 15.1 → 10.9% on the demo's — for zero gain, their aggregates all being flat.
 *
 * The criterion mentions NO size, and that is deliberate. A cardinality
 * threshold would have been fitted to the fixtures: the one that cancelled the
 * cost on the repo's datasets was exactly their maximum aggregate size (5),
 * which is not a reason but a coincidence we would have carved in. The depth
 * criterion, on the other hand, is fitted to radial's REASON TO EXIST, and
 * decides without knowing anything about the number of cards.
 *
 * ── ORPHANS ARE EXCLUDED FROM THE CRITERION ────────────────────────────────
 *
 * A member unreached by the local BFS (hidden intermediate link, see
 * `referenceDepths`) receives in radial a SYNTHETIC ring beyond the last one.
 * That ring must not trigger radial: it reflects no reference depth, only an
 * absence of information. Without that exclusion, a perfectly flat aggregate
 * with one detached card would flip to radial and pay its price for nothing. The
 * criterion therefore reads `depths.dist`, which holds only the actually reached
 * members.
 *
 * ── WHAT THE TWO MODES SHARE ───────────────────────────────────────────────
 *
 * The same signature, and the same guarantee: non-overlap with margin `gap` by
 * construction. Each obtains it its own way — shelves through rows and columns
 * separated by `gap`, radial through the chord geometry proved above
 * `packRadial` — and the rest of the engine need not know which one answered.
 */
export function packCluster(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  /** Cluster members referencing the key — the reverse adjacency, sorted. */
  childrenOf: Map<NodeId, NodeId[]>,
): Map<NodeId, Rect> {
  if (memberIds.length === 1) {
    // A single card: both modes give the same result up to recentering, and the
    // BFS would have nothing to traverse.
    const s = sizes.get(memberIds[0]!)!
    return new Map([[memberIds[0]!, { x: 0, y: 0, width: s.width, height: s.height }]])
  }

  const depths = referenceDepths(memberIds, childrenOf)
  let deep = false
  for (const d of depths.dist.values()) {
    if (d >= 2) {
      deep = true
      break
    }
  }
  return deep ? packRadial(memberIds, sizes, gap, depths) : packShelf(memberIds, sizes, gap)
}

