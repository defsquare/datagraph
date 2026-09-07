# ADR-0013 — Organic layout engine (cytoscape + fcose) for the graph view

**Date**: 2026-08-31
**Status**: Superseded by [ADR-0017](./0017-two-level-layout-engine.md)

## Context

The graph view (ADR-0012) needs an engine that places entities linked by
references, with no hierarchy. The `spikes/2026-08-31-organic-layout.md` spike had
measured a dramatic gain of fcose over ELK for this graph shape: bbox ratio from
1:21 to ~1:1.5, useful density ×19.

## Decision

`createGraphLayoutEngine`: fcose (cytoscape + cytoscape-fcose) places visible
entities by reference, seeded from a **deterministic hash of the node id**
(`randomize: false`), followed by two repair passes:

- `separateOverlaps` — relaxation pushing colliding cards apart until
  non-overlap with a margin (capped iteration count);
- `separateClusters` — relaxation at aggregate granularity, every member taking
  its block's translation **rigidly**.

The engine lives behind a second entry point `./graph-layout` (ADR-0014), since
cytoscape weighs ~178 kB gzipped.

## Alternatives considered

- **Virtual aggregate centres** — implemented, then **removed** after measurement:
  an invisible node linked to the members pushed co-members 2.2–2.4× further apart
  instead of gathering them, and occupied the very space it was meant to close.
  Aggregate membership **is** reachability along reference edges: the centre only
  duplicated an edge already present.
- **Shortening `idealEdgeLength` to tighten aggregates** — mechanically wrong:
  fcose calibrates its repulsion scale on the **mean** ideal edge length, so
  shortening a subset of edges contracts the whole layout, including disjoint
  components.

## Consequences

- Three passes repairing one another, and a cost driven by the number of **cards**:
  ~4.2 s for `setView("graph")` on 350 entities, 2.8 % fill. That ceiling is what
  motivated the two-level spike.
- Two durable lessons outlive the engine's removal: an early exit compared against
  zero **never fires** (a residual penetration of 1.84e-11 px passes the `> 0`
  test), and edge length and elasticity are not interchangeable.
- The `clusterGap` sweep done here fixed the 160 px value, which the current engine
  inherits without re-sweeping it.
- The engine, its two passes, its tests and the `cytoscape` / `cytoscape-fcose`
  dependencies were **removed from the repository** once the switch was made: the
  lazy chunk went from 180.28 to 1.77 kB gzipped.
