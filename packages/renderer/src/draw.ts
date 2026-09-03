import { BitmapText, Circle, Container, Graphics, Rectangle, Text } from "pixi.js";
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
import { DIM_ALPHA } from "./focus.js";
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
 *
 * `showChevron` gouverne l'affordance de pli. Le défaut — le nœud a des enfants
 * de containment — est celui de la vue structure ; la vue graphe le passe
 * explicitement, car là c'est l'agrégat qui se plie, pas l'arbre, et seule sa
 * racine porte un chevron.
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
  showChevron = node.childIds.length > 0,
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
 * Point où le segment CENTRE de `rect` → `(tx, ty)` coupe le PÉRIMÈTRE de
 * `rect`.
 *
 * Les arêtes sont dessinées SOUS le calque des cartes : un ancrage fixe (le
 * milieu du bord droit de la source, le milieu du bord gauche de la cible)
 * enterre le départ de l'arête sous sa propre carte dès que la cible est en
 * dessous ou à gauche — la ligne « sort de nulle part ». En sortant du côté
 * qui fait face à la cible, le départ reste toujours visible.
 *
 * `(tx, ty)` à l'INTÉRIEUR du rectangle (ou confondu avec son centre) n'a pas
 * d'intersection utile : on renvoie alors le centre. L'arête finit cachée sous
 * les cartes qui se chevauchent, ce qui est le repli acceptable — il n'existe
 * pas de « bon » point de sortie dans ce cas.
 */
