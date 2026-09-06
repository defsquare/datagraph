import { BitmapText, Circle, Container, Graphics, Rectangle, Text } from "pixi.js";
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

/** Aucun champ référençant : une constante partagée plutôt qu'un `new Set()`
 * par appel, `drawNode` étant appelé une fois par carte visible et par rebuild.
 * Sert aussi de défaut aux champs CASSÉS — les deux ensembles sont vides de la
 * même façon, et distinguer deux singletons vides n'apporterait rien. */
const NO_REF_FIELDS: ReadonlySet<string> = new Set();



/** La croix « ✕ » d'une référence cassée : une boîte carrée posée contre le
 * bord droit du contenu, précédée d'un écart qui la sépare de la valeur. */
const DANGLING_ICON_WIDTH = 7;
const DANGLING_ICON_GAP = 4;
const DANGLING_ICON_STROKE = 1.5;

/** Hauteur de la pilule d'une ligne-tableau, et son rayon d'arrondi. Elle est
 * plus basse que `rowHeight` pour laisser respirer les lignes voisines. */
const TOKEN_HEIGHT = 15;
const TOKEN_RADIUS = 7.5;

/**
 * De combien la pilule se décale vers la droite au survol. Le décalage va dans
 * le SENS du dépliage — les cartes d'éléments sortent à droite — si bien que
 * le geste est annoncé par la direction du mouvement et pas seulement par un
 * changement de couleur.
 */
export const TOKEN_HOVER_SHIFT = 2;

