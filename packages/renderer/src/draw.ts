import { BitmapText, Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  badgeTextFor,
  headerTextFor,
  DEFAULT_METRICS,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Point,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
import type { Theme, TypeStyle } from "./theme.js";
import { fontNameFor, type TextRole } from "./font-registry.js";

export type { TextRole };

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

// L'installation des atlas appartient à `font-registry.ts`, qui les compte
// par référence : le nom d'un atlas y est une fonction pure du thème et du
// rôle, si bien que `drawNode` le retrouve sans rien recevoir de l'appelant.
// C'est `create.ts` qui tient le bail et le libère à `destroy()`.

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
  // Les atlas sont installés par le bail que tient `create.ts`, avant tout
  // appel ici. `fontNameFor` en dérive le nom depuis le thème seul.
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

    // Le key doit lui aussi être tronqué : sans plafond, une clé d'environ
    // 49+ caractères (à `maxWidth` 340) consomme `inner` en entier, rend
    // `valueBudget` négatif, et `truncateToWidth` renvoie "" pour la valeur —
    // qui disparaît alors silencieusement de la carte. On réserve donc à la
    // clé au plus `inner - gapKeyValue - <largeur d'un caractère de valeur>`,
    // ce qui garantit à la valeur un budget plancher d'au moins un caractère.
    const valueCharWidth = charWidthFor("value", metrics);
    const keyCharWidth = charWidthFor("key", metrics);
    const keyBudget = Math.max(0, inner - metrics.gapKeyValue - valueCharWidth);
    const keyStr = truncateToWidth(row.key, keyBudget, keyCharWidth);

    const keyText = createLabel(keyStr, theme, "key", theme.ink.muted, useBitmapText);
    keyText.position.set(contentX, Math.round(y - keyText.height / 2));
    container.addChild(keyText);

    const keyWidth = keyStr.length * keyCharWidth;
    const valueBudget = inner - keyWidth - metrics.gapKeyValue;
    const valueStr = truncateToWidth(String(row.value), valueBudget, valueCharWidth);
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

const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 3.5;

/** Triangle plein pointant de (x1,y1) vers (x2,y2), sa pointe en (x2,y2). */
function arrowHead(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * ARROW_LENGTH;
  const by = y2 - uy * ARROW_LENGTH;
  // Normale unitaire.
  const nx = -uy;
  const ny = ux;
  g.moveTo(x2, y2)
    .lineTo(bx + nx * ARROW_HALF_WIDTH, by + ny * ARROW_HALF_WIDTH)
    .lineTo(bx - nx * ARROW_HALF_WIDTH, by - ny * ARROW_HALF_WIDTH)
    .closePath();
}

const DANGLING_STUB_LENGTH = 32;
const DANGLING_CROSS_RADIUS = 4;

/**
 * Dessine toutes les arêtes entre nœuds visibles dans un seul Graphics,
 * groupées par style : contenance en béziers horizontales pleines, références
 * résolues en pointillés terminés par une tête de flèche, références cassées
 * en moignon pointillé barré d'une croix.
 *
 * Les têtes de flèche sont des triangles pleins : elles ne peuvent pas
 * partager l'appel `stroke()` des pointillés, d'où un `fill()` distinct émis
 * après lui, sur le même Graphics.
 *
 * Renvoie un Graphics vide en LOD 2 (les arêtes ne sont ni lisibles ni
 * rentables à ce niveau de dézoom).
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
  if (hasContain) g.stroke({ width: theme.strokes.edge, color: theme.edge.contain });

  let hasRef = false;
  const resolved: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const edge of graph.refEdges) {
    if (edge.dangling || edge.to === null) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    // La ligne s'arrête au pied de la flèche pour ne pas la traverser.
    const len = Math.hypot(x2 - x1, y2 - y1);
    const t = len > ARROW_LENGTH ? (len - ARROW_LENGTH) / len : 1;
    dashedLine(g, x1, y1, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    resolved.push({ x1, y1, x2, y2 });
    hasRef = true;
  }
  if (hasRef) {
    g.stroke({ width: theme.strokes.edge, color: theme.edge.ref });
    for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
    g.fill(theme.edge.ref);
  }

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
  if (hasDangling) g.stroke({ width: theme.strokes.edge, color: theme.edge.dangling });

  return g;
}

export interface EdgeHit {
  edge: RefEdge;
  graphics: Graphics;
}

const REF_HIT_WIDTH = 14;

/**
 * Une zone de clic invisible et épaissie (14px) par arête de référence
 * visible. Purement géométrique : l'appelant règle `eventMode`/`cursor` et
 * branche le tap. L'alpha est 0, mais le hit-test des Graphics étant
 * géométrique, la forme reste cliquable.
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

/**
 * Surlignage de sélection : contour sur le nœud, sur sa chaîne de parenté
 * jusqu'à la racine, et sur ses références sortantes (moignons cassés
 * inclus). Renvoie un Graphics vide si rien n'est sélectionné ou si le nœud
 * sélectionné n'est pas visible.
 *
 * C'est le seul endroit, avec les références cassées, où le rouge apparaît :
 * comme plus rien d'autre n'est rouge, la sélection se lit immédiatement.
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
  if (hasChain) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });

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
  if (hasRefs) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });

  return g;
}

/**
 * Surlignage de recherche : remplissage lavé plus contour sur chaque résultat
 * visible, et un contour renforcé dans la couleur de sélection sur le résultat
 * courant, dessiné en dernier pour passer au-dessus. Un id absent de
 * `positions` est ignoré sans bruit.
 */
export function drawSearchHighlights(
  positions: Map<NodeId, Rect>,
  theme: Theme,
  matchedIds: Iterable<NodeId>,
  currentId: NodeId | null,
): Graphics {
  const g = new Graphics();
  for (const id of matchedIds) {
    if (id === currentId) continue; // dessiné ci-dessous, au-dessus
    const rect = positions.get(id);
    if (!rect) continue;
    g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
      .fill({ color: theme.accent.match, alpha: 0.55 })
      .stroke({ width: theme.strokes.match, color: theme.accent.matchStroke });
  }

  if (currentId !== null) {
    const rect = positions.get(currentId);
    if (rect) {
      g.roundRect(rect.x, rect.y, rect.width, rect.height, theme.radii.card)
        .fill({ color: theme.accent.match, alpha: 0.55 })
        .stroke({ width: theme.strokes.matchCurrent, color: theme.accent.selection });
    }
  }

  return g;
}

/**
 * Peint les enveloppes d'agrégats : remplissage translucide plus contour, dans
 * la couleur d'accent du type de la racine. Le calque qui les reçoit est le
 * plus bas du monde, donc elles passent derrière les arêtes et les cartes.
 *
 * Un polygone de moins de trois points n'est pas une surface et est ignoré.
 */
export function drawHulls(hulls: { polygon: Point[]; color: string }[], theme: Theme): Graphics {
  const g = new Graphics();
  for (const hull of hulls) {
    if (hull.polygon.length < 3) continue;
    const [first, ...rest] = hull.polygon;
    g.moveTo(first!.x, first!.y);
    for (const point of rest) g.lineTo(point.x, point.y);
    g.closePath();
    g.fill({ color: hull.color, alpha: 0.08 });
    g.stroke({ width: 1.5, color: hull.color, alpha: 0.35 });
  }
  return g;
}
