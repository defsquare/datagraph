import { BitmapText, Circle, Color, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  badgeTextFor,
  headerTextFor,
  arrayTokenTextFor,
  arrayTokenWidth,
  anchorRectFor,
  nearestCardRectFor,
  isValueOnlyRow,
  DEFAULT_METRICS,
  type ArrayRow,
  type ContainEdge,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
} from "@defsquare/datagraph-core";
import type { Theme, TypeStyle } from "./theme.js";
import { DIM_ALPHA } from "./focus.js";
import { fontNameFor, type TextRole } from "./font-registry.js";

export type { TextRole };

export type Lod = 0 | 1 | 2;

/**
 * scale >= LOD0_MIN: full card (header + rows). LOD1_MIN <= scale < LOD0_MIN:
 * card + rail + label. scale < LOD1_MIN: solid rectangle.
 *
 * The full card appears only once its ROWS are legible, which is what fixes the
 * upper threshold: a key/value row is typeset at 12, so 0.85 is where it reaches
 * ~10 CSS pixels — the floor `CARD_LABEL_MIN_SCREEN_PX` holds for the label.
 *
 * It was 0.5, which opened a band where the card drew its whole content at 6
 * pixels. Nothing can be done for those rows — `rowHeight` is fixed, so a floor
 * on their type would spill them out of the card — so the band goes back to
 * LOD 1, whose label DOES hold a screen floor.
 */
export const LOD0_MIN_SCALE = 0.85;
export const LOD1_MIN_SCALE = 0.15;

export function lodForScale(scale: number): Lod {
  if (scale >= LOD0_MIN_SCALE) return 0;
  if (scale >= LOD1_MIN_SCALE) return 1;
  return 2;
}

/** The advance to use when truncating a given role. MUST stay aligned with what
 * `measureNode` budgeted for that same role: this is the invariant the old
 * implementation violated (one single advance for two fonts), hence the values
 * that spilled out of their card. */
export function charWidthFor(role: TextRole, metrics: NodeMetrics): number {
  switch (role) {
    case "header":
      return metrics.headerCharWidth;
    case "badge":
      return metrics.badgeCharWidth;
    case "key":
      return metrics.keyCharWidth;
    case "value":
      return metrics.valueCharWidth;
  }
}

