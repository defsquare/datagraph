import { Container, Graphics, Text } from "pixi.js";

import { enclosingCircle, type Circle } from "@core/hull.ts";
import { DEFAULT_METRICS, measureNode } from "@core/measure.ts";
import type {
  EntityNode,
  Graph,
  GraphNode,
  NodeId,
  ObjectNode,
  RefEdge,
  Row,
} from "@core/model.ts";
import type { Rect } from "@core/structure-layout.ts";
import {
  drawClusters,
  drawEdgeLabels,
  drawEdges,
  drawNode,
  drawSearchHighlights,
  drawSelectionOverlay,
  drawSemanticDiscs,
  drawSemanticEdges,
  drawSemanticLabels,
  edgeLabelPlacements,
  lodForScale,
  LOD0_MIN_SCALE,
  LOD1_MIN_SCALE,
  type SemanticEdge,
  type SemanticNode,
} from "@renderer/draw.ts";
import { pixiFontRegistry } from "@renderer/font-registry.ts";
import { entityAccentMap, type Theme } from "@renderer/theme.ts";

import { createPixiStage, supportsBitmapText, type PixiStage } from "../pixi-stage.ts";
import { currentTheme, type ThemeState } from "../theme-state.ts";

import "./graph-components.css";

/**
 * The « Graph components » view: every visual that
 * `packages/renderer/src/draw.ts` can produce, in all its states, drawn by THE
 * SAME functions as the product.
 *
 * That constraint is what gives this board its value: nothing is redrawn "in
 * the likeness of". A hovered card is a `drawNode` whose hover parameters are
 * forced, a dangling edge is a `drawEdges` on a graph whose edge is dangling. A
 * specimen therefore cannot lie about what the renderer does — if it diverges,
 * it is the renderer that changed, and that is exactly what one comes to see.
 *
 * Hence the fabrication of BARE DATA: `draw.ts` only takes nodes, rects and
 * colors (never a live graph nor any UI state), which allows building here, by
 * hand, the exact situation of each state — including those one would only
 * reach in the product with a complicit dataset.
 *
 * The CAPTIONS, for their part, are Pixi `Text` and not `BitmapText`: the
 * renderer's atlas is baked on `BitmapFontManager.ASCII`, where an em dash or
 * an accented letter is missing. A `Text` is no lie here, because the caption is NOT a component
 * of the product — it is the display card of the object shown, not the object.
 */

// --- Stage geometry.
//
// Hardcoded pixels, and these are not tokens leaking out: they are the
// dimensions of a DISPLAY CASE (the size of a grid cell, the gap between two
// specimens), not design system decisions. Inventing them as tokens would
// export to the renderer a notion it does not have.

const STAGE_PAD = 16;
const CAPTION_HEIGHT = 16;

const CARD_CELL_W = 200;
const CARD_CELL_H = 165;
const CARD_COLUMNS = 3;

const EDGE_ROW_H = 78;
const EDGE_SPAN = 300;

const HULL_R = 64;
const HULL_GAP = 50;

const PANEL_W = 300;
const PANEL_H = 220;
const PANEL_GAP = 16;
/** The three scales of the semantic zoom board, chosen on either side of
 * `lodForScale`'s thresholds: above `LOD0_MIN_SCALE`, between the two, then
 * below `LOD1_MIN_SCALE` — the scale at which the graph view stops drawing its
 * cards and paints the aggregates. */
const PANEL_SCALES = [LOD0_MIN_SCALE + 0.1, (LOD0_MIN_SCALE + LOD1_MIN_SCALE) / 2, 0.08];

/** The magnification of a hovered card. Mirror of `HOVER_LIFT`, which
 * `create.ts` does not export: the value is copied, so it can drift — the
 * specimen states what it shows ("×1.025") so that the discrepancy shows. */
const HOVER_LIFT = 0.025;

const NO_FIELDS: ReadonlySet<string> = new Set();

// --- Bare data factories.