/**
 * Dessine la pilule d'une ligne-tableau, alignée à droite du contenu.
 *
 * Elle est montée dans un conteneur étiqueté `array-token:<index>` — même
 * convention que `ref-underline:<index>` — pour que `create.ts` puisse la
 * déplacer au survol sans redessiner la carte ni recalculer sa géométrie. Le
 * visuel de survol est un SECOND tracé préparé caché plutôt qu'une couleur
 * recalculée : `draw.ts` ne peut pas connaître l'état du pointeur, et basculer
 * une visibilité est tout ce qu'il reste à faire à l'appelant.
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

  // Le fond reprend la couleur du canevas : sur une carte claire comme sur une
  // carte estompée, la pilule se lit alors comme un creux, sans qu'aucune
  // palette ait à déclarer une teinte de plus.
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

  // `null` : la vue courante ne plie rien (vue graphe), donc pas de chevron —
  // il promettrait un geste sans effet. La LARGEUR reste la même dans les deux
  // cas, `arrayTokenWidth` réservant toujours la place du chevron : `measureNode`
  // ne connaît pas la vue, et une carte qui se mesurerait différemment selon la
  // vue ferait diverger les deux mises en page.
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
 *
 * `refFields` nomme les lignes dont la valeur déclenche une référence sortante
 * au clic. Sans ce signal, rien ne distinguait une valeur navigable d'une
 * valeur inerte : la carte proposait un geste invisible. L'appelant passe des
 * NOMS DE CHAMPS et non des arêtes — `drawNode` n'a pas à connaître le graphe.
 *
 * L'indicateur est en deux temps, et c'est ce qui préserve la pureté de ce
 * fichier : au repos la valeur est simplement TEINTÉE, et un souligné est
 * préparé sous elle, `visible = false`. Savoir quelle ligne est sous le
 * pointeur est un état d'interface qui appartient à `create.ts` ; il n'a plus
 * qu'à basculer une visibilité par label, sans redessiner ni consulter la
 * géométrie que ce fichier vient de calculer.
 *
 * `danglingFields` nomme les lignes dont la référence NE RÉSOUT PAS. Leur valeur
 * garde la teinte de référence — c'en est une, simplement cassée — et reçoit une
 * croix contre le bord droit de la ligne. Le diagnostic vivait auparavant dans
 * l'espace des arêtes, en moignon accroché au bord de la carte : il désignait
 * ainsi la CARTE et non le CHAMP fautif. Posé sur la ligne, il désigne
 * exactement la valeur qui ne résout pas.
 *
 * Ces lignes n'ont PAS de souligné : le souligné promet « ce clic navigue », or
 * `followRef` ne mène nulle part quand la cible est nulle. Une ligne présente
 * dans les deux ensembles (un champ portant plusieurs arêtes) est traitée comme
 * cassée — le doute doit se voir.
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
    // La croix d'une référence cassée, elle, PREND de la place, contrairement
    // à la teinte. Elle est retranchée des DEUX budgets et pas seulement de
    // celui de la valeur : le budget de troncature doit égaler la place
    // réellement disponible, sans quoi une clé longue reprendrait la place
    // réservée à l'icône et la croix se poserait sur du texte.
    const isDangling = danglingFields.has(row.key);
    const iconSpace = isDangling ? DANGLING_ICON_WIDTH + DANGLING_ICON_GAP : 0;

    const valueCharWidth = charWidthFor("value", metrics);
    const keyCharWidth = charWidthFor("key", metrics);

    // Une ligne « valeur seule » — le document racine scalaire, un élément
    // scalaire de tableau — ne dessine pas sa clé : `tags[0]` en en-tête puis
    // `$value` en clé ne dirait rien de plus. Elle ne consomme donc ni largeur
    // de clé ni écart, exactement comme `measureNode` l'a budgété.
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

    // L'écart clé/valeur est REPLIÉ dans `keyWidth` : sans clé il n'y a pas
    // d'écart à réserver, et le garder à part imposerait de le retrancher
    // conditionnellement à deux endroits.
    const keyWidth = showKey ? keyStr.length * keyCharWidth + metrics.gapKeyValue : 0;
    const valueBudget = inner - iconSpace - keyWidth;

    // La ligne d'un tableau élidé porte une pilule, pas du texte : elle sort
    // ici, avant toute la mécanique de troncature et de référence, qui ne
    // s'applique qu'à une valeur scalaire.
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
      // Dessinée AVANT le repli sur valeur vide : sur une carte trop étroite
      // pour afficher quoi que ce soit, c'est justement le diagnostic qui doit
      // survivre — sinon la carte la moins lisible serait celle qui cache son
      // erreur. Un tracé et non un glyphe : l'atlas ASCII ne contient pas « ✕ ».
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

    // La valeur porte la couleur de l'arête qu'elle déclenche : c'est le même
    // objet vu de deux endroits, pas deux informations à accorder. Une référence
    // cassée garde cette teinte — c'en est une, et c'est précisément sa nature de
    // référence qui rend son échec intéressant. La teinte ne prend AUCUNE place :
    // hors ligne cassée, les budgets ci-dessus restent ceux d'une ligne
    // ordinaire, et rendre une ligne navigable ne peut pas raccourcir sa valeur.
    const isRef = refFields.has(row.key) || isDangling;
    const valueColor = isRef ? theme.edge.ref : theme.ink.primary;
    const valueText = createLabel(valueStr, theme, "value", valueColor, useBitmapText);
    valueText.position.set(
      Math.round(contentRight - iconSpace - valueText.width),
      Math.round(y - valueText.height / 2),
    );
    container.addChild(valueText);

    // Pas de souligné sur une ligne cassée : il promettrait une navigation que
    // `followRef` ne fera pas.
    if (!isRef || isDangling) return;
    // Le souligné du survol : l'affordance de lien hypertexte. Il est posé APRÈS
    // le repli sur valeur vide, car il souligne un TEXTE — sans texte, un trait
    // isolé ne désignerait plus rien.
    //
    // Caché, et repéré par un label plutôt que rendu à l'appelant : l'état de
    // survol (quelle ligne est sous le pointeur) appartient à `create.ts`, et
    // c'est de le garder hors d'ici qui laisse `drawNode` pur et testable sans
    // instance. Ce fichier ne fait que préparer un visuel piloté par visibilité.
    //
    // La géométrie est reprise du texte lui-même, jamais recalculée : le trait
    // couvre exactement sa largeur et suit sa ligne de base, si bien qu'un
    // changement de police ou de troncature n'a pas à être répercuté ici.
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

/**
 * Les deux extrémités du segment d'une arête de référence : chaque bout sort du
 * côté qui fait face à l'AUTRE carte, sinon la ligne passe sous la carte source
 * (le calque des arêtes est au-dessous des cartes).
 *
 * Ce calcul existait en trois exemplaires — tracé, zones de clic, surlignage de
 * sélection — que rien n'obligeait à rester d'accord, et qui ne l'étaient
 * d'ailleurs plus. Une seule définition, désormais partagée aussi par les
 * étiquettes : une zone de clic ou un surlignage posés ailleurs que le trait
 * sont des bogues qu'aucun test de tracé ne peut voir.
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

/** Relation dominante de la vue : l'arbre de containment (vue structure) ou les
 * seules références (vue graphe). */
