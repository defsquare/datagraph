# ADR-0036 — The brand marks live in `packages/tokens`, beside the design tokens

**Date**: 2026-09-13
**Status**: Accepted

## Context

datagraph had no mark of its own. Both apps served the **defsquare** logo as a
stand-in — the demo in its bottom-right corner and as its favicon, the playground
as a favicon that pointed at a file `apps/design/public/` did not contain, so it
404'd. `apps/demo/src-tauri/icons/` still held the sixteen images of the Tauri
template.

Giving the product a mark raises three questions at once: where the artwork
lives, how the derived files (favicons, rasters) are produced, and what stops
them drifting from it. The repository already answers the last one for
`tokens.css` (ADR-0027): generate, commit, and guard with a byte-for-byte
freshness test.

## Decision

`packages/tokens/brand/` holds the hand-authored SVGs, plus the two defsquare
logos vendored as the **parent reference** the mark is derived from. The package
is already "the design system's source of truth"; a logo is a design system
asset, and ADR-0027's convention puts the freshness test with whoever owns the
source.

The mark itself is built inside the parent's grammar rather than beside it: only
axis-aligned rectangles, two colours, and the pun carried by the glyph — the
defsquare bracket, reused untouched, holding two records joined by an orthogonal
edge. `test/brand.test.ts` enforces the grammar mechanically: no `<path>`, no
`rx`, exactly two hex colours, and exactly one path per lockup (the wordmark;
a second would mean the mark itself had been converted).

Two artworks, not one, with a **48 px threshold**. Below it the bracket is about
one pixel row and the icon turns to mud, so the small rasters and the favicon
carry the reduction — the bracket's contents alone. It is a reduction, not a
second logo.

Three derivation paths, deliberately given **different guarantees**:

| Path | Tooling | Guard |
|---|---|---|
| `generate:brand` → `apps/*/public/` | tsx, portable | freshness test, byte for byte |
| `generate-app-icons.sh` → `src-tauri/icons/` | rsvg-convert, iconutil — macOS | none |
| `outline-wordmark.py` → the lockups' path | fonttools — macOS | none |

Only the first can be tested without making `pnpm test` depend on librsvg and on
macOS. The other two are run by hand and their output is committed.

The wordmark is **outlined**, not `<text>`. The defsquare asset ships live text
and this started there too, but the mark now heads the repository README, which
renders on machines whose fonts we do not control.

## Alternatives considered

- **A `brand/` package, or a plain directory at the root** — rejected: the guard
  would then sit apart from the source it guards, against ADR-0027's convention,
  and `packages/tokens` would keep claiming a title it no longer fully held.
- **Keeping the wordmark as live `<text>`** — tried, then reverted. Metric
  fallbacks (Arial, Liberation Sans) cover most machines, but "most" is not a
  property a logo may have.
- **Wiring the raster generation into `pnpm test`** — rejected: it would put
  librsvg and a macOS-only `iconutil` between a contributor and a green suite,
  to guard files that change once a year.
- **ImageMagick for the `.ico`** — rejected: an ICO is a short header followed
  by whole PNG files, which Windows has read since Vista. Twenty lines of Python
  against a system dependency.

## Consequences

- **A brand SVG edited without re-running `generate:brand` breaks `pnpm test`**,
  the same bargain ADR-0027 struck. The raster set and the outlined wordmark have
  no such guard and can go stale silently; `brand/README.md` says so out loud.
- **The application icon set is still consumed by nobody.** `bundle.active` is
  false (ADR-0020, ADR-0033), and the Tauri bundler is the only reader of
  `bundle.icon`. The shipped artifact is a bare Mach-O with no `Info.plist`, and
  macOS draws an icon only from a `.app`'s `Contents/Resources`. The set is
  generated regardless: it is correct and ready the day the bundle is switched
  on, and it replaces template artwork that was equally unreachable.
- The demo's corner signature moved from defsquare to datagraph. The parent's
  SVGs left `apps/demo/public/`, so `e2e/smoke.spec.ts`, which asserts the
  logo's `src` across the theme toggle, moved with them.
- `apps/design` gained the `public/` directory it never had, which fixes its
  404'ing favicon in passing.
- Out of scope, and unchanged: code signing and notarisation. Both stay as
  ADR-0033 left them.
