# ADR-0030 — `deselect` and `statschange`, the renderer's lifecycle events

Date: 2026-09-08
Status: Accepted

## Context

The renderer emitted exactly two events, `select` and `followRef`, both carrying
a payload and both describing a gesture AIMED AT something. A host built on them
alone cannot tell when the selection returns to rest, nor when the visible set
changes: `apps/demo` kept its detail panel open on a node that was no longer
selected, and refreshed its "N visibles" counter only on `select`, on a view
toggle and on a dataset toggle — so an expansion, a collapse or a revealed page
left the counter lying.

Both are the same shortcoming: the API announced the arrivals and none of the
departures.

## Decision

Two events are added to the public contract, both WITHOUT payload:

- `deselect`, emitted by `doDeselect()` and by `setView()` when the carry-over to
  the nearest entity ancestor finds none. It only fires when a selection actually
  existed, so a host never sees a phantom event at boot.

  A view switch announces BOTH of its outcomes: the carry-over that finds no
  enclosing entity emits `deselect`, and the one that SUCCEEDS emits `select` on
  the node it landed on. Without that second emission the selection silently
  became a different node and the host's panel went on describing the one the
  canvas no longer designates — the very failure this pair of events exists to
  remove. A carry-over that lands on the node already selected (it was itself an
  entity) emits nothing: nothing moved.
- `statschange`, emitted from `rebuild()` — the single point every operation that
  changes the visible set ends on — and deduplicated against the last announced
  counters, so a repaint that changes no count (LOD flip, `setTheme`) stays
  silent.

No payload for either: `deselect` has nothing left to describe, and the host
re-reads `stats()`, which means a counter added there later needs no new event
shape.

## Alternatives

- **Emit `select` with `null`.** Rejected: `select` is typed `GraphNode`, and
  widening it to `GraphNode | null` would break every existing host at the type
  level for a case they would then have to branch on anyway.
- **Carry the counters in `statschange`'s payload.** Rejected: it duplicates
  `stats()` and freezes its shape into the event contract.
- **Emit `statschange` from each of the seven mutating operations.** Rejected:
  seven call sites to keep in agreement, and each one would have to re-derive the
  `opGen` verdict `rebuild()` already embodies by simply not being reached.
- **Let the host poll `stats()` on a timer.** Rejected: it is the shortcoming
  dressed as a workaround.

## Consequences

- `DataGraphEvent` gains two names; hosts that switch exhaustively over it must
  handle them.
- `rebuild()` now has an observable side effect. Anything added to it that could
  reach back into the host must account for re-entrancy — the emission is the
  last statement of the function precisely so the scene is fully published first.
- `apps/demo` drops its PER-OPERATION manual `updateStatus()` calls in favour of
  the event (see `main.ts`), which removes the class of bug where a new operation
  is added and its counter refresh forgotten. One boot-time call remains, and
  correctly so: `rebuild()` returns before the emission as long as no layout has
  been published, so nothing announces the very first counters.
- A known asymmetry stays: `deselect` fires when a CLUSTER selection is cleared
  (`doDeselect` only tests that a selection existed, whatever its kind), while
  `doSelectCluster` never emits `select` — an aggregate is not a `GraphNode`, see
  its doc comment. A host therefore sees a departure it never saw arrive. It is
  harmless for a panel driven by `select` (it has nothing open on the aggregate,
  so it clears what is already clear) and inventing an aggregate event to make
  the pair symmetric would grow the API for a gesture no host has asked to be
  notified of.