export type EdgeMode = "contain" | "ref";

/**
 * Dessine toutes les arêtes entre nœuds visibles dans un seul Graphics,
 * groupées par style : contenance en béziers horizontales pleines, références
 * résolues terminées par une tête de flèche.
 *
 * Une référence CASSÉE n'est plus tracée du tout. Le moignon qui la signalait
 * flottait au bord de la carte source, donc il désignait la CARTE et non le
 * CHAMP fautif ; le diagnostic est passé sur la ligne de la carte, où la croix
 * de `drawNode` se pose contre la valeur qui ne résout pas.
 *
 * Le tracé des références résolues dépend du mode : POINTILLÉ en `"contain"`
 * (vue structure, où la référence est une décoration au-dessus de l'arbre),
 * PLEIN en `"ref"` (vue graphe, où elle est la relation principale).
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
  metrics: NodeMetrics = DEFAULT_METRICS,
): Graphics {
  const g = new Graphics();
  if (lod === 2) return g;

  /** L'arête appartient-elle à la passe d'alpha `full` ? Sans focus, tout est
   * de la passe pleine et la passe estompée n'émet aucune instruction.
   *
   * Une référence compte aussi par son ENTITÉ déclarante : la sélection est le
   * value object en vue structure, mais l'entité en vue graphe, où le value
   * object n'a pas de carte à sélectionner. Sans `fromEntity`, sélectionner un
   * panier estomperait l'arête que sa propre ligne porte. L'arête entière en
   * paramètre plutôt que deux ids : c'est elle qui sait s'il y a une entité
   * derrière son départ. */
  const inPass = (edge: ContainEdge | RefEdge, full: boolean): boolean => {
    if (focusIds === null) return full;
    const touched =
      focusIds.has(edge.from) ||
      (edge.to !== null && focusIds.has(edge.to)) ||
      (edge.kind === "ref" && focusIds.has(edge.fromEntity));
    return touched === full;
  };

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
        if (!inPass(edge, pass.full)) continue;
        // Le DÉPART passe par `anchorRectFor` : pour un tableau élidé, c'est la
        // bande de sa ligne sur la carte parente, si bien que l'arête sort du
        // jeton `[ n items ]` et non du milieu de la carte. L'ARRIVÉE, elle, se
        // lit directement dans `positions` — une arête ne peut pas pointer vers
        // un nœud élidé, qui n'a pas de carte, et l'arête `#p1 → tags` tombe
        // donc d'elle-même, remplacée par la ligne qu'elle décrivait.
        const from = anchorRectFor(graph, positions, edge.from, metrics);
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
      if (!inPass(edge, pass.full)) continue;
      // Le DÉPART est HISSÉ jusqu'à la plus proche CARTE : celle du value object
      // si elle est dépliée, celle de l'entité hôte sinon. Une référence portée
      // par un value object reste ainsi tracée dans toutes les vues, au lieu de
      // disparaître avec la carte qui la porte ; de quelle LIGNE elle part est
      // dit par l'étiquette de sélection (`drawEdgeLabels`), pas par le point
      // d'attache. L'ARRIVÉE, elle, se lit toujours dans `positions` : une cible
      // hors de l'écran n'a pas d'arête à montrer.
      const from = nearestCardRectFor(graph, positions, edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const { start, end } = refEdgeEnds(from, to);
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

  return g;
}

/** Distance du départ à laquelle l'étiquette se pose, le long du segment, et
 * décalage perpendiculaire qui l'écarte du trait. Assez près pour que l'œil
 * rattache l'étiquette à SON arête quand plusieurs quittent la même carte,
 * assez loin pour ne pas chevaucher la carte de départ. */
/**
 * Position des étiquettes le long du lien, en FRACTION de sa longueur et non en
 * pixels fixes : plusieurs arêtes quittent la même carte par des points
 * voisins, et à 24 px du départ elles ne se sont pas encore écartées — leurs
 * étiquettes se recouvraient (constaté sur la démo, sélection de #p16). À un
 * tiers du trajet, la divergence des traits a fait le travail d'espacement.
 *
 * Les étiquettes d'une même sélection sont en plus ÉTAGÉES (`i % 3`) : deux
 * arêtes quasi parallèles resteraient proches à fraction égale, l'étagement les
 * sépare le long de leur propre trait. Le plafond (0.38 + 2×0.14 = 0.66) garde
 * l'étiquette nettement du côté de la SOURCE : au-delà, elle se lirait comme
 * désignant la cible.
 */