function entityNode(
  id: NodeId,
  entityType: string,
  entityId: string,
  rows: Row[],
  cardChildCount = 0,
): EntityNode {
  return {
    kind: "entity",
    id,
    path: [],
    label: `${entityType} #${entityId}`,
    rows,
    parentId: null,
    childIds: [],
    elided: false,
    cardChildCount,
    entityType,
    entityId,
  };
}

function objectNode(id: NodeId, label: string, rows: Row[]): ObjectNode {
  return {
    kind: "object",
    id,
    path: [],
    label,
    rows,
    parentId: null,
    childIds: [],
    elided: false,
    cardChildCount: 0,
  };
}

/** A minimal graph around fabricated nodes and edges. `entityIndex` and
 * `diagnostics` stay empty: no drawing function reads them — they only consult
 * `nodes`, `containEdges` and `refEdges`. */
function graphOf(nodes: GraphNode[], refEdges: RefEdge[] = [], containEdges: Graph["containEdges"] = []): Graph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootId: nodes[0]?.id ?? "",
    containEdges,
    refEdges,
    entityIndex: new Map(),
    diagnostics: [],
    logicalNodeCount: nodes.length,
  };
}

/** A null `to` = a DANGLING reference: that is the only difference between the
 * two cases, on the data side as on the rendering side. */
function refEdge(from: NodeId, to: NodeId | null, field: string, targetType = "Customer"): RefEdge {
  return {
    kind: "ref",
    from,
    fromEntity: from,
    to,
    field,
    targetType,
    targetId: to ?? "GHOST",
    dangling: to === null,
  };
}

function rectOf(node: GraphNode, x = 0, y = 0): Rect {
  return { x, y, ...measureNode(node) };
}

// --- DOM factories.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A section's frame: title, note, canvas host.
 *
 * The classes belong to this view (`gc-*`) and are not the Tokens view's
 * (`ds-*`): those live in `views/tokens.css`, ANOTHER view's stylesheet. A view
 * leaning on them would break the day the Tokens view renames or moves its
 * sheet, with nothing to announce it.
 */
function section(title: string, note: string): { node: HTMLElement; host: HTMLElement } {
  const node = el("section", "gc-section");
  node.append(el("h2", "gc-section-title", title));
  node.append(el("p", "gc-note", note));
  const host = el("div", "gc-stage");
  node.append(host);
  return { node, host };
}

// --- Drawn captions.

function caption(text: string, theme: Theme): Text {
  return new Text({
    text,
    style: { fontFamily: theme.fonts.body, fontSize: 11, fill: theme.ink.subtle },
  });
}

/** A grid cell: its caption on top, its specimen underneath. */
function cell(label: string, content: Container, theme: Theme, x: number, y: number): Container {
  const c = new Container();
  c.position.set(x, y);
  content.position.set(content.position.x, content.position.y + CAPTION_HEIGHT);
  c.addChild(caption(label, theme), content);
  return c;
}

function group(...children: Container[]): Container {
  const c = new Container();
  c.addChild(...children);
  return c;
}

// --- Section 1: the node card.

const ORDER_ROWS: Row[] = [
  { key: "status", value: "shipped", valueType: "string" },
  { key: "total", value: 99.5, valueType: "number" },
  { key: "customerId", value: "c1", valueType: "string" },
  { key: "lines", value: 2, valueType: "array", arrayId: "order:lines" },
];

/** The field carrying a reference, and its row index. The two must stay in
 * agreement: `drawNode` labels the hover underline
 * `ref-underline:<row index>`, not `<field name>`. */
const REF_FIELDS: ReadonlySet<string> = new Set(["customerId"]);
const REF_ROW_INDEX = 2;

const ADDRESS_ROWS: Row[] = [
  { key: "street", value: "1 rue de la Paix", valueType: "string" },
  { key: "city", value: "Paris", valueType: "string" },
];

