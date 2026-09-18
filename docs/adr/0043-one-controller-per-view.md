# ADR-0043 — One controller per view, behind a `View` seam

**Date**: 2026-09-18
**Status**: Accepted

## Context

ADR-0042 shipped the tree view as *the structure view's machinery over another
containment*. That sentence was the design, and within three commits it had cost
more than it saved. The tree ended up parametrising shared code in seven places:
a `direction` on `createStructureLayoutEngine` implemented by transposing every
box and every `positions` map at the engine's boundary; a non-commuting
elided-array anchor (`anchorInFlowSpace`); an `EdgeFlow` on `drawEdges` and
`drawSelectionOverlay`; a second placement rule inside `redrawRemainderTokens`;
`CollapseState`'s `expandEntities`; and, in `create.ts`, a `foldedView` variable
plus three `foldedXxxFor(target)` helpers swapping the graph, the collapse state
and the layout direction under one set of state.

Every one of those is a conditional on code the **structure view also runs**. The
transposition in particular doubled the surface of the arithmetic that took the
longest to get right — the incremental expand/reveal/collapse deltas — without
duplicating it, which is worse: a change to either view had to be re-reasoned in
flow space for the other. And the tree did not need that machinery at all. Its
visible set is bounded by the same opening budget and the same pagination as the
structure view's (ADR-0025), so it can afford a **global** layout on every
gesture, which is precisely what the incremental engine exists to avoid paying.

Meanwhile `create.ts` had grown back to ~3,300 lines and was again the place
where "which view are we in" was answered, in a dozen different ways.

## Decision

**Three isolated views, each its own controller, reached through ONE small seam.**

- **`packages/renderer/src/view.ts`** declares the seam: `DataGraphView`,
  `ViewPolicy` (both moved here from `create.ts`), `FoldStep`, `RemainderToken`,
  and the `View` interface — graph, positions, visible set, policy, the
  references to draw, the remainder tokens, the search index, and the five fold
  gestures. `FoldedView<State>` adds `graph-view.ts`'s `compute`/`publish`/
  `invalidate` cycle (ADR-0024) for the views that compute before they publish.
- **`create.ts` is the Pixi host and the orchestrator only**: cards, camera,
  hover, drag, selection, search controller, the `opGen`/`destroyed` guards
  (ADR-0009), the view switch. It holds three controllers and reads them through
  `activeView()`. The only switch on the current view left in the file is
  `viewFor()`.
- **`tree-view.ts`** is the tree's own machinery: `buildTreeGraph`, a
  `CollapseState` with `expandEntities`, a search index, and
  **`core/tree-layout.ts`** — a single global ELK layered pass, `DOWN`, no
  private state, no deltas. Every fold gesture — `expand`, `collapse`, `reveal`,
  `revealPathTo` alike — mutates, lays the whole visible set out again, and
  publishes, rolling its mutation back if the host's generation moved during the
  layout. A collapse is no exception: dropping the subtree's rects in place would
  leave the survivors spread over the width the tree had before, holes included,
  and `fit()` would frame that emptiness. `tidy()` returns `null` — a view that
  re-lays out globally cannot drift.
- **`graph-view.ts`** keeps its rich controller and gains a thin `View` adapter
  (`graphViewAsView`) beside it, so the host's generic paths read it in the same
  words as the other two.
- **`structure-view.ts`** is the structure view's controller, and the machinery
  it keeps is the INCREMENTAL one: `CollapseState` (no `expandEntities`), a
  search index, the ELK engine with its in-process fallback, and the four
  gestures built on `layoutAfterExpand`/`layoutAfterReveal`/`layoutAfterCollapse`
  plus the global `layout()` behind `tidy()`. It also owns the column placement
  of its remainder tokens. Relocated from `create.ts` in step 2 without a
  behaviour change: the façade that preceded it had already made nothing outside
  read `collapseState`, `layoutResult` or `engine`, so there was no call site to
  chase. The engine travels INSIDE the published state, because the fallback
  replaces it and a layout published without its engine would leave the next
  gestures' `expansionDeltas` on an engine that did not produce those positions.
- **`structure-layout.ts` returns to its pre-transposition shape** (the
  `e9b1702` version, keeping `considerModelOrder.strategy`, which predates the
  tree and belongs to the structure view). `LayoutDirection` and
  `structure-layout-direction.test.ts` are gone.
- What stays SHARED is exactly the core's primitives (`buildGraph`,
  `CollapseState`, `buildSearchIndex`, the layout engines, `measureNode`) and
  `draw.ts`'s pure functions (ADR-0006). A card is a card in all three views.
  Edge geometry stays a parameter of a pure function: the host hands the drawing
  functions a graph-like object whose `refEdges` the **view** chose
  (`refEdgesToDraw()`), which is how the tree drops the references it consumed
  into its hierarchy without a single conditional in the drawing code — and how
  the hit areas and the labels stay in agreement with the strokes by
  construction.

