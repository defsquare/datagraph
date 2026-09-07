# ADR-0016 — An aggregate envelope is a minimal enclosing circle

**Date**: 2026-09-01
**Status**: Accepted

## Context

Aggregates were circled by a **padded convex hull** (`paddedHull`) drawn by the
renderer, while the separation pass relaxed **axis-aligned bounding boxes**. The
corridor being measured was therefore not the corridor being looked at: two
shapes, one spaced, the other drawn.

## Decision

A single shape: the **minimal enclosing circle** of the cards' corners (Welzl's
algorithm in iterative form, `hull.ts`), its radius grown by `hullPadding`. The
separation pass pushes the **circles themselves**, along the line of centres, up
to `r₁ + r₂ + clusterGap` — at the very margin that is drawn.

The input is **deliberately not shuffled**: Welzl's expected linear bound relies on
a random permutation, but this view requires pixel-level determinism and the
clusters are tiny. A fixed order is the right trade at this scale, and that is
written in the code.

## Alternatives considered

- **Keeping the convex hull and relaxing polygons** — more expensive, and a polygon
  offers no single push axis: the circle gives a line of centres where the box
  forced a choice between two axial penetrations.
- **Shuffling Welzl's input** for the linear bound — rejected by the determinism
  requirement; the overhead is measured (0.0187 → 0.0352 ms at 41 cards) and
  negligible against the level-2 simulation.

## Consequences

- One shape, spaced and drawn: `fitInternal` extends its bounds over `cx ± r`,
  `cy ± r`, and `drawClusters` takes `{ circle, color }`.
- The circle **survived the engine replacement**: `hull.ts` did not move when the
  view switched to the two-level engine (ADR-0017), which instead builds its discs
  from it.
- Intra-aggregate rigidity is no longer bit-exact but exact to the rounding of one
  translation, the push no longer being axial. Maximum deviation measured across
  the repository's fixtures: 2.84e-14 px, against an asserted tolerance of 1e-9.
  There is **no** class of inputs where exactness is guaranteed — a fixture shifted
  by a few tenths of a pixel shows it.