/**
 * A specimen: its caption, and what it takes to build it.
 *
 * `build` receives `useBitmap` as an ARGUMENT rather than capturing it: the
 * list is thus buildable at mount time, before the renderer exists and says
 * whether it can rasterize BitmapText. That is what allows sizing the stage on
 * `specimens.length` — a Pixi canvas's size is frozen at its `init()`, hence
 * before `ready`, and a count hardcoded next to the list would end up drifting
 * from it silently, clipping the last row.
 */
interface Specimen {
  label: string;
  build: (useBitmap: boolean) => Container;
}

function cardSpecimens(theme: Theme): Specimen[] {
  const accents = entityAccentMap(["Order", "Customer"], theme);
  const accent = accents.get("Order") ?? theme.accent.entity;

  const order = entityNode("order:o1042", "Order", "o1042", ORDER_ROWS, 1);
  const rect = rectOf(order);
  const positions = new Map<NodeId, Rect>([[order.id, rect]]);
  // A ONE-node graph is enough for the selection overlay: it only follows the
  // parent chain (empty here) and the outgoing references (none drawn on an
  // isolated card). What the specimen shows is therefore exactly the outline,
  // which is what one comes to look at.
  const graph = graphOf([order]);

  // `expandedArrays: null`: the graph view does not fold arrays, so the
  // `[ 2 items ]` pill carries no chevron there — it would promise a gesture
  // with no effect. Its WIDTH still reserves the room, `measureNode` knowing
  // nothing of the view.
  const card = (
    useBitmap: boolean,
    opts: { expanded?: boolean; dangling?: boolean } = {},
  ): Container =>
    drawNode(
      order,
      rect,
      theme,
      0,
      useBitmap,
      accent,
      DEFAULT_METRICS,
      opts.expanded ?? false,
      true,
      REF_FIELDS,
      opts.dangling === true ? REF_FIELDS : NO_FIELDS,
      null,
    );

  return [
    { label: "rest (collapsed)", build: (bitmap) => card(bitmap) },
    { label: "expanded", build: (bitmap) => card(bitmap, { expanded: true }) },
    {
      label: `hover — lift ×${1 + HOVER_LIFT}`,
      build: (bitmap) => {
        const c = card(bitmap);
        const scale = 1 + HOVER_LIFT;
        c.scale.set(scale);
        // Same compensation as `create.ts`: Pixi puts a container's origin at
        // the top left, so a plain scale would push the card down-right instead
        // of growing it around its center.
        c.position.set(-((scale - 1) * rect.width) / 2, -((scale - 1) * rect.height) / 2);
        return group(c);
      },
    },
    {
      label: "hovering a reference row",
      build: (bitmap) => {
        const c = card(bitmap);
        // `drawNode` has prepared the hidden underline; knowing which row is
        // under the pointer belongs to `create.ts`, which only toggles that
        // visibility. The specimen makes the same gesture, through the same
        // label.
        const underline = c.getChildByLabel(`ref-underline:${REF_ROW_INDEX}`);
        if (underline) underline.visible = true;
        return c;
      },
    },
    {
      label: "selected",
      build: (bitmap) =>
        group(card(bitmap), drawSelectionOverlay(graph, positions, theme, order.id, "ref")),
    },
    {
      label: "search result (match)",
      build: (bitmap) =>
        group(card(bitmap), drawSearchHighlights(positions, theme, [order.id], null)),
    },
    {
      label: "current result (matchCurrent)",
      build: (bitmap) =>
        group(card(bitmap), drawSearchHighlights(positions, theme, [order.id], order.id)),
    },
    {
      label: "broken reference (dangling)",
      build: (bitmap) => card(bitmap, { dangling: true }),
    },
    {
      label: "surface cardMuted (value object)",
      build: (bitmap) => {
        const address = objectNode("order:o1042.address", "address", ADDRESS_ROWS);
        return drawNode(
          address,
          rectOf(address),
          theme,
          0,
          bitmap,
          accent,
          DEFAULT_METRICS,
          false,
          false,
          NO_FIELDS,
          NO_FIELDS,
          null,
        );
      },
    },
  ];
}