export function truncateToWidth(text: string, maxWidth: number, charWidth: number): string {
  if (maxWidth <= 0) return "";
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

/**
 * Same budget as `truncateToWidth`, but the ellipsis eats the MIDDLE.
 *
 * Reserved for the semantic regime's aggregate labels, and their nature is what
 * justifies it: an aggregate's root is typically a hierarchical identifier
 * (`com.exemple.credit.domain`), whose leading segments are shared by the whole
 * dataset and whose last one is the only distinguishing part. Truncating from the
 * end would give a thousand discs named `com.exemple.cr…` — a label that costs
 * room and teaches nothing. CARDS, for their part, keep end truncation: their
 * header is a short id, not a path.
 *
 * The middle remains the right place EVEN now that the controller strips the
 * dominant prefix before publishing labels (`dominantSegmentPrefix`), and that is
 * a choice rather than a leftover: that prefix is the WHOLE dataset's, whereas the
 * tail it leaves is still a path whose intermediate segments repeat from one
 * branch to the next (`domain.project.service` against
 * `domain.project.repository`). End truncation would therefore still sacrifice the
 * discriminating part, one level down; this one keeps the head — which situates the
 * package in the tree — AND the end — which names it. Stripping the prefix does not
 * change WHERE to cut, it changes how often one has to cut: most of the real
 * dataset's labels now fit whole.
 *
 * The head gets the extra character when the budget is odd: a prefix one notch
 * more complete beats a suffix, reading starting from the left.
 */
export function truncateMiddle(text: string, maxWidth: number, charWidth: number): string {
  if (maxWidth <= 0) return "";
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail === 0
    ? `${text.slice(0, head)}…`
    : `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

// --------------------------------------------------------------------------
// A LOD 1 card's label
//
// At LOD 1 the card carries NOTHING but its name, and that name used to be
// typeset at the theme's world size — so zoomed out it reached the screen at a
// few pixels inside a card a hundred wide. Same failure
// `SEMANTIC_LABEL_MIN_SCREEN_PX` fixes for the semantic regime's discs, same fix
// in kind: a floor expressed on SCREEN, divided back by the camera's scale.
//
// Two things differ from the discs, both because a card is a card:
//
//  - it has a FIXED width and height, where a disc grows with its member count.
//    Magnifying costs characters per line, and past a point asks for a font
//    taller than the card. Hence the wrap onto several lines — LOD 1 leaves the
//    card mostly empty, the room is there — and the cap by the card's height;
//  - the floor is QUANTIZED. `rescaleSemanticLabels` follows the scale
//    continuously because it only touches a label's scale and position; here the
//    wrap and the truncation change with the size, so a continuous floor would
//    recreate every visible card's text on every wheel frame. Stepping turns that
//    into a handful of rebuilds, through the trigger `currentLod` already uses.
// --------------------------------------------------------------------------

/**
 * The smallest a card's LOD 1 label may be ON SCREEN, in CSS pixels.
 *
 * A notch above the discs' 9: a disc's label sits on an empty ground and is the
 * only thing to read there, whereas a card's competes with its own border, its
 * rail and the edges crossing behind it.
 */
export const CARD_LABEL_MIN_SCREEN_PX = 10;

/**
 * The magnifications the label may take, as multiples of the theme's header size.
 *
 * A √2 ratchet whose span is not free: the first step must be exactly 1, so that
 * ordinary zoom draws what it always drew, and the last must still reach the
 * floor at `LOD1_MIN_SCALE`. `test/card-label.test.ts` asserts that coverage
 * against both LOD constants, so widening the band without extending this list
 * fails there rather than quietly bringing the unreadable label back.
 */
export const CARD_LABEL_STEPS: readonly number[] = [1, 1.4, 2, 2.8, 4, 5.6];

/**
 * The fraction of the card's height the label block may occupy, so a magnified
 * label never touches the card's border, where it would read as overflow.
 *
 * 0.9 and not a rounder 0.8: the line box already carries its own leading
 * (`CARD_LABEL_LINE_HEIGHT_RATIO`) and the block is centred, so the glyphs never
 * reach the block's edges anyway — and every unit reserved here is one the
 * descent may need, since a block half a unit too tall costs a whole rung.
 */
export const CARD_LABEL_HEIGHT_RATIO = 0.9;

/** One line's box, as a multiple of the font size. */
export const CARD_LABEL_LINE_HEIGHT_RATIO = 1.25;

/**
 * The quantized magnification the cards must be BUILT with at a camera scale —
 * the LOD 1 label's counterpart to `lodForScale`, and like it a pure scale → band
 * classifier, which is what lets `refreshCards` compare it against the step a
 * rebuild last stored.
 *
 * Pinned to 1 outside LOD 1, and `lodForScale` is consulted HERE rather than at
 * the call site so the pinning is part of the classifier and provable with it.
 * That confines the extra rebuilds to the band that needs them: LOD 0 typesets
 * its header at the theme's size — which IS step 1 — and LOD 2 draws no text.
 *
 * Takes the header SIZE rather than the theme, which is overridable
 * (`ThemeOverride` reaches `typography`): a bare number keeps the rebuild trigger
 * trivially testable.
 */
export function cardLabelStepForScale(scale: number, headerSize: number): number {
  if (lodForScale(scale) !== 1) return 1;
  const wanted = CARD_LABEL_MIN_SCREEN_PX / (Math.max(scale, 1e-6) * headerSize);
  for (const step of CARD_LABEL_STEPS) if (step >= wanted) return step;
  return CARD_LABEL_STEPS[CARD_LABEL_STEPS.length - 1]!;
}

/**
 * The characters a line may break AFTER.
 *
 * Cards carry identifiers, not prose — `analyst_form_v2_financing_plan`, not a
 * sentence — so the separators that matter are the ones a schema uses to compose
 * a name. Breaking there keeps each line a whole segment, which is what lets the
 * eye reassemble the name across the lines; breaking mid-segment would give
 * `analyst_fo` / `rm_v2` and cost the reader the word.
 */
const CARD_LABEL_BREAK_AFTER = new Set([" ", "_", "-", ".", "/", ":"]);

/**
 * `#` breaks BEFORE itself, where every other separator breaks after, and the
 * asymmetry is the point: `#` opens an identifier rather than closing a segment
 * (`Order #o200`), so it belongs with what FOLLOWS. Breaking after it gave
 * `Order #` / `o200`, the `#` dangling at a line's end and the id it introduces
 * orphaned on the next. Breaking before gives `Order` / `#o200`.
 */
const CARD_LABEL_BREAK_BEFORE = "#";

/** The label split at every break point, each piece keeping its own separator so
 * that reassembling the pieces reproduces the label exactly. */
function chunkLabel(label: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] === CARD_LABEL_BREAK_BEFORE) {
      if (i > start) chunks.push(label.slice(start, i));
      start = i;
    } else if (CARD_LABEL_BREAK_AFTER.has(label[i]!)) {
      chunks.push(label.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < label.length) chunks.push(label.slice(start));
  return chunks;
}

export interface CardLabelLayout {
  /** The factor to apply to a text created at the theme's header size — the same
   * trick `drawSemanticLabels` uses, and for the same reason: one atlas shared by
   * every label, instead of one atlas per size. */
  k: number;
  /** The lines to paint, top to bottom, already fitted to the card. */
  lines: string[];
  /** One line's box height, in world units. */
  lineHeight: number;
}

/**
 * How a LOD 1 label fits into its card at ONE step — and, through `clipped`,
 * whether it had to sacrifice part of the name to get there: a line dropped for
 * want of height, or a word cut in half for want of width. `cardLabelLayout` reads
 * that flag to decide whether a smaller step would do better.
 *
 * The size is the step's, capped by the card's height — a step alone would ask
 * 72.8 world units of a card 56 tall, a name that does not fit in the thing it
 * names. That cap is also what makes the block self-consistent: since
 * `size <= usableHeight / CARD_LABEL_LINE_HEIGHT_RATIO`, one line always fits, so
 * `maxLines` is never 0 and the block never exceeds the card.
 *
 * Everything is BUDGETED from `metrics`'s advances, never measured on the
 * rendered object — the same discipline as `measureNode`/`drawNode` and
 * `semanticLabelGeometry`, and the same practical consequence: no canvas, hence
 * no `document`, hence testable outside a browser.
 */
function cardLabelAtStep(
  label: string,
  innerWidth: number,
  cardHeight: number,
  step: number,
  headerSize: number,
  headerCharWidth: number,
): { layout: CardLabelLayout; clipped: boolean } {
  const usableHeight = cardHeight * CARD_LABEL_HEIGHT_RATIO;
  // The cap may drop BELOW the theme's size, and must: a card shorter than one
  // line box still has to get one line, which is what makes `maxLines >= 1` below.
  const size = Math.min(
    headerSize * Math.max(step, 1),
    usableHeight / CARD_LABEL_LINE_HEIGHT_RATIO,
  );
  const k = size / headerSize;
  const lineHeight = size * CARD_LABEL_LINE_HEIGHT_RATIO;
  const nothing = { layout: { k, lines: [], lineHeight }, clipped: false };
  if (label.length === 0 || !(size > 0) || !(innerWidth > 0)) return nothing;

  // The budget is counted in CHARACTERS at the rendered advance: `k` is already
  // folded into `charWidth`, so a line that respects `maxChars` respects
  // `innerWidth` once painted at `k`. Computing the budget at the UNFLOORED size
  // and painting at the floored one is precisely the overflow
  // `semanticLabelScale` documents next door.
  const charWidth = headerCharWidth * k;
  const maxChars = Math.floor(innerWidth / charWidth);
  if (maxChars <= 0) return nothing;
  const maxLines = Math.max(1, Math.floor(usableHeight / lineHeight));

  // A line is measured ELAGUED of its trailing separator, because that is how it
  // is painted (see the trim below): a space at a line's end takes no ink, so
  // charging it to the budget forces a break the rendered line did not need. The
  // rule any line breaker applies to trailing whitespace, extended to the
  // separators this one breaks on.
  const fits = (line: string): boolean => line.trimEnd().length <= maxChars;

  const lines: string[] = [];
  let hardBroken = false;
  let current = "";
  for (const chunk of chunkLabel(label)) {
    if (current.length > 0 && !fits(current + chunk)) {
      lines.push(current);
      current = chunk;
    } else {
      current += chunk;
    }
    // A single segment wider than the whole line: there is no break point to
    // honour, so cut it. Overflowing the card is the one thing that is never an
    // option — but the cut costs the reader the word, so it is reported as a
    // sacrifice and `cardLabelLayout` will try a smaller step before accepting it.
    while (!fits(current)) {
      hardBroken = true;
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current.length > 0) lines.push(current);

  // A trailing separator is invisible at the end of a line but was paid for in
  // the budget — trimming it can only shorten the line, never break the width
  // invariant. A line left EMPTY by that trim (a run of spaces) is dropped: it
  // would otherwise spend a whole line box saying nothing.
  const kept = lines.slice(0, maxLines).map((line) => line.trimEnd());
  if (lines.length > maxLines) {
    // Height ran out before the label did. The ellipsis is not decoration: a name
    // silently amputated reads as a DIFFERENT name, which is worse than an
    // obviously incomplete one.
    const last = kept[maxLines - 1] ?? "";
    kept[maxLines - 1] = last.length < maxChars ? `${last}…` : `${last.slice(0, maxChars - 1)}…`;
  }
  return {
    layout: { k, lines: kept.filter((line) => line.length > 0), lineHeight },
    clipped: hardBroken || lines.length > maxLines,
  };
}

/**
 * How a LOD 1 label fits into its card: the magnification finally applied, the
 * lines to paint, and the line box they sit in.
 *
 * Walks DOWN `CARD_LABEL_STEPS` from the step the camera asked for and takes the
 * first one that costs the name nothing. Legibility yields to completeness here,
 * and only here: on the demo's `Order` cards at scale 0.20 (140 wide, 113 tall)
 * the requested step held one line where the name needed two, and gave `Orde…` —
 * a legible fragment of a name is not a name, a smaller complete one is.
 *
 * The ladder is reused rather than a continuous fit being solved for. That keeps
 * the descent to at most six cheap string passes over a short label, and keeps
 * every size drawn one of the six the rebuild trigger already knows about.
 *
 * When no step fits — a name far too long for its card — the SMALLEST is returned:
 * it shows the most of the name before the ellipsis, and is exactly what LOD 1
 * drew before any of this existed.
 */
export function cardLabelLayout(
  label: string,
  innerWidth: number,
  cardHeight: number,
  step: number,
  headerSize: number,
  headerCharWidth: number,
): CardLabelLayout {
  const descending = CARD_LABEL_STEPS.filter((candidate) => candidate <= step).reverse();
  const candidates = descending.length > 0 ? descending : [1];
  let smallest: CardLabelLayout | null = null;
  for (const candidate of candidates) {
    const attempt = cardLabelAtStep(
      label,
      innerWidth,
      cardHeight,
      candidate,
      headerSize,
      headerCharWidth,
    );
    if (!attempt.clipped) return attempt.layout;
    smallest = attempt.layout;
  }
  return smallest!;
}

// Installing the atlases belongs to `font-registry.ts`, which reference-counts
// them: an atlas name there is a pure function of theme and role, so `drawNode`
// finds it without receiving anything from the caller. `create.ts` is the one
// holding the lease and releasing it at `destroy()`.

/**
 * BitmapText does not rasterize reliably under Pixi v8's software canvas renderer
 * (`app.renderer.name === "canvas"`, used when neither WebGL nor WebGPU is
 * available): verified empirically, the Graphics show but the BitmapTexts stay
 * empty. Text goes through another path, safe in the canvas fallback, hence
 * callers passing `useBitmapText: false` in that case.
 */
function createLabel(
  text: string,
  theme: Theme,
  role: TextRole,
  color: string,
  useBitmapText: boolean,
): BitmapText | Text {
  const s: TypeStyle = theme.typography[role];
  if (useBitmapText) {
    const t = new BitmapText({
      text,
      style: { fontFamily: fontNameFor(theme, role), fontSize: s.size },
    });
    t.tint = color;
    return t;
  }
  return new Text({
    text,
    style: {
      fontFamily: s.family === "body" ? theme.fonts.body : theme.fonts.mono,
      fontSize: s.size,
      fontWeight: String(s.weight) as never,
      letterSpacing: (s.tracking ?? 0) * s.size,
      fill: color,
    },
  });
}

/** Chevron "▸" (collapsed) or "▾" (expanded), drawn as Graphics rather than as a
 * glyph: the ASCII atlas does not contain these characters. */
function drawChevron(g: Graphics, x: number, y: number, expanded: boolean, color: string): void {
  const r = 3.5;
  if (expanded) {
    g.moveTo(x - r, y - r * 0.6).lineTo(x + r, y - r * 0.6).lineTo(x, y + r * 0.9);
  } else {
    g.moveTo(x - r * 0.6, y - r).lineTo(x + r * 0.9, y).lineTo(x - r * 0.6, y + r);
  }
  g.fill(color);
}

/** No referencing field: a shared constant rather than a `new Set()` per call,
 * `drawNode` being called once per visible card per rebuild. Also serves as the
 * default for BROKEN fields — both sets are empty in the same way, and telling two
 * empty singletons apart would gain nothing. */
const NO_REF_FIELDS: ReadonlySet<string> = new Set();



/** A broken reference's "✕": a square box set against the content's right edge,
 * preceded by a gap that separates it from the value. */
const DANGLING_ICON_WIDTH = 7;
const DANGLING_ICON_GAP = 4;
const DANGLING_ICON_STROKE = 1.5;

/** An array row's pill height, and its corner radius. It is shorter than
 * `rowHeight` so the neighboring rows can breathe. */
const TOKEN_HEIGHT = 15;
const TOKEN_RADIUS = 7.5;

/**
 * How far the pill shifts to the right on hover. The shift goes in the DIRECTION
 * of expansion — element cards come out to the right — so the gesture is announced
 * by the direction of the movement and not merely by a color change.
 */
export const TOKEN_HOVER_SHIFT = 2;

/**
 * Draws an array row's pill, right-aligned within the content.
 *
 * It is mounted in a container labeled `array-token:<index>` — the same convention
 * as `ref-underline:<index>` — so `create.ts` can move it on hover without
 * redrawing the card or recomputing its geometry. The hover visual is a SECOND
 * drawing prepared hidden rather than a recomputed color: `draw.ts` cannot know
 * the pointer's state, and toggling a visibility is all the caller has left to do.
 */
function drawArrayToken(
  row: ArrayRow,
  index: number,
  rightEdge: number,
  centerY: number,
  theme: Theme,
  metrics: NodeMetrics,
  expandedArrays: ReadonlySet<NodeId> | null,
  useBitmapText: boolean,
): Container {
  const token = new Container();
  token.label = `array-token:${index}`;

  const width = arrayTokenWidth(row.value, metrics);
  const x = rightEdge - width;
  const y = centerY - TOKEN_HEIGHT / 2;

  // The background takes the canvas color: on a light card as on a dimmed one,
  // the pill then reads as a hollow, without any palette having to declare one
  // more shade.
  const rest = new Graphics();
  rest.label = "rest";
  rest
    .roundRect(x, y, width, TOKEN_HEIGHT, TOKEN_RADIUS)
    .fill(theme.surface.canvas)
    .stroke({ width: 1, color: theme.edge.border });
  token.addChild(rest);

  const hover = new Graphics();
  hover.label = "hover";
  hover.visible = false;
  hover
    .roundRect(x, y, width, TOKEN_HEIGHT, TOKEN_RADIUS)
    .fill(theme.surface.canvas)
    .stroke({ width: 1, color: theme.accent.selection });
  token.addChild(hover);

  const label = createLabel(
    arrayTokenTextFor(row.value),
    theme,
    "value",
    theme.ink.muted,
    useBitmapText,
  );
  label.position.set(
    Math.round(x + metrics.tokenPaddingX),
    Math.round(centerY - label.height / 2),
  );
  token.addChild(label);

  // `null`: the current view collapses nothing (graph view), hence no chevron —
  // it would promise a gesture with no effect. The WIDTH stays the same in both
  // cases, `arrayTokenWidth` always reserving the chevron's room: `measureNode`
  // does not know the view, and a card measuring itself differently per view would
  // make the two layouts diverge.
  if (expandedArrays !== null) {
    const chevron = new Graphics();
    chevron.label = "chevron";
    drawChevron(
      chevron,
      x + width - metrics.tokenPaddingX - metrics.tokenChevronWidth / 2,
      centerY,
      expandedArrays.has(row.arrayId),
      theme.ink.subtle,
    );
    token.addChild(chevron);
  }

  return token;
}

/**
 * A remainder token's height.
 *
 * INVARIANT: `REMAINDER_TOKEN_GAP + REMAINDER_TOKEN_HEIGHT < NODE_GAP`, where
 * `NODE_GAP` is 24 px (`packages/core/src/structure-layout.ts`, aligned on
 * `elk.spacing.nodeNode`). Layout reserves NO room at all for the tokens — they are
 * pseudo-elements ELK does not see — so the token has to fit in the band that
 * already separates two stacked cards. At 22 px + an 8 px gap it overflowed by 6,
 * which it painted over the next card and, its layer being on top, whose clicks it
 * stole. 4 + 16 leaves 4 px of clearance. If the engine's spacing changes, these
 * two constants must be revisited with it.
 *
 * 16 px carries the `value`-role label (12 px) without cramping it: the same
 * pairing as an array row's pill, 15 px tall for the same text.
 *
 * Exported because the caller needs it for ANCHORING: set above the card that
 * follows it, the token must rise by its own height, which nothing else tells it.
 */
export const REMAINDER_TOKEN_HEIGHT = 16;

/**
 * The gap separating a remainder token from the card that anchors it.
 *
 * Lives here, next to `REMAINDER_TOKEN_HEIGHT`, because both constants carry the
 * SAME invariant (see above): `REMAINDER_TOKEN_GAP + REMAINDER_TOKEN_HEIGHT <
 * NODE_GAP`. Separating them would make them easy to drift apart with nothing
 * noticing. `create.ts` imports it to place the token above or below its anchor.
 */
export const REMAINDER_TOKEN_GAP = 4;

/**
 * The token standing in for a block of unrevealed card children: "+ 47300".
 *
 * It is drawn at (0,0) in its local space — the caller places it, since only the
 * caller knows the positions of the neighboring cards that anchor it.
 *
 * The BARE count rather than a phrasing ("47300 more", "before", "after"): the
 * token's POSITION in the column is what says which side the hole is on, and a
 * label restating it would be a second source to keep in agreement with the
 * anchoring arithmetic. The "+" is enough to announce that clicking adds.
 *
 * The `width` parameter comes from the anchoring card and never from the text: a
 * token as wide as its label would float in the middle of a column whose template
 * it is meant to occupy. That is also why the label is TRUNCATED here — on a narrow
 * column, the label is what gives way, not the pill.
 */
export function drawRemainderToken(opts: {
  count: number;
  width: number;
  theme: Theme;
  metrics?: NodeMetrics;
  useBitmapText?: boolean;
}): Container {
  const { count, width, theme } = opts;
  const metrics = opts.metrics ?? DEFAULT_METRICS;
  const token = new Container();
  token.label = "remainder-token";

  // The background takes the MUTED surface of non-entity cards, like container
  // nodes: the token belongs to the same family as what it replaces, set back. The
  // border and the rounding are the cards', for the same reason — a radius of its
  // own would make it an object of a different nature in the column.
  const rest = new Graphics();
  rest.label = "rest";
  rest
    .roundRect(0, 0, width, REMAINDER_TOKEN_HEIGHT, theme.radii.card)
    .fill(theme.surface.cardMuted)
    .stroke({ width: theme.strokes.border, color: theme.edge.border });
  token.addChild(rest);

  const charWidth = charWidthFor("value", metrics);
  const budget = width - 2 * metrics.tokenPaddingX;
  const text = truncateToWidth(`+ ${count}`, budget, charWidth);
  if (text.length > 0) {
    const label = createLabel(text, theme, "value", theme.ink.muted, opts.useBitmapText ?? false);
    // Centered: the token spans the column's full width, and a label pinned left
    // would leave a pill that looks empty.
    label.position.set(
      Math.round(width / 2 - label.width / 2),
      Math.round(REMAINDER_TOKEN_HEIGHT / 2 - label.height / 2),
    );
    token.addChild(label);
  }

  return token;
}

/**
 * Draws a node's visual, positioned at (0,0) in its local space (the caller places
 * it at `rect.x`/`rect.y`).
 *
 * LOD 0: card + type rail + header (chevron, label, badge) + key/value rows, value
 * right-aligned. LOD 1: card + rail + full label, truncated. LOD 2: solid rectangle
 * in the type color.
 *
 * `accent` is the rail color the caller resolved through `entityAccentMap` —
 * `drawNode` cannot deduce it from `node` and `theme` alone, since the assignment
 * depends on the declaration order of the types in the config.
 *
 * `showChevron` governs the collapse affordance. The default — the node has
 * containment children — is structure view's; graph view passes it explicitly,
 * because there it is the aggregate that collapses, not the tree, and only its root
 * carries a chevron.
 *
 * `refFields` names the rows whose value fires an outgoing reference on click.
 * Without this signal, nothing set a navigable value apart from an inert one: the
 * card offered an invisible gesture. The caller passes FIELD NAMES and not edges —
 * `drawNode` has no business knowing the graph.
 *
 * The indicator comes in two stages, and that is what preserves this file's purity:
 * at rest the value is merely TINTED, and an underline is prepared beneath it,
 * `visible = false`. Knowing which row is under the pointer is interface state that
 * belongs to `create.ts`; all it has left to do is toggle a visibility by label,
 * without redrawing or consulting the geometry this file just computed.
 *
 * `danglingFields` names the rows whose reference DOES NOT RESOLVE. Their value
 * keeps the reference tint — it is one, simply broken — and gets a cross against
 * the row's right edge. The diagnostic used to live in the edge space, as a stub
 * hooked onto the card's edge: it thereby designated the CARD and not the offending
 * FIELD. Placed on the row, it designates exactly the value that fails to resolve.
 *
 * These rows have NO underline: an underline promises "this click navigates",
 * whereas `followRef` leads nowhere when the target is null. A row present in both
 * sets (a field carrying several edges) is treated as broken — the doubt must show.
 */
export function drawNode(
  node: GraphNode,
  rect: Rect,
  theme: Theme,
  lod: Lod,
  useBitmapText: boolean,
  accent: string,
  metrics: NodeMetrics = DEFAULT_METRICS,
  expanded = false,
  showChevron = node.cardChildCount > 0,
  refFields: ReadonlySet<string> = NO_REF_FIELDS,
  danglingFields: ReadonlySet<string> = NO_REF_FIELDS,
  expandedArrays: ReadonlySet<NodeId> | null = null,
  // The LOD 1 label's magnification, from `cardLabelStepForScale`. Last and
  // defaulted rather than beside `lod`, where it would read better: inserting it
  // there would rewrite every call site and test for a cosmetic gain. Ignored
  // outside LOD 1 — LOD 0 typesets its header at the theme's size, LOD 2 has no text.
  labelScale = 1,
): Container {
  // The atlases are installed by the lease `create.ts` holds, before any call
  // here. `fontNameFor` derives the name from the theme alone.
  const container = new Container();
  container.cullable = true;
  container.cullArea = new Rectangle(0, 0, rect.width, rect.height);

  const isEntity = node.kind === "entity";
  const radius = theme.radii.card;

  if (lod === 2) {
    const g = new Graphics();
    g.rect(0, 0, rect.width, rect.height).fill(isEntity ? accent : theme.edge.contain);
    container.addChild(g);
    return container;
  }

  // Card + rail, in a single Graphics and in this precise order:
  //   1. an accent background covering the WHOLE card,
  //   2. the body on top, offset by railWidth to the right — so the accent shows
  //      only on a railWidth-px band on the left,
  //   3. the outer border, stroked last along the complete outline.
  // The body has its left corners squared back off by a rect, otherwise the
  // roundRect would let the accent widen at top and bottom and the rail would not
  // be of constant thickness.
  const half = theme.strokes.border / 2;
  const innerW = rect.width - theme.strokes.border;
  const innerH = rect.height - theme.strokes.border;
  const surface = isEntity ? theme.surface.card : theme.surface.cardMuted;

  const box = new Graphics();
  if (isEntity) {
    box.roundRect(half, half, innerW, innerH, radius).fill(accent);
    const bodyX = metrics.railWidth;
    box.roundRect(bodyX, half, rect.width - bodyX - half, innerH, radius).fill(surface);
    box.rect(bodyX, half, radius, innerH).fill(surface);
  } else {
    box.roundRect(half, half, innerW, innerH, radius).fill(surface);
  }
  box
    .roundRect(half, half, innerW, innerH, radius)
    .stroke({ width: theme.strokes.border, color: theme.edge.border });
  container.addChild(box);

  const contentX = metrics.railWidth + metrics.paddingX;
  const contentRight = rect.width - metrics.paddingX;
  const inner = contentRight - contentX;

  if (lod === 1) {
    const layout = cardLabelLayout(
      node.label,
      inner,
      rect.height,
      labelScale,
      theme.typography.header.size,
      charWidthFor("header", metrics),
    );
    // One Text PER LINE, placed on `layout.lineHeight`, rather than a single Text
    // holding "\n"s: Pixi would then space the lines on the font's own metrics,
    // which are not the metric the block's height was budgeted on — the vertical
    // centering would drift by whatever the two disagree on. The line count is
    // bounded by the card's height, so this stays a handful of objects per card.
    const size = layout.k * theme.typography.header.size;
    const top = rect.height / 2 - (layout.lines.length * layout.lineHeight) / 2;
    // Left-aligned on `contentX`, the abscissa LOD 0 gives its header: crossing the
    // threshold then moves the name vertically at most, never sideways.
    layout.lines.forEach((line, index) => {
      const text = createLabel(line, theme, "header", theme.ink.primary, useBitmapText);
      text.scale.set(layout.k);
      text.position.set(
        contentX,
        Math.round(top + index * layout.lineHeight + (layout.lineHeight - size) / 2),
      );
      container.addChild(text);
    });
    return container;
  }

  // --- LOD 0: header ---
  const headerY = metrics.headerHeight / 2;
  let cursorX = contentX;

  if (showChevron) {
    const chevron = new Graphics();
    drawChevron(chevron, cursorX + 5, headerY, expanded, theme.ink.subtle);
    container.addChild(chevron);
    cursorX += metrics.chevronWidth;
  }

  const badge = badgeTextFor(node);
  const badgeWidth = badge.length > 0 ? badge.length * charWidthFor("badge", metrics) : 0;
  const headerBudget = contentRight - cursorX - (badge.length > 0 ? badgeWidth + metrics.gapKeyValue : 0);

  const headerLabel = truncateToWidth(
    headerTextFor(node),
    headerBudget,
    charWidthFor("header", metrics),
  );
  const headerText = createLabel(headerLabel, theme, "header", theme.ink.primary, useBitmapText);
  headerText.position.set(cursorX, Math.round(headerY - headerText.height / 2));
  container.addChild(headerText);

  if (badge.length > 0) {
    const badgeColor = isEntity ? accent : theme.ink.subtle;
    const badgeText = createLabel(badge, theme, "badge", badgeColor, useBitmapText);
    badgeText.position.set(
      Math.round(contentRight - badgeText.width),
      Math.round(headerY - badgeText.height / 2),
    );
    container.addChild(badgeText);
  }

  // Hairline separator under the header.
  if (node.rows.length > 0) {
    const hairline = new Graphics();
    hairline
      .moveTo(metrics.railWidth, metrics.headerHeight)
      .lineTo(rect.width, metrics.headerHeight)
      .stroke({ width: 1, color: theme.edge.hairline });
    container.addChild(hairline);
  }

  // --- LOD 0: rows, value right-aligned ---
  node.rows.forEach((row, index) => {
    const y = metrics.headerHeight + index * metrics.rowHeight + metrics.rowHeight / 2;

    // The key must be truncated too: with no cap, a key of about 49+ characters
    // (at `maxWidth` 340) eats all of `inner`, makes `valueBudget` negative, and
    // `truncateToWidth` returns "" for the value — which then silently vanishes
    // from the card. So we reserve for the key at most
    // `inner - gapKeyValue - <width of one value character>`, which guarantees the
    // value a floor budget of at least one character. A broken reference's cross,
    // for its part, DOES take room, unlike the tint. It is subtracted from BOTH
    // budgets and not from the value's alone: the truncation budget must equal the
    // room actually available, otherwise a long key would take back the space
    // reserved for the icon and the cross would land on top of text.
    const isDangling = danglingFields.has(row.key);
    const iconSpace = isDangling ? DANGLING_ICON_WIDTH + DANGLING_ICON_GAP : 0;

    const valueCharWidth = charWidthFor("value", metrics);
    const keyCharWidth = charWidthFor("key", metrics);

    // A "value-only" row — the scalar root document, an array's scalar element —
    // draws no key: `tags[0]` as the header then `$value` as the key would say
    // nothing more. It therefore consumes neither key width nor gap, exactly as
    // `measureNode` budgeted it.
    const showKey = !isValueOnlyRow(row);
    const keyBudget = showKey
      ? Math.max(0, inner - iconSpace - metrics.gapKeyValue - valueCharWidth)
      : 0;
    const keyStr = showKey ? truncateToWidth(row.key, keyBudget, keyCharWidth) : "";

    if (showKey) {
      const keyText = createLabel(keyStr, theme, "key", theme.ink.muted, useBitmapText);
      keyText.position.set(contentX, Math.round(y - keyText.height / 2));
      container.addChild(keyText);
    }

    // The key/value gap is FOLDED into `keyWidth`: with no key there is no gap to
    // reserve, and keeping it separate would force us to subtract it conditionally
    // in two places.
    const keyWidth = showKey ? keyStr.length * keyCharWidth + metrics.gapKeyValue : 0;
    const valueBudget = inner - iconSpace - keyWidth;

    // An elided array's row carries a pill, not text: it exits here, before all
    // the truncation and reference machinery, which only applies to a scalar
    // value.
    if (row.valueType === "array") {
      container.addChild(
        drawArrayToken(
          row,
          index,
          contentRight,
          y,
          theme,
          metrics,
          expandedArrays,
          useBitmapText,
        ),
      );
      return;
    }

    const valueStr = truncateToWidth(String(row.value), valueBudget, valueCharWidth);

    if (isDangling) {
      // Drawn BEFORE the empty-value bail-out: on a card too narrow to show
      // anything at all, the diagnostic is precisely what must survive —
      // otherwise the least readable card would be the one hiding its error. A
      // drawing and not a glyph: the ASCII atlas does not contain "✕".
      const cross = new Graphics();
      const right = contentRight;
      const left = right - DANGLING_ICON_WIDTH;
      const top = y - DANGLING_ICON_WIDTH / 2;
      const bottom = y + DANGLING_ICON_WIDTH / 2;
      cross.moveTo(left, top).lineTo(right, bottom);
      cross.moveTo(right, top).lineTo(left, bottom);
      cross.stroke({ width: DANGLING_ICON_STROKE, color: theme.edge.dangling, cap: "round" });
      container.addChild(cross);
    }

    if (valueStr.length === 0) return;

    // The value carries the color of the edge it fires: it is the same object seen
    // from two places, not two pieces of information to keep in agreement. A broken
    // reference keeps that tint — it is one, and it is precisely its nature as a
    // reference that makes its failure interesting. The tint takes NO room: outside
    // a broken row, the budgets above stay those of an ordinary row, and making a
    // row navigable cannot shorten its value.
    const isRef = refFields.has(row.key) || isDangling;
    const valueColor = isRef ? theme.edge.ref : theme.ink.primary;
    const valueText = createLabel(valueStr, theme, "value", valueColor, useBitmapText);
    valueText.position.set(
      Math.round(contentRight - iconSpace - valueText.width),
      Math.round(y - valueText.height / 2),
    );
    // Labelled so `overRefValue` can find it: the value is the row's CLICK ZONE,
    // and the zone is read from the text rather than recomputed from the budgets.
    if (isRef) valueText.label = `ref-value:${index}`;
    container.addChild(valueText);

    // No underline on a broken row: it would promise a navigation `followRef` will
    // not perform.
    if (!isRef || isDangling) return;
    // The hover underline: the hyperlink affordance. It is laid down AFTER the
    // empty-value bail-out, because it underlines TEXT — with no text, a lone
    // stroke would designate nothing.
    //
    // Hidden, and found by label rather than returned to the caller: hover state
    // (which row is under the pointer) belongs to `create.ts`, and keeping it out
    // of here is what leaves `drawNode` pure and testable without an instance. This
    // file merely prepares a visual driven by visibility.
    //
    // The geometry is taken from the text itself, never recomputed: the stroke
    // covers exactly its width and follows its baseline, so a change of font or of
    // truncation does not have to be echoed here.
    const underline = new Graphics();
    underline.label = `ref-underline:${index}`;
    underline.visible = false;
    const underlineY = Math.round(valueText.y + valueText.height) + 1;
    underline
      .moveTo(valueText.x, underlineY)
      .lineTo(contentRight, underlineY)
      .stroke({ width: 1, color: theme.edge.ref });
    container.addChild(underline);
  });

  return container;
}

/**
 * Is a card-local abscissa over row `index`'s referencing VALUE — the tinted,
 * right-aligned text `drawNode` labelled `ref-value:<index>`? Everything to its
 * right counts (the padding, a dangling row's cross), nothing to its left: the key
 * column belongs to the card, and a click there selects it. Before this zone
 * existed the whole row answered, and a card whose rows are mostly references
 * could hardly be selected without navigating away.
 */
export function overRefValue(card: Container, index: number, localX: number): boolean {
  const value = card.getChildByLabel(`ref-value:${index}`);
  return value !== null && localX >= value.x;
}

const DASH_LENGTH = 6;
const GAP_LENGTH = 4;

function dashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;

  let dist = 0;
  let drawing = true;
  let x = x1;
  let y = y1;
  while (dist < len) {
    const step = Math.min(drawing ? DASH_LENGTH : GAP_LENGTH, len - dist);
    const nx = x + ux * step;
    const ny = y + uy * step;
    if (drawing) {
      g.moveTo(x, y);
      g.lineTo(nx, ny);
    }
    x = nx;
    y = ny;
    dist += step;
    drawing = !drawing;
  }
}

const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 3.5;

/** Solid triangle pointing from (x1,y1) towards (x2,y2), its tip at (x2,y2). */
function arrowHead(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * ARROW_LENGTH;
  const by = y2 - uy * ARROW_LENGTH;
  // Unit normal.
  const nx = -uy;
  const ny = ux;
  g.moveTo(x2, y2)
    .lineTo(bx + nx * ARROW_HALF_WIDTH, by + ny * ARROW_HALF_WIDTH)
    .lineTo(bx - nx * ARROW_HALF_WIDTH, by - ny * ARROW_HALF_WIDTH)
    .closePath();
}

/**
 * The point where the segment from `rect`'s CENTER to `(tx, ty)` crosses `rect`'s
 * PERIMETER.
 *
 * Edges are drawn UNDER the card layer: a fixed anchoring (the source's mid-right,
 * the target's mid-left) buries the edge's start under its own card as soon as the
 * target is below or to the left — the line "comes out of nowhere". By exiting on
 * the side facing the target, the start always stays visible.
 *
 * A `(tx, ty)` INSIDE the rectangle (or coinciding with its center) has no useful
 * intersection: we then return the center. The edge ends up hidden under the
 * overlapping cards, which is the acceptable fallback — there is no "right" exit
 * point in that case.
 */
export function anchorOnRect(rect: Rect, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return { x: cx, y: cy };
  // The first edge reached is the one with the smallest scale factor; `Infinity`
  // neutralizes the axis along which we do not advance.
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** A rectangle's center — the target `anchorOnRect` aims at from the other end. */
function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * A reference edge's two segment endpoints: each end exits on the side facing the
 * OTHER card, otherwise the line runs under the source card (the edge layer sits
 * below the cards).
 *
 * This computation existed in three copies — drawing, hit areas, selection
 * highlight — which nothing forced to stay in agreement, and which in fact no
 * longer were. One single definition, now shared by the labels too: a hit area or
 * a highlight laid down anywhere but on the stroke are bugs no drawing test can
 * see.
 */
function refEdgeEnds(
  from: Rect,
  to: Rect,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  return {
    start: anchorOnRect(from, toCenter.x, toCenter.y),
    end: anchorOnRect(to, fromCenter.x, fromCenter.y),
  };
}

/** The view's dominant relation: the containment tree (structure view) or the
 * references alone (graph view). */
export type EdgeMode = "contain" | "ref";

/** The direction the containment is laid along: left-to-right (structure view) or
 * top-to-bottom (tree view). It only concerns the CONTAINMENT geometry — references
 * anchor on the side facing their target, whatever the flow. */
export type EdgeFlow = "right" | "down";

/**
 * Draws every edge between visible nodes into a single Graphics, grouped by style:
 * containment as solid horizontal beziers, resolved references ending in an arrow
 * head.
 *
 * A BROKEN reference is no longer drawn at all. The stub that flagged it floated at
 * the source card's edge, so it designated the CARD and not the offending FIELD;
 * the diagnostic moved onto the card's row, where `drawNode`'s cross sits against
 * the value that fails to resolve.
 *
 * How resolved references are drawn depends on the mode: DASHED in `"contain"`
 * (structure view, where a reference is a decoration on top of the tree), SOLID in
 * `"ref"` (graph view, where it is the primary relation).
 *
 * Arrow heads are solid triangles: they cannot share the dashes' `stroke()` call,
 * hence a separate `fill()` emitted after it, on the same Graphics.
 *
 * Returns an empty Graphics at LOD 2 (edges are neither legible nor worth their
 * cost at that zoom-out level).
 *
 * `focusIds` dims everything touching NONE of the focused nodes (the selection, on
 * `create.ts`'s side). A `stroke()` carries ONE style, so alpha cannot be set edge
 * by edge without producing one drawing call per edge: each color group splits into
 * two passes, the dimmed one first — so the selection's edges pass over — then the
 * full one. A null `focusIds` leaves the dimmed pass empty, and the drawing is then
 * exactly the pre-dimming one, instruction for instruction.
 *
 * A SET and not a single id, because graph view has two selection units: a card,
 * whose set is the singleton (and the rendering is then strictly the former one),
 * and an aggregate, whose set is that of its MEMBERS. Passing the members — and not
 * `clusterRelatedIds`'s wider "related" set — is what gives the right reading:
 * edges internal to the block and those crossing it stay full, while an edge
 * between two outside neighbors, which says nothing about the block, recedes.
 *
 * The function stays PURE and takes nothing but bare data: a set of ids, not the
 * notion of a selection nor the interface state carrying it.
 */
export function drawEdges(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  lod: Lod,
  mode: EdgeMode = "contain",
  focusIds: ReadonlySet<NodeId> | null = null,
  metrics: NodeMetrics = DEFAULT_METRICS,
  flow: EdgeFlow = "right",
): Graphics {
  const g = new Graphics();
  if (lod === 2) return g;

  /** Does the edge belong to the `full` alpha pass? With no focus, everything is
   * in the full pass and the dimmed pass emits no instruction.
   *
   * A reference also counts through its declaring ENTITY: the selection is the
   * value object in structure view, but the entity in graph view, where the value
   * object has no card to select. Without `fromEntity`, selecting a cart would dim
   * the edge its own row carries. The whole edge as a parameter rather than two
   * ids: the edge is what knows whether there is an entity behind its start. */
  const inPass = (edge: ContainEdge | RefEdge, full: boolean): boolean => {
    if (focusIds === null) return full;
    const touched =
      focusIds.has(edge.from) ||
      (edge.to !== null && focusIds.has(edge.to)) ||
      (edge.kind === "ref" && focusIds.has(edge.fromEntity));
    return touched === full;
  };

  // Dimmed first, full second: the selection's edges are thereby painted over the
  // others, inside a single Graphics where only emission order settles the
  // overlap. With no focus there is only one pass — not out of thrift, but so that
  // "no focus" and "the pre-dimming drawing" are the same code path, and not two
  // that have to resemble each other.
  const PASSES: { alpha: number; full: boolean }[] =
    focusIds === null
      ? [{ alpha: 1, full: true }]
      : [
          { alpha: DIM_ALPHA, full: false },
          { alpha: 1, full: true },
        ];

  // In `"ref"` mode (graph view), containment is not the relation being shown:
  // only references are. Two entities nested one inside the other are both
  // positioned, and drawing their containment edge would add a relation that does
  // not belong to this view.
  if (mode === "contain") {
    for (const pass of PASSES) {
      let hasContain = false;
      for (const edge of graph.containEdges) {
        if (!inPass(edge, pass.full)) continue;
        // The START goes through `anchorRectFor`: for an elided array, that is its
        // row's band on the parent card, so the edge leaves the `[ n items ]`
        // token and not the middle of the card. The ARRIVAL, for its part, is read
        // straight from `positions` — an edge cannot point at an elided node, which
        // has no card, and the `#p1 → tags` edge therefore falls away by itself,
        // replaced by the row it was describing.
        //
        // In `"down"` flow the row band says nothing — rows run across the flow —
        // so the start is the nearest DRAWN card instead, exactly as the layout
        // engine's anchor does in that direction (`anchorInFlowSpace`): the
        // expansion opens below the card, and the edge must leave where it opens.
        const from =
          flow === "down"
            ? nearestCardRectFor(graph, positions, edge.from)
            : anchorRectFor(graph, positions, edge.from, metrics);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        if (flow === "down") {
          const x1 = from.x + from.width / 2;
          const y1 = from.y + from.height;
          const x2 = to.x + to.width / 2;
          const y2 = to.y;
          const dy = Math.max(24, (y2 - y1) / 2);
          g.moveTo(x1, y1);
          g.bezierCurveTo(x1, y1 + dy, x2, y2 - dy, x2, y2);
        } else {
          const x1 = from.x + from.width;
          const y1 = from.y + from.height / 2;
          const x2 = to.x;
          const y2 = to.y + to.height / 2;
          const dx = Math.max(24, (x2 - x1) / 2);
          g.moveTo(x1, y1);
          g.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
        }
        hasContain = true;
      }
      if (hasContain) {
        g.stroke({ width: theme.strokes.edge, color: theme.edge.contain, alpha: pass.alpha });
      }
    }
  }

  for (const pass of PASSES) {
    let hasRef = false;
    const resolved: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const edge of graph.refEdges) {
      if (edge.dangling || edge.to === null) continue;
      if (!inPass(edge, pass.full)) continue;
      // The START is LIFTED to the nearest CARD: the value object's if it is
      // expanded, the host entity's otherwise. A reference carried by a value
      // object therefore stays drawn in every view, instead of vanishing along
      // with the card carrying it; which ROW it leaves from is stated by the
      // selection label (`drawEdgeLabels`), not by the attachment point. The
      // ARRIVAL is still read from `positions`: a target off screen has no edge to
      // show.
      const from = nearestCardRectFor(graph, positions, edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const { start, end } = refEdgeEnds(from, to);
      const x1 = start.x;
      const y1 = start.y;
      const x2 = end.x;
      const y2 = end.y;
      // The line stops at the foot of the arrow so as not to run through it.
      const len = Math.hypot(x2 - x1, y2 - y1);
      const t = len > ARROW_LENGTH ? (len - ARROW_LENGTH) / len : 1;
      const ex = x1 + (x2 - x1) * t;
      const ey = y1 + (y2 - y1) * t;
      if (mode === "ref") {
        // Graph view: the reference IS the relation being shown, not a decoration
        // laid over containment. Dashes mean "secondary"; they would read backwards
        // in a view whose whole point this is. Solid stroke, then — one single
        // segment instead of `dashedLine`'s N dashes, which makes the two modes
        // distinguishable by counting instructions.
        g.moveTo(x1, y1);
        g.lineTo(ex, ey);
      } else {
        dashedLine(g, x1, y1, ex, ey);
      }
      resolved.push({ x1, y1, x2, y2 });
      hasRef = true;
    }
    if (hasRef) {
      // Arrow heads are solid triangles: their `fill()` cannot share the strokes'
      // `stroke()`, so it follows its pass's alpha.
      g.stroke({ width: theme.strokes.edge, color: theme.edge.ref, alpha: pass.alpha });
      for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
      g.fill({ color: theme.edge.ref, alpha: pass.alpha });
    }
  }

  return g;
}

/** How far from the start the label sits, along the segment, and the perpendicular
 * offset that pushes it off the stroke. Close enough for the eye to attach the
 * label to ITS edge when several leave the same card, far enough not to overlap
 * the card it starts from. */
/**
 * The labels' position along the link, as a FRACTION of its length rather than in
 * fixed pixels: several edges leave the same card from neighboring points, and
 * 24 px from the start they have not spread apart yet — their labels overlapped
 * (observed on the demo, selecting #p16). A third of the way along, the strokes'
 * divergence has done the spacing work.
 *
 * The labels of one selection are also STAGGERED (`i % 3`): two near-parallel
 * edges would stay close at an equal fraction, staggering separates them along
 * their own stroke. The cap (0.38 + 2×0.14 = 0.66) keeps the label clearly on the
 * SOURCE side: past that, it would read as designating the target.
 */
const LABEL_ALONG_FRACTION = 0.38;
const LABEL_STAGGER_FRACTION = 0.14;
const LABEL_ASIDE = 10;
const LABEL_HEIGHT = 15;
const LABEL_RADIUS = 7.5;
const LABEL_PADDING_X = 6;

/**
 * What one needs to know about a label to draw it AND to reposition it elsewhere
 * on its stroke: its text, the segment it annotates, and its RESTING fraction
 * along that segment.
 *
 * The segment is carried here, and not just the final point, because the position
 * is no longer frozen at construction: `create.ts` recomputes it as the camera
 * moves (see `labelParamInView`), which requires knowing the whole stroke, not a
 * point laid on it.
 */
export interface EdgeLabelPlacement {
  text: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Resting position, as a fraction of the segment's length. */
  fraction: number;
}

/**
 * Where to place the label of each reference OUTGOING from the selected node, and
 * what to write on it. Pure data, no Pixi object: `drawEdgeLabels` is what renders,
 * and `create.ts` what repositions as the camera moves.
 *
 * This is the "progressive disclosure" half of reference drawing: an edge's start
 * is always a CARD (see `nearestCardRectFor`), which keeps the resting view sober
 * but does not say which ROW the reference leaves from. The label carries that
 * detail, and only once it has been asked for by selecting the source.
 *
 * Two texts, depending on what the selection designates:
 * - `field` alone when the selection IS the carrying node (a direct reference of
 *   the entity, or the value object's card itself) — the path from the selected
 *   card has a single segment, spelling it out would be verbose;
 * - `label.field` (`lines[0].productRef`) when it is the declaring ENTITY that is
 *   selected while the row is carried by a hidden value object. The carrying node's
 *   label is the INSTANTIATED path, index included: it designates the exact
 *   element, which the config's `lines[*].productRef` does not.
 *
 * Nothing on selecting the TARGET (an incoming edge does not read from a field of
 * the selected card), nothing for an aggregate selection (the caller then passes
 * `null`), nothing for a broken reference — it is not drawn, and a label floating
 * without a stroke would designate nothing.
 *
 * The pill (card background, border outline) is what makes the label legible over
 * an aggregate envelope or another edge; without it the text blends into graph
 * view's tinted background.
 *
 * PURE, like the rest of the file: `selectedId` is a bare id, not the notion of a
 * selection — the caller is the one who knows who is selected and what the current
 * view makes of it.
 */
export function edgeLabelPlacements(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  selectedId: NodeId | null,
): EdgeLabelPlacement[] {
  const placements: EdgeLabelPlacement[] = [];
  if (selectedId === null) return placements;

  for (const edge of graph.refEdges) {
    if (edge.dangling || edge.to === null) continue;
    if (edge.from !== selectedId && edge.fromEntity !== selectedId) continue;
    // The same endpoints as the stroke it annotates: a label computed otherwise
    // would float beside its edge as soon as the start is lifted.
    const from = nearestCardRectFor(graph, positions, edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const { start, end } = refEdgeEnds(from, to);

    // The COMPLETE path from the entity, whatever node is selected:
    // `Product#p16.reviews[1].customerId`. The label slides with the viewport, so
    // it is often read near the TARGET, with the source off-frame — a path relative
    // to the selection (`customerId` alone) would then identify nothing. The prefix
    // is the entity's identity, not its `label` ("Product #p16"): the label's space
    // would cut the path in two when read.
    const fromEntity = graph.nodes.get(edge.fromEntity);
    const prefix =
      fromEntity?.kind === "entity"
        ? `${fromEntity.entityType}#${fromEntity.entityId}`
        : (fromEntity?.label ?? edge.fromEntity);
    const viaValueObject =
      edge.from === edge.fromEntity ? "" : `${graph.nodes.get(edge.from)?.label ?? edge.from}.`;
    const text = `${prefix}.${viaValueObject}${edge.field}`;

    // Staggering counts the labels KEPT, not the edges examined: an edge dropped
    // above (target off screen) must not leave an empty step in the series,
    // otherwise two kept neighbors land on the same step one time in three.
    placements.push({
      text,
      start,
      end,
      fraction: LABEL_ALONG_FRACTION + (placements.length % 3) * LABEL_STAGGER_FRACTION,
    });
  }

  return placements;
}

/**
 * The point where a placement's label sits, at fraction `t` of the segment.
 *
 * The segment's frame: `u` towards the arrival, its perpendicular to move off the
 * stroke. A segment of zero length (two cards on the same spot) has no direction —
 * the horizontal is the fallback, the label staying at the start point.
 *
 * Exported because `create.ts` repositions the labels as the camera moves and must
 * find EXACTLY the same point as the initial render: two copies of the
 * perpendicular offset would make the label jump by a hair on the first camera
 * frame.
 */
export function edgeLabelPosition(
  start: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  const along = len * t;
  return {
    x: start.x + ux * along - uy * LABEL_ASIDE,
    y: start.y + uy * along + ux * LABEL_ASIDE,
  };
}

/**
 * The fraction at which to place the label so it stays IN the viewport, `baseT`
 * being its resting position.
 *
 * The why: a label frozen a third of the way along the link becomes useless as soon
 * as you zoom on the TARGET — you see a stroke arrive without knowing which
 * reference it is, and you would have to zoom out then travel back to the source to
 * read it. So the label slides along its own stroke, like a road name on a map, and
 * stays on the stretch you are looking at.
 *
 * `baseT` remains the RESTING position: as long as the edge fits entirely on
 * screen, nothing moves (`t0 <= 0 && t1 >= 1`). Sliding is triggered only by what
 * justifies it — part of the link having left the frame.
 *
 * `marginWorld` pushes the label off the frame's edge: sitting exactly on the cut,
 * the pill would be half outside. When the visible stretch is shorter than two
 * margins, no position honors both: its MIDDLE is then the least bad compromise.
 */
export function labelParamInView(
  start: { x: number; y: number },
  end: { x: number; y: number },
  baseT: number,
  viewport: Rect,
  marginWorld: number,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  // A segment of zero length has no parametrization to clip.
  if (len === 0) return baseT;

  // Liang-Barsky: the segment is reduced to the interval of `t` where it lies
  // inside the rect. Each edge gives a constraint; `p < 0` bounds it from below
  // (entry), `p > 0` from above (exit).
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [
    start.x - viewport.x,
    viewport.x + viewport.width - start.x,
    start.y - viewport.y,
    viewport.y + viewport.height - start.y,
  ];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      // Parallel to this edge: outside the band, hence never visible.
      if (qi < 0) return baseT;
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return baseT;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return baseT;
      if (r < t1) t1 = r;
    }
  }
  if (t1 <= t0) return baseT;
  // Edge entirely visible: the resting position is already the right one, and the
  // margin has no business moving it — the user must see the label move only when
  // its link leaves the frame.
  if (t0 <= 0 && t1 >= 1) return baseT;

  const pad = marginWorld / len;
  const lo = t0 + pad;
  const hi = t1 - pad;
  if (lo > hi) return (t0 + t1) / 2;
  return Math.min(hi, Math.max(lo, baseT));
}

/**
 * Renders the placements as labeled pills, one SUB-CONTAINER per label.
 *
 * The pill (card background, border outline) is what makes the label legible over
 * an aggregate envelope or another edge; without it the text blends into graph
 * view's tinted background.
 *
 * The children's order follows that of `placements`, and this is a CONTRACT:
 * `create.ts` repositions the labels by pairing `children[i]` with `placements[i]`.
 * Do not sort or filter here.
 */
export function drawEdgeLabels(
  placements: readonly EdgeLabelPlacement[],
  theme: Theme,
  useBitmapText: boolean,
  metrics: NodeMetrics = DEFAULT_METRICS,
): Container {
  const container = new Container();

  for (const placement of placements) {
    // One SUB-CONTAINER per label, pill and text drawn around the local (0,0):
    // repositioning a label is then nothing but a `position.set` on that
    // container. Without it, following the camera would require recreating a
    // `Text` per pan frame — the real cost, by far.
    const item = new Container();

    // Width BUDGETED up front in average advances, like `measureNode` and
    // `arrayTokenWidth`: a `Text`'s real measurement depends on the canvas, hence
    // on the runtime, and the pill must keep the same geometry everywhere.
    const width = placement.text.length * charWidthFor("badge", metrics) + 2 * LABEL_PADDING_X;

    const pill = new Graphics();
    pill
      .roundRect(-width / 2, -LABEL_HEIGHT / 2, width, LABEL_HEIGHT, LABEL_RADIUS)
      .fill(theme.surface.card)
      .stroke({ width: 1, color: theme.edge.border });
    item.addChild(pill);

    // Text CENTERED in the pill and not pinned to its edge: the width is a budget
    // in average advances, hence almost always a little wide for the real text —
    // pinning it left would then leave a void on the right, which the eye reads as
    // a misalignment.
    const label = createLabel(placement.text, theme, "badge", theme.edge.ref, useBitmapText);
    label.position.set(Math.round(-label.width / 2), Math.round(-label.height / 2));
    item.addChild(label);

    const at = edgeLabelPosition(placement.start, placement.end, placement.fraction);
    item.position.set(at.x, at.y);
    container.addChild(item);
  }

  return container;
}

export interface EdgeHit {
  edge: RefEdge;
  graphics: Graphics;
}

const REF_HIT_WIDTH = 14;

/**
 * Does the bounding box of the segment `start`→`end` touch `view`?
 *
 * A conservative and deliberately coarse test: it keeps segments that graze the
 * frame diagonally without reaching it, but it can NEVER drop one that crosses it —
 * the only acceptable direction of error for a visibility filter. Edge contact
 * counts, as it does everywhere else.
 */
function segmentBoxInView(
  start: { x: number; y: number },
  end: { x: number; y: number },
  view: Rect,
): boolean {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return minX <= view.x + view.width && view.x <= maxX && minY <= view.y + view.height && view.y <= maxY;
}

/**
 * One invisible, thickened (14px) hit area per RESOLVED reference edge. Purely
 * geometric: the caller sets `eventMode`/`cursor` and wires the tap. Alpha is 0,
 * but since Graphics hit-testing is geometric, the shape stays clickable.
 *
 * A broken reference gets none: nothing is drawn for it any more, and a target laid
 * down in the void would promise a navigation `followRef` cannot perform. What
 * flags it is on the card, where the card's own tap suffices.
 *
 * `worldView`, when provided, restricts production to the edges whose SEGMENT can
 * cross that world rectangle — tested on its bounding box, hence conservative: an
 * edge that merely crosses the frame without having an endpoint in it is indeed
 * kept, and only those whose box misses the window entirely are dropped. This is
 * the layer's cost lever: it produces one INTERACTIVE Graphics per edge, and a
 * large dataset has tens of thousands of them, all pushed through the render pass
 * and through hit-testing when only the ones on screen can be aimed at. `null`
 * (the default) produces them all, which remains the original behavior.
 */
export function drawEdgeHitAreas(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  worldView: Rect | null = null,
): EdgeHit[] {
  const hits: EdgeHit[] = [];
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue;
    // The same LIFTED start as `drawEdges` — its nearest card, not its own rect: a
    // reference carried by a hidden value object is drawn from the host card, and a
    // hit area read from `positions` then did not exist at all, leaving a stroke
    // visible but inert.
    const from = nearestCardRectFor(graph, positions, edge.from);
    if (!from) continue;
    const to = positions.get(edge.to);
    if (!to) continue;
    const { start, end } = refEdgeEnds(from, to);
    if (worldView && !segmentBoxInView(start, end, worldView)) continue;
    const g = new Graphics();
    g.moveTo(start.x, start.y)
      .lineTo(end.x, end.y)
      .stroke({ width: REF_HIT_WIDTH, color: 0xffffff, alpha: 0, cap: "round" });
    hits.push({ edge, graphics: g });
  }
  return hits;
}

