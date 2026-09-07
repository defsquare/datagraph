# ADR-0025 — Structure view at scale: opening budget, aligned pages, `tidy()`

**Date**: 2026-09-07
**Status**: Accepted

## Context

`datagraph data.json` refused any document past 50,000 logical nodes, and that cap
guarded the wrong cost (ADR-0008). The real cause is `CollapseState`'s initial
expansion policy: a BFS that expands every non-entity node and only stops at
entity boundaries. **Without a config** there are no entities, hence no brake: the
whole document entered ELK in one call.

One constraint dictated the shape of the fix: search. The index covers the whole
document and `focus(id)` already auto-reveals collapsed ancestors. "First N
children" pagination would break that contract — reaching `orders[47,312]` would
force revealing 47,313 cards.

## Decision

Five rules, all inside `CollapseState` (the single source of truth for visibility)
and the layout engine:

1. **Bounded opening**: the initial BFS keeps its entity rule but counts the cards
   each marking would reveal and stops marking past a budget
   (`INITIAL_CARD_BUDGET = 300`). The budget applies **always**, with or without a
   config; documents that fit under it look unchanged.
2. **Reveal by aligned pages** (`PAGE_SIZE = 100`), not by prefix: page `p` covers
   `[p·100, (p+1)·100)`, a union of pages replaces any range-merging arithmetic, and
   search reveals only the page containing its target. A missing entry means `{0}`,
   so an ordinary expansion creates no state.
3. **Remainder tokens** `+ n`: **renderer pseudo-elements**, neither graph nodes nor
   ELK boxes. Their position in the column alone tells the direction of the gap.
4. **`layoutAfterReveal`**: a revealed page is not an expansion — its cards belong
   to an already placed sibling set, so they are **inserted** into that column at
   their rank. Placing the isolated block is shared with `layoutAfterExpand`, so the
   delta mechanism stays single.
5. **`maxNodes` becomes a memory guard**, default raised from 50,000 to
   **1,000,000** — measured in an isolated process: 479 MB of heap and ~814 ms of
   build + index at 1M, ~3× margin under the target budget. The error message names
   the lever: a deliberately raisable cap must say how to raise it.

Plus **`tidy()`**: a global re-layout on demand over the now-bounded visible set,
which purges the deltas and refits. Spatial stability by default, repair on
request.

## Alternatives considered

- **Prefix pagination** — rejected by the search constraint above.
- **Virtualising the structure view's rendering** and **streaming JSON parsing** —
  out of scope: the problem was layout, not reading.
- **Re-running a global layout automatically** after each expansion — rejected:
  spatial stability is what incremental layout buys. Drift is repaired on demand.

## Consequences

- The graph stays **complete and faithful**: no pagination nodes, no change to
  `logicalNodeCount`, and search, refs and diagnostics never see a fictitious node.
- Every reveal is bounded by `PAGE_SIZE` cards: the visible set only grows through
  bounded user gestures.
- `expandPathTo` must now reveal, for each link of the path, the page containing
  that child — expanding ancestors no longer guarantees the target is visible.
- A global `layout()` **clears** recorded expansion deltas: after a global layout
  they describe `y` coordinates that no longer exist, and undoing them on a later
  collapse moved cards at random.
- **Elided** children (the array tokens of ADR-0018) are never paginated nor
  counted: they are rows, not cards.
- Size is no longer a reason for a document to refuse to open.
