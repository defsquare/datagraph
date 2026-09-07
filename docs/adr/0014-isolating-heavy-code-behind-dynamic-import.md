# ADR-0014 — Isolate heavy code behind a secondary entry point and a dynamic `import()`

**Date**: 2026-08-31
**Status**: Accepted

## Context

The graph view's engine pulled in cytoscape: ~178 kB gzipped, +33 % of the bundle,
for a package that already ships elkjs and Pixi. A consumer who only uses the
structure view has no reason to pay for it. The spike said as much already: if the
organic engine is retained, it must be dynamically imported.

## Decision

Two mechanisms, at two levels:

- **In the core**: a second entry point `./graph-layout`, excluded from the main
  barrel. The barrel must never reach the graph engine.
- **In the renderer**: types come from an `import type` (no emitted code), and the
  module is reached only through a single dynamic `import()`.

Both properties are **guarded by tests**, not by a convention:

- the core's test walks the **transitive closure** of `dist/index.js` — tsup
  factors shared code into chunks, so searching `index.js` alone would let a leak
  through;
- the renderer's test inspects the **source** with a regular expression, the
  property being syntactic: tsup erases an `import type` exactly as it would keep a
  value import, so `dist/` does not reveal it. It also asserts the dynamic
  `import()` is still there, otherwise deleting both imports would make the test
  pass while breaking the view.

Both tests are verified **by falsification**: the mutation that should break them
does break them.

## Alternatives considered

- **A single barrel, relying on tree-shaking** — rejected: the engine is reached
  through a dynamic path, no bundler can prune it.
- **Trusting review** — rejected after observing that turning the `import type`
  into a value import left the entire suite green.

## Consequences

- The mechanism survived the engine replacement (ADR-0017), even though the stake
  in kilobytes dropped by a factor of 82. Both tests are **kept**, with their stake
  rewritten: the core's now checks that the closure of `dist/index.js` does not
  reach `createTwoLevelLayoutEngine`, with a counter-guard requiring it on the
  other entry point.
- The renderer's purity test follows the code: when loading moved into
  `graph-view.ts` (ADR-0024), it was amended to require that module to be the
  **single loading path**.
- The pattern generalised: `demo-mode.ts` (the demo's generator) is reached only by
  `import()` on the demo branch, so the CLI's file mode neither fetches nor
  evaluates it.
- Standing constraint: `pnpm build` must precede `pnpm test`, the core's test
  reading `dist/`.
