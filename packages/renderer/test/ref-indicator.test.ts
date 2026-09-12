import { describe, it, expect } from "vitest";
import { Color, DOMAdapter, Graphics, Text } from "pixi.js";
import { buildGraph, DEFAULT_METRICS, type DataGraphConfig } from "@defsquare/datagraph-core";
import { drawNode } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * `drawNode` asks for each label's height in order to center it, and Pixi measures
 * that through a 2D canvas — absent from vitest's Node runtime. So we substitute
 * Pixi's DOM adapter with a fake canvas of FIXED advance: the measurement does not
 * need to be faithful here, only to exist, since what the tests observe is the
 * tint, the presence of the underline Graphics and the length of the TRUNCATED
 * strings — the latter computed by `truncateToWidth` from the theme's metrics,
 * never from the canvas.
 */
class FakeCanvasContext {
  font = "";
  letterSpacing = "";
  measureText(text: string) {
    return { width: text.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
  }
}
const browserAdapter = DOMAdapter.get();
DOMAdapter.set({
  ...browserAdapter,
  createCanvas: (width?: number, height?: number) =>
    ({
      width: width ?? 0,
      height: height ?? 0,
      getContext: () => new FakeCanvasContext(),
    }) as never,
  getCanvasRenderingContext2D: () => FakeCanvasContext as never,
});

const theme = resolveTheme(undefined);
const metrics = DEFAULT_METRICS;

/** An id long enough to be truncated in a narrow card: it is what makes the
 * value's truncation budget observable. */
const LONG_ID = "identifiant-de-client-extremement-long-pour-forcer-la-troncature";

const data = {
  customers: [{ id: LONG_ID, name: "Dupont" }],
  orders: [{ id: "o1", customerId: LONG_ID, total: 99.5 }],
};
const config: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
};

const graph = buildGraph(data, config);
const order = graph.nodes.get("/orders/0")!;
const rect = { x: 0, y: 0, width: 260, height: 140 };

/** The row indices the tests aim at, found by NAME: the row order belongs to
 * `buildGraph`, not to this file. */
const REF_ROW = order.rows.findIndex((r) => r.key === "customerId");
const PLAIN_ROW = order.rows.findIndex((r) => r.key === "total");

function render(refFields?: ReadonlySet<string>, at = rect, danglingFields?: ReadonlySet<string>) {
  if (refFields === undefined) {
    return drawNode(order, at, theme, 0, false, "#123456", metrics, false, false);
  }
  if (danglingFields === undefined) {
    return drawNode(order, at, theme, 0, false, "#123456", metrics, false, false, refFields);
  }
  return drawNode(
    order,
    at,
    theme,
    0,
    false,
    "#123456",
    metrics,
    false,
    false,
    refFields,
    danglingFields,
  );
}

/** A card's observable signature: each child's type, its text and its color. Two
 * renders identical up to this signature are, as far as this file is concerned,
 * the same render. */
function signature(container: ReturnType<typeof drawNode>): string[] {
  return container.children.map((child) => {
    if (child instanceof Text) return `Text:${child.text}:${String(child.style.fill)}`;
    return "Graphics";
  });
}

function textsOf(container: ReturnType<typeof drawNode>): Text[] {
  return container.children.filter((c): c is Text => c instanceof Text);
}

/** The card's VALUES: only the `value` role is set in mono, which separates them
 * from keys, header and badge without depending on the order of the children. */
function valueTexts(container: ReturnType<typeof drawNode>): Text[] {
  return textsOf(container).filter((t) => t.style.fontFamily === theme.fonts.mono);
}

/** The value shown for the `customerId` row — the only one of the three long
 * enough to be truncated. */
function refValueText(container: ReturnType<typeof drawNode>): Text {
  const found = valueTexts(container).find((t) => t.text !== "o1" && t.text !== "99.5");
  expect(found).toBeDefined();
  return found!;
}

function underlineOf(container: ReturnType<typeof drawNode>, index: number): Graphics | null {
  return container.getChildByLabel(`ref-underline:${index}`) as Graphics | null;
}

function underlines(container: ReturnType<typeof drawNode>): Graphics[] {
  return container.children.filter(
    (c): c is Graphics => c instanceof Graphics && c.label.startsWith("ref-underline:"),
  );
}

/** The underline stroke's two endpoints, read from the Graphics context: an
 * underline is a single `moveTo`/`lineTo` followed by a `stroke`. */
/** A card's diagnostic crosses. Unlike the underlines they carry NO label:
 * `create.ts` has nothing to toggle on them, so nothing needs to find them at
 * runtime. We recognize them here by their color, the broken references' color,
 * which no other drawing on the card uses. */
function crosses(container: ReturnType<typeof drawNode>): Graphics[] {
  const color = new Color(theme.edge.dangling).toNumber();
  return container.children.filter((c): c is Graphics => {
    if (!(c instanceof Graphics)) return false;
    const instructions = c.context.instructions as any[];
    return (
      instructions.length > 0 &&
      instructions.every((i) => i.action === "stroke" && i.data.style.color === color)
    );
  });
}