/**
 * Selection highlight: an outline on the node, on its parent chain up to the root,
 * and on its RESOLVED outgoing references. Returns an empty Graphics if nothing is
 * selected or if the selected node is not visible.
 *
 * A broken reference has no edge left to restyle: it flags itself only on the card,
 * through `drawNode`'s cross.
 *
 * This is the only place, along with those crosses, where red appears: since
 * nothing else is red, the selection reads immediately.
 *
 * The highlight of a resolved reference REUSES `drawEdges`'s geometry and style —
 * same anchors, same stop at the foot of the arrow, same repainted head — and its
 * stroke follows the mode: solid in `"ref"`, dashed in `"contain"`. In other words,
 * it makes the existing edge CHANGE STYLE instead of superimposing a second one.
 * Dashes laid over graph view's solid stroke read as one more edge, and its line ran
 * through the arrow head of the very edge it was meant to underline.
 */
export function drawSelectionOverlay(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  selectedId: NodeId | null,
  mode: EdgeMode = "contain",
  flow: EdgeFlow = "right",
): Graphics {
  const g = new Graphics();
  if (!selectedId) return g;
  const rect = positions.get(selectedId);
  if (!rect) return g;

  g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card).stroke({
    width: theme.strokes.selection,
    color: theme.accent.selection,
  });

  let hasChain = false;
  let node = graph.nodes.get(selectedId);
  while (node && node.parentId !== null) {
    const childRect = positions.get(node.id);
    const parentRect = positions.get(node.parentId);
    if (childRect && parentRect) {
      // The same geometry as `drawEdges`'s containment, flow for flow: the
      // highlight must COVER the stroke it underlines, not run beside it.
      if (flow === "down") {
        const x1 = parentRect.x + parentRect.width / 2;
        const y1 = parentRect.y + parentRect.height;
        const x2 = childRect.x + childRect.width / 2;
        const y2 = childRect.y;
        const dy = Math.max(24, (y2 - y1) / 2);
        g.moveTo(x1, y1).bezierCurveTo(x1, y1 + dy, x2, y2 - dy, x2, y2);
      } else {
        const x1 = parentRect.x + parentRect.width;
        const y1 = parentRect.y + parentRect.height / 2;
        const x2 = childRect.x;
        const y2 = childRect.y + childRect.height / 2;
        const dx = Math.max(24, (x2 - x1) / 2);
        g.moveTo(x1, y1).bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      }
      hasChain = true;
    }
    node = graph.nodes.get(node.parentId);
  }
  if (hasChain) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });

  let hasRefs = false;
  const resolved: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const edge of graph.refEdges) {
    // Same rule as `drawEdgeLabels`: an edge also belongs to its declaring entity.
    // Without `fromEntity`, selecting the entity would label a lifted edge WITHOUT
    // highlighting it — two contradictory answers to the same gesture, on the same
    // stroke.
    if (edge.from !== selectedId && edge.fromEntity !== selectedId) continue;
    if (edge.to === null || edge.dangling) continue;
    // The same LIFTED start as `drawEdges`: the highlight must COVER the stroke,
    // so it cannot resolve its attachment point any differently than it does.
    const from = nearestCardRectFor(graph, positions, edge.from);
    if (!from) continue;
    const to = positions.get(edge.to);
    if (!to) continue;
    const { start, end } = refEdgeEnds(from, to);
    // The line stops at the foot of the arrow so as not to run through it.
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const t = len > ARROW_LENGTH ? (len - ARROW_LENGTH) / len : 1;
    const ex = start.x + (end.x - start.x) * t;
    const ey = start.y + (end.y - start.y) * t;
    if (mode === "ref") {
      g.moveTo(start.x, start.y);
      g.lineTo(ex, ey);
    } else {
      dashedLine(g, start.x, start.y, ex, ey);
    }
    resolved.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    hasRefs = true;
  }
  if (hasRefs) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });
  if (resolved.length > 0) {
    // Arrow heads are solid triangles: their `fill()` cannot share the strokes'
    // `stroke()`, hence this separate call — exactly `drawEdges`'s split.
    for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
    g.fill(theme.accent.selection);
  }

  return g;
}

