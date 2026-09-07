# ADR-0015 — Aggregate membership is a strict partition

**Date**: 2026-09-01
**Status**: Accepted

## Context

The graph view's initial design allowed **multiple membership**: an entity at
equal minimal distance from two roots belonged to both, and envelopes overlapped.
It was presented as desirable — "an order belongs both to its customer's aggregate
and to its product's".

Measurement said otherwise. On the demo dataset (350 entities, `groups:
["Customer", "Product"]`), every `Order` references its `Customer` **and** its
`Product` one hop away, so it belongs to both; the separation pass's union-find
then merges transitively down to a single block of 342 cards out of 350 (97.7 %),
and the pass has nothing left to separate.

## Decision

Membership becomes a **strict partition**: exactly one aggregate per entity that
reaches a root. Ties on minimal distance are broken by **declaration order** in
`groups`; within the same type, the smallest root id wins.

The reverse multi-source BFS now propagates a single winner per predecessor. This
is exact: the set of minimal roots of an entity is the union of those of its
minimal-distance successors, and the minimum of a union is the minimum of the
minima — so the result does not depend on discovery order.

## Alternatives considered

- **Keeping overlap and exempting pairs of aggregates sharing a member** — tried,
  and wrong: the exemption only prevents A and B from pushing each other, it says
  nothing about a third cluster C pushing A. Their translations diverge and the
  shared member detaches from its co-members.
- **Merging shared aggregates into rigid super-clusters** (union-find before
  relaxation) — correct, and implemented, but it degenerates: with a shared
  catalogue everything collapses into one block.

## Consequences

- Measured on the demo dataset: super-clusters 9 → 116, largest block 342/350 →
  5/350, overlapping envelope pairs 3,520 → 0. The price is a bbox ~11× larger in
  area, which `fit()` absorbs.
- **This rule is what makes the two-level decomposition correct** (ADR-0017):
  intra-aggregate packing is only valid because every entity is in exactly one
  block.
- The order of keys in the config's `ids` becomes semantically load-bearing: it
  arbitrates ties. It is documented, and it also determines `entityPalette` colour
  assignment.
- The separation pass's union-find was **kept and documented as inactive** while
  the rule holds: it is what guarantees a card receives a single translation, and
  that guarantee belongs to the pass, not to a membership rule which is a product
  choice and could be relaxed.
