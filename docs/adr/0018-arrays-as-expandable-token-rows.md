# ADR-0018 — An array is an expandable token row, not a card

**Date**: 2026-09-03
**Status**: Accepted

## Context

An array was a card connected to its parent by a containment edge. The only way
to expand it was that card's header gutter, which does not name the field
concerned: the affordance did not say what was being opened.

## Decision

An array becomes **a row of its parent's card**, whose value is a `[ n items ]`
token that expands and collapses its elements.

The array **stays a node** — it keeps its id, its children and its collapse state
— but it is marked `elided`: no box in the layout, no rect in `positions`, no card
drawn. That choice is what lets `CollapseState`, `expandPathTo` and search
auto-expansion keep working **by id**, knowing nothing about rows. Layout remaps an
elided node's edges to the nearest drawn ancestor.

An array is only elided if it has a **drawn** parent to carry its row: the root
never is, nor an array under an already elided array. Scalar elements become nodes
with a `$value` row, rendered without a key: one card per element, whatever it
contains.

## Alternatives considered

- **Removing the array node from the graph** — rejected: `CollapseState`, search
  and diagnostics all work by node id, and the graph must remain a faithful,
  complete representation of the data.
- **Indexed rows on the array's own card** — rejected in favour of one card per
  element: uniform expansion regardless of the element's contents.

## Consequences

- Accepted, documented consequences: a card whose children are all arrays has
  neither chevron nor badge; collapsing a card does not retract what its token
  expanded, the two commands being independent; in the graph view tokens are
  legible but inert, that view folding nothing.
- `visibleNodeCount` now counts **drawn cards**, permanently decoupling logical
  nodes from cards.
- The token's animation is carried by **hover**, not by the click: `toggleExpand`
  triggers a `rebuild()` that destroys the card views, so an animation started on
  click would be destroyed before being seen.
- The elided-node notion paid off a second time at scale: elided children are
  **never paginated**, being rows rather than cards (ADR-0025).
