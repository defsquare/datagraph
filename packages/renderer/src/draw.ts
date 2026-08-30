import { BitmapFont, BitmapFontManager, BitmapText, Container, Graphics, Rectangle } from "pixi.js";
import { DEFAULT_METRICS, type Graph, type GraphNode, type NodeId, type Rect } from "@defsquare/data-graph-core";
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
export function drawNode(node: GraphNode, rect: Rect, theme: Theme, lod: Lod): Container {
  ensureFonts(theme);

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
    const text = new BitmapText({ text: label, style: { fontFamily: BODY_FONT, fontSize: 14 } });
    text.tint = theme.colors.text;
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
  const headerText = new BitmapText({ text: label, style: { fontFamily: BODY_FONT, fontSize: 14 } });
  headerText.tint = theme.colors.nodeFill;
  headerText.position.set(DEFAULT_METRICS.paddingX, headerHeight / 2 - headerText.height / 2);
  container.addChild(headerText);

  const rowWidth = rect.width - 2 * DEFAULT_METRICS.paddingX;
  node.rows.forEach((row, index) => {
    const y = headerHeight + index * DEFAULT_METRICS.rowHeight + DEFAULT_METRICS.rowHeight / 2;

    const keyText = new BitmapText({ text: `${row.key}:`, style: { fontFamily: BODY_FONT, fontSize: 14 } });
    keyText.tint = theme.colors.textMuted;
    keyText.position.set(DEFAULT_METRICS.paddingX, y - keyText.height / 2);
    container.addChild(keyText);

    const valueMaxWidth = Math.max(0, rowWidth - keyText.width - 6);
    const valueStr = truncateToWidth(String(row.value), valueMaxWidth, DEFAULT_METRICS.charWidth);
    const valueText = new BitmapText({ text: valueStr, style: { fontFamily: MONO_FONT, fontSize: 14 } });
    valueText.tint = theme.colors.text;
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