function cardStageSize(count: number): { width: number; height: number } {
  const rows = Math.ceil(count / CARD_COLUMNS);
  return {
    width: 2 * STAGE_PAD + CARD_COLUMNS * CARD_CELL_W,
    height: 2 * STAGE_PAD + rows * CARD_CELL_H,
  };
}

function paintCards(
  stage: PixiStage,
  theme: Theme,
  useBitmap: boolean,
  specimens: Specimen[],
): void {
  specimens.forEach((specimen, index) => {
    stage.app.stage.addChild(
      cell(
        specimen.label,
        specimen.build(useBitmap),
        theme,
        STAGE_PAD + (index % CARD_COLUMNS) * CARD_CELL_W,
        STAGE_PAD + Math.floor(index / CARD_COLUMNS) * CARD_CELL_H,
      ),
    );
  });
}

// --- Section 2: the edges.

/**
 * A pair of connected cards, and what `draw.ts` draws between them.
 *
 * Cards WITHOUT rows: the pair is there to carry an edge, and content rows
 * would only pull the eye away from what is under examination — the stroke, its
 * style and its attachment point.
 */
function edgeSpecimens(theme: Theme): Specimen[] {
  const accents = entityAccentMap(["Order", "Customer"], theme);

  const pair = (
    useBitmap: boolean,
  ): {
    from: EntityNode;
    to: EntityNode;
    positions: Map<NodeId, Rect>;
    cards: Container;
  } => {
    const from = entityNode("o1", "Order", "o1", []);
    const to = entityNode("c1", "Customer", "c1", []);
    const fromRect = rectOf(from);
    const toRect = rectOf(to, EDGE_SPAN);
    const positions = new Map<NodeId, Rect>([
      [from.id, fromRect],
      [to.id, toRect],
    ]);
    const cards = new Container();
    for (const [node, rect] of [
      [from, fromRect],
      [to, toRect],
    ] as const) {
      const c = drawNode(
        node,
        rect,
        theme,
        0,
        useBitmap,
        accents.get(node.entityType) ?? theme.accent.entity,
      );
      c.position.set(rect.x, rect.y);
      cards.addChild(c);
    }
    return { from, to, positions, cards };
  };

  return [
    {
      label: "containment — solid bezier (structure view)",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [], [{ kind: "contain", from: from.id, to: to.id }]);
        return group(drawEdges(graph, positions, theme, 0, "contain"), cards);
      },
    },
    {
      label: "reference, graph view — solid stroke + arrow",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, to.id, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "ref"), cards);
      },
    },
    {
      label: "reference, structure view — dashes + arrow",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, to.id, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "contain"), cards);
      },
    },
    {
      label: "broken reference — no stroke: the diagnostic is on the card",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, null, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "ref"), cards);
      },
    },
    {
      label: "reference label (source selected)",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, to.id, "customerId")]);
        const placements = edgeLabelPlacements(graph, positions, from.id);
        return group(
          drawEdges(graph, positions, theme, 0, "ref"),
          cards,
          drawEdgeLabels(placements, theme, bitmap),
        );
      },
    },
  ];
}

function edgeStageSize(count: number): { width: number; height: number } {
  return {
    width: 2 * STAGE_PAD + EDGE_SPAN + DEFAULT_METRICS.minWidth,
    height: 2 * STAGE_PAD + count * EDGE_ROW_H,
  };
}

function paintEdges(
  stage: PixiStage,
  theme: Theme,
  useBitmap: boolean,
  specimens: Specimen[],
): void {
  specimens.forEach((specimen, index) => {
    stage.app.stage.addChild(
      cell(
        specimen.label,
        specimen.build(useBitmap),
        theme,
        STAGE_PAD,
        STAGE_PAD + index * EDGE_ROW_H,
      ),
    );
  });
}

// --- Section 3: the aggregate envelopes.

/** An envelope's three states, exactly as `drawClusters` interpolates them. The
 * hover arrives ALREADY eased by `attachHover`: what the specimen forces here is
 * the upper bound of that intensity, not one more curve. */
