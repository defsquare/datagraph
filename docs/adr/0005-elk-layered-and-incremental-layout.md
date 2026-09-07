# ADR-0005 — ELK `layered` and incremental layout for the structure view

**Date**: 2026-08-30
**Status**: Accepted

## Context

The structure view lays out the containment tree. Two requirements pull against
each other: a 10,000-node document must never enter a layout engine in one go, and
expanding a node must stay visually continuous — the card you were looking at must
not leave the screen.

## Decision

elkjs, `layered` algorithm, left → right, orchestrated by the core behind a
`StructureLayoutEngine` interface:

- **collapsed by default** at entity boundaries, so ELK only ever sees what is
  visible;
- **incremental layout** on expansion: the subtree is laid out in isolation, then
  siblings below it are shifted by a recorded delta, undone on collapse. Never a
  global re-layout;
- **computed in a Web Worker** (`elkWorkerUrl`), with a permanent in-process
  fallback on first failure.

## Alternatives considered

- **Global re-layout on every expansion** — rejected on cost: ELK layout grows
  ~n^1.7, 16.5 s for 16,671 cards.
- **An organic engine (fcose) for this view** — spiked
  (`spikes/2026-08-31-organic-layout.md`) and rejected: median drift on expansion
  is 1,084 px there against 0 px for incremental ELK, and two consecutive
  `layout()` calls on the same data differ by 1,589 px median. The very real
  readability gain was recovered another way — a second view (ADR-0012).

## Consequences

- **`layered` stacks a wide sibling set into a single column.** Measured: 1:21
  bbox ratio and 2.5 % fill on the extended dataset. That flaw, not fixable inside
  this engine, is what motivated the graph view.
- Expansion deltas must be composed and undone correctly, each keyed to its own
  threshold: two fixes were needed before collapsing an ancestor and repeated
  expansions behaved.
- Delta undo is **approximate** by construction; that is exactly what `tidy()`
  repairs (ADR-0025). A global `layout()` clears recorded deltas, otherwise they
  describe `y` coordinates that no longer exist.
- Collapse (`layoutAfterCollapse`) is **synchronous** by contract: no `await`
  separates the mutation from the publication, which spares it the rollback
  `doExpand` needs (ADR-0009).
