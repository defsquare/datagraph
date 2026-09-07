# ADR-0002 — Pixi.js v8 (WebGL) as the rendering engine

**Date**: 2026-08-30
**Status**: Accepted

## Context

The performance budget is explicit: 60 fps while panning and zooming with 2,000
visible nodes, and ~10,000 logical nodes sustainable. The dominant cost of such a
rendering is text: every card shows a header and key/value rows.

## Decision

Render with Pixi.js v8 (WebGL/WebGPU), with four complementary mechanisms:
`BitmapText` (glyph atlas) for text, viewport culling, three levels of detail on
zoom-out (full text → header only → coloured rectangle), and batching of
primitives per LOD bucket.

The chrome (search bar, detail panel, menus) stays **DOM laid over the canvas**,
never drawn inside Pixi.

## Alternatives considered

- **SVG (through reaflow or hand-written)** — collapses well before 10,000 nodes;
  measured as a non-starter during design.
- **A hand-rolled canvas 2D renderer** — would reimplement the batching, glyph
  atlases and scene graph Pixi gives for free.

## Consequences

- **Pixi's software fallback does not render `BitmapText`.** Under the canvas
  renderer (`app.renderer.name === "canvas"`, used when neither WebGL nor WebGPU is
  available) glyphs are drawn through a Graphics instruction that does not reach
  the canvas 2D adaptor: `drawNode` takes a `useBitmapText` flag resolved once
  right after `Application.init()` and falls back to plain `Text`.
- **Font atlases are page-global state.** They are reference-counted and named
  from the theme, otherwise two instances with different typography overwrite each
  other's atlases.
- **`Application.destroy(true, …)` releases the global `TexturePool`.** The object
  form `{ removeView: true }` is mandatory as soon as a page holds several scenes
  — a trap paid twice in `apps/design`.
- **CSP**: Pixi generates its WebGL uniform-sync functions with `new Function(...)`,
  so the desktop shell must grant `script-src 'unsafe-eval'` (ADR-0020).
- The chrome stays DOM because translucency, backdrop blur and drop shadows are
  exactly what the canvas cannot do.
