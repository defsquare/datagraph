# ADR-0001 — pnpm monorepo: headless core, Pixi renderer, demo

**Date**: 2026-08-30
**Status**: Accepted

## Context

The project starts as a publishable, generic visualisation library: explore a
complex JSON document in which references between entities
(`Order.customerId` → `Customer#42`) are first-class edges. Three constraints are
validated up front: stay framework-agnostic (React, Vue, Reagent, vanilla), stay
fluid at ~10,000 logical nodes, and ship the Defsquare design system as the
default theme with no runtime dependency on it.

Most of the value — parsing, graph model, reference resolution, search index,
collapse state, layout orchestration — needs neither DOM nor canvas. Mixing it
with rendering would make all of it testable only in a browser.

## Decision

A pnpm workspaces monorepo, strict TypeScript, ESM, tsup builds:

- `packages/core` (`@defsquare/data-graph-core`) — headless, zero DOM, runs in
  Node: parsing, graph, layout, search index, `CollapseState`, diagnostics.
- `packages/renderer` (`@defsquare/data-graph`) — the rendering layer, depends on
  the core. This is the package consumers install.
- `apps/demo` — Vite + vanilla TS: daily dev harness, Playwright bench and
  showcase. Page chrome, detail panel and search box live there; the library
  renders a bare canvas.

The public API is imperative (`createDataGraph(element, options)`), mountable in
three lines inside a `useEffect`. No React wrapper in v1.

## Alternatives considered

- **reaflow** — coupled to React (against the agnosticism requirement) and SVG
  rendering that collapses well before 10,000 nodes.
- **A single renderer package** — the default option, rejected: it would have made
  the graph model and layout untestable without a browser, which is where the
  logic actually is.

## Consequences

- The core is testable in vitest without a DOM, and that stays the rule: the
  renderer only has unit proofs on its pure functions (see ADR-0010).
- Two packages to publish, two READMEs, and a build order to respect
  (`pnpm build` before `pnpm test`, since the bundle-purity test reads `dist/`).
- The demo is never published (`"private": true`) but grows well past a showcase:
  it carries the desktop shell and the CLI (ADR-0020, ADR-0021).
- The split held through every later extension: `packages/tokens` (ADR-0027) and
  `apps/design` (ADR-0028) were added without reopening it.