const HULL_STATES: { label: string; hover?: number; dim?: boolean }[] = [
  { label: "rest (hover 0)" },
  { label: "hovered (hover 1)", hover: 1 },
  { label: "dimmed (dim, outside selection)", dim: true },
];

function hullStageSize(): { width: number; height: number } {
  return {
    width: 2 * STAGE_PAD + HULL_STATES.length * (2 * HULL_R) + (HULL_STATES.length - 1) * HULL_GAP,
    height: 2 * STAGE_PAD + CAPTION_HEIGHT + 2 * HULL_R,
  };
}

function paintHulls(stage: PixiStage, theme: Theme): void {
  const accents = entityAccentMap(["Order", "Customer", "Product"], theme);
  const palette = [...accents.values()];
  const cy = STAGE_PAD + CAPTION_HEIGHT + HULL_R;

  const clusters = HULL_STATES.map((state, index) => ({
    circle: {
      cx: STAGE_PAD + HULL_R + index * (2 * HULL_R + HULL_GAP),
      cy,
      r: HULL_R,
    },
    color: palette[index % palette.length] ?? theme.accent.entity,
    hover: state.hover,
    dim: state.dim,
  }));

  // ONE single call for all three: that is how the renderer paints them (one
  // Graphics for every visible envelope), and splitting them would hide that a
  // `stroke()` carries only one style — the reason dimming is a boolean and not
  // a free factor.
  stage.app.stage.addChild(drawClusters(clusters, theme));

  clusters.forEach((cluster, index) => {
    const label = caption(HULL_STATES[index]!.label, theme);
    label.position.set(cluster.circle.cx - HULL_R, STAGE_PAD);
    stage.app.stage.addChild(label);
  });
}

// --- Section 4: semantic zoom.

/** The fictitious world: a grid of aggregates, each one a block of cards. Wide
 * enough that the most distant of the three panels' scales still has discs to
 * show across its whole frame.
 *
 * The pitch is taken CLEARLY above the envelope's diameter (~610 for a 3×3
 * block), and not merely above: the aggregated edges are painted UNDER the
 * discs, so with near-touching discs only a few pixels of them would remain and
 * the board would claim to show `drawSemanticEdges` while showing none of it.
 * The breathing gap IS the specimen.
 *
 * The pitch being the same on both axes and the block CENTERED within it, the
 * world's center falls exactly on the center of the median aggregate
 * (`COLS/2 × pitch`): the zoomed panels therefore frame a whole block, whatever
 * that pitch is. */
const AGG_COLS = 7;
const AGG_ROWS = 5;
const AGG_PITCH = 900;
const BLOCK = 3;
const CARD_PITCH_X = 180;
const CARD_PITCH_Y = 100;
const HULL_PADDING = 20;

const WORLD_ROWS: Row[] = [
  { key: "status", value: "open", valueType: "string" },
  { key: "total", value: 42, valueType: "number" },
];

interface Aggregate {
  id: string;
  label: string;
  color: string;
  circle: Circle;
  count: number;
}

interface FakeWorld {
  graph: Graph;
  positions: Map<NodeId, Rect>;
  accentByNode: Map<NodeId, string>;
  aggregates: Aggregate[];
  semanticEdges: SemanticEdge[];
  /** The reference disc radius from which `drawSemanticEdges` derives its
   * stroke widths. All the aggregates here are the same size, so any one of
   * them will do. */
  unit: number;
}