Two consequences of the seam are behavioural and deliberate:

- **The tree's synthetic root is never drawn.** It stays in the model, because
  `CollapseState` and the search index need a node to start from, but
  `tree-layout.ts` gives ELK a 1×1 box for it — which keeps the forest connected
  so the top-level entities line up on the first row — and then **removes it from
  the returned positions**. The host materialises cards from positions, so no
  card can exist for it. `stats().visibleNodeCount` accordingly counts only nodes
  that are both non-elided and positioned: what the user can count on screen
  (ADR-0003): one card fewer than the tree graph holds nodes.
- **A view's published state survives a trip through another view.** `setView`
  computes only when the target has nothing published, so exploring the tree,
  looking at the graph and coming back finds the tree as it was left. The
  structure view is always published (it is the fallback and it owns the search
  index the graph view borrows).

## Alternatives considered

- **One generic folded controller instantiated twice** (a `FoldedViewOptions`
  carrying direction, anchor rule, token placement, `expandEntities`) — rejected:
  every difference between the two views stays a parameter of shared code, which
  is exactly the coupling being removed. It would have renamed the problem, not
  solved it: the transposition and the non-commuting anchor would both have moved
  into the options object.
- **Three fully independent copies of the incremental machinery** — rejected: it
  duplicates the delta arithmetic (`expansionDeltas`, the insertion point, the
  push/undo thresholds), the part of this codebase that took the longest to get
  right and the part where a second copy silently drifts from the first at the
  next fix.
- **The tree gets a SIMPLER machinery instead** — chosen. It needs no deltas
  because its visible set is already bounded, so a global layered pass per
  gesture is affordable; and with no incremental state there is nothing to purge,
  nothing to drift, and no `tidy` to write.
- **Keeping the transposed engine and only extracting the controllers** —
  rejected: it leaves `structure-layout.ts` carrying a second geometry for a view
  that no longer uses it, and the flow-space reasoning in every reader's way
  forever.

## Consequences

- `create.ts` has one switch on the view (`viewFor`). `viewPolicy()`,
  `activePositions()`, `activeVisible()` and the fold gestures all go through
  `activeView()`; `foldedView`, `foldedGraphFor`, `layoutDirectionFor` and
  `foldedCollapseStateFor` are gone.
- The core gains `createTreeLayout` on its public surface
  (`test/api-surface.test.ts` updated) and loses `LayoutDirection`.
  `tree-layout.ts` imports `nearestDrawn` from `model.ts` and nothing from
  `structure-layout.ts` but three types; it stays out of `validate.ts`'s closure,
  so the embedded `--check` bundle is untouched (ADR-0032).
- The tree view no longer draws the references it turned into parent links: a
  dashed overlay used to lie exactly on top of every containment stroke.
- `graph-view.ts` is no longer invalidated when the folded view changes: it is
  computed on the source document's graph, never on the tree's, so there is
  nothing left to prove about the reuse.
- ADR-0024's rejected alternative — "a `ViewStrategy` interface with two
  implementations" — is **revisited** here. Its reasoning held for the problem it
  faced (a symmetric interface mirroring asymmetric conditionals, over shared
  state). What changed is that the three views no longer share state: each owns
  its graph, its folding and its layout, so the interface has real
  implementations behind it rather than half-empty mirrors. ADR-0024 keeps its
  status: `ViewPolicy` and the `compute`/`publish` discipline are unchanged, and
  this record extends them rather than replacing them.
- ADR-0042 is **amended**: the tree view is no longer the structure view's
  machinery, the transposition is gone, and "opens fully expanded" is now a
  property of `tree-view.ts`'s own `CollapseState`. Its decision — a containment
  re-derived from the references, read top to bottom — stands untouched.
- `create.ts` went from ~3,500 lines (`6b73254`, the seam and the façade) to
  **3,153**, and no longer holds a `collapseState`, `layoutResult`, `engine` or
  `searchIndex` of its own — the 364 lines removed are the structure view's, now
  459 lines of `structure-view.ts` with its own doc header. The three
  controllers are then symmetrical: `create.ts` imports no layout engine and no
  `CollapseState` at all.
- One publication discipline changed shape, and it is the only behavioural
  difference of step 2. `ready` used to publish the collapse state and the search
  index BEFORE awaiting the first layout, so `search()` and the fold guards could
  read them during that round trip; the controller publishes all five members in
  one gesture, after the layout. Nothing can be drawn in that window anyway
  (there are no positions and no `rebuild()` yet), and one publication point per
  view is what `FoldedView`'s `compute`/`publish` split is for.
- `packages/renderer/test/structure-view.test.ts` covers the controller without
  Pixi, on an in-process ELK — the layout contract (positions cover the drawn
  visible set), the four gestures, their rollbacks, the token placement and
  `tidy`. The e2e suite (`structure-scale`, `tidy`, `reveal-camera`,
  `array-token`, `findbar`, `keyboard`) stays the behavioural proof.
