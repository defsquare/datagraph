# ADR-0019 — A reference is declared by a path, not by a row key

**Date**: 2026-09-03
**Status**: Accepted

## Context

A `references[Type]` key was a field name on the entity's card. A reference
carried by a **value object** — `lines[*].productRef` on each line of a cart — was
therefore inexpressible; the workaround produced misleading `missing-id`
diagnostics and zero edges, silently.

## Decision

Every reference key is a **path relative to the entity**, in `match`'s grammar.
`customerId` is the single-segment case (zero migration); a key containing neither
`.` nor `[` stays a verbatim row key, so JSON field names are not restricted to the
selector grammar.

Two model decisions follow:

- **The edge lands on the node carrying the terminal row**, with `field` being the
  last segment. The invariant "`field` is a row key of `from`" holds everywhere, and
  the structure view's rendering (tint, underline, click, broken-reference cross)
  works on the value object's card unchanged.
- **`RefEdge.fromEntity` carries the declaring entity** — the level at which the
  relation exists, a value object having no identity of its own. That is what
  aggregate membership, two-level layout and dimming read.

An `unresolved-reference` diagnostic is added: a declaration never resolved on any
instance of a type that has instances — the typo that was silent until then.

## Alternatives considered

- **Anchoring the edge's start on the `[ n items ]` token row** when the value
  object is collapsed — implemented, then replaced: it was half a signal, nothing
  distinguished that line from a direct reference and a few pixels of offset did not
  read. The detail moved to **selection**, as a label naming the instantiated path.
- **Extending the selector grammar with quoted segments** (for exotic keys such as
  `@odata:id`) — left aside, a separate piece of work if the need returns.

## Consequences

- A reference edge's start is **always a card** (`nearestCardRectFor`, walking
  `parentId` up to the first rect): expansion emerges from the token, a whole
  signal.
- Factoring the endpoint computation (`refEdgeEnds`) fixed a real defect: hit areas
  and highlighting did not lift their start, so a reference carried by a hidden
  value object was drawn but had no clickable area.
- The data-first contract (ADR-0022) re-expressed the same capability with
  **absolute** paths in `refs[].from`, the owner being found by longest prefix: the
  internal relative resolution (`ReferenceDecl {navigate, field}`) did not change.