const LABEL_ALONG_FRACTION = 0.38;
const LABEL_STAGGER_FRACTION = 0.14;
const LABEL_ASIDE = 10;
const LABEL_HEIGHT = 15;
const LABEL_RADIUS = 7.5;
const LABEL_PADDING_X = 6;

/**
 * Ce qu'il faut savoir d'une étiquette pour la dessiner ET pour la reposer
 * ailleurs sur son trait : son texte, le segment qu'elle annote, et sa fraction
 * de REPOS le long de ce segment.
 *
 * Le segment est porté ici, et pas seulement le point final, parce que la
 * position n'est plus figée à la construction : `create.ts` la recalcule au fil
 * de la caméra (voir `labelParamInView`), ce qui demande de connaître le trait
 * entier, pas un point posé dessus.
 */
export interface EdgeLabelPlacement {
  text: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Position de repos, en fraction de la longueur du segment. */
  fraction: number;
}

/**
 * Où poser l'étiquette de chaque référence SORTANTE du nœud sélectionné, et
 * quoi y écrire. Donnée pure, sans objet Pixi : c'est `drawEdgeLabels` qui rend,
 * et `create.ts` qui repose au fil de la caméra.
 *
 * C'est la moitié « divulgation progressive » du tracé des références : le
 * départ d'une arête est toujours une CARTE (voir `nearestCardRectFor`), ce qui
 * garde la vue au repos sobre mais ne dit pas de quelle LIGNE la référence part.
 * L'étiquette porte ce détail, et seulement quand on l'a demandé en
 * sélectionnant la source.
 *
 * Deux textes, selon ce que la sélection désigne :
 * - `field` seul quand la sélection EST le nœud porteur (référence directe de
 *   l'entité, ou carte du value object elle-même) — le chemin depuis la carte
 *   sélectionnée n'a qu'un segment, l'écrire en toutes lettres serait bavard ;
 * - `label.field` (`lines[0].productRef`) quand c'est l'ENTITÉ déclarante qui
 *   est sélectionnée alors que la ligne est portée par un value object caché.
 *   Le label du nœud porteur est le chemin INSTANCIÉ, indice compris : il
 *   désigne l'élément exact, ce que `lines[*].productRef` de la config ne fait
 *   pas.
 *
 * Rien à la sélection de la CIBLE (une arête entrante ne se lit pas depuis un
 * champ de la carte sélectionnée), rien pour une sélection d'agrégat (l'appelant
 * passe alors `null`), rien pour une référence cassée — elle n'est pas tracée,
 * et une étiquette flottant sans trait ne désignerait rien.
 *
 * La pilule (fond de carte, contour de bordure) est ce qui rend l'étiquette
 * lisible par-dessus une enveloppe d'agrégat ou une autre arête ; sans elle le
 * texte se confond avec le fond teinté de la vue graphe.
 *
 * PURE, comme le reste du fichier : `selectedId` est un id nu, pas la notion de
 * sélection — c'est l'appelant qui sait qui est sélectionné et ce que la vue
 * courante en fait.
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
    // Mêmes extrémités que le trait qu'elle annote : une étiquette calculée
    // autrement flotterait à côté de son arête dès que le départ est hissé.
    const from = nearestCardRectFor(graph, positions, edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const { start, end } = refEdgeEnds(from, to);

    // Le chemin COMPLET depuis l'entité, quel que soit le nœud sélectionné :
    // `Product#p16.reviews[1].customerId`. L'étiquette glisse avec le viewport,
    // donc elle se lit souvent près de la CIBLE, source hors cadre — un chemin
    // relatif à la sélection (`customerId` seul) n'identifierait alors plus
    // rien. Le préfixe est l'identité de l'entité, pas son `label` (« Product
    // #p16 ») : l'espace du label couperait le chemin en deux à la lecture.
    const fromEntity = graph.nodes.get(edge.fromEntity);
    const prefix =
      fromEntity?.kind === "entity"
        ? `${fromEntity.entityType}#${fromEntity.entityId}`
        : (fromEntity?.label ?? edge.fromEntity);
    const viaValueObject =
      edge.from === edge.fromEntity ? "" : `${graph.nodes.get(edge.from)?.label ?? edge.from}.`;
    const text = `${prefix}.${viaValueObject}${edge.field}`;

    // L'étagement compte les étiquettes RETENUES, pas les arêtes examinées :
    // une arête écartée plus haut (cible hors écran) ne doit pas laisser un
    // cran vide dans la série, sinon deux voisines conservées se retrouvent au
    // même cran une fois sur trois.
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
 * Le point où se pose l'étiquette d'un placement, à la fraction `t` du segment.
 *
 * Le repère du segment : `u` vers l'arrivée, sa perpendiculaire pour écarter du
 * trait. Un segment de longueur nulle (deux cartes confondues) n'a pas de
 * direction — l'horizontale est le repli, l'étiquette restant posée au point de
 * départ.
 *
 * Exporté parce que `create.ts` repose les étiquettes au fil de la caméra et
 * doit trouver EXACTEMENT le même point que le rendu initial : deux copies du
 * décalage perpendiculaire feraient sauter l'étiquette d'un cheveu à la
 * première image de caméra.
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
 * La fraction à laquelle poser l'étiquette pour qu'elle reste DANS le viewport,
 * `baseT` étant sa position de repos.
 *
 * Le pourquoi : une étiquette figée au tiers du lien devient inutile dès qu'on
 * zoome sur la CIBLE — on voit un trait arriver sans savoir de quelle référence
 * il s'agit, et il faudrait dézoomer puis remonter jusqu'à la source pour le
 * lire. L'étiquette glisse donc le long de son propre trait, comme le nom d'une
 * route sur une carte, et reste sur le tronçon qu'on regarde.
 *
 * `baseT` reste la position de REPOS : tant que l'arête tient entièrement à
 * l'écran, rien ne bouge (`t0 <= 0 && t1 >= 1`). Le glissement n'est déclenché
 * que par ce qui le justifie — une partie du lien sortie du cadre.
 *
 * `marginWorld` écarte l'étiquette du bord du cadre : posée pile sur la coupe,
 * la pilule serait à moitié dehors. Quand le tronçon visible est plus court que
 * deux marges, aucune position ne les honore toutes les deux : son MILIEU est
 * alors le moins mauvais compromis.
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
  // Un segment de longueur nulle n'a pas de paramétrage à couper.
  if (len === 0) return baseT;

  // Liang-Barsky : le segment est réduit à l'intervalle de `t` où il est dans
  // le rect. Chaque bord donne une contrainte ; `p < 0` la borne par le bas
  // (entrée), `p > 0` par le haut (sortie).
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
      // Parallèle à ce bord : hors bande, donc jamais visible.
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
  // Arête entièrement visible : la position de repos est déjà la bonne, et la
  // marge n'a pas à la déplacer — l'utilisateur ne doit voir bouger l'étiquette
  // que lorsque son lien sort du cadre.
  if (t0 <= 0 && t1 >= 1) return baseT;

  const pad = marginWorld / len;
  const lo = t0 + pad;
  const hi = t1 - pad;
  if (lo > hi) return (t0 + t1) / 2;
  return Math.min(hi, Math.max(lo, baseT));
}

/**
 * Rend les placements en pilules étiquetées, un SOUS-CONTENEUR par étiquette.
 *
 * La pilule (fond de carte, contour de bordure) est ce qui rend l'étiquette
 * lisible par-dessus une enveloppe d'agrégat ou une autre arête ; sans elle le
 * texte se confond avec le fond teinté de la vue graphe.
 *
 * L'ordre des enfants suit celui des `placements`, et c'est un CONTRAT :
 * `create.ts` repose les étiquettes en appariant `children[i]` à
 * `placements[i]`. Ne pas trier ni filtrer ici.
 */
