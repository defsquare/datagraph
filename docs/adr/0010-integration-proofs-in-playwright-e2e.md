# ADR-0010 — The renderer's integration proofs live in `apps/demo`'s e2e suite

**Date**: 2026-08-31
**Status**: Accepted

## Context

The renderer has no DOM in unit tests and never mounts `createDataGraph`: its
tests all cover pure functions (ADR-0006). What is left are behaviours that only
exist once assembled — view switching, `setData`/`setView` races, the CLI's file
mode, pagination — with no natural home.

## Decision

Playwright (chromium only) against `apps/demo`, with its `webServer` wired to
`pnpm dev`. Specs drive the graph through `window.__graph`, the handle `main.ts`
exposes for exactly this.

Two rules complete the setup:

- **Wait on `ready`, not on the handle's existence.** `window.__graph` is assigned
  synchronously at module load, well before async init completes; a `gotoReady(page)`
  helper awaits the public promise.
- **The e2e suite exercises the sources**, through the Vite aliases active in
  `serve` mode: no prior `pnpm build`, and no timing it reports describes the
  published bundle.

## Alternatives considered

- **jsdom / a stubbed canvas in the renderer** — rejected: what we want to prove is
  precisely that Pixi paints, which a stubbed canvas says nothing about.
- **Visual regression testing** — out of scope for v1; assertions rely on counters,
  deterministic positions, and before/after canvas comparison.

## Consequences

- A rendering defect can only be "covered" by finding its observable counterpart:
  cards teleporting out of their envelopes were reproduced and then pinned by a
  pixel-exact e2e test.
- Pinned counts (logical nodes, visible entities) make the fixtures **load-bearing**:
  changing the demo generator breaks the e2e suite, which is the point.
- The CLI's file mode is covered without a desktop build:
  `e2e/file-mode.spec.ts` installs a fake `window.__TAURI_INTERNALS__` whose
  `invoke` answers `launch_payload` with the real contents of the committed
  `fixtures/` read off disk (ADR-0021).
- Rust coverage of the argv parser is wired into `apps/demo`'s `test` script, hence
  into `pnpm test`: a Rust toolchain is required at the root.
