# ADR-0024 — The two-view machine: `ViewPolicy` for branches, `graph-view.ts` for state

**Date**: 2026-09-06
**Status**: Accepted

## Context

`create.ts` was 2,166 lines and tested `view === "graph"` in **18 places**. Reading
them again sorts them into three very unequal families: ~10 asymmetric one-line
branches (edge mode, chevrons, folding, token hover); ~350 lines of **graph-view
state** and its lifecycle (aggregate index, layout, engine, dynamic loading,
derived reads); and 3 sites of **cross-view orchestration**, coordinating state
that traverses both views (`opGen`, `selection`, `collapseState`).

## Decision

Three moves, no polymorphism:

- **M1 — `ViewPolicy`**: the pure branches become **data**, an object derived from
  `view` alone (`edgeMode`, `chevrons`, `foldable`, `tokenHover`,
  `expandedArrays`), computed in one block. `expanded` is routed by `foldable`
  rather than `chevrons`: it is the existence of folding that decides whether to
  read `collapseState`, not the painted arrow.
- **M2 — `graph-view.ts`**: a controller with injected dependencies and **no Pixi
  import**, the single owner of graph-view state. Its cycle is
  `compute` / `tryCompute` / `publish` / `invalidate` — **`compute` never
  publishes**, so that `opGen` and the generation guards stay with the orchestrator
  (ADR-0009), and the three fallback policies stay at the call sites: the controller
  returns `null`, it does not decide.
- **M3 — the invariants become tests**: atomic publication, "`compute` never
  publishes" (interleaved race included), and `hullPadding` only being correct
  after the first load.

## Alternatives considered

- **A `ViewStrategy` interface with two implementations** — **explicitly
  rejected**. The branches are not symmetric: almost every conditional is either
  "the graph view adds something" or "the structure view adds something". The
  interface would have had ~15 methods, half of them no-ops in one implementation —
  a mirror of the conditionals with one more indirection, not touching the real
  problem, which is **state synchronisation**.

## Consequences

- `create.ts` drops from 2,228 to 2,073 lines, and the remaining
  `view === "graph"` sites read **no graph-view state at all**: policy and
  orchestration only.
- 24 controller tests run **without Pixi or a canvas**, including the dimming and
  hover rules previously reachable only through e2e, and `tryCompute` failure
  through a realistic hook rather than a module mock.
- The bundle-purity test had to **follow** the dynamic `import()` into
  `graph-view.ts`, with a new assertion requiring that module to be the single
  loading path (ADR-0014). It was the only test modification of the effort, and it
  was planned by the spec.
- A future third view mode would be written inside `viewPolicy()`; the graph view's
  semantic zoom (ADR-0026) already went in there, and that is what guarantees by
  construction that cards and discs never coexist.