export function anchorOnRect(rect: Rect, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return { x: cx, y: cy };
  // Le premier bord atteint est celui dont le facteur d'échelle est le plus
  // petit ; `Infinity` neutralise l'axe le long duquel on n'avance pas.
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Centre d'un rectangle — la cible que vise `anchorOnRect` de l'autre bout. */
function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Relation dominante de la vue : l'arbre de containment (vue structure) ou les
 * seules références (vue graphe). */
export type EdgeMode = "contain" | "ref";

/**
 * Dessine toutes les arêtes entre nœuds visibles dans un seul Graphics,
 * groupées par style : contenance en béziers horizontales pleines, références
 * résolues terminées par une tête de flèche, références cassées en moignon
 * pointillé barré d'une croix.
 *
 * Le tracé des références résolues dépend du mode : POINTILLÉ en `"contain"`
 * (vue structure, où la référence est une décoration au-dessus de l'arbre),
 * PLEIN en `"ref"` (vue graphe, où elle est la relation principale). Le moignon
 * d'une référence cassée reste pointillé dans les deux modes : son pointillé ne
 * dit pas « secondaire » mais « ne mène nulle part », et il porte déjà sa propre
 * couleur et sa croix.
 *
 * Les têtes de flèche sont des triangles pleins : elles ne peuvent pas
 * partager l'appel `stroke()` des pointillés, d'où un `fill()` distinct émis
 * après lui, sur le même Graphics.
 *
 * Renvoie un Graphics vide en LOD 2 (les arêtes ne sont ni lisibles ni
 * rentables à ce niveau de dézoom).
 *
 * `focusIds` estompe tout ce qui ne touche AUCUN des nœuds focalisés (la
 * sélection, côté `create.ts`). Un `stroke()` ne porte qu'UN style, donc l'alpha
 * ne peut pas se poser arête par arête sans rendre un appel de tracé par arête :
 * chaque groupe de couleur se scinde en deux passes, l'estompée d'abord — les
 * arêtes de la sélection passent ainsi par-dessus — puis la pleine. `focusIds`
 * nul laisse la passe estompée vide, et le tracé est alors exactement celui
 * d'avant l'estompage, à l'instruction près.
 *
 * Un ENSEMBLE et non un id unique, parce que la vue graphe a deux unités de
 * sélection : une carte, dont l'ensemble est le singleton (et le rendu est alors
 * strictement celui d'avant), et un agrégat, dont l'ensemble est celui de ses
 * MEMBRES. Passer les membres — et non l'ensemble « lié » plus large de
 * `clusterRelatedIds` — est ce qui donne la bonne lecture : les arêtes internes
 * au bloc et celles qui le traversent restent pleines, tandis qu'une arête entre
 * deux voisins extérieurs, qui ne dit rien du bloc, recule.
 *
 * La fonction reste PURE et ne prend que de la donnée nue : un ensemble d'ids,
 * pas la notion de sélection ni l'état d'interface qui la porte.
 */
export function drawEdges(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  lod: Lod,
  mode: EdgeMode = "contain",
  focusIds: ReadonlySet<NodeId> | null = null,
): Graphics {
  const g = new Graphics();
  if (lod === 2) return g;

  /** L'arête appartient-elle à la passe d'alpha `full` ? Sans focus, tout est
   * de la passe pleine et la passe estompée n'émet aucune instruction. */
  const inPass = (from: NodeId, to: NodeId | null, full: boolean): boolean =>
    (focusIds === null || focusIds.has(from) || (to !== null && focusIds.has(to))) === full;

  // Estompée d'abord, pleine ensuite : les arêtes de la sélection sont ainsi
  // peintes par-dessus les autres, dans un Graphics unique où seul l'ordre
  // d'émission règle le recouvrement. Sans focus il n'y a qu'une passe — non
  // par économie, mais pour que « aucun focus » et « tracé d'avant l'estompage »
  // soient le même chemin de code, et pas deux qui doivent se ressembler.
  const PASSES: { alpha: number; full: boolean }[] =
    focusIds === null
      ? [{ alpha: 1, full: true }]
      : [
          { alpha: DIM_ALPHA, full: false },
          { alpha: 1, full: true },
        ];

  // En mode `"ref"` (vue graphe), le containment n'est pas la relation montrée :
  // seules les références le sont. Deux entités imbriquées l'une dans l'autre
  // sont toutes deux positionnées, et tracer leur arête de containment
  // ajouterait une relation qui n'appartient pas à cette vue.
  if (mode === "contain") {
    for (const pass of PASSES) {
      let hasContain = false;
      for (const edge of graph.containEdges) {
        if (!inPass(edge.from, edge.to, pass.full)) continue;
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
      if (!inPass(edge.from, edge.to, pass.full)) continue;
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      // Chaque bout sort du côté qui fait face à l'autre carte, sinon la ligne
      // passe sous la carte source (calque des arêtes au-dessous des cartes).
      const fromCenter = centerOf(from);
      const toCenter = centerOf(to);
      const start = anchorOnRect(from, toCenter.x, toCenter.y);
      const end = anchorOnRect(to, fromCenter.x, fromCenter.y);
      const x1 = start.x;
      const y1 = start.y;
      const x2 = end.x;
      const y2 = end.y;
      // La ligne s'arrête au pied de la flèche pour ne pas la traverser.
      const len = Math.hypot(x2 - x1, y2 - y1);
      const t = len > ARROW_LENGTH ? (len - ARROW_LENGTH) / len : 1;
      const ex = x1 + (x2 - x1) * t;
      const ey = y1 + (y2 - y1) * t;
      if (mode === "ref") {
        // Vue graphe : la référence EST la relation montrée, pas une décoration
        // posée au-dessus du containment. Le pointillé signifie « secondaire » ;
        // il serait à contresens dans une vue dont c'est tout le propos. Trait
        // plein, donc — un seul segment au lieu des N tirets de `dashedLine`,
        // ce qui rend les deux modes distinguables au comptage d'instructions.
        g.moveTo(x1, y1);
        g.lineTo(ex, ey);
      } else {
        dashedLine(g, x1, y1, ex, ey);
      }
      resolved.push({ x1, y1, x2, y2 });
      hasRef = true;
    }
    if (hasRef) {
      // Les têtes de flèche sont des triangles pleins : leur `fill()` ne peut
      // pas partager le `stroke()` des traits, et suit donc son alpha de passe.
      g.stroke({ width: theme.strokes.edge, color: theme.edge.ref, alpha: pass.alpha });
      for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
      g.fill({ color: theme.edge.ref, alpha: pass.alpha });
    }
  }

  for (const pass of PASSES) {
    let hasDangling = false;
    for (const edge of graph.refEdges) {
      if (!edge.dangling) continue;
      // Un moignon ne touche le focus que par sa SOURCE : son autre bout ne
      // mène nulle part, et `inPass` ne peut donc l'apparier à personne.
      if (!inPass(edge.from, edge.to, pass.full)) continue;
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
    if (hasDangling) {
      g.stroke({ width: theme.strokes.edge, color: theme.edge.dangling, alpha: pass.alpha });
    }
  }

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
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      // Mêmes ancrages que `drawEdges` : la zone de clic doit rester posée sur
      // le trait, pas sur l'ancien segment milieu-droit → milieu-gauche.
      const fromCenter = centerOf(from);
      const toCenter = centerOf(to);
      const start = anchorOnRect(from, toCenter.x, toCenter.y);
      const end = anchorOnRect(to, fromCenter.x, fromCenter.y);
      x1 = start.x;
      y1 = start.y;
      x2 = end.x;
      y2 = end.y;
    } else {
      // Un moignon ne vise rien : pas de direction à suivre, il reste
      // horizontal depuis le milieu du bord droit.
      x1 = from.x + from.width;
      y1 = from.y + from.height / 2;
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
 *
 * Le surlignage d'une référence résolue REPREND la géométrie et le style de
 * `drawEdges` — mêmes ancrages, même arrêt au pied de la flèche, même tête
 * repeinte —, et son trait suit le mode : plein en `"ref"`, pointillé en
 * `"contain"`. Autrement dit, il fait CHANGER DE STYLE l'arête existante au lieu
 * d'en superposer une seconde. Un pointillé posé sur le trait plein de la vue
 * graphe se lisait comme une arête de plus, et sa ligne traversait la tête de
 * flèche de celle qu'elle était censée souligner.
 *
 * Le moignon d'une référence cassée reste pointillé dans les deux modes : son
 * pointillé ne dit pas « secondaire » mais « ne mène nulle part » — même
 * argument que dans `drawEdges`.
 */
export function drawSelectionOverlay(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  theme: Theme,
  selectedId: NodeId | null,
  mode: EdgeMode = "contain",
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
  const resolved: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const edge of graph.refEdges) {
    if (edge.from !== selectedId) continue;
    const from = positions.get(edge.from);
    if (!from) continue;
    if (edge.to !== null && !edge.dangling) {
      const to = positions.get(edge.to);
      if (!to) continue;
      // Mêmes ancrages que `drawEdges` : le surlignage doit recouvrir le trait.
      const fromCenter = centerOf(from);
      const toCenter = centerOf(to);
      const start = anchorOnRect(from, toCenter.x, toCenter.y);
      const end = anchorOnRect(to, fromCenter.x, fromCenter.y);
      // La ligne s'arrête au pied de la flèche pour ne pas la traverser.
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
    } else {
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      dashedLine(g, x1, y1, x1 + DANGLING_STUB_LENGTH, y1);
    }
    hasRefs = true;
  }
  if (hasRefs) g.stroke({ width: theme.strokes.selection, color: theme.accent.selection });
  if (resolved.length > 0) {
    // Les têtes de flèche sont des triangles pleins : leur `fill()` ne peut pas
    // partager le `stroke()` des traits, d'où cet appel distinct — exactement le
    // découpage de `drawEdges`.
    for (const r of resolved) arrowHead(g, r.x1, r.y1, r.x2, r.y2);
    g.fill(theme.accent.selection);
  }

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
 * L'enveloppe est le cercle englobant minimal des cartes de l'agrégat, calculé
 * côté cœur (`enclosingCircle`). Ce qu'on peint ici n'est pas seulement égal à
 * ce que la mise en page a espacé : c'est le MÊME disque. `layout-two-level.ts`
 * le calcule une fois sur le bloc packé, puis le translate avec ses cartes.
 * Un rayon nul ou négatif n'est pas une surface et est ignoré.
 *
 * Une seule chose recalcule ce disque après la mise en page : le déplacement
 * d'une carte à la souris (`recomputeClusterCircle`, dans `create.ts`), qui
 * refait le MÊME calcul avec le MÊME `hullPadding` — celui que le moteur
 * expose. Le déplacement d'un agrégat entier, lui, ne recalcule rien : il
 * translate le disque avec ses cartes, exactement comme le moteur le fait.
 */
export function drawClusters(
  clusters: {
    circle: { cx: number; cy: number; r: number };
    color: string;
    /**
     * Intensité du survol, de 0 (au repos) à 1 (survolée). Absente vaut 0 : le
     * rendu au repos est celui d'avant le survol, au chiffre près.
     *
     * La valeur arrive DÉJÀ adoucie par `attachHover` (ease-out quad) ; on
     * n'interpole donc ici que linéairement, sans quoi la courbe s'appliquerait
     * deux fois et la montée partirait mollement.
     */
    hover?: number;
    /**
     * Vrai quand l'enveloppe n'a aucun lien avec la sélection courante : ses
     * deux alphas sont alors multipliés par `DIM_ALPHA`. Absent vaut faux, donc
     * un appelant qui ignore le champ obtient le rendu d'avant l'estompage.
     *
     * Un BOOLÉEN et pas un facteur numérique : l'estompage n'a que deux états —
     * la question posée à `focus.ts` est « lié ou pas », jamais « à quel point ».
     * Un facteur laisserait chaque appelant choisir le sien, et c'est justement
     * ce que `DIM_ALPHA` interdit pour que cartes, arêtes et enveloppes reculent
     * du même pas. Qui décide reste `create.ts` (`clustersFor`), qui seul
     * connaît la sélection ; ce qu'on peint alors est fixé ici.
     */
    dim?: boolean;
  }[],
  theme: Theme,
): Graphics {
  const g = new Graphics();
  for (const cluster of clusters) {
    const { cx, cy, r } = cluster.circle;
    if (!(r > 0)) continue;
    // Bornage défensif : aucune source ne produit d'intensité hors de [0,1],
    // mais un alpha > 1 ou négatif ne serait pas seulement laid, il serait
    // invalide pour le renderer.
    const t = Math.min(1, Math.max(0, cluster.hover ?? 0));
    // L'estompage MULTIPLIE l'état de survol au lieu de s'y substituer : une
    // enveloppe estompée que le pointeur traverse répond quand même, en restant
    // au fond. Le survol dit « celle-ci est saisissable », l'estompage « celle-ci
    // ne parle pas à la sélection » — deux informations qui ne s'annulent pas.
    const dim = cluster.dim === true ? DIM_ALPHA : 1;
    g.circle(cx, cy, r);
    // Les trois paliers montent ensemble : le fond seul ferait une tache sans
    // contour net, le contour seul un cerne sans corps. C'est leur montée
    // simultanée qui fait lire l'enveloppe comme un objet qu'on peut saisir —
    // ce qu'elle est, puisque c'est ce disque qui déplace l'agrégat entier.
    //
    // L'ÉPAISSEUR du trait, elle, échappe à l'estompage : elle dit la taille de
    // l'objet, pas son importance, et l'amincir en plus de le pâlir ferait
    // rentrer l'enveloppe estompée dans la précision du sub-pixel.
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
 * Les cibles de SAISIE des enveloppes : un container vide et transparent par
 * disque, sans autre rôle que de recevoir le pointeur.
 *
 * Séparer la cible du visuel n'est pas un raffinement, c'est la condition pour
 * que le geste existe : le Graphics des enveloppes est détruit et reconstruit à
 * chaque image d'un déplacement, donc des écouteurs posés dessus mourraient à
 * la première frame du drag qu'ils viennent de démarrer. Même partage que les
 * arêtes et leur `edgeHitLayer`.
 *
 * Le container est POSITIONNÉ sur le centre du disque et sa `hitArea` est un
 * cercle centré sur l'origine locale, plutôt qu'un cercle en coordonnées monde
 * sur un container à l'origine. Déplacer l'agrégat se résume alors à écrire sa
 * position, comme pour une carte, au lieu de muter la géométrie de la zone
 * sensible à chaque image.
 *
 * L'objet d'entrée est rendu TEL QUEL (et non copié) : c'est le `ClusterShape`
 * de la mise en page, et le déplacement le mute en place pour que le prochain
 * repeint voie la nouvelle forme.
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
    // `grab` et non `pointer` : un tap sur ce disque sélectionne bien son
    // agrégat, mais le geste DOMINANT reste la saisie — le tap n'en est que
    // l'en-deçà, sous le seuil. `create.ts` repose ce curseur après
    // `attachTap`, qui le remplacerait par `pointer`. Le passage à `grabbing`
    // pendant le geste est déjà porté par `attachDrag`.
    container.cursor = "grab";
    hits.push({ cluster, container });
  }
  return hits;
}
