# datagraph — brand marks

The source of truth for the datagraph logo. Everything here is hand-authored;
the copies in `apps/*/public/` and the raster set in
`apps/demo/src-tauri/icons/` are generated from it and committed.

## The mark

datagraph is a defsquare product, so the mark is built inside the parent's
grammar rather than beside it — read `defsquare-short-dark-red.svg`, vendored
here beside them, before touching anything. Four rules come from it:

- **Axis-aligned rectangles only.** No path, no circle, no diagonal, no `rx`.
  `test/brand.test.ts` fails the build if one appears.
- **Two colours, never three.** Navy `#1a2a36` and red `#f65e5e`. Also enforced
  by the test.
- **A heavy stroke.** The parent runs 7 units on a height of 54 (13 %). On our
  64 grid: bracket stroke 7, edge 6, record 12.
- **The glyph carries the pun.** `def` + `[ ]` = def·square. Here the parent's
  bracket is reused untouched and holds two records joined by an orthogonal
  edge — the routing the layout engine actually draws. The mark says both
  "this is a defsquare" and "this is a graph".

The elbow turns **right then down**. Down-then-right puts the corner at the
bottom left and the whole thing reads as a capital `L`; that orientation was
tried and rejected.

## Files

| File | Use |
|---|---|
| `datagraph-mark.svg` | The mark. Light backgrounds. |
| `datagraph-mark-inverse.svg` | Same, pale records, for dark backgrounds. |
| `datagraph-mark-min.svg` | The reduction — records and edge, no bracket. **Below 48 px.** |
| `datagraph-mark-min-inverse.svg` | Same, dark backgrounds. |
| `datagraph-favicon.svg` | The reduction, with an internal `prefers-color-scheme` switch. Served by both apps. |
| `datagraph-lockup.svg` | Horizontal mark + wordmark. |
| `datagraph-lockup-auto.svg` | Horizontal, follows the reader's `prefers-color-scheme`. For the repository README, where the background is unknown. |
| `datagraph-lockup-stacked.svg` | Vertical, same mark and type sizes. |
| `datagraph-appicon.svg` | White rounded square, navy records. Source of the ≥48 px rasters. |
| `datagraph-appicon-min.svg` | Same ground, reduced artwork. Source of the <48 px rasters. |

`-inverse` exists for each lockup too.

### The 48 px threshold

At 32 px the bracket is roughly one pixel row and the icon turns to mud. That
is the only reason two artworks exist, and why `generate-app-icons.sh` switches
source file on size rather than just scaling one down. It is a reduction, not a
second logo: what survives is literally the bracket's contents.

### The wordmark is outlined

The lockups carry the word as a `<path>`, not as `<text>`: Helvetica Bold traced
by `scripts/outline-wordmark.py`. The defsquare asset ships live text, and we
started there too, but a logo that renders in whatever face the machine happens
to carry is not a logo — and the repository README is read on machines we do
not control.

Helvetica Bold specifically, matching the parent's `Helvetica-Bold`, with its
`kern` pairs applied and −0.02 em of tracking. Both lockups translate the same
path, so the word cannot drift between them.

### Clear space

The lockup viewBoxes ARE the ink box — no built-in padding, so a consumer picks
its own. The minimum is one bracket stroke, 7 units at mark scale, on all four
sides.

## Regenerating

```sh
# SVG copies into apps/*/public — portable, guarded by test/brand.test.ts.
pnpm --filter @defsquare/datagraph-tokens generate:brand

# Raster icon set into apps/demo/src-tauri/icons — needs rsvg-convert
# (brew install librsvg) and iconutil, so it is macOS-only and never runs in
# CI or in a build. Its output is committed.
packages/tokens/scripts/generate-app-icons.sh
```

`.ico` is written by a few lines of Python inside that script rather than by
ImageMagick: an ICO is a short header followed by whole PNG files, and Windows
has read that form since Vista. One less thing to install.

## Not covered here

The demo's bottom-right corner still shows the **defsquare** logo
(`apps/demo/src/chrome.ts`) — that is the studio's signature on the canvas, not
the product's, and switching it to the datagraph lockup is a product call
nobody has made yet. `brand/` holds the lockups ready for the day it is.