export function drawEdgeLabels(
  placements: readonly EdgeLabelPlacement[],
  theme: Theme,
  useBitmapText: boolean,
  metrics: NodeMetrics = DEFAULT_METRICS,
): Container {
  const container = new Container();

  for (const placement of placements) {
    // Un SOUS-CONTENEUR par étiquette, pilule et texte dessinés autour de (0,0)
    // local : reposer une étiquette n'est alors qu'un `position.set` sur ce
    // conteneur. Sans ça, suivre la caméra demanderait de recréer un `Text` par
    // image de pan — le vrai coût, et de loin.
    const item = new Container();

    // Largeur BUDGÉTÉE à l'avance en avances moyennes, comme `measureNode` et
    // `arrayTokenWidth` : la mesure réelle d'un `Text` dépend du canvas, donc du
    // runtime, et la pilule doit garder la même géométrie partout.
    const width = placement.text.length * charWidthFor("badge", metrics) + 2 * LABEL_PADDING_X;

    const pill = new Graphics();
    pill
      .roundRect(-width / 2, -LABEL_HEIGHT / 2, width, LABEL_HEIGHT, LABEL_RADIUS)
      .fill(theme.surface.card)
      .stroke({ width: 1, color: theme.edge.border });
    item.addChild(pill);

    // Texte CENTRÉ dans la pilule et non calé sur son bord : la largeur est un
    // budget en avances moyennes, donc presque toujours un peu large pour le
    // texte réel — un calage à gauche laisserait alors du vide à droite, que
    // l'œil lit comme un défaut d'alignement.
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
 * Une zone de clic invisible et épaissie (14px) par arête de référence
 * RÉSOLUE. Purement géométrique : l'appelant règle `eventMode`/`cursor` et
 * branche le tap. L'alpha est 0, mais le hit-test des Graphics étant
 * géométrique, la forme reste cliquable.
 *
 * Une référence cassée n'en reçoit aucune : plus rien n'est tracé pour elle, et
 * une cible posée dans le vide promettrait une navigation que `followRef` ne
 * peut pas faire. Ce qui la signale est sur la carte, où le tap de la carte suffit.
 */
export function drawEdgeHitAreas(graph: Graph, positions: Map<NodeId, Rect>): EdgeHit[] {
  const hits: EdgeHit[] = [];
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue;
    // Même DÉPART hissé que `drawEdges` — sa plus proche carte, pas son propre
    // rect : une référence portée par un value object caché est tracée depuis
    // la carte hôte, et une zone de clic lue dans `positions` n'existait alors
    // pas du tout, laissant un trait visible mais inerte.
    const from = nearestCardRectFor(graph, positions, edge.from);
    if (!from) continue;
    const to = positions.get(edge.to);
    if (!to) continue;
    const { start, end } = refEdgeEnds(from, to);
    const g = new Graphics();
    g.moveTo(start.x, start.y)
      .lineTo(end.x, end.y)
      .stroke({ width: REF_HIT_WIDTH, color: 0xffffff, alpha: 0, cap: "round" });
    hits.push({ edge, graphics: g });
  }
  return hits;
}

/**
 * Surlignage de sélection : contour sur le nœud, sur sa chaîne de parenté
 * jusqu'à la racine, et sur ses références sortantes RÉSOLUES. Renvoie un
 * Graphics vide si rien n'est sélectionné ou si le nœud sélectionné n'est pas
 * visible.
 *
 * Une référence cassée n'a plus d'arête à restyler : elle ne se signale que sur
 * la carte, par la croix de `drawNode`.
 *
 * C'est le seul endroit, avec ces croix, où le rouge apparaît : comme plus rien
 * d'autre n'est rouge, la sélection se lit immédiatement.
 *
 * Le surlignage d'une référence résolue REPREND la géométrie et le style de
 * `drawEdges` — mêmes ancrages, même arrêt au pied de la flèche, même tête
 * repeinte —, et son trait suit le mode : plein en `"ref"`, pointillé en
 * `"contain"`. Autrement dit, il fait CHANGER DE STYLE l'arête existante au lieu
 * d'en superposer une seconde. Un pointillé posé sur le trait plein de la vue
 * graphe se lisait comme une arête de plus, et sa ligne traversait la tête de
 * flèche de celle qu'elle était censée souligner.
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
    // Même règle que `drawEdgeLabels` : une arête appartient aussi à son entité
    // déclarante. Sans `fromEntity`, sélectionner l'entité étiquetterait une
    // arête hissée SANS la surligner — deux réponses contradictoires au même
    // geste, sur le même trait.
    if (edge.from !== selectedId && edge.fromEntity !== selectedId) continue;
    if (edge.to === null || edge.dangling) continue;
    // Même DÉPART hissé que `drawEdges` : le surlignage doit RECOUVRIR le
    // trait, donc il ne peut pas résoudre son point d'attache autrement que lui.
    const from = nearestCardRectFor(graph, positions, edge.from);
    if (!from) continue;
    const to = positions.get(edge.to);
    if (!to) continue;
    const { start, end } = refEdgeEnds(from, to);
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
 * ce que la mise en page a espacé : c'est le MÊME disque. `graph-layout.ts`
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