/**
 * Search highlight: a halo around every visible result and a heavier outline in
 * `accent.matchCurrent` on the current one, drawn last so it goes on top. An id
 * absent from `positions` is ignored without a sound.
 *
 * NO FILL OVER THE CARD. The previous treatment laid a translucent veil across
 * the whole box, which lowered the contrast of the very text the user was
 * hunting for: the emphasis made the result harder to read than its neighbours.
 * The halo carries the same weight from the outside and leaves the body alone.
 *
 * And the current match no longer wears `accent.selection`: a found card looked
 * selected, when the two are different notions the user chains — search, then
 * select. One costume for two concepts is what made the pair unreadable side by
 * side.
 */
export function drawSearchHighlights(
  positions: Map<NodeId, Rect>,
  theme: Theme,
  matchedIds: Iterable<NodeId>,
  currentId: NodeId | null,
): Graphics {
  const g = new Graphics();

  // The halo sits OUTSIDE the card: inflated by its own width so the stroke's
  // inner edge lands on the card's outline rather than across its border.
  const halo = theme.strokes.match * 2;

  for (const id of matchedIds) {
    if (id === currentId) continue; // drawn below, so it goes on top
    const rect = positions.get(id);
    if (!rect) continue;
    g.roundRect(rect.x - halo, rect.y - halo, rect.width + halo * 2, rect.height + halo * 2, theme.radii.card + halo)
      .stroke({ width: theme.strokes.match, color: theme.accent.matchStroke, alpha: 0.55 });
    g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
      .stroke({ width: theme.strokes.match, color: theme.accent.matchStroke });
  }

  if (currentId !== null) {
    const rect = positions.get(currentId);
    if (rect) {
      g.roundRect(rect.x - halo, rect.y - halo, rect.width + halo * 2, rect.height + halo * 2, theme.radii.card + halo)
        .stroke({ width: theme.strokes.matchCurrent, color: theme.accent.matchCurrent, alpha: 0.55 });
      g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
        .stroke({ width: theme.strokes.matchCurrent, color: theme.accent.matchCurrent });
    }
  }

  return g;
}

