#!/usr/bin/env python3
"""Outlines the datagraph wordmark to a single SVG path, in Helvetica Bold.

Run by hand, output pasted into the lockups in `brand/`. Like
`generate-app-icons.sh` this needs a toolchain the repo does not carry:

    python3 -m venv /tmp/fontenv
    /tmp/fontenv/bin/pip install fonttools
    /tmp/fontenv/bin/python packages/tokens/scripts/outline-wordmark.py

Helvetica Bold, not Helvetica Neue: the defsquare logo sets `Helvetica-Bold`,
and the child mark has no business drifting to a different face.

The pen origin is (0, 0) and the baseline is y = 0, so the same path string
serves both lockups — each one only translates it. The numbers this prints are
what position it; recompute them here rather than eyeballing the SVG.
"""

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

WORD = "datagraph"
SIZE = 46.0
TRACKING = -0.92  # -0.02 em, the wordmark's crénage
FONT = "/System/Library/Fonts/Helvetica.ttc"
FACE = 1  # Helvetica Bold inside the collection

font = TTFont(FONT, fontNumber=FACE)
scale = SIZE / font["head"].unitsPerEm
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()
hmtx = font["hmtx"]
kern = font["kern"].kernTables[0].kernTable if "kern" in font else {}

names = [cmap[ord(ch)] for ch in WORD]
path = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
bounds = BoundsPen(glyphs)

x = 0.0
for i, name in enumerate(names):
    placed = Transform(scale, 0, 0, -scale, x, 0)  # SVG y grows downward
    glyphs[name].draw(TransformPen(path, placed))
    glyphs[name].draw(TransformPen(bounds, placed))
    x += hmtx[name][0] * scale + TRACKING
    if i + 1 < len(names):
        x += kern.get((name, names[i + 1]), 0) * scale

left, top, right, bottom = (round(v, 2) for v in bounds.bounds)
print(f"ink box     x {left} … {right}   (width {round(right - left, 2)})")
print(f"            y {top} … {bottom}   (above baseline {abs(top)}, below {bottom})")
print()
print(path.getCommands())
