# ADR-0045 — A packaging smoke test runs the README Quickstart from the packed tarballs

**Date**: 2026-10-05
**Status**: Accepted

## Context

Every proof so far exercises the sources: unit tests, and the e2e suite through
`apps/demo`'s Vite aliases (ADR-0010). Nothing checked what an npm consumer
actually receives. The first manual attempt found three defects none of those
tests could see:

- the renderer README's Quickstart awaited `graph.ready` at the top level of the
  entry module, which deadlocks in a production bundle (Pixi's lazy chunks import
  the entry chunk back): blank page, no error;
- core and tokens published stale files, their `build` not cleaning `dist/`;
- Vite 6's default target list fails the consumer's build on the minified elkjs
  bundle (`build-import-analysis … Parse error`).

## Decision

`pnpm smoke` (`scripts/smoke-pack.mjs`) builds and `pnpm pack`s tokens, core and
renderer, installs the tarballs into a blank app OUTSIDE the workspace with strict
pnpm, typechecks it, `vite build`s it and checks in Chromium that `graph.ready`
resolves and a canvas is mounted.

The app's entry module is the Quickstart's ```` ```ts ```` block, extracted from
`packages/renderer/README.md` verbatim: the snippet users copy is the thing under
test. Vite and Playwright come from the workspace; the consumer installs only the
tarballs (`--prefer-offline`). It builds with `target: "es2022"`, the setting the
README asks of Vite 6 users.

It stays OUT of `pnpm test`: it needs a build, a browser and possibly the network.

## Alternatives considered

- **Inside `pnpm test`** — rejected: slow, browser- and network-dependent, for a
  surface that only changes with packaging or the Quickstart.
- **An e2e spec in `apps/demo`** — rejected: the demo is inside the workspace, so
  it resolves through aliases and hoisting, which is exactly what must be avoided.
- **A hand-written consumer app** — rejected: it would drift from the README the
  way the Quickstart had drifted from reality.

## Consequences

- Editing the Quickstart is editing a test: it must remain a self-contained
  module that declares `graph`.
- Run it before a release, and after touching `exports`, `files`, a `build`
  script or the Quickstart.
- The Vite 6 workaround is documented, not fixed: the defect is in the interaction
  between elkjs's minified output and Vite's import scanner, outside this repo.