/**
 * Paints the aggregate envelopes: a translucent fill plus an outline, in the accent
 * color of the root's type. The layer receiving them is the lowest in the world, so
 * they pass behind the edges and the cards.
 *
 * The envelope is the minimal enclosing circle of the aggregate's cards, computed
 * on the core side (`enclosingCircle`). What we paint here is not merely equal to
 * what layout spaced out: it is the SAME disc. `graph-layout.ts` computes it once
 * on the packed block, then translates it along with its cards. A zero or negative
 * radius is not a surface and is ignored.
 *
 * One single thing recomputes this disc after layout: moving a card with the mouse
 * (`recomputeClusterCircle`, in `create.ts`), which redoes the SAME computation
 * with the SAME `hullPadding` — the one the engine exposes. Moving a whole
 * aggregate, for its part, recomputes nothing: it translates the disc along with
 * its cards, exactly as the engine does.
 */
export function drawClusters(
  clusters: {
    circle: { cx: number; cy: number; r: number };
    color: string;
    /**
     * Hover intensity, from 0 (at rest) to 1 (hovered). Absent means 0: the
     * resting rendering is the pre-hover one, down to the digit.
     *
     * The value arrives ALREADY eased by `attachHover` (ease-out quad); so we only
     * interpolate linearly here, otherwise the curve would apply twice and the
     * ramp would start limply.
     */
    hover?: number;
    /**
     * True when the envelope has no link to the current selection: both its alphas
     * are then multiplied by `DIM_ALPHA`. Absent means false, so a caller ignoring
     * the field gets the pre-dimming rendering.
     *
     * A BOOLEAN and not a numeric factor: dimming has only two states — the
     * question put to `focus.ts` is "related or not", never "how much". A factor
     * would let every caller choose its own, and that is precisely what
     * `DIM_ALPHA` forbids so cards, edges and envelopes recede by the same step.
     * Who decides remains `create.ts` (`clustersFor`), the only one that knows the
     * selection; what gets painted then is settled here.
     */
    dim?: boolean;
  }[],
  theme: Theme,
): Graphics {
  const g = new Graphics();
  for (const cluster of clusters) {
    const { cx, cy, r } = cluster.circle;
    if (!(r > 0)) continue;
    // Defensive clamping: no source produces an intensity outside [0,1], but an
    // alpha > 1 or negative would not merely be ugly, it would be invalid for the
    // renderer.
    const t = Math.min(1, Math.max(0, cluster.hover ?? 0));
    // Dimming MULTIPLIES the hover state instead of replacing it: a dimmed
    // envelope the pointer crosses still responds, while staying in the
    // background. Hover says "this one is grabbable", dimming says "this one says
    // nothing about the selection" — two pieces of information that do not cancel
    // each other out.
    const dim = cluster.dim === true ? DIM_ALPHA : 1;
    g.circle(cx, cy, r);
    // The three levels rise together: the fill alone would make a smudge with no
    // crisp outline, the outline alone a ring with no body. Their simultaneous
    // rise is what makes the envelope read as an object one can grab — which it is,
    // since this disc is what moves the whole aggregate.
    //
    // The stroke's WIDTH, for its part, escapes dimming: it states the object's
    // size, not its importance, and thinning it on top of paling it would push the
    // dimmed envelope into sub-pixel precision.
    g.fill({ color: cluster.color, alpha: (0.08 + t * (0.15 - 0.08)) * dim });
    g.stroke({
      width: 1.5 + t * (2 - 1.5),
      color: cluster.color,
      alpha: (0.35 + t * (0.6 - 0.35)) * dim,
    });
  }
  return g;
}

