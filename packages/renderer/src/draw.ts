import { BitmapFont, BitmapFontManager, BitmapText, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  DEFAULT_METRICS,
  type Graph,
  type GraphNode,
  type NodeId,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { Theme } from "./theme.js";

export type Lod = 0 | 1 | 2;

/** scale >= LOD0_MIN: full card (header + rows). LOD1_MIN <= scale < LOD0_MIN: box + label.
 * scale < LOD1_MIN: flat colored rectangle, no text. */
export const LOD0_MIN_SCALE = 0.5;
export const LOD1_MIN_SCALE = 0.15;

export function lodForScale(scale: number): Lod {
  if (scale >= LOD0_MIN_SCALE) return 0;
  if (scale >= LOD1_MIN_SCALE) return 1;
  return 2;
}

const RADIUS = 6; // --radius-md
const BODY_FONT = "dg-body";
const MONO_FONT = "dg-mono";

let installedBodyFamily: string | null = null;
let installedMonoFamily: string | null = null;

/**
 * Installs (or reinstalls, if the theme's font family changed) the two
 * bitmap fonts used for node text. Fonts are baked white with dynamicFill
 * so a single texture can be tinted per-use (key vs value vs header colors).
 */
function ensureFonts(theme: Theme): void {
  if (installedBodyFamily !== theme.fonts.body) {
    if (installedBodyFamily) BitmapFont.uninstall(BODY_FONT);
    BitmapFont.install({
      name: BODY_FONT,
      style: { fontFamily: theme.fonts.body, fontSize: 14, fill: "#ffffff" },
      chars: BitmapFontManager.ASCII,
      dynamicFill: true,
    });
    installedBodyFamily = theme.fonts.body;
  }
  if (installedMonoFamily !== theme.fonts.mono) {
    if (installedMonoFamily) BitmapFont.uninstall(MONO_FONT);
    BitmapFont.install({
      name: MONO_FONT,
      style: { fontFamily: theme.fonts.mono, fontSize: 14, fill: "#ffffff" },
      chars: BitmapFontManager.ASCII,
      dynamicFill: true,
    });
    installedMonoFamily = theme.fonts.mono;
  }
}

/**
 * BitmapText's canvas-renderer path (glyphs drawn via a Graphics "texture"
 * instruction) does not reliably rasterize under Pixi v8's software canvas
 * fallback renderer (`app.renderer.name === "canvas"`, used when neither
 * WebGL nor WebGPU is available) — verified empirically: plain Graphics
 * shapes render fine there, but every BitmapText stayed blank. Regular
 * `Text` goes through a different, canvas-fallback-safe path, so callers
 * pass `useBitmapText: false` there and this module renders with `Text`
 * instead (real font family + `fill`, no tint/BitmapFont involved).
 */
function createLabel(
  text: string,
  theme: Theme,
  family: "body" | "mono",
  color: string,
  useBitmapText: boolean,
): BitmapText | Text {
  if (useBitmapText) {
    const bitmapFontName = family === "body" ? BODY_FONT : MONO_FONT;
    const t = new BitmapText({ text, style: { fontFamily: bitmapFontName, fontSize: 14 } });
    t.tint = color;
    return t;
  }
  const fontFamily = family === "body" ? theme.fonts.body : theme.fonts.mono;
  return new Text({ text, style: { fontFamily, fontSize: 14, fill: color } });
}

function truncateToWidth(text: string, maxWidth: number, charWidth: number): string {
  if (maxWidth <= 0) return "";
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

function nodeAccent(node: GraphNode, theme: Theme): string {
  if (node.kind === "entity") {
    return theme.byEntityType?.[node.entityType]?.accent ?? theme.colors.entity;
  }
  return theme.colors.containEdge;
}

/**
 * Draws a single node's visual as a Container positioned at (0,0) in local
 * space (the caller positions it at `rect.x`/`rect.y`). LOD 0 renders a
 * rounded card with a colored header and key/value rows; LOD 1 renders the
 * box with a truncated label only; LOD 2 renders a flat colored rectangle.
 */
export function drawNode(
  node: GraphNode,
  rect: Rect,
  theme: Theme,
  lod: Lod,
  useBitmapText: boolean,
): Container {
  if (useBitmapText) ensureFonts(theme);

  const container = new Container();
  container.cullable = true;
  container.cullArea = new Rectangle(0, 0, rect.width, rect.height);

  const accent = nodeAccent(node, theme);

  if (lod === 2) {
    const g = new Graphics();
    g.rect(0, 0, rect.width, rect.height).fill(accent);
    container.addChild(g);
    return container;
  }

  const box = new Graphics();
  box.roundRect(0, 0, rect.width, rect.height, RADIUS).fill(theme.colors.nodeFill).stroke({
    width: 1,
    color: theme.colors.nodeStroke,
  });
  container.addChild(box);

  if (lod === 1) {
    const label = truncateToWidth(
      node.label,
      rect.width - 2 * DEFAULT_METRICS.paddingX,
      DEFAULT_METRICS.charWidth,
    );
    const text = createLabel(label, theme, "body", theme.colors.text, useBitmapText);
    text.position.set(DEFAULT_METRICS.paddingX, rect.height / 2 - text.height / 2);
    container.addChild(text);
    return container;
  }

  // lod === 0: header (rounded top corners, flat bottom) + label + rows.
  const headerHeight = DEFAULT_METRICS.headerHeight;
  const header = new Graphics();
  header.roundRect(0, 0, rect.width, headerHeight + RADIUS, RADIUS);
  header.rect(0, headerHeight, rect.width, RADIUS);
  header.fill(accent);
  container.addChild(header);

  const label = truncateToWidth(
    node.label,
    rect.width - 2 * DEFAULT_METRICS.paddingX,
    DEFAULT_METRICS.charWidth,
  );
  const headerText = createLabel(label, theme, "body", theme.colors.nodeFill, useBitmapText);
  headerText.position.set(DEFAULT_METRICS.paddingX, headerHeight / 2 - headerText.height / 2);
  container.addChild(headerText);

  const rowWidth = rect.width - 2 * DEFAULT_METRICS.paddingX;
  node.rows.forEach((row, index) => {
    const y = headerHeight + index * DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.rowHeight / 2;

    const keyText = createLabel(`${row.key}:`, theme, "body", theme.colors.textMuted, useBitmapText);
    keyText.position.set(DEFAULT_METRICS.paddingX, y - keyText.height / 2);
    container.addChild(keyText);

    const valueMaxWidth = Math.max(0, rowWidth - keyText.width - 6);
    const valueStr = truncateToWidth(String(row.value), valueMaxWidth, DEFAULT_METRICS.charWidth);
    const valueText = createLabel(valueStr, theme, "mono", theme.colors.text, useBitmapText);
    valueText.position.set(DEFAULT_METRICS.paddingX + keyText.width + 6, y - valueText.height / 2);
    container.addChild(valueText);
  });

  return container;
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

const DANGLING_STUB_LENGTH = 32;
const DANGLING_CROSS_RADIUS = 4;

/**
 * Draws every contain and reference edge between currently visible nodes
 * (per `positions`) into a single Graphics, batched by style: contain edges
 * as solid horizontal beziers, resolved refs as dashed lines, dangling refs
 * as a dashed stub with a terminal cross. Returns an empty Graphics at
 * LOD 2 (edges are not legible/worth the draw calls when fully zoomed out).
 */
export function drawEdges(graph: Graph, positions: Map<NodeId, Rect>, theme: Theme, lod: Lod): Graphics {
  const g = new Graphics();
  if (lod === 2) return g;

  let hasContain = false;
  for (const edge of graph.containEdges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    g.moveTo(x1, y1);
    g.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    hasContain = true;
  }
  if (hasContain) g.stroke({ width: 1.5, color: theme.colors.containEdge });

  let hasRef = false;
  for (const edge of graph.refEdges) {
    if (edge.dangling || edge.to === null) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    dashedLine(g, x1, y1, x2, y2);
    hasRef = true;
  }
  if (hasRef) g.stroke({ width: 1.5, color: theme.colors.refEdge });

  let hasDangling = false;
  for (const edge of graph.refEdges) {
    if (!edge.dangling) continue;
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = x1 + DANGLING_STUB_LENGTH;
    const y2 = y1;
    dashedLine(g, x1, y1, x2, y2);
    const r = DANGLING_CROSS_RADIUS;
    g.moveTo(x2 - r, y2 - r);
    g.lineTo(x2 + r, y2 + r);
    g.moveTo(x2 + r, y2 - r);
    g.lineTo(x2 - r, y2 + r);
    hasDangling = true;
  }
  if (hasDangling) g.stroke({ width: 1.5, color: theme.colors.danglingRef });

  return g;
}

export interface EdgeHit {
  edge: RefEdge;
  graphics: Graphics;
}

const REF_HIT_WIDTH = 14;

/**
 * Builds one invisible, thickened (14px) hit-area Graphics per currently
 * visible ref edge — a resolved line to its target or, for a dangling ref,
 * the same stub drawn by `drawEdges`. Purely geometric: the caller sets
 * `eventMode`/`cursor` and wires up tap handling (e.g. to emit
 * "followRef"). Alpha is 0 (invisible) but Graphics hit-testing is
 * geometry-based, so the shape stays clickable.
 */
export function drawEdgeHitAreas(graph: Graph, positions: Map<NodeId, Rect>): EdgeHit[] {
  const hits: EdgeHit[] = [];
  for (const edge of graph.refEdges) {
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    let x2: number;
    let y2: number;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      x2 = to.x;
      y2 = to.y + to.height / 2;
    } else {
      x2 = x1 + DANGLING_STUB_LENGTH;
      y2 = y1;
    }
    const g = new Graphics();
    g.moveTo(x1, y1)
      .lineTo(x2, y2)
      .stroke({ width: REF_HIT_WIDTH, color: 0xffffff, alpha: 0, cap: "round" });
    hits.push({ edge, graphics: g });
  }
  return hits;
}

const SELECTION_STROKE_WIDTH = 3;

/**
 * Draws the selection highlight for `selectedId`: a thickened
 * `selection`-colored outline on the node itself, on its contain-edge chain
 * up to the root, and on its outgoing ref edges (dangling stubs included).
 * Returns an empty Graphics when nothing is selected or the selected node
 * isn't currently visible (not present in `positions`).
 */
export function drawSelectionOverlay(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  selectedId: NodeId | null,
): Graphics {
  const g = new Graphics();
  if (!selectedId) return g;
  const rect = positions.get(selectedId);
  if (!rect) return g;

  g.roundRect(rect.x, rect.y, rect.width, rect.height, RADIUS).stroke({
    width: SELECTION_STROKE_WIDTH,
    color: theme.colors.selection,
  });

  let hasChain = false;
  let node = graph.nodes.get(selectedId);
  while (node && node.parentId !== null) {
    const childRect = positions.get(node.id);
    const parentRect = positions.get(node.parentId);
    if (childRect && parentRect) {
      const x1 = parentRect.x + parentRect.width;
      const y1 = parentRect.y + parentRect.height / 2;
      const x2 = childRect.x;
      const y2 = childRect.y + childRect.height / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      g.moveTo(x1, y1).bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      hasChain = true;
    }
    node = graph.nodes.get(node.parentId);
  }
  if (hasChain) g.stroke({ width: SELECTION_STROKE_WIDTH, color: theme.colors.selection });

  let hasRefs = false;
  for (const edge of graph.refEdges) {
    if (edge.from !== selectedId) continue;
    const from = positions.get(edge.from);
    if (!from) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      dashedLine(g, x1, y1, to.x, to.y + to.height / 2);
    } else {
      dashedLine(g, x1, y1, x1 + DANGLING_STUB_LENGTH, y1);
    }
    hasRefs = true;
  }
  if (hasRefs) g.stroke({ width: SELECTION_STROKE_WIDTH, color: theme.colors.selection });

  return g;
}
