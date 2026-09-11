import { describe, it, expect } from "vitest";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import {
  CARD_LABEL_HEIGHT_RATIO,
  CARD_LABEL_LINE_HEIGHT_RATIO,
  CARD_LABEL_MIN_SCREEN_PX,
  CARD_LABEL_STEPS,
  LOD0_MIN_SCALE,
  LOD1_MIN_SCALE,
  cardLabelLayout,
  cardLabelStepForScale,
} from "../src/draw.js";

const HEADER_SIZE = 13;
const m = DEFAULT_METRICS;

/** The widest card and the inner width `drawNode` derives from it — the geometry
 * the card in the bug report has. */
const WIDE_INNER = m.maxWidth - m.railWidth - 2 * m.paddingX;
/** A card with a single row: the shortest shape the layout produces, and the one
 * whose HEIGHT — not width — is what limits its label. */
const SHORT_HEIGHT = m.headerHeight + m.rowHeight + m.paddingBottom;
/** A card tall enough that height never binds, like the cards in the report. */
const TALL_HEIGHT = 512;

/** Every scale in the LOD 1 band, sampled finely enough to catch a step boundary. */
function bandScales(): number[] {
  const scales: number[] = [];
  for (let s = LOD1_MIN_SCALE; s < LOD0_MIN_SCALE; s += 0.005) scales.push(Number(s.toFixed(4)));
  return scales;
}