/**
 * The envelopes' GRAB targets: one empty, transparent container per disc, with no
 * role other than receiving the pointer.
 *
 * Separating the target from the visual is not a refinement, it is the condition
 * for the gesture to exist at all: the envelopes' Graphics is destroyed and rebuilt
 * on every frame of a move, so listeners placed on it would die on the first frame
 * of the drag they just started. Same split as the edges and their `edgeHitLayer`.
 *
 * The container is POSITIONED on the disc's center and its `hitArea` is a circle
 * centered on the local origin, rather than a circle in world coordinates on a
 * container at the origin. Moving the aggregate then comes down to writing its
 * position, as for a card, instead of mutating the hit region's geometry every
 * frame.
 *
 * The input object is returned AS IS (not copied): it is layout's `ClusterShape`,
 * and moving mutates it in place so the next repaint sees the new shape.
 */
export function drawClusterHitAreas<T extends { cx: number; cy: number; r: number }>(
  clusters: T[],
): { cluster: T; container: Container }[] {
  const hits: { cluster: T; container: Container }[] = [];
  for (const cluster of clusters) {
    if (!(cluster.r > 0)) continue;
    const container = new Container();
    container.position.set(cluster.cx, cluster.cy);
    container.hitArea = new Circle(0, 0, cluster.r);
    container.eventMode = "static";
    // `grab` and not `pointer`: a tap on this disc does select its aggregate, but
    // the DOMINANT gesture remains the grab — the tap is merely what lies below it,
    // under the threshold. `create.ts` sets this cursor back after `attachTap`,
    // which would replace it with `pointer`. The switch to `grabbing` during the
    // gesture is already carried by `attachDrag`.
    container.cursor = "grab";
    hits.push({ cluster, container });
  }
  return hits;
}

