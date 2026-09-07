# ADR-0011 — A semantic, overridable theme contract with copied Defsquare tokens

**Date**: 2026-08-31
**Status**: Accepted

## Context

The first theme was a flat list of colours (`nodeFill`, `nodeStroke`, `text`…).
That was enough for one theme, not for four: every new visual intent — a type
rail, a badge, a search highlight — demanded another token without saying what it
was for. Separately, the Defsquare design system lives in another project, which
must not become a runtime dependency.

## Decision

A **semantic** theme contract: `surface`, `ink`, `accent`, `edge`, `typography`,
`radii`, `strokes`, `motion`, `entityPalette` — roles, not elements. Four themes
shipped (`defsquare` / `neutral` × light / dark), and every token overridable
through an explicit `ThemeOverride`.

The Defsquare DS values are **copied** into the code, never imported: the library
is publishable and generic, it cannot depend on an internal project.

`setTheme(next)` always applies `resolveTheme(next, theme)` — idempotent on a
complete theme — rather than discriminating `Theme` from `ThemeOverride`, which no
field can safely do.

## Alternatives considered

- **`DeepPartial<Theme>`** for overrides — dropped in favour of an explicit
  `ThemeOverride`, which enforces complete entries where a partial one would be
  incoherent, and allows a structural merge with no `JSON.parse`/`stringify` and no
  forced casts.
- **A runtime dependency on the Claude Design project** — ruled out by the
  genericity requirement.

## Consequences

- `setTheme()` does not redo measurement: `NodeMetrics` depend on typography, so
  the "no relayout" shortcut is only safe when typography does not change, as in a
  light/dark pair. For that reason the playground **recreates** its instance rather
  than calling `setTheme` (ADR-0028).
- Font metrics must be measured after the real faces have loaded: `fontsReady`
  explicitly requests each typographic role then races `document.fonts.ready`
  against a timeout, otherwise a cold cache bakes fallback-stack advances into the
  whole session.
- A token with no reader is deleted rather than kept "just in case" — three were,
  before the first publish.
- This accepted duplication between the Pixi theme and the chrome's CSS variables
  eventually cost: it is the reason `packages/tokens` exists (ADR-0027).
