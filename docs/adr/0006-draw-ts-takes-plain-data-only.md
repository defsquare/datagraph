# ADR-0006 — `draw.ts` takes plain data only

**Date**: 2026-08-30
**Status**: Accepted

## Context

The renderer has no DOM in tests: no unit test mounts `createDataGraph`. If the
drawing functions read the graph, the `CollapseState` or interface state, all
rendering would only be provable end-to-end — that is, slowly, and only in the
states the application knows how to reach.

## Decision

The renderer is split in two: `create.ts` orchestrates (state, lifecycle, Pixi
scene, interactions) and `draw.ts` **draws, receiving nothing but plain data** —
rects, colours, strings, state flags. No function in `draw.ts` knows about the
graph or interface state; the state it paints is passed in as a parameter.

The same principle applies to geometric computation: `labelParamInView`,
`edgeLabelPlacements`, `anchorOnRect`, `classifyWheel` and `normalizeWheelDelta`
are pure, tested functions, not exported from the public index.

## Alternatives considered

- **A monolithic renderer reading state directly** — the default option, rejected
  for testability: it would have pushed the entire proof of rendering into e2e.

## Consequences

- Most of the renderer's ~240 tests cover pure functions. An edge style is checked
  by counting the path commands of the `GraphicsContext` — a solid line yields
  exactly `moveTo`+`lineTo` where a dashed one yields about fifty.
- The convention paid off a second time three weeks later: the playground's "graph
  components" view (ADR-0028) shows every product state by **forcing the
  parameters** of the real drawing functions. A specimen therefore cannot lie about
  what the renderer does.
- Standing constraint: any new visual state must arrive as a `draw.ts` parameter,
  not as a state read — that is why the `showChevron` flag and the `EdgeMode`
  parameter were added when the graph view arrived.
