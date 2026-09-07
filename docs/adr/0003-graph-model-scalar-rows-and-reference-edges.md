# ADR-0003 — Graph model: scalar fields as rows, two kinds of edges, path-derived ids

**Date**: 2026-08-30
**Status**: Accepted

## Context

A literal JSON viewer draws one node per value: an object with 50 fields becomes
50 nodes, and 10,000 logical nodes become unplayable. What this project wants to
show is not the literal tree but the graph of references.

## Decision

Three kinds of nodes: entity node (recognised by the config, default collapse
unit, visually distinct), object/array node, and **scalar fields grouped as rows
of the parent card** — not as separate nodes. An aggregate with 50 fields fits in
a handful of visual nodes.

Two kinds of edges, of different natures:

- **containment** (parent → child) — this is the tree, and the only thing the
  structure view's layout lays out;
- **reference** (`Order.customerId` → `Customer#42`) — overlays freely, and cycles
  are a nominal case, not an error.

Every node carries a **stable id derived from its path in the source JSON**.

## Alternatives considered

- **One node per scalar value**, as JSON tree viewers do: rejected outright — it is
  exactly the behaviour the project distinguishes itself from, and it makes the
  10,000-node budget unreachable.

## Consequences

- The path id is the key to everything that came later: selection, search,
  `CollapseState`, pagination, and id-keyed invalidation of graph-view state.
- A reference edge's `field` is always **a row key of its source node**: the
  invariant survived value-object references (ADR-0019), which land the edge on the
  node carrying the terminal row rather than on the declaring entity.
- `logicalNodeCount` counts logical nodes, not cards; the two diverged when arrays
  became token rows (ADR-0018) and when the view started paginating (ADR-0025).
- Anything deliberately kept out of the search index must be decided explicitly:
  the item count of a `[ n items ]` token is not indexed, otherwise "items" would
  match every array in the document.