function segmentOf(g: Graphics): { x1: number; y1: number; x2: number; y2: number } {
  const instructions = g.context.instructions as any[];
  expect(instructions).toHaveLength(1);
  expect(instructions[0].action).toBe("stroke");
  const path = instructions[0].data.path.instructions as any[];
  expect(path.map((p) => p.action)).toEqual(["moveTo", "lineTo"]);
  return {
    x1: path[0].data[0],
    y1: path[0].data[1],
    x2: path[1].data[0],
    y2: path[1].data[1],
  };
}

describe("drawNode — referencing value indicator", () => {
  it("renders exactly as before with no reference fields", () => {
    // Non-regression guard: the parameter is optional, and omitting it or passing
    // an EMPTY set must give the rendering from before the feature, child for
    // child.
    const implicit = render();
    const empty = render(new Set());
    expect(signature(empty)).toEqual(signature(implicit));
    // No value in it carries the reference edges' color.
    for (const t of textsOf(implicit)) expect(t.style.fill).not.toBe(theme.edge.ref);
    expect(underlines(implicit)).toHaveLength(0);
  });

  it("tints a referencing row's value in the edge color", () => {
    const g = render(new Set(["customerId"]));
    expect(refValueText(g).style.fill).toBe(theme.edge.ref);
    // The other values do not move: only the named row is concerned.
    const total = textsOf(g).find((t) => t.text === "99.5");
    expect(total?.style.fill).toBe(theme.ink.primary);
  });

  it("changes NOTHING about the value's truncation or alignment", () => {
    // The indicator at rest is a tint, and a tint takes up no room: the value's
    // budget must stay the one of an ordinary row. This is the regression the
    // icon had introduced, trimming the right of the row and truncating the value
    // shorter the moment it became navigable.
    const plain = refValueText(render());
    const tinted = refValueText(render(new Set(["customerId"])));
    expect(plain.text.length).toBeGreaterThan(1);
    expect(tinted.text).toBe(plain.text);
    expect(tinted.x).toBe(plain.x);
    expect(tinted.y).toBe(plain.y);
  });

  it("prepares a HIDDEN underline under the value of each referencing row", () => {
    const g = render(new Set(["customerId"]));
    const underline = underlineOf(g, REF_ROW);
    expect(underline).toBeInstanceOf(Graphics);
    // Hidden by default: `drawNode` prepares the visual, `create.ts` is what
    // decides when it shows. An underline visible at rest would turn the whole
    // card into a carpet of links.
    expect(underline!.visible).toBe(false);
    // The count follows the ROWS, not the mere presence of a non-empty set.
    expect(underlines(g)).toHaveLength(1);
    expect(underlines(render(new Set(["customerId", "total"])))).toHaveLength(2);
    expect(underlines(render(new Set(["inexistant"])))).toHaveLength(0);
  });

  it("aligns the underline with the value it underlines, just below it", () => {
    const g = render(new Set(["customerId"]));
    const value = refValueText(g);
    const seg = segmentOf(underlineOf(g, REF_ROW)!);
    const contentRight = rect.width - metrics.paddingX;
    // Exactly the text's width, up to the content's right edge: the underline
    // must read as belonging to the value, not to the row.
    expect(seg.x1).toBe(Math.round(contentRight - value.width));
    expect(seg.x2).toBe(contentRight);
    // Horizontal, and below the text's baseline.
    expect(seg.y1).toBe(seg.y2);
    expect(seg.y1).toBeGreaterThan(value.y + value.height - 1);
  });

  it("prepares no underline for a non-referencing row", () => {
    const g = render(new Set(["customerId"]));
    expect(underlineOf(g, PLAIN_ROW)).toBeNull();
  });

  it("prepares no underline when the value is truncated to nothing", () => {
    // Card too narrow to show any value at all: there is then nothing to
    // underline, and a stroke on its own would designate nothing.
    const narrow = { x: 0, y: 0, width: 40, height: 140 };
    const g = render(new Set(["customerId"]), narrow);
    expect(valueTexts(g)).toHaveLength(0);
    expect(underlines(g)).toHaveLength(0);
  });

  it("draws no cross when no field is dangling", () => {
    // Non-regression guard: the parameter is optional, and a card whose
    // references all resolve must render exactly as before.
    expect(crosses(render())).toHaveLength(0);
    expect(crosses(render(new Set(["customerId"])))).toHaveLength(0);
    expect(signature(render(new Set(["customerId"]), rect, new Set()))).toEqual(
      signature(render(new Set(["customerId"]))),
    );
  });

  it("changes nothing outside LOD 0", () => {
    // LOD 1 and 2 show no rows at all: there is no value to tint, hence no
    // underline either.
    for (const lod of [1, 2] as const) {
      const plain = drawNode(order, rect, theme, lod, false, "#123456", metrics, false, false);
      const tinted = drawNode(
        order,
        rect,
        theme,
        lod,
        false,
        "#123456",
        metrics,
        false,
        false,
        new Set(["customerId"]),
      );
      expect(signature(tinted)).toEqual(signature(plain));
      expect(underlines(tinted)).toHaveLength(0);
    }
  });
});

