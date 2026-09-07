# ADR-0023 — Public surfaces keep only what is consumed or documented

**Date**: 2026-09-06
**Status**: Accepted

## Context

Both packages' barrels had grown by accretion: anything that might be useful was
exported. That made public the selector parser (`parseSelector`, `matchesPath`,
`PathSegment`), twelve low-level drawing functions and the LOD types, `Camera`,
`Emitter`, `measureFontMetrics`… Each is a compatibility promise no consumer asked
for, and each freezes an internal choice.

## Decision

**Export only what is consumed or documented.** Removed, as an accepted 0.x break:

- core — `parseSelector`, `parseRelativePath`, `matchesPath`, `PathSegment`,
  `nearestDrawn`, `VALUE_ONLY_KEY`; `rowValueWidth` becomes module-local (it was
  not dead: `measureNode` calls it); `SearchIndex` is re-exported as a type only;
- renderer — the 12 drawing functions and the LOD types, `Camera`/`Size`,
  `Emitter`, `measureFontMetrics`/`fontsReady`; `TextRole` no longer leaks.

And above all: **API-surface tests** on all three entry points, pinning the
**exact list** of exports as a contract. Adding or removing an export becomes an
explicit decision rather than a side effect.

## Alternatives considered

- **Keeping everything out of caution** — the default option, rejected: a public
  export is paid for in compatibility, and 0.x is when removal is cheapest.
- **Documenting without testing** — rejected: the repository holds that a budget
  with no test behind it is worse than no budget; the same applies to a surface.

## Consequences

- The playground (ADR-0028) needed the renderer's internal modules (`draw.ts`,
  `theme.ts`, `font-registry.ts`): it reaches them through **source aliases**,
  precisely so as not to reopen the public API frozen here.
- The refactors that followed — splitting the graph engine, extracting `search.ts`
  / `animate.ts` / `graph-view.ts` — could all happen at unchanged surface, which
  the API tests prove each time.
- Later additions are explicit and motivated: `tidy()`, `PAGE_SIZE`, `pageOf`,
  `INITIAL_CARD_BUDGET` and `HiddenGap` came in with the structure view at scale
  (ADR-0025), alongside their documentation.