function buildFakeWorld(theme: Theme): FakeWorld {
  const types = ["Order", "Customer", "Product", "Invoice"];
  const accents = entityAccentMap(types, theme);

  // The block is CENTERED within the aggregate grid's pitch: that pitch is
  // chosen larger than the envelope's diameter, otherwise two neighboring discs
  // would overlap — which the real layout rules out by construction (it packs
  // disjoint circles).
  const probe = entityNode("probe", "Order", "0", WORLD_ROWS);
  const cardSize = measureNode(probe);
  const insetX = (AGG_PITCH - (cardSize.width + (BLOCK - 1) * CARD_PITCH_X)) / 2;
  const insetY = (AGG_PITCH - (cardSize.height + (BLOCK - 1) * CARD_PITCH_Y)) / 2;

  const nodes: GraphNode[] = [];
  const positions = new Map<NodeId, Rect>();
  const accentByNode = new Map<NodeId, string>();
  const refEdges: RefEdge[] = [];
  const aggregates: Aggregate[] = [];

  for (let ar = 0; ar < AGG_ROWS; ar++) {
    for (let ac = 0; ac < AGG_COLS; ac++) {
      const index = ar * AGG_COLS + ac;
      const type = types[index % types.length]!;
      const color = accents.get(type) ?? theme.accent.entity;
      const rects: Rect[] = [];
      let previous: NodeId | null = null;

      for (let j = 0; j < BLOCK; j++) {
        for (let i = 0; i < BLOCK; i++) {
          const id = `e${index}-${j * BLOCK + i}`;
          const node = entityNode(id, type, `${index}${j}${i}`, WORLD_ROWS);
          const rect = rectOf(
            node,
            ac * AGG_PITCH + insetX + i * CARD_PITCH_X,
            ar * AGG_PITCH + insetY + j * CARD_PITCH_Y,
          );
          nodes.push(node);
          positions.set(id, rect);
          accentByNode.set(id, color);
          rects.push(rect);
          // A chain of references within the block: enough to give the most
          // zoomed-in panel some edges to show under its cards.
          if (previous !== null) refEdges.push(refEdge(previous, id, "next", type));
          previous = id;
        }
      }

      aggregates.push({
        id: `agg-${index}`,
        // A hierarchical identifier, as in the real dataset: that is what makes
        // `drawSemanticLabels`'s MIDDLE truncation visible — truncating at the
        // end would make every disc a namesake of the others.
        label: `svc.commerce.${type.toLowerCase()}.bloc-${index}`,
        color,
        circle: enclosingCircle(rects, HULL_PADDING),
        count: BLOCK * BLOCK,
      });
    }
  }

  const semanticEdges: SemanticEdge[] = [];
  for (let ar = 0; ar < AGG_ROWS; ar++) {
    for (let ac = 0; ac < AGG_COLS; ac++) {
      const here = aggregates[ar * AGG_COLS + ac]!;
      for (const [dc, dr] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (ac + dc >= AGG_COLS || ar + dr >= AGG_ROWS) continue;
        const other = aggregates[(ar + dr) * AGG_COLS + (ac + dc)]!;
        semanticEdges.push({
          x1: here.circle.cx,
          y1: here.circle.cy,
          x2: other.circle.cx,
          y2: other.circle.cy,
          // A deterministic gradation crossing all four of `bucketOf`'s tiers:
          // at constant weight, the board would show one stroke width out of
          // the four.
          weight: ((ac * 3 + ar * 5) % 12) + 1,
        });
      }
    }
  }

  return {
    graph: graphOf(nodes, refEdges),
    positions,
    accentByNode,
    aggregates,
    semanticEdges,
    unit: aggregates[0]?.circle.r ?? 1,
  };
}

function rectInView(rect: Rect, view: Rect): boolean {
  return (
    rect.x <= view.x + view.width &&
    view.x <= rect.x + rect.width &&
    rect.y <= view.y + view.height &&
    view.y <= rect.y + rect.height
  );
}

function circleInView(circle: Circle, view: Rect): boolean {
  return rectInView(
    { x: circle.cx - circle.r, y: circle.cy - circle.r, width: 2 * circle.r, height: 2 * circle.r },
    view,
  );
}

/**
 * A panel: what the graph view paints of the SAME world at a given camera
 * scale.
 *
 * The world is shared by the three panels and only the camera changes — that is
 * what makes the board three zoom levels of one dataset, and not three drawings
 * that resemble each other. The consequence is the product's: the further out
 * one goes, the more objects enter the frame, until the point where a card is
 * no more than a mute rectangle — and where the semantic regime replaces it
 * with a named disc.
 *
 * The content is CULLED against the world window, as `create.ts` does: without
 * that, the most zoomed-out panel would build the world's 315 cards to show a
 * dozen of them.
 */