/**
 * A BROKEN reference (`RefEdge.dangling`) used to be flagged by a red stub struck
 * through with a cross, hooked onto the card's right edge. That stub designated
 * the CARD and not the offending FIELD: on a ten-row card, nothing said which one
 * failed to resolve. The diagnostic therefore moved onto the ROW, where the cross
 * sits exactly against the value at fault.
 *
 * The value keeps its reference tint — it is one, simply broken — but loses the
 * hover underline: an underline promises "this click navigates", whereas
 * `followRef` leads nowhere when `to === null`.
 */
describe("drawNode — dangling reference", () => {
  /** The cross's geometry, taken from `draw.ts`'s constants: a 7 px box set
   * against `contentRight`, preceded by a 4 px gap. */
  const ICON_WIDTH = 7;
  const ICON_GAP = 4;
  const ICON_SPACE = ICON_WIDTH + ICON_GAP;
  const contentRight = rect.width - metrics.paddingX;
  const rowY = metrics.headerHeight + REF_ROW * metrics.rowHeight + metrics.rowHeight / 2;

  const BROKEN = new Set(["customerId"]);

  it("keeps the reference tint on a dangling row's value", () => {
    // Broken or not, it is a reference: taking it out of the reference family
    // would make the field pass for an ordinary value, when it is precisely its
    // nature as a reference that makes its failure interesting.
    const g = render(new Set(), rect, BROKEN);
    expect(refValueText(g).style.fill).toBe(theme.edge.ref);
    expect(textsOf(g).find((t) => t.text === "99.5")?.style.fill).toBe(theme.ink.primary);
  });

  it("draws a cross against the right edge of the offending row", () => {
    const g = render(new Set(), rect, BROKEN);
    const found = crosses(g);
    expect(found).toHaveLength(1);
    const instructions = found[0]!.context.instructions as any[];
    expect(instructions).toHaveLength(1);
    const style = instructions[0].data.style;
    expect(style.color).toBe(new Color(theme.edge.dangling).toNumber());
    expect(style.cap).toBe("round");
    // Two diagonals: the "✕" is not a glyph (the ASCII atlas does not contain
    // it), it is a drawing.
    const path = instructions[0].data.path.instructions as any[];
    expect(path.map((p) => p.action)).toEqual(["moveTo", "lineTo", "moveTo", "lineTo"]);
    const xs = path.map((p) => p.data[0]);
    const ys = path.map((p) => p.data[1]);
    expect(Math.min(...xs)).toBeCloseTo(contentRight - ICON_WIDTH, 10);
    expect(Math.max(...xs)).toBeCloseTo(contentRight, 10);
    // Vertically centered on the row, and as tall as it is wide.
    expect(Math.min(...ys)).toBeCloseTo(rowY - ICON_WIDTH / 2, 10);
    expect(Math.max(...ys)).toBeCloseTo(rowY + ICON_WIDTH / 2, 10);
  });

  it("prepares NO underline for a dangling row", () => {
    // The underline says "this click navigates". On a broken reference it would
    // be lying.
    const g = render(new Set(), rect, BROKEN);
    expect(underlineOf(g, REF_ROW)).toBeNull();
    expect(underlines(g)).toHaveLength(0);
  });

  it("treats a row that is also referencing as DANGLING", () => {
    // A field carrying several edges can be in both sets: the doubt must show, so
    // the cross wins and the underline disappears.
    const g = render(BROKEN, rect, BROKEN);
    expect(crosses(g)).toHaveLength(1);
    expect(underlines(g)).toHaveLength(0);
    expect(refValueText(g).style.fill).toBe(theme.edge.ref);
  });

  it("reserves the cross's room on BOTH sides of the budget", () => {
    // The truncation budget must equal the room actually available: subtracting
    // it on the value side only would let a long key take back the space reserved
    // for the icon, and the cross would land on top of text.
    const resolved = refValueText(render(BROKEN));
    const broken = refValueText(render(new Set(), rect, BROKEN));
    expect(broken.text.length).toBeLessThan(resolved.text.length);
    // The value realigns on the gap's left edge, not on `contentRight`.
    expect(broken.x).toBe(Math.round(contentRight - ICON_SPACE - broken.width));
  });

  it("draws the cross even when the value is truncated to nothing", () => {
    // Card too narrow for any value at all: the diagnostic must survive the
    // text's disappearance, otherwise the least readable card would be precisely
    // the one hiding its error.
    const narrow = { x: 0, y: 0, width: 40, height: 140 };
    const g = render(new Set(), narrow, BROKEN);
    expect(valueTexts(g)).toHaveLength(0);
    expect(crosses(g)).toHaveLength(1);
  });

  it("draws nothing extra outside LOD 0", () => {
    for (const lod of [1, 2] as const) {
      const plain = drawNode(order, rect, theme, lod, false, "#123456", metrics, false, false);
      const broken = drawNode(
        order,
        rect,
        theme,
        lod,
        false,
        "#123456",
        metrics,
        false,
        false,
        new Set(),
        BROKEN,
      );
      expect(signature(broken)).toEqual(signature(plain));
      expect(crosses(broken)).toHaveLength(0);
    }
  });
});
