# ADR-0012 — A second view, driven by references and aggregates

**Date**: 2026-08-31
**Status**: Accepted

## Context

The structure view lays out the containment tree and **ignores references**.
Measured on the extended demo dataset: of the 227 visible nodes, 3 structural
nodes carry 224 of the 226 edges and by themselves create a star topology that
collapses into a vertical line (1:21 bbox ratio, 2.5 % fill) — while the 112
`Order → Customer` edges, the ones that carry meaning, take part in nothing.

## Decision

Add a **second, coexisting view**, leaving the structure view untouched and still
the default:

- **entities** are the vertices (structural nodes disappear);
- **references** are the edges, and they are drawn **solid** here — they are the
  primary relation, not decoration laid over containment;
- entities are grouped into **aggregates** declared in the config (the roots) and
  circled by an envelope;
- layout determinism is a **requirement**, not a budget.

`setView` / `currentView` expose the toggle; selection is carried over to the
enclosing entity when switching.

## Alternatives considered

- **Fixing the stacking inside ELK** (`mrtree`, per-parent `rectpacking`) — the
  cheapest follow-up recommended by the `2026-08-31-organic-layout` spike. Not
  retained: it improves the tree's shape without ever letting references
  participate, and references are the subject.
- **Replacing ELK with an organic engine in the existing view** — rejected: it
  trades a readability problem for an orientation problem (see ADR-0005).

## Consequences

- Two views to keep in sync, hence a state machine that had to be extracted two
  weeks later (ADR-0024).
- **Aggregate collapsing was implemented, then removed.** The graph view hides
  nothing: all entities are permanently visible, no card carries a chevron, and a
  header click selects. Gone with it: `AggregateCollapseState`, the graph engine's
  `layoutAfterExpand`/`Collapse`, and `fixedNodeConstraint` pinning.
- Multiple aggregate membership, planned in the design, was revised into a strict
  partition after measurement (ADR-0015).
- The view's layout engine was replaced once (ADR-0013 → ADR-0017); the view itself
  did not move.