describe("cardLabelStepForScale", () => {
  it("holds the screen floor across the whole LOD 1 band", () => {
    // The guarantee the steps exist for. It ties the LAST step to the band's
    // lower bound on purpose: widening the band downwards without extending
    // `CARD_LABEL_STEPS` must fail here rather than silently reintroduce the
    // unreadable label.
    for (const scale of bandScales()) {
      const step = cardLabelStepForScale(scale, HEADER_SIZE);
      expect(step * HEADER_SIZE * scale, `scale ${scale}`).toBeGreaterThanOrEqual(
        CARD_LABEL_MIN_SCREEN_PX - 1e-9,
      );
    }
  });

  it("never magnifies a label that already clears the floor on its own", () => {
    // Above `CARD_LABEL_MIN_SCREEN_PX / HEADER_SIZE` the theme's own size is
    // enough, so the step must be exactly 1 — LOD 1 there is byte-for-byte what
    // it drew before this mechanism existed.
    const neutral = CARD_LABEL_MIN_SCREEN_PX / HEADER_SIZE;
    for (const scale of [neutral, 0.9, 1, 2, 3]) {
      expect(cardLabelStepForScale(scale, HEADER_SIZE)).toBe(1);
    }
  });

  it("grows as the camera zooms out, and only by declared steps", () => {
    let previous = 0;
    for (const scale of [...bandScales()].reverse()) {
      const step = cardLabelStepForScale(scale, HEADER_SIZE);
      expect(CARD_LABEL_STEPS).toContain(step);
      expect(step, `scale ${scale}`).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
  });

  it("crosses a boundary only a handful of times over the band", () => {
    // The whole point of quantizing: a crossing costs a rebuild of every visible
    // card, so a continuous function here would rebuild on every wheel frame. The
    // count is asserted against the SAMPLE, which is finer than any wheel notch —
    // 140 samples, at most 5 rebuilds.
    const scales = bandScales();
    let crossings = 0;
    for (let i = 1; i < scales.length; i += 1) {
      if (
        cardLabelStepForScale(scales[i]!, HEADER_SIZE) !==
        cardLabelStepForScale(scales[i - 1]!, HEADER_SIZE)
      ) {
        crossings += 1;
      }
    }
    expect(scales.length).toBeGreaterThan(100);
    expect(crossings).toBeLessThanOrEqual(CARD_LABEL_STEPS.length - 1);
  });

  it("stays pinned to 1 outside the LOD 1 band", () => {
    // THE guarantee that LOD 0 and LOD 2 gain no rebuild from this mechanism:
    // `refreshCards` compares the step against the one a rebuild stored, so a step
    // that never varies there can never trigger one. LOD 0 draws its header at the
    // theme's size, which IS step 1; LOD 2 draws no text at all.
    for (const scale of [LOD0_MIN_SCALE, 1, 2, 3]) {
      expect(cardLabelStepForScale(scale, HEADER_SIZE), `LOD 0 @${scale}`).toBe(1);
    }
    for (const scale of [0, 0.01, 0.1, LOD1_MIN_SCALE - 1e-6]) {
      expect(cardLabelStepForScale(scale, HEADER_SIZE), `LOD 2 @${scale}`).toBe(1);
    }
  });

  it("takes the very bottom of the band to its largest step, and no further", () => {
    // The band's lower edge is where the floor is hardest to hold, and where a
    // step list too short would silently clamp below it. Asserted at the exact
    // boundary, which the sampled sweep above may step over.
    const step = cardLabelStepForScale(LOD1_MIN_SCALE, HEADER_SIZE);
    expect(step * HEADER_SIZE * LOD1_MIN_SCALE).toBeGreaterThanOrEqual(CARD_LABEL_MIN_SCREEN_PX);
    expect(step).toBeLessThanOrEqual(CARD_LABEL_STEPS[CARD_LABEL_STEPS.length - 1]!);
  });
});

describe("cardLabelLayout", () => {
  it("leaves a label that already fits on one line untouched at step 1", () => {
    // No regression at ordinary zoom: this is exactly what `truncateToWidth`
    // returned before, on the same card.
    const label = "Table #analyst_form_v2_forecast";
    const layout = cardLabelLayout(label, WIDE_INNER, TALL_HEIGHT, 1, HEADER_SIZE, m.headerCharWidth);
    expect(layout.k).toBe(1);
    expect(layout.lines).toEqual([label]);
  });

  it("wraps at the identifier's own separators rather than mid-word", () => {
    // At step 2.8 a 340-wide card fits 17 characters per line. Breaking on the
    // identifier's own separators is what makes the two halves read as parts of
    // a name.
    const layout = cardLabelLayout(
      "Table #analyst_form_v2_forecast",
      WIDE_INNER,
      TALL_HEIGHT,
      2.8,
      HEADER_SIZE,
      m.headerCharWidth,
    );
    expect(layout.lines).toEqual(["Table #analyst_", "form_v2_forecast"]);
  });

  it("keeps every line inside the card's inner width", () => {
    const labels = [
      "Table #analyst_form_v2_forecast",
      "Table #analyst_form_v2_origin_fund_characteristics",
      "Table #remark",
      "sansaucunseparateurdanstoutecettechainedecaracteres",
    ];
    for (const label of labels) {
      for (const step of CARD_LABEL_STEPS) {
        for (const height of [SHORT_HEIGHT, 140, TALL_HEIGHT]) {
          const layout = cardLabelLayout(
            label,
            WIDE_INNER,
            height,
            step,
            HEADER_SIZE,
            m.headerCharWidth,
          );
          const charWidth = m.headerCharWidth * layout.k;
          for (const line of layout.lines) {
            expect(line.length * charWidth, `${label} @${step} h${height}: "${line}"`).toBeLessThanOrEqual(
              WIDE_INNER + 1e-9,
            );
          }
        }
      }
    }
  });

  it("keeps the whole block inside the card's height", () => {
    for (const step of CARD_LABEL_STEPS) {
      for (const height of [SHORT_HEIGHT, 80, 140, TALL_HEIGHT]) {
        const layout = cardLabelLayout(
          "Table #analyst_form_v2_origin_fund_characteristics",
          WIDE_INNER,
          height,
          step,
          HEADER_SIZE,
          m.headerCharWidth,
        );
        const block = layout.lines.length * layout.lineHeight;
        expect(block, `@${step} h${height}`).toBeLessThanOrEqual(height * CARD_LABEL_HEIGHT_RATIO + 1e-9);
      }
    }
  });

  it("keeps `#` with the identifier it opens, not at the end of the line before", () => {
    // `Order #` / `o200` hangs the `#` at a line's end and orphans the id it
    // introduces. A budget of 8 fits `Order #` exactly, which is what made the
    // greedy fill take it before this asymmetry existed.
    const layout = cardLabelLayout("Order #o200", 8 * 6.5, TALL_HEIGHT, 1, 13, 6.5);
    expect(layout.lines).toEqual(["Order", "#o200"]);
  });

  it("never strands a separator on a line of its own", () => {
    // Regression, seen on the demo's dataset at scale 0.30: a budget of 5 against
    // `Order #o200` gave `Order` / `#` / `o200`. `Order ` was charged its trailing
    // space, overflowed the budget by one, hit the hard break and left the `#`
    // alone — a whole line box spent on one character of punctuation. A line is
    // measured as it is PAINTED, that is, elagued.
    const layout = cardLabelLayout("Order #o200", 5 * 6.5, TALL_HEIGHT, 1, 13, 6.5);
    expect(layout.lines).toEqual(["Order", "#o200"]);
  });

  it("hard-breaks only once no step can avoid it", () => {
    // A 24-character run with nothing to break on fits whole at a lower step, so
    // the descent takes that rather than cut it at the step asked for.
    const short = cardLabelLayout("abcdefghijklmnopqrstuvwx", WIDE_INNER, TALL_HEIGHT, 4, HEADER_SIZE, m.headerCharWidth);
    expect(short.lines).toEqual(["abcdefghijklmnopqrstuvwx"]);

    // Longer than the 48 characters even the theme's own size affords: nothing to
    // break on and nowhere left to descend, so the cut is the only honest answer.
    const long = "z".repeat(60);
    const cut = cardLabelLayout(long, WIDE_INNER, TALL_HEIGHT, 4, HEADER_SIZE, m.headerCharWidth);
    expect(cut.k).toBe(1);
    expect(cut.lines).toEqual([long.slice(0, 48), long.slice(48)]);
  });

  it("marks the cut with an ellipsis when NO step can hold the whole name", () => {
    // The descent's last resort. A name this long does not fit its card even at
    // the theme's own size, so something must be dropped — and what shows must SAY
    // so: a label silently amputated reads as a different name.
    const huge = Array.from({ length: 30 }, (_, i) => `segment_${i}`).join("_");
    const layout = cardLabelLayout(huge, WIDE_INNER, SHORT_HEIGHT, 5.6, HEADER_SIZE, m.headerCharWidth);
    // The theme's size, i.e. the bottom of the ladder: nothing larger fitted.
    expect(layout.k).toBe(1);
    expect(layout.lines.at(-1)!.endsWith("…")).toBe(true);
  });

  it("comes back down the ladder rather than amputate a name a smaller step would hold", () => {
    // Regression, seen on the demo's dataset at scale 0.20: on a card 140×113 —
    // the layout's `minWidth`, four rows — step 4 held one line where the name
    // needed two, and `Order #o200` came out as `Orde…`. A legible fragment of a
    // name is not a name.
    const narrowInner = m.minWidth - m.railWidth - 2 * m.paddingX;
    const layout = cardLabelLayout("Order #o200", narrowInner, 113, 4, HEADER_SIZE, m.headerCharWidth);
    expect(layout.k).toBeLessThan(4);
    expect(layout.k).toBeGreaterThan(1);
    expect(layout.lines.join("")).not.toContain("…");
  });

  it("never mangles a name on a narrow card, whatever the step, height or advance", () => {
    // The descent's real job. Two regressions live here, both on the demo's
    // 140-wide `Order` cards (the layout's `minWidth`):
    //  - at scale 0.20 the requested step fit 4 characters: `Orde` / `r #…`;
    //  - a TALL narrow card hid that from the height check entirely, since the
    //    extra lines a hard break produces fit there — height alone never caught it.
    // The advance is swept rather than fixed at the token's 6.5: `headerCharWidth`
    // is measured from the real font (`measureFontMetrics`), and an earlier fix
    // held only for the advances that happened to divide cleanly.
    const narrowInner = m.minWidth - m.railWidth - 2 * m.paddingX;
    for (const advance of [5.9, 6.0, 6.3, 6.5, 6.8, 7.0, 7.2]) {
      for (const step of CARD_LABEL_STEPS) {
        for (const height of [113, TALL_HEIGHT]) {
          const layout = cardLabelLayout("Order #o222", narrowInner, height, step, HEADER_SIZE, advance);
          expect(
            layout.lines.join("").replace(/\s/g, ""),
            `advance ${advance} @${step} h${height}`,
          ).toBe("Order#o222");
        }
      }
    }
  });

  it("caps the size by the card's height, so a label never outgrows its own card", () => {
    // The constraint the discs of the semantic regime never had: a card has a
    // fixed height, and the screen floor alone would ask for a font taller than
    // the shortest card.
    const layout = cardLabelLayout("Table #remark", WIDE_INNER, SHORT_HEIGHT, 5.6, HEADER_SIZE, m.headerCharWidth);
    const size = layout.k * HEADER_SIZE;
    expect(size).toBeLessThan(5.6 * HEADER_SIZE);
    expect(size * CARD_LABEL_LINE_HEIGHT_RATIO).toBeLessThanOrEqual(
      SHORT_HEIGHT * CARD_LABEL_HEIGHT_RATIO + 1e-9,
    );
  });

  it("returns no line when there is nothing to draw or no room to draw it", () => {
    expect(cardLabelLayout("", WIDE_INNER, TALL_HEIGHT, 1, HEADER_SIZE, m.headerCharWidth).lines).toEqual([]);
    expect(cardLabelLayout("Table #remark", 0, TALL_HEIGHT, 1, HEADER_SIZE, m.headerCharWidth).lines).toEqual([]);
    expect(cardLabelLayout("Table #remark", WIDE_INNER, 0, 1, HEADER_SIZE, m.headerCharWidth).lines).toEqual([]);
  });

  it("shows more of the name at a given step than end-truncation on one line would", () => {
    // The reason wrapping was chosen over harsher truncation: at step 4 a single
    // line holds 12 characters, the wrapped block holds the whole name.
    const label = "Table #analyst_form_v2_forecast";
    const layout = cardLabelLayout(label, WIDE_INNER, TALL_HEIGHT, 4, HEADER_SIZE, m.headerCharWidth);
    expect(layout.lines.join("").replace(/\s/g, "")).toBe(label.replace(/\s/g, ""));
  });
});