// --------------------------------------------------------------------------
// The graph view's SEMANTIC regime
//
// Below the LOD 2 threshold, graph view stops drawing its cards and paints the
// AGGREGATES as nodes: one disc per aggregate, at the position and radius layout
// has already computed, plus the references folded onto aggregate pairs. What one
// reads then is no longer the data, it is the architecture.
//
// The threshold is not a third setting: it is EXACTLY `lodForScale`, and LOD 2 is
// precisely the scale at which a card is nothing but a solid rectangle — that is,
// at which it has ceased to carry any information at all. Replacing 6,251 mute
// rectangles with 1,300 named discs is therefore a strict gain there, and never a
// loss. A threshold specific to the semantic regime would have demanded its own
// rebuild trigger, competing with the LOD's; it would also have opened a band of
// scales where the two regimes fight over the screen — the mixed state this split
// forbids by construction.
// --------------------------------------------------------------------------

/**
 * An aggregate ready to be painted as a NODE: the bare data the three functions
 * below consume.
 *
 * The same shape as `drawClusters`'s input — it is the same disc — augmented with
 * what a node must say about itself: its name and its size.
 */
export interface SemanticNode {
  /** The aggregate's id. Serves as the LABEL of its label's sub-container, which
   * lets the caller find and move only the label concerned while a disc is being
   * grabbed — instead of redoing all 1,300 per frame. */
  id: string;
  circle: { cx: number; cy: number; r: number };
  color: string;
  label: string;
  count: number;
  /** Hover intensity, from 0 to 1. Absent means 0. */
  hover?: number;
  /** No link to the current selection. Absent means false. */
  dim?: boolean;
}

/**
 * The label's size and the badge's, as a fraction of the disc's RADIUS.
 *
 * Proportional, and that is the only way a semantic zoom holds: the disc grows with
 * the camera, so its name must grow with it. A size in fixed font pixels would give
 * a label unreadable at the global framing and then outsized three notches later.
 */
export const SEMANTIC_LABEL_RATIO = 0.2;
export const SEMANTIC_BADGE_RATIO = 0.13;

/**
 * The smallest a semantic label may be ON SCREEN, in CSS pixels.
 *
 * `SEMANTIC_LABEL_RATIO` sizes a label from its disc, which is right as long as
 * the disc is big: it keeps the label inside the circle it names. Zoomed out on
 * a dense set, the small aggregates' labels fall to a fraction of a pixel and
 * become a smudge that says nothing — the name is there, and unreadable, which
 * is worse than absent.
 *
 * The floor is expressed on SCREEN and not in the world: it is a property of the
 * eye, not of the layout, so it has to be divided back by the camera's scale to
 * become a world size.
 */
export const SEMANTIC_LABEL_MIN_SCREEN_PX = 9;

/**
 * A label's usable width, as a fraction of the radius — that is, 70% of the
 * diameter, which keeps the text inside the disc rather than on the longest chord,
 * where it would spill out top and bottom.
 *
 * A consequence, and it is intended: combined with `SEMANTIC_LABEL_RATIO`, this
 * fraction makes the truncation budget INDEPENDENT of the radius — the radius
 * cancels out between the available width and the font size. Every disc therefore
 * shows the same number of characters, large or small, which makes the disc's size
 * read as a quantity of members and not as a quantity of text.
 */
export const SEMANTIC_LABEL_WIDTH_RATIO = 1.4;

/** The gap between the label and its badge, as a fraction of the label's size. */
const SEMANTIC_LABEL_GAP_RATIO = 0.18;

/** A disc's outline width, as a fraction of its radius: at rest, then at full
 * intensity. Proportional for the same reason as the label. */
const SEMANTIC_STROKE_RATIO = 0.03;
const SEMANTIC_STROKE_RATIO_HOVER = 0.05;

/**
 * A disc's accent intensities, at rest and at full intensity — then its outline's.
 *
 * Clearly above an envelope's (0.08 → 0.15): an envelope is a REGION behind cards,
 * a semantic disc IS the object.
 *
 * These are NOT render alphas, and that is a measured performance decision: the
 * colors are pre-mixed with the canvas (`blendOver`) and painted OPAQUE. Two
 * reasons, pulling the same way:
 *  - the aggregated edges pass UNDER the discs; a translucent disc would let them
 *    show through it, and on a dense dataset each one then fills up with the network
 *    routing around it, label included. So an opaque background was needed anyway;
 *  - obtained through a second fill in the canvas color, that background doubled the
 *    painted surface: measured on the real dataset (1,300 discs, 1600×1000, headless
 *    software rendering), 755 ms per frame at rest against 380 ms with a single
 *    fill. Mixing up front gives exactly the same pixel for half the cost.
 *
 * The label stays painted in `ink.primary`, the same ink as on a card: the
 * moderation of these intensities is what allows it, without having to choose a
 * contrast color per accent — a luminance computation the theme does not carry and
 * that an accent overridden by the host (`byEntityType`) would make wrong.
 */
const SEMANTIC_FILL_MIX = 0.3;
const SEMANTIC_FILL_MIX_HOVER = 0.5;
const SEMANTIC_STROKE_MIX = 0.75;
const SEMANTIC_STROKE_MIX_HOVER = 1;

/**
 * `over` laid onto `base` at `amount`, returned as an OPAQUE color.
 *
 * Memoized, and it has to be: `drawSemanticDiscs` is called again on every frame of
 * an aggregate hover, and without a cache it would allocate two `Color`s per disc
 * per frame. The number of distinct pairs is tiny — a handful of accents × a handful
 * of intensities — so the cache fills once and stops growing. It is module-global
 * and survives a theme change without risk: the key carries both colors, so two
 * themes cannot share an entry.
 *
 * Pixi's `Color` rather than a home-grown "#rrggbb" parser: a host can set any CSS
 * color through `byEntityType`, and that is exactly the set Pixi already knows how
 * to read.
 */
const blendCache = new Map<string, number>();
export function blendOver(base: string, over: string, amount: number): number {
  const key = `${base}|${over}|${amount.toFixed(4)}`;
  const known = blendCache.get(key);
  if (known !== undefined) return known;
  const [br, bg, bb] = new Color(base).toRgbArray();
  const [or, og, ob] = new Color(over).toRgbArray();
  const t = Math.min(1, Math.max(0, amount));
  const mix = (b: number, o: number): number =>
    Math.round(Math.min(255, Math.max(0, (b + (o - b) * t) * 255)));
  const value = (mix(br!, or!) << 16) | (mix(bg!, og!) << 8) | mix(bb!, ob!);
  blendCache.set(key, value);
  return value;
}

/**
 * The number of sides of the polygon that STANDS IN for a disc.
 *
 * `Graphics.circle()` picks its fineness from the radius in WORLD coordinates,
 * which has nothing to do with the size on screen: a 1,000 world-px envelope seen at
 * scale 0.04 is 80 px, and Pixi still cuts it into several hundred segments. Across
 * 1,300 discs, that makes hundreds of thousands of triangles per frame — measured on
 * the real dataset in headless software rendering: 494 ms per frame at rest, against
 * 60 ms with this polygon.
 *
 * 36 sides, and that is well beyond what is needed: the maximum gap between the
 * polygon and the circle is `r × (1 − cos(π/36))`, i.e. 0.4% of the radius — less
 * than a third of a pixel on the real dataset's largest disc, at the scale where the
 * semantic regime exists. Past the LOD 2 threshold, it is no longer these discs that
 * are painted but `drawClusters`'s envelopes, which keep the true circle: the
 * comparison therefore never arises side by side.
 */
const SEMANTIC_DISC_SEGMENTS = 36;

