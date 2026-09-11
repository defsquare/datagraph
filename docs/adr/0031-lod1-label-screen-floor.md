# ADR-0031 — The LOD 1 label holds a screen floor, quantized into rebuild steps

Date: 2026-09-11
Status: Accepted

## Context

At LOD 1 a card carries nothing but its name, typeset at the theme's header size
in WORLD units. The camera therefore shrank it: at scale 0.3 a 13-unit label
reached the screen at 4 pixels, inside a card a hundred pixels wide. The name was
present and unreadable — the exact failure `SEMANTIC_LABEL_MIN_SCREEN_PX` already
fixes for the semantic regime's discs (ADR-0026), left unfixed one level up.

The band above was no better. `LOD0_MIN_SCALE` was 0.5, so between 0.5 and 0.85
the full card drew every key/value row at 6 pixels: all the content, none of it
legible.

Transposing the discs' floor onto a card is not a copy, because a card is not a
disc. A disc grows with its member count, so a floor on its label costs nothing;
a card has a FIXED width and height, so magnifying its label costs characters per
line and, past a point, asks for a font taller than the card. And where
`rescaleSemanticLabels` follows the camera continuously — it only ever touches a
label's scale and position — a card's label changes its WRAP and its TRUNCATION
with its size, which means recreating text rather than rescaling it.

## Decision

**A screen floor, quantized into steps that are a rebuild trigger.**
`CARD_LABEL_MIN_SCREEN_PX` (10) is divided back by the camera's scale to a world
size, then rounded up to one of six declared magnifications
(`CARD_LABEL_STEPS`, a √2 ratchet from 1 to 5.6). `cardLabelStepForScale` is a
pure scale → band classifier, `lodForScale`'s companion, and `refreshCards`
compares it against the step the last `rebuild()` stored — so the whole LOD 1
band costs five rebuilds instead of one per wheel frame. The classifier pins the
step to 1 outside LOD 1, which is what keeps LOD 0 and LOD 2 free of any extra
rebuild.

**The label wraps rather than truncating harder.** A magnified label on a
fixed-width card must lose characters; LOD 1 leaves the card mostly empty, so the
room is vertical. `cardLabelLayout` breaks on the separators an identifier is
composed of (`_ - . / :` and space after, `#` BEFORE — it opens an id rather than
closing a segment, so `Order` / `#o200` and not `Order #` / `o200`).

**Completeness outranks legibility, in one place.** The layout walks DOWN the
ladder from the step the camera asked for and takes the first rung that costs the
name nothing — neither a line dropped for want of height nor a word cut in half
for want of width. A legible fragment of a name is not a name; a smaller complete
one is. When no rung fits, the smallest is returned with an ellipsis, which is
exactly what LOD 1 drew before.

**`LOD0_MIN_SCALE` moves from 0.5 to 0.85**, the scale at which a 12-unit row
reaches ~10 screen pixels. The band that opens up falls back to LOD 1, which now
holds a floor.

## Alternatives

- **Follow the camera continuously, rescaling only** (what the discs do). Cheap
  and smooth, but the wrap and the truncation go stale and the text overflows the
  card. A disc tolerates that; a bordered card reads it as breakage.
- **Follow the camera continuously, recreating the text.** Correct at every
  scale, and it recreates every visible card's label on every wheel frame —
  hundreds of cards at the bottom of the band.
- **Size the label as a fraction of the card**, as `SEMANTIC_LABEL_RATIO` sizes a
  disc's from its radius. No per-frame cost and no new trigger, but it is
  zoom-INDEPENDENT: the label shrinks on screen again, merely later.
- **Truncate harder instead of wrapping.** Simpler, and at step 4 a 340-wide card
  shows twelve characters of a thirty-one-character name.
- **A minimum characters-per-line cap** to stop the magnification before it
  mangles a word. It works, and it is redundant: making the hard break a reason
  to descend the ladder covers the same failure with one mechanism instead of
  two, and covers the tall narrow card the height check alone misses.

## Consequences

- The on-screen label size oscillates between ~10 and ~14 pixels across the band
  instead of holding one value. The floor is a guarantee, not a target.
- A card too short or too narrow for its name gets a label BELOW the floor. That
  is the correct answer rather than a gap: no label can be bigger than its card.
- `drawNode` gains a thirteenth positional parameter, `labelScale`, defaulted to
  1 and appended rather than placed beside `lod` where it belongs — the
  alternative rewrites every call site and test for a cosmetic gain.
- `create.ts` tracks `currentLabelStep` beside `currentLod`. The invariant
  ADR-0026 established — one camera movement produces at most ONE rebuild — still
  holds, `refreshCards` remaining the single arbiter.
- One Text object per LINE at LOD 1, positioned on the budgeted `lineHeight`
  rather than on Pixi's own font metrics, which the block's height was not
  computed from.
- The proof stays in pure functions (`test/card-label.test.ts`): no renderer test
  mounts `createDataGraph`, so the two classifiers and the wrap are testable only
  by being free of Pixi and of a canvas.
