# ADR-0009 — `opGen` + `destroyed` guard every async mutating operation

**Date**: 2026-08-31
**Status**: Accepted

## Context

Two blocking defects came out of the review of the expand/collapse interactions:

1. a `rebuild()` mid-transition destroyed the `Container`s a running animation
   tick still referenced, and since the throw preceded the tick's own
   `ticker.remove()`, it crashed every frame forever;
2. `doExpand` and `focusOn` had no re-entrancy guard around their awaited
   `layoutAfterExpand` calls, so a synchronous `doCollapse` racing during that
   await could be silently reverted by the stale expand result.

## Decision

An **operation generation counter** (`opGen`) owned by the orchestrator: every
mutating operation bumps it on entry and re-checks it **after every `await`**. A
`destroyed` flag completes the mechanism: after `destroy()`, `fit`, `focus`,
`select`, `search`, `nextMatch`, `prevMatch`, `expand`, `collapse` and `on` are
safe no-ops, and `destroy()` itself is idempotent.

The writing rule learned the hard way: **never mutate before the `await`** without
planning the rollback. `collapseState` must not get ahead of `layoutResult`, or it
declares visible nodes that have no position — they are never drawn, and the
half-merged layout corrupts the next operation by serving as its `prev`.

## Alternatives considered

- **A serialised operation queue** — not retained: the counter is enough, and it
  lets a user gesture cancel a computation that has become useless, which is the
  wanted behaviour.

## Consequences

- The `focus` cascade mutates `CollapseState` **one ancestor at a time**, in
  lockstep with the layout actually applied for it, and reverts only the single
  not-yet-applied step.
- `opGen` is **shared across both views**: a click in the graph view can
  short-circuit an in-flight structure-view `expand()`, and the damage would only
  show on the way back. That sharing is what made `doExpand`'s rollback necessary.
- The `compute` / `publish` split of the graph-view controller (ADR-0024) exists
  precisely so `opGen` stays with the orchestrator: a controller publishing across
  its own `await`s would break the guard.
- The rule is written into the repository's `CLAUDE.md`: every async mutating
  operation is guarded by `opGen` + `destroyed`.