function semanticPanel(world: FakeWorld, theme: Theme, useBitmap: boolean, scale: number): Container {
  const panel = new Container();
  const lod = lodForScale(scale);

  const centerX = (AGG_COLS * AGG_PITCH) / 2;
  const centerY = (AGG_ROWS * AGG_PITCH) / 2;
  const view: Rect = {
    x: centerX - PANEL_W / (2 * scale),
    y: centerY - PANEL_H / (2 * scale),
    width: PANEL_W / scale,
    height: PANEL_H / scale,
  };

  const layer = new Container();
  layer.scale.set(scale);
  layer.position.set(-view.x * scale, -view.y * scale);

  const visibleAggregates = world.aggregates.filter((a) => circleInView(a.circle, view));

  if (lod === 2) {
    const semanticNodes: SemanticNode[] = visibleAggregates.map((a) => ({
      id: a.id,
      circle: a.circle,
      color: a.color,
      label: a.label,
      count: a.count,
    }));
    // The order IS the stacking: the aggregated edges under the discs (an
    // opaque disc must hide them), the labels above.
    layer.addChild(
      drawSemanticEdges(world.semanticEdges, theme, world.unit),
      drawSemanticDiscs(semanticNodes, theme),
      drawSemanticLabels(semanticNodes, theme, useBitmap),
    );
  } else {
    const visible = new Map<NodeId, Rect>();
    for (const [id, rect] of world.positions) {
      if (rectInView(rect, view)) visible.set(id, rect);
    }
    layer.addChild(
      drawClusters(
        visibleAggregates.map((a) => ({ circle: a.circle, color: a.color })),
        theme,
      ),
      drawEdges(world.graph, visible, theme, lod, "ref"),
    );
    for (const [id, rect] of visible) {
      const node = world.graph.nodes.get(id);
      if (!node) continue;
      const card = drawNode(
        node,
        rect,
        theme,
        lod,
        useBitmap,
        world.accentByNode.get(id) ?? theme.accent.entity,
      );
      card.position.set(rect.x, rect.y);
      layer.addChild(card);
    }
  }

  // The mask bounds the panel to its frame: without it, the world would spill
  // over its neighbors and the board would no longer show three framings but a
  // mush.
  const mask = new Graphics().rect(0, 0, PANEL_W, PANEL_H).fill(theme.surface.canvas);
  const frame = new Graphics()
    .rect(0.5, 0.5, PANEL_W - 1, PANEL_H - 1)
    .stroke({ width: 1, color: theme.edge.border });
  panel.addChild(layer, mask, frame);
  layer.mask = mask;
  return panel;
}

function semanticStageSize(): { width: number; height: number } {
  return {
    width:
      2 * STAGE_PAD + PANEL_SCALES.length * PANEL_W + (PANEL_SCALES.length - 1) * PANEL_GAP,
    height: 2 * STAGE_PAD + CAPTION_HEIGHT + PANEL_H,
  };
}

function paintSemantic(stage: PixiStage, theme: Theme, useBitmap: boolean): void {
  const world = buildFakeWorld(theme);
  PANEL_SCALES.forEach((scale, index) => {
    const lod = lodForScale(scale);
    const regime = lod === 2 ? "aggregate discs" : lod === 1 ? "truncated cards" : "full cards";
    stage.app.stage.addChild(
      cell(
        `scale ${scale.toFixed(2)} — LOD ${lod}: ${regime}`,
        semanticPanel(world, theme, useBitmap, scale),
        theme,
        STAGE_PAD + index * (PANEL_W + PANEL_GAP),
        STAGE_PAD,
      ),
    );
  });
}

// --- Mounting.

/**
 * Mounts the view. Conforms to `PlaygroundView.mount`'s contract: `root` is
 * empty and ours, the return unmounts. No theme subscription — the shell
 * remounts the whole view on every change, and that is what guarantees a Pixi
 * stage on screen really matches the theme announced (colors repaint live, font
 * atlases do not).
 */
