# ADR-0026 — Graph view at scale: spatial grid, culling on creation, semantic zoom, worker

**Date**: 2026-09-07
**Status**: Accepted

## Context

A real architecture audit — 6,251 entities, ~1,300 aggregates — took the graph view
out of its validated regime. Three distinct costs, measured:

- the level-2 collision pass was an all-pairs double loop, called up to 400 times
  per simulation and thousands of times by the hard pass: 55 s of layout with
  groups, 23.5 minutes without;
- `rebuild()` destroyed and recreated **every** card at each LOD crossing (worst
  frame: 6.5 s), and `setView` rebuilt at the outgoing scale before the fit threw
  it away;
- layout being synchronous, `setView("graph")` froze the main thread for ~4.4 s.

## Decision

Four changes, each measured on the real audit driven in Chromium:

1. **A spatial grid** (uniform, CSR, rebuilt each pass) with **per-cell pruning** —
   the cell's max radius replaces the global max in the per-ring threshold. The
   exit invariant is still proved: a full pass with no push moved nothing, so its
   index was valid from start to finish. Result: 55 s → 4.5 s, invariant verified by
   brute force (0 violations over 844,350 pairs).
2. **Fit before building**: `doFit()` precedes `rebuild()` at all three sites, and
   `refreshCards()` becomes the single arbiter between rebuilding (LOD changed) and
   updating the window.
3. **Culling on creation**: `syncCards()` only materialises the cards of the
   paint / prefetch / reclaim windows derived from the viewport, under a 4 ms
   per-frame budget, with hysteresis, the selected card pinned, and an `ensureCard`
   for paths that address a card outside the window.
4. **Semantic zoom**: at LOD 2 the graph view draws **aggregates** as named discs
   linked by weighted aggregated references, computed once per publication in the
   controller. Cards only return on zoom, and the two regimes never coexist —
   guaranteed **by construction** through `ViewPolicy` (ADR-0024).

Finally, layout moves **into a worker**: the engine is split into
`extractGraphLayoutInput` (main thread, flat serialisable input) and
`layoutFromInput` (pure, worker-executable), their composition keeping the existing
signature and bit-exact identity, locked by SHA-256 fingerprints captured before
the split.

## Alternatives considered

- **An incremental dirty-set collision pass** — tried and **removed**: on a dense
  pile under global relaxation, the dirty set stays 99 % full.
- **Barnes-Hut for the springs** — noted in the spike as the next step if the
  cardinality becomes real; unnecessary, collision was the dominant cost.
- **Keeping layout synchronous** — rejected: no tuning recovers 4.4 s of genuine
  work, it had to leave the main thread.

## Consequences

- Measured after: the toggle's rendering share ~4.5 s → ~105 ms; worst zoom frame
  6.5 s → ~1.4 s with pixel-identical output; idle frame at global fit 503 → 203 ms;
  longest long task during `setView` ~4,450 ms → 62 ms on the layout side (356 ms
  for the final application), and the structure view stays interactive while
  waiting — 311 frames rendered against 5.
- The worker follows the same discipline as `elkWorkerUrl`: responses tagged by
  generation and dropped when stale, **permanent in-process fallback on first
  failure**, a single worker terminated on `destroy`. `create.ts` stays the only
  place `new Worker` exists.
- The worker URL must resolve in **four modes**: `vite dev` by alias to the source,
  `vite build` through the package's `exports` (a standalone tsup entry), the Tauri
  shell under `worker-src 'self'` (ADR-0020), and vitest with no worker.
