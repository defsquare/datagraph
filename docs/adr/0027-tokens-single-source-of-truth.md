# ADR-0027 — `packages/tokens`, the single source of truth for the design system

**Date**: 2026-09-07
**Status**: Accepted

## Context

The project had a de facto design system **duplicated by hand in two places**:
`packages/renderer/src/theme.ts` (the four Pixi themes of the canvas) and
`apps/demo/src/style.css` (the chrome's `--ds-*`, `--space-*`, `--radius-*`
variables, retyped from the same values). Nothing guaranteed they stayed in sync:
no test, no generation. A colour fixed on one side drifted on the other.

## Decision

A new package `@defsquare/data-graph-tokens`: pure TypeScript, zero dependencies,
zero DOM — the same constraints as the core. It holds the primitives (colour
scales, font families) and the semantic tokens per theme (`defsquare` / `neutral`
× light / dark), plus DOM-only `chrome` tokens the canvas knows nothing about.

Two consumers, two mechanisms:

- **Pixi** — `theme.ts` builds its four themes from the package instead of
  literals. Its public API does not change: `Theme`, `TypeStyle` and `ThemeOverride`
  stay **defined locally**, so consumers do not pay a type dependency on the tokens
  package.
- **CSS** — `scripts/generate-css.ts` renders `apps/demo/src/tokens.css`, a
  **generated and committed** file (Vite imports static CSS, it cannot run the
  generator). The guard against forgetting to regenerate is a **freshness test**
  that regenerates in memory and compares **byte for byte** with the committed file.

`renderTokensCss` is exposed through a `./css` export rather than the index: the
index stays pure data, and the renderer has no use for a CSS string.

The refactor is **strictly neutral**: no value changes. The proof is that
`theme.test.ts` and `api-surface.test.ts` pass unmodified, and that the CSS bundle
produced by the demo's build is identical before and after (same md5).

## Alternatives considered

- **style-dictionary** — rejected: a large dependency, untyped JSON tokens,
  over-tooled for two targets.
- **Keeping the duplication and adding a comparison test** — would have given an
  alarm, not a single source: two files are still two places to edit.

## Consequences

- **A token changed without regenerating breaks `pnpm test`.** That is the explicit
  price of the generated-and-committed file, and the only way to keep the drift
  from returning.
- The demo's dev aliases must resolve the tokens package to its sources too,
  otherwise the renderer-source → tokens-`dist` path would hide any change to
  `packages/tokens/src` in dev.
- The playground (ADR-0028) injects the variables via `renderTokensCss()` rather
  than importing the generated file: the module is then code, hence subject to HMR.
- Deliberately out of scope: exposing theming to the CLI user, and tokenising the
  ~25 geometry constants of `draw.ts` — those are drawing invariants, not design
  choices.
