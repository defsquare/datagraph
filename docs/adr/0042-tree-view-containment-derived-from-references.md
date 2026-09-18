# ADR-0042 — A tree view whose containment is derived from the references

**Date**: 2026-09-18
**Status**: Accepted

## Context

The structure view lays out the containment tree of the JSON document and
ignores references (ADR-0003, ADR-0012). On a **normalised** document — flat
tables joined by foreign keys, the shape of `apps/demo/fixtures/sanctions.json`
— that tree is `root → table → row`: six columns of cards, depth 2, and the
~250 reference edges that carry all the meaning zigzag across them. The layout
algorithm is not the problem; the edges it is given are.

The hierarchy the reader wants is the references read backwards: an infraction
hangs under its group, a sanction under its infraction. The graph view already
computes exactly that forest — `buildAggregates` runs a reverse BFS over the
references from the `groups` roots, breaking ties by declaration order
(ADR-0015) — but only to decide membership; the parent each entity was claimed
through was not kept.

## Decision

A third view, `"tree"`: **the structure view's machinery over a graph whose
containment is re-derived from the references.** No new config entry — the tree
is fully determined by `refs` and `groups`.

- `buildAggregates` now records its BFS **predecessor** (`parents`): the target
  of the reference that put an entity one hop closer to its root, following the
  same tie-break as membership.
- `buildTreeGraph(source, config)` builds a second `Graph` from the first:
  entities and their descendants are kept, structural nodes (root, top-level
  arrays, intermediate containers) are dropped, and a **top-level entity** is
  re-parented under its predecessor, or under a synthetic root when nothing
  claims it. Nested entities and value objects keep their containment parent,
  which is what preserves every array-row invariant (ADR-0018). Siblings are in
  document order; the roots come first under the synthetic root. Reference
  edges, entity index, diagnostics and `logicalNodeCount` are the source's.
- In the renderer the tree graph **is** the structure view's graph: same
  `CollapseState`, pagination, ELK layered layout, incremental expand/collapse/
  reveal and search reveal, untouched. `setView` swaps the folded state between
  the source graph and its tree; `ViewPolicy` gives `"tree"` the structure
  policy, as ADR-0024 anticipated for a third mode.

Shared targets of a many-to-many join (a sanction type referenced by many
relations) cannot hang under every parent without duplication: they sit under
the root as leaves, and the reference stays an overlay edge.

**The tree view flows TOP-TO-BOTTOM** — levels are rows, siblings side by side —
while the structure view keeps its left-to-right layout. Not an option: a tree of
a normalised document is read the way an org chart is. `createStructureLayoutEngine`
therefore takes a `direction` (`"RIGHT"` by default, `"DOWN"` for the tree),
implemented by TRANSPOSITION at the engine's boundary: the boxes handed to ELK
have their width and height swapped, every `positions` map is transposed on entry
and transposed back on exit, and the whole engine keeps working in a flow space
where the layout always runs along x. A layered RIGHT layout over transposed boxes
IS a layered DOWN layout over the real ones, so the three incremental paths —
expand, reveal, collapse — stay a SINGLE implementation instead of two copies of
the arithmetic that took the longest to get right. The one rule that does not
transpose is the elided-array anchor: a row band is a horizontal reading, so in
`"DOWN"` an elided node anchors on its nearest drawn card (its parent's) and the
expansion opens below that card. On the renderer's side a `ViewPolicy.flow`
(`"down"` for the tree, `"right"` elsewhere) carries the same decision to the
containment edges — which leave the bottom centre of the source for the top centre
of the target, from that same nearest drawn card — and to the remainder tokens,
which sit beside their anchor rather than under it.

One layout change, shared with the structure view: the ELK engine now gets
`considerModelOrder.strategy = NODES_AND_EDGES`, so a column of siblings keeps
its `childIds` order. Without it the layer sweep sorted the root's children by
the barycenter of whatever subtrees happened to be open, and the five declared
roots came out scattered among the 37 unclaimed leaves — the "roots first"
order was decided and then not shown.

## Alternatives considered

- **Tuning the structure layout** (`mrtree`, per-parent packing) — rejected: the
  graph fed to ELK is already a tree, just the wrong one.
- **A `tree` config entry naming the parent references** — rejected for now:
  `groups` already expresses the intent ("rooted at X") and the tie-break already
  arbitrates join tables. An explicit entry becomes worth its cost only if
  shared targets must be *inlined* under each parent — an alias node, which
  ADR-0003's path-derived ids do not have.
- **A direction OPTION on the tree view** (horizontal or vertical, at the host's
  choice) — rejected: nobody asked for a horizontal tree, and a switch is a second
  geometry to keep working — a second set of edge anchors, token placements and
  camera framings to test, for a reading nobody wants.
- **Reading the `refs` declaration order as the parent choice** — rejected: a
  rule that happened to match the fixture, not a reason (cf. ADR-0017's
  threshold).

## Consequences

- `AggregateIndex` gains `parents`; `buildTreeGraph` joins the core's public
  surface; `DataGraphView` gains `"tree"`. No change to `validate.ts` and its
  embedded `--check` bundle (ADR-0032).
- The demo's view toggle now returns to the **last folded view** rather than
  always to structure, and a ⋮ menu item switches structure ↔ tree.
- Scalar rows carried by dropped structural nodes are not shown, nor searchable,
  in tree view. Accepted: on a normalised document those nodes carry nothing.
- Only top-level entities move. A nested entity referencing something outside
  its container stays nested — the containment is the stronger signal there.
- The sanctions fixture's `groups` becomes `["GroupeInfractionPersonneMorale"]`:
  with every infraction declared as a root, groups claimed nothing and no
  hierarchy could emerge. The same change turns its graph view from 14 flat
  shelves into 5 radial clusters.
- The tree view opens **fully expanded**, within the opening budget of ADR-0025
  (`CollapseState`'s `expandEntities`): every node below a tree graph's root is
  an entity, so the default entity boundary would show nothing but the roots —
  and the hierarchy is exactly what the reader picked this view to see.