function discPath(g: Graphics, cx: number, cy: number, r: number): void {
  g.moveTo(cx + r, cy);
  for (let i = 1; i < SEMANTIC_DISC_SEGMENTS; i++) {
    const angle = (i / SEMANTIC_DISC_SEGMENTS) * Math.PI * 2;
    g.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  g.closePath();
}

/**
 * Paints the aggregates as solid discs.
 *
 * SEPARATE from the labels, and that is not cosmetic: THIS Graphics is destroyed
 * and remade on every frame of an aggregate hover (`redrawClusters`), whereas the
 * labels depend on no intensity. Painting them in the same pass would rebuild 1,300
 * texts sixty times a second for a strictly identical rendering.
 *
 * A zero or negative radius is ignored, as for an envelope: it is not a surface.
 */
export function drawSemanticDiscs(nodes: SemanticNode[], theme: Theme): Graphics {
  const g = new Graphics();
  const canvas = theme.surface.canvas;
  for (const node of nodes) {
    const { cx, cy, r } = node.circle;
    if (!(r > 0)) continue;
    const t = Math.min(1, Math.max(0, node.hover ?? 0));
    // Dimming MULTIPLIES the accent's intensity instead of adding transparency: a
    // dimmed disc recedes towards the canvas, like a dimmed envelope, but it keeps
    // HIDING the edges passing underneath — otherwise the drawing's background
    // would come back up through the very blocks we pushed out of sight.
    const dim = node.dim === true ? DIM_ALPHA : 1;
    discPath(g, cx, cy, r);
    g.fill(
      blendOver(
        canvas,
        node.color,
        (SEMANTIC_FILL_MIX + t * (SEMANTIC_FILL_MIX_HOVER - SEMANTIC_FILL_MIX)) * dim,
      ),
    );
    g.stroke({
      // The width escapes dimming, exactly as on an envelope: it states the
      // object's size, not its importance.
      width: r * (SEMANTIC_STROKE_RATIO + t * (SEMANTIC_STROKE_RATIO_HOVER - SEMANTIC_STROKE_RATIO)),
      color: blendOver(
        canvas,
        node.color,
        (SEMANTIC_STROKE_MIX + t * (SEMANTIC_STROKE_MIX_HOVER - SEMANTIC_STROKE_MIX)) * dim,
      ),
    });
  }
  return g;
}

/**
 * The RENDERED scale factor for one disc's label — `r * SEMANTIC_LABEL_RATIO`
 * floored at `SEMANTIC_LABEL_MIN_SCREEN_PX` on screen, then expressed relative to
 * the theme's header size.
 *
 * Shared between `drawSemanticLabels` (which needs it to fix the truncation
 * BUDGET) and `semanticLabelGeometry` (which needs it to place the text already
 * truncated), and that sharing is load-bearing: the budget is computed as
 * `(r * SEMANTIC_LABEL_WIDTH_RATIO) / k`, so painting the truncated text back at
 * this SAME `k` is exactly what makes its rendered width equal `r *
 * SEMANTIC_LABEL_WIDTH_RATIO` again — the width the budget was set to respect.
 * Computing the budget from the UNFLOORED `k` instead — as a prior revision of
 * this file did — but PAINTING at the floored one breaks that identity: the
 * rendered width becomes `r * SEMANTIC_LABEL_WIDTH_RATIO * (kFloored / kNatural)`,
 * i.e. inflated by however much the floor stretched the label. At `r=6,
 * cameraScale=0.1` that ratio is ≈75× — an 8.4-world-unit budget rendered at
 * ≈630 world units, on a disc 12 wide. The floored `k` used here keeps the two
 * in agreement, at every radius and every scale, including the ones the floor
 * exists to fix.
 */
function semanticLabelScale(r: number, cameraScale: number, theme: Theme): number {
  const size = Math.max(
    r * SEMANTIC_LABEL_RATIO,
    SEMANTIC_LABEL_MIN_SCREEN_PX / Math.max(cameraScale, 1e-6),
  );
  return size / theme.typography.header.size;
}

/**
 * The SCALE and POSITION of one disc's label and badge, given its world circle,
 * the two texts already decided for it, and the LIVE camera scale.
 *
 * Pulled out of `drawSemanticLabels` for one reason: `SEMANTIC_LABEL_MIN_SCREEN_PX`
 * is a SCREEN floor, so this geometry keeps changing as the camera keeps zooming —
 * and LOD 2 (the semantic regime) has no upper zoom-out bound, so nothing re-triggers
 * a `rebuild()` past the threshold that first entered it. `rescaleSemanticLabels` in
 * `create.ts` calls this on every frame the camera moves, to keep the labels
 * `drawSemanticLabels` already created in step with it, WITHOUT recreating them.
 * Sharing the formula here is what keeps the two from drifting apart — the risk a
 * hand-copied second implementation would carry.
 */
export function semanticLabelGeometry(
  circle: { cx: number; cy: number; r: number },
  text: string,
  countText: string,
  theme: Theme,
  metrics: NodeMetrics,
  cameraScale: number,
): { k: number; kBadge: number; labelX: number; labelY: number; badgeX: number; badgeY: number } {
  const { cx, cy, r } = circle;
  const k = semanticLabelScale(r, cameraScale, theme);
  // Recovered from `k` rather than recomputed: `size` is the on-screen-floored
  // label size in WORLD units, and `k` already carries it (`size = k *
  // theme.typography.header.size`) — recomputing the `Math.max` here would just
  // be `semanticLabelScale`'s body pasted a second time.
  const size = k * theme.typography.header.size;
  const kBadge = (r * SEMANTIC_BADGE_RATIO) / theme.typography.badge.size;

  // Both boxes are BUDGETED from `metrics` and the typography, not measured on the
  // rendered object. It is the same discipline as `measureNode` and `drawNode` on
  // the cards — draw exactly what was budgeted — and it also has a practical
  // consequence: reading a `Text`'s `.width`/`.height` triggers a canvas
  // measurement, hence a `document`, which would make this function untestable
  // outside a browser.
  const labelWidth = text.length * charWidthFor("header", metrics) * k;
  const labelHeight = theme.typography.header.size * k;
  const badgeWidth = countText.length * charWidthFor("badge", metrics) * kBadge;
  const badgeHeight = theme.typography.badge.size * kBadge;

  // The "name + count" block is centered VERTICALLY on the disc, not laid on its
  // center: a label whose baseline ran through the center would push the badge out
  // of the circle on small aggregates.
  const gap = size * SEMANTIC_LABEL_GAP_RATIO;
  const top = cy - (labelHeight + gap + badgeHeight) / 2;
  return {
    k,
    kBadge,
    labelX: Math.round(cx - labelWidth / 2),
    labelY: Math.round(top),
    badgeX: Math.round(cx - badgeWidth / 2),
    badgeY: Math.round(top + labelHeight + gap),
  };
}

/**
 * Each aggregate's name and its member count, centered in its disc.
 *
 * The text is created at the theme's size then SCALED, instead of being created at
 * the size wanted: that is what lets the 1,300 labels share the font atlas already
 * installed for the cards. Creating 1,300 `BitmapText`s at 1,300 different sizes
 * would demand as many atlases.
 *
 * Depends NEITHER on hover NOR on anything that changes per frame in itself — the
 * caller only calls THIS back on a rebuild or a change of selection. A live camera
 * scale is instead followed cheaply by `rescaleSemanticLabels`, which reuses
 * `semanticLabelGeometry` above to update the labels this function created without
 * recreating them (see there for why that is necessary in LOD 2).
 *
 * Each label and its badge live in a sub-container LABELED with the aggregate's id
 * — the same convention as `array-token:<index>` on the cards. That is what lets
 * the caller translate only the label of a grabbed disc, instead of rebuilding the
 * whole layer on every frame of the gesture.
 */
export function drawSemanticLabels(
  nodes: SemanticNode[],
  theme: Theme,
  useBitmapText: boolean,
  metrics: NodeMetrics = DEFAULT_METRICS,
  cameraScale = 1,
): Container {
  const layer = new Container();
  // No label is a target: the disc underneath carries the click, the move and the
  // hover. Without this, a text sitting at the center would steal the pointer from
  // its own grab area.
  layer.eventMode = "none";

  for (const node of nodes) {
    const { r } = node.circle;
    if (!(r > 0)) continue;
    // The RENDERED `k` — floor included — is what fixes the truncation budget, not
    // a hypothetical unfloored one: the budget is later used to decide how much of
    // the label survives, and that decision only stays honest if it is measured in
    // the scale the survivor is actually PAINTED at (see `semanticLabelScale`'s doc
    // for the overflow this avoids).
    const k = semanticLabelScale(r, cameraScale, theme);
    if (!(k > 0)) continue;
    // The budget is expressed in the UNSCALED space, the one where `metrics`'s
    // advances mean something: dividing the usable width by `k` is what keeps the
    // truncation in agreement with the text actually painted.
    const budget = (r * SEMANTIC_LABEL_WIDTH_RATIO) / k;
    const text = truncateMiddle(node.label, budget, charWidthFor("header", metrics));
    if (text.length === 0) continue;

    const countText = String(node.count);
    const label = createLabel(text, theme, "header", theme.ink.primary, useBitmapText);
    const badge = createLabel(countText, theme, "badge", theme.ink.muted, useBitmapText);
    const geo = semanticLabelGeometry(node.circle, text, countText, theme, metrics, cameraScale);
    label.scale.set(geo.k);
    badge.scale.set(geo.kBadge);
    label.position.set(geo.labelX, geo.labelY);
    badge.position.set(geo.badgeX, geo.badgeY);

    const group = new Container();
    group.label = node.id;
    group.addChild(label, badge);
    layer.addChild(group);
  }

  return layer;
}

/**
 * The weight at which an aggregated edge is painted at maximum.
 *
 * The capping is in the same spirit as layout's level 2 (`min(1, w/2)`): past a
 * certain coupling, "even more related" no longer has a useful visual translation,
 * and letting the weight run would let a single very chatty pair crush the whole
 * gradation. The value itself, though, belongs to the DRAWING and not to the
 * simulation: on the real dataset (28,685 references folded onto ~1,300
 * aggregates), a cap at 2 would saturate nearly every pair and make the gradation
 * mute.
 */
export const SEMANTIC_EDGE_WEIGHT_FULL = 8;

/**
 * The number of weight buckets.
 *
 * A `stroke()` carries ONE style, so one width per edge would mean one drawing call
 * per edge — thousands of them. Quantizing into four buckets brings the drawing down
 * to eight calls at most (four buckets × dimmed/full), for a gradation the eye reads
 * just as well: it is the same split into passes that `drawEdges` already does for
 * its two alphas.
 */
const SEMANTIC_EDGE_BUCKETS = 4;

/** An aggregated edge's width and alpha, from the weakest bucket to the strongest.
 * The width is a fraction of `unit` — a reference disc radius — and not in pixels:
 * like the labels, it must grow with the view. */
const SEMANTIC_EDGE_WIDTH_MIN = 0.02;
const SEMANTIC_EDGE_WIDTH_MAX = 0.12;
// Deliberately VERY low at the bottom of the range. On the real dataset, 28,685
// references fold into several thousand pairs: at a legible alpha, each stroke is a
// piece of information but their sum is an opaque sheet, and the view becomes again
// the plate of spaghetti it replaces. Nearly transparent, the weak links ADD UP into
// shading — it is the coupling density that reads — while the strong links stay
// strokes one follows with the eye.
const SEMANTIC_EDGE_ALPHA_MIN = 0.05;
const SEMANTIC_EDGE_ALPHA_MAX = 0.45;

export interface SemanticEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /** No link to the current selection. Absent means false. */
  dim?: boolean;
}

/**
 * Draws the references folded onto the aggregates, graded by their weight.
 *
 * `unit` is the REFERENCE disc radius the widths are fractions of. A bare number,
 * supplied by the caller: this function knows neither the discs nor the camera, and
 * a width in screen pixels would require one or the other.
 *
 * Emission order IS the overlap, inside a single Graphics: the dimmed ones first,
 * then the full ones, and within each group from the weakest bucket to the
 * strongest. A heavy edge therefore passes over the light ones crossing it, and the
 * selection over everything.
 */
export function drawSemanticEdges(edges: SemanticEdge[], theme: Theme, unit: number): Graphics {
  const g = new Graphics();
  if (edges.length === 0 || !(unit > 0)) return g;

  for (const full of [false, true]) {
    for (let bucket = 0; bucket < SEMANTIC_EDGE_BUCKETS; bucket++) {
      let has = false;
      for (const edge of edges) {
        if ((edge.dim !== true) !== full) continue;
        if (bucketOf(edge.weight) !== bucket) continue;
        g.moveTo(edge.x1, edge.y1);
        g.lineTo(edge.x2, edge.y2);
        has = true;
      }
      if (!has) continue;
      // The bucket's representative is its MIDDLE: the weakest bucket is thereby
      // never drawn at zero width, and the strongest never at the absolute
      // maximum, which keeps visual headroom for hovering the cards that will come
      // back on zoom.
      const t = (bucket + 0.5) / SEMANTIC_EDGE_BUCKETS;
      g.stroke({
        width: unit * (SEMANTIC_EDGE_WIDTH_MIN + t * (SEMANTIC_EDGE_WIDTH_MAX - SEMANTIC_EDGE_WIDTH_MIN)),
        color: theme.edge.ref,
        alpha:
          (SEMANTIC_EDGE_ALPHA_MIN + t * (SEMANTIC_EDGE_ALPHA_MAX - SEMANTIC_EDGE_ALPHA_MIN)) *
          (full ? 1 : DIM_ALPHA),
      });
    }
  }

  return g;
}

/** A weight's bucket, from 0 to `SEMANTIC_EDGE_BUCKETS - 1`. Exported so it can be
 * tested without a Graphics: this is the whole gradation, and an off-by-one there
 * would be invisible in the rendering. */
export function bucketOf(weight: number): number {
  const t = Math.min(1, Math.max(0, weight / SEMANTIC_EDGE_WEIGHT_FULL));
  return Math.min(SEMANTIC_EDGE_BUCKETS - 1, Math.floor(t * SEMANTIC_EDGE_BUCKETS));
}
