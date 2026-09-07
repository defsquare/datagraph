# ADR-0017 — An in-repo two-level layout engine

**Date**: 2026-09-01
**Status**: Accepted

## Context

The fcose pipeline (ADR-0013) had plateaued: 4.2 s for `setView("graph")` on 350
entities, 2.8 % fill, and three passes repairing one another. Cost tracked the
number of **cards**, and fcose scattered an aggregate's members, so the enclosing
circle inflated, so the separation pass pushed apart large, nearly empty circles —
cards became confetti inside their own envelopes.

Membership having become a strict partition (ADR-0015), the problem decomposes.

## Decision

An in-repo two-level engine, spiked
(`spikes/2026-09-01-two-level-layout.md`) then ported into `packages/core` behind
the existing `GraphLayoutEngine` interface:

1. **Intra-aggregate** — each aggregate is packed independently. Non-overlap with
   a `cardGap` margin holds **by construction**, not by relaxation. Two modes,
   chosen per cluster: **radial** (root at the centre, one ring per reference
   distance) if at least one member is at distance ≥ 2 from the root, **shelf
   packing** otherwise.
2. **Inter-aggregate** — each aggregate becomes a **rigid disc** (the circle of
   ADR-0016), inter-aggregate references become weighted springs. A small
   simulation (springs + gravity + collision) places the discs, then a final hard
   pass guarantees `dist ≥ r₁ + r₂ + clusterGap` as its **exit invariant**.

No source of randomness: no `Math.random`, no `Date.now`. The engine's only noise
is a **deterministic jitter** (FNV-1a hash of the id) that virtually inflates discs
**during the simulation only**, to break the hexagonal packing that equal-radius
discs converge to.

## Alternatives considered

- **Keeping and tuning fcose** — rejected by measurement: ×11 to ×65 faster, ×2 to
  ×5.4 denser, inter-aggregate references 4.5× shorter, same guarantees, in favour
  of the two-level engine.
- **A size threshold to choose radial vs shelves** — rejected: the threshold that
  cancelled the cost on the repository's datasets was exactly their maximum
  aggregate size, which is not a reason but a coincidence that would have been
  carved in. The criterion reads **depth** instead, which is what radial is for.
- **A parameterised radial/shelf hybrid** — quantified in the refinements spike,
  not retained for the same reason.

## Consequences

- `setView("graph")` goes from 4,310–4,484 ms to 220–252 ms on the extended
  dataset — ×19, measured in Chromium.
- Several guarantees move from "capped relaxation" to "by construction", and
  determinism from "to the pixel" to "to the bit".
- **API change with no compatibility layer (0.x)**:
  `DataGraphOptions.graphLayoutOptions` now carries `TwoLevelLayoutOptions`;
  `separationMargin` and `separationIterations` disappear with the pass they tuned.
- The old engine, its two passes and the cytoscape dependencies were removed
  (ADR-0013), and the remaining engine was later split into three modules
  (`graph-pack.ts`, `disc-simulation.ts`, `graph-layout.ts`) with bit-identical
  behaviour, verified by SHA-256 fingerprints over 11 input sets.
- The four level-2 constants (spring 0.15, weight cap min(1, w/2), gravity 0.02,
  400 iterations) were swept afterwards: the sweep **confirms** them, and
  incidentally shows they interact with the jitter — too strong a spring
  recompresses the packing and undoes the noise.