export function mountGraphComponentsView(root: HTMLElement, state: ThemeState): () => void {
  const theme = currentTheme(state);
  // A lease on the renderer's shared atlases, exactly like a DataGraph
  // instance: the registry counts them by reference, so `dispose()` only
  // uninstalls if nobody else holds them.
  const lease = pixiFontRegistry.lease();
  const stages: PixiStage[] = [];
  let disposed = false;
  let fontsInstalled = false;

  const page = el("div", "graph-components-view");

  const mount = (
    title: string,
    note: string,
    size: { width: number; height: number },
    paint: (stage: PixiStage, useBitmap: boolean) => void,
  ): void => {
    const { node, host } = section(title, note);
    const status = el("p", "gc-note gc-status", "Initializing canvas…");
    node.append(status);
    page.append(node);

    const stage = createPixiStage(host, theme, size);
    stages.push(stage);

    stage.ready
      .then(() => {
        // An unmount that landed during the init: the stage is already settled,
        // and drawing into it would throw on a destroyed renderer.
        if (disposed || stage.isDestroyed()) return;
        const useBitmap = supportsBitmapText(stage.app);
        if (useBitmap && !fontsInstalled) {
          // BEFORE any BitmapText: `drawNode` derives the atlas name from the
          // theme alone, and reading it before the lease has installed it would
          // render empty texts.
          lease.sync(theme);
          fontsInstalled = true;
        }
        status.remove();
        paint(stage, useBitmap);
      })
      .catch((error: unknown) => {
        // Without this, a renderer init that fails (WebGL off, context refused)
        // would leave the caption stuck and the reason in an unhandled
        // rejection. The failure reads where the specimen is missing.
        status.textContent = `The Pixi canvas could not initialize: ${String(error)}`;
      });
  };

  // The lists are built HERE, before the stages: their length sizes the canvas,
  // whose size freezes at `init()` — hence before `ready` says whether the
  // renderer can rasterize BitmapText, the only unknown at this point.
  const cards = cardSpecimens(theme);
  const edges = edgeSpecimens(theme);

  mount(
    "Node card",
    "The same fictitious node declined by drawNode's parameters. The interface states (hover, selection, search) are FORCED here: in the product create.ts is what decides them, drawNode only prepares the visual — a hidden underline, an outline, a washed fill.",
    cardStageSize(cards.length),
    (stage, useBitmap) => paintCards(stage, theme, useBitmap, cards),
  );

  mount(
    "Edges",
    "A stroke's style states its nature AND the view it is drawn in: containment is a solid bezier, a reference is solid in graph view (where it is the relation being shown) and dashed in structure view (where it decorates the tree). A broken reference is no longer drawn at all — its diagnostic moved onto the card's row, where the cross designates the offending field rather than the whole card.",
    edgeStageSize(edges.length),
    (stage, useBitmap) => paintEdges(stage, theme, useBitmap, edges),
  );

  mount(
    "Aggregate envelopes",
    "The disc the layout computed for an aggregate, painted under the cards. The three levels — fill, thickness, outline opacity — rise together on hover: it is that simultaneous rise that makes the envelope read as a graspable object, which it is.",
    hullStageSize(),
    (stage) => paintHulls(stage, theme),
  );

  mount(
    "Semantic zoom",
    `The same fictitious world at three camera scales, on either side of lodForScale's thresholds (${LOD0_MIN_SCALE} and ${LOD1_MIN_SCALE}). Below the second threshold a card is nothing but a mute rectangle: the graph view then stops drawing them and paints the aggregates as nodes — discs, labels truncated through the middle, and references folded onto the pairs, graded by their weight.`,
    semanticStageSize(),
    (stage, useBitmap) => paintSemantic(stage, theme, useBitmap),
  );

  root.append(page);

  return () => {
    disposed = true;
    // Before the stages: releasing the atlases depends on no renderer, and it
    // must happen even if no init ever completed.
    lease.dispose();
    for (const stage of stages) stage.destroy();
    page.remove();
  };
}
