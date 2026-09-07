# ADR-0007 — Imperfect data degrades the view, it never breaks it

**Date**: 2026-08-30
**Status**: Accepted

## Context

A viewer of real data meets incomplete documents: foreign keys that do not
resolve, entities without an `id`, duplicate ids, reference cycles, a scalar root.
Failing the render on every anomaly would make the tool useless exactly where it
helps most — diagnosing an incomplete aggregate.

## Decision

Two error regimes, told apart by who is responsible:

- **Invalid config** = integrator's bug → **fail fast and clearly**.
  `createDataGraph` and `setData` validate the config **synchronously**, before
  any rendering, rather than letting the `ready` promise reject later.
- **Imperfect data** = **local** degradation. An unresolved reference becomes a
  dangling reference, shown as such; an entity without an `id` is treated as an
  ordinary object; a `null` or scalar root yields a single object node with a
  `$value` row instead of a raw `TypeError`. Everything is collected in
  `graph.diagnostics()` — a structured list of `{ code, path, message }`.

Reference cycles are a **nominal case**: only containment is laid out as a tree.

## Alternatives considered

- **Throwing on the first data anomaly** — rejected: that is the use case. An
  incomplete aggregate must be visible, not fatal.
- **Silently ignoring** — rejected: the demo's status bar shows the diagnostic
  count, so diagnostics must exist and be named.

## Consequences

- Every new capability must pick a side. A `null` foreign key does **not** produce
  a dangling reference (that would be a diagnostic on the literal string "null");
  conversely a reference declaration that **no** instance ever satisfies gets its
  own `unresolved-reference` diagnostic — the typo was silent until then.
- The CLI inherits the split: Rust validates JSON **syntax** only and fails before
  opening a window; a semantically invalid config is reported in-app by the
  TypeScript core, the single source of truth for it (ADR-0021).
- A legitimate diagnostic can read as a bug: that is why the demo's large dataset
  has its own config, without the reference declaration its data does not carry.
