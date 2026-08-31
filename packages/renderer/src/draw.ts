import { BitmapFont, BitmapFontManager, BitmapText, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  badgeTextFor,
  headerTextFor,
  DEFAULT_METRICS,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { Theme, TypeStyle } from "./theme.js";

export type Lod = 0 | 1 | 2;

/** scale >= LOD0_MIN: carte complète (en-tête + lignes). LOD1_MIN <= scale <
 * LOD0_MIN: carte + rail + libellé. scale < LOD1_MIN: rectangle plein. */
export const LOD0_MIN_SCALE = 0.5;
export const LOD1_MIN_SCALE = 0.15;

export function lodForScale(scale: number): Lod {
  if (scale >= LOD0_MIN_SCALE) return 0;
  if (scale >= LOD1_MIN_SCALE) return 1;
  return 2;
}

// Rayon de coin utilisé par le surlignage de sélection/recherche plus bas
// dans ce fichier (drawSelectionOverlay, drawSearchHighlights) : ce bloc
// n'est pas encore converti vers `theme.radii.card` (tâche 4), donc cette
// constante reste nécessaire pour que le fichier compile.
const RADIUS = 6; // --radius-md

export type TextRole = "header" | "badge" | "key" | "value";

/** L'avance à utiliser pour tronquer un rôle donné. DOIT rester alignée sur
 * ce que `measureNode` a budgété pour ce même rôle : c'est l'invariant que
 * l'ancienne implémentation violait (une seule avance pour deux polices), d'où
 * les valeurs qui débordaient de leur carte. */
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

// Une police bitmap par rôle : les quatre diffèrent en famille, taille ou
// graisse, et BitmapFont cuit un atlas par combinaison.
const FONT_NAMES: Record<TextRole, string> = {
  header: "dg-header",
  badge: "dg-badge",
  key: "dg-key",
  value: "dg-value",
};

// Résolution 2 : le texte reste net jusqu'à 2x de zoom au lieu de baver dès
// que la caméra dépasse 1x.
const FONT_RESOLUTION = 2;

/** Signature d'un rôle, pour ne réinstaller un atlas que si son style change. */
const installed = new Map<TextRole, string>();

function styleKey(theme: Theme, role: TextRole): string {
  const s = theme.typography[role];
  const family = s.family === "body" ? theme.fonts.body : theme.fonts.mono;
  return `${family}|${s.size}|${s.weight}`;
}

function ensureFonts(theme: Theme): void {
  for (const role of ["header", "badge", "key", "value"] as TextRole[]) {
    const key = styleKey(theme, role);
    if (installed.get(role) === key) continue;
    if (installed.has(role)) BitmapFont.uninstall(FONT_NAMES[role]);
    const s = theme.typography[role];
    BitmapFont.install({
      name: FONT_NAMES[role],
      style: {
        fontFamily: s.family === "body" ? theme.fonts.body : theme.fonts.mono,
        fontSize: s.size,
        fontWeight: String(s.weight) as never,
        letterSpacing: (s.tracking ?? 0) * s.size,
        fill: "#ffffff",
      },
      chars: BitmapFontManager.ASCII,
      resolution: FONT_RESOLUTION,
      dynamicFill: true,
    });
    installed.set(role, key);
  }
}

/**
 * BitmapText ne se rastérise pas de façon fiable sous le renderer canvas
 * logiciel de Pixi v8 (`app.renderer.name === "canvas"`, utilisé quand ni
 * WebGL ni WebGPU ne sont disponibles) : vérifié empiriquement, les Graphics
 * s'affichent mais les BitmapText restent vides. Text passe par un autre
 * chemin, sûr en fallback canvas, d'où le `useBitmapText: false` des appelants
 * dans ce cas.
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
    const t = new BitmapText({ text, style: { fontFamily: FONT_NAMES[role], fontSize: s.size } });
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

/** Chevron « ▸ » (replié) ou « ▾ » (déplié), dessiné en Graphics plutôt qu'en
 * glyphe : l'atlas ASCII ne contient pas ces caractères. */
function drawChevron(g: Graphics, x: number, y: number, expanded: boolean, color: string): void {
  const r = 3.5;
  if (expanded) {
    g.moveTo(x - r, y - r * 0.6).lineTo(x + r, y - r * 0.6).lineTo(x, y + r * 0.9);
  } else {
    g.moveTo(x - r * 0.6, y - r).lineTo(x + r * 0.9, y).lineTo(x - r * 0.6, y + r);
  }
  g.fill(color);
}

/**
 * Dessine le visuel d'un nœud, positionné en (0,0) dans son espace local
 * (l'appelant le place à `rect.x`/`rect.y`).
 *
 * LOD 0 : carte + rail de type + en-tête (chevron, libellé, pastille) + lignes
 * clé/valeur, valeur alignée à droite. LOD 1 : carte + rail + libellé complet
 * tronqué. LOD 2 : rectangle plein dans la couleur de type.
 *
 * `accent` est la couleur de rail résolue par l'appelant via `entityAccentMap`
 * — `drawNode` ne peut pas la déduire de `node` et `theme` seuls, puisque
 * l'assignation dépend de l'ordre de déclaration des types dans la config.
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
): Container {
  if (useBitmapText) ensureFonts(theme);

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

  // Carte + rail, dans un seul Graphics et dans cet ordre précis :
  //   1. un fond accent qui occupe TOUTE la carte,
  //   2. le corps par-dessus, décalé de railWidth vers la droite — ne laisse
  //      donc voir l'accent que sur une bande de railWidth px à gauche,
  //   3. la bordure extérieure, tracée en dernier sur le contour complet.
  // Le corps a ses coins gauches recarrés par un rect, sinon le roundRect
  // laisserait l'accent s'élargir en haut et en bas et le rail ne serait pas
  // d'épaisseur constante.
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
    const label = truncateToWidth(node.label, inner, charWidthFor("header", metrics));
    const text = createLabel(label, theme, "header", theme.ink.primary, useBitmapText);
    text.position.set(contentX, Math.round(rect.height / 2 - text.height / 2));
    container.addChild(text);
    return container;
  }

  // --- LOD 0 : en-tête ---
  const headerY = metrics.headerHeight / 2;
  let cursorX = contentX;

  if (node.childIds.length > 0) {
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

  // Filet de séparation sous l'en-tête.
  if (node.rows.length > 0) {
    const hairline = new Graphics();
    hairline
      .moveTo(metrics.railWidth, metrics.headerHeight)
      .lineTo(rect.width, metrics.headerHeight)
      .stroke({ width: 1, color: theme.edge.hairline });
    container.addChild(hairline);
  }

  // --- LOD 0 : lignes, valeur alignée à droite ---
  node.rows.forEach((row, index) => {
    const y = metrics.headerHeight + index * metrics.rowHeight + metrics.rowHeight / 2;

    const keyText = createLabel(row.key, theme, "key", theme.ink.muted, useBitmapText);
    keyText.position.set(contentX, Math.round(y - keyText.height / 2));
    container.addChild(keyText);

    const keyWidth = row.key.length * charWidthFor("key", metrics);
    const valueBudget = inner - keyWidth - metrics.gapKeyValue;
    const valueStr = truncateToWidth(String(row.value), valueBudget, charWidthFor("value", metrics));
    if (valueStr.length === 0) return;

    const valueText = createLabel(valueStr, theme, "value", theme.ink.primary, useBitmapText);
    valueText.position.set(
      Math.round(contentRight - valueText.width),
      Math.round(y - valueText.height / 2),
    );
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

const SEARCH_STROKE_WIDTH = 2;
const SEARCH_CURRENT_STROKE_WIDTH = 4;

/**
 * Draws a `searchHighlight`-colored outline on every currently visible
 * matched node (`matchedIds`), plus a thicker "reinforced" outline on
 * `currentId` (drawn last, on top, so it wins visually over the plain
 * outline when both would otherwise overlap). A node id present in
 * `matchedIds`/`currentId` that isn't in `positions` (i.e. not currently
 * visible) is silently skipped — callers are expected to have already
 * filtered to visible ids, but this is a defensive no-op either way.
 */
export function drawSearchHighlights(
  positions: Map<NodeId, Rect>,
  theme: Theme,
  matchedIds: Iterable<NodeId>,
  currentId: NodeId | null,
): Graphics {
  const g = new Graphics();
  for (const id of matchedIds) {
    if (id === currentId) continue; // drawn separately below, on top
    const rect = positions.get(id);
    if (!rect) continue;
    g.roundRect(rect.x, rect.y, rect.width, rect.height, RADIUS).stroke({
      width: SEARCH_STROKE_WIDTH,
      color: theme.colors.searchHighlight,
    });
  }

  if (currentId !== null) {
    const rect = positions.get(currentId);
    if (rect) {
      g.roundRect(rect.x, rect.y, rect.width, rect.height, RADIUS).stroke({
        width: SEARCH_CURRENT_STROKE_WIDTH,
        color: theme.colors.searchHighlight,
      });
    }
  }

  return g;
}
