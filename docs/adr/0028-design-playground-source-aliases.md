# ADR-0028 — `apps/design`: a never-published playground, aliased to the sources

**Date**: 2026-09-07
**Status**: Accepted

## Context

With `packages/tokens` (ADR-0027) the design system has a source of truth — but no
way to **consult** it. Seeing the effect of a token meant launching the demo and
provoking states by hand: hover, selection, semantic zoom, broken reference. And
`apps/demo` cannot play that role: it shows the viewer to a user, not the system to
the people who change it.

## Decision

A light Vite app `apps/design` (port 5174, the demo keeping 5173 — both run
together), with four views, each in the four brand × mode themes: **tokens**,
**graph components**, **chrome UI components**, and a **sandbox** (a real
`createDataGraph` instance on one of the demo's fixtures).

The structural decision is the resolution mode: the playground's Vite aliases point
**unconditionally** at `packages/*/src`, build included — the opposite of the
demo's, which only apply in `serve`.

The reason is what each application has to prove:

- the demo consumes the packages through their `exports` at build time, like an
  external consumer; that is what keeps size measurements taken on that bundle
  honest (ADR-0014);
- the playground is **never published** and is nobody's reference. Its only purpose
  is to show the **current** state of the sources. A stale `dist/` there would be a
  lie, and a mandatory `pnpm -r build` before every colour experiment would be
  exactly the round-trip this bench removes.

## Alternatives considered

- **Storybook** — not retained: the project paints into a Pixi canvas, where the
  unit to show is a call to a drawing function, not a DOM component.
- **A fifth view inside `apps/demo`** — rejected: the demo must stay what a user
  sees, and unconditional aliases would ruin its bundle measurements.
- **Twin `.is-hover` classes** to freeze DOM states — rejected: they would only be a
  copy of the `:hover` rule and would go stale at the first edit to either. The
  states shown are **real** — you hover, you tab — at the accepted price that
  several cells look alike at rest.

## Consequences

- The playground can import internal modules no `exports` publishes (aliases are
  prefixes) — without widening the public API frozen by ADR-0023. That is
  intentional: a test bench is allowed to look under the hood.
- `tsconfig.json` must carry the **same** paths in `paths`, otherwise `tsc --noEmit`
  would resolve to `dist/` where the bundler serves sources — two divergent
  resolutions, hence a typecheck validating something other than what runs.
- The "graph components" view only exists thanks to ADR-0006: states are
  **forced parameters** passed to the real `draw.ts` functions, over hand-built
  plain data. A specimen cannot lie.
- Every view is **remounted** on each theme change rather than repainted: the
  sandbox therefore does not call `graph.setTheme()`, whose safety is conditional on
  identical typography — a condition nothing checks at runtime (ADR-0011).
- States **missing** from the design system are said to be missing, not invented:
  the UI board records that there is no `:active` for a menu item and no "on accent"
  ink (a hard-coded `#ffffff` at 4.8:1 in dark mode). A board that quietly patched
  those holes would stop being useful for spotting them.
