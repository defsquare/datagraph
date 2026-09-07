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
 * La vue « Composants graphe » : chaque visuel que `packages/renderer/src/draw.ts`
 * sait produire, dans tous ses états, dessiné par LES MÊMES fonctions que le
 * produit.
 *
 * C'est la contrainte qui fait la valeur de cette planche : rien n'est
 * re-dessiné « à la ressemblance de ». Une carte survolée est un `drawNode` dont
 * on force les paramètres de survol, une arête cassée est un `drawEdges` sur un
 * graphe dont l'arête est cassée. Un spécimen ne peut donc pas mentir sur ce que
 * le renderer fait — s'il diverge, c'est le renderer qui a changé, et c'est
 * exactement ce qu'on vient voir.
 *
 * D'où la fabrication de DONNÉE NUE : `draw.ts` ne prend que des nœuds, des
 * rects et des couleurs (jamais un graphe vivant ni un état d'interface), ce qui
 * laisse fabriquer ici, à la main, la situation exacte de chaque état — y
 * compris celles qu'on n'atteindrait dans le produit qu'avec un jeu de données
 * complice.
 *
 * Les LÉGENDES, elles, sont des `Text` Pixi et non des `BitmapText` : l'atlas du
 * renderer est cuit sur `BitmapFontManager.ASCII`, où « é » et « — » manquent.
 * Un `Text` n'est pas un mensonge ici, parce que la légende n'est PAS un
 * composant du produit — c'est le cartel de l'objet exposé, pas l'objet.
 */

// --- Géométrie des scènes.
//
// Des pixels en dur, et ce ne sont pas des tokens en fuite : ce sont les
// dimensions d'une VITRINE (taille d'une case de grille, écart entre deux
// spécimens), pas des décisions de design system. Les inventer en tokens
// exporterait au renderer une notion qu'il n'a pas.

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
/** Les trois échelles de la planche de zoom sémantique, choisies de part et
 * d'autre des seuils de `lodForScale` : au-dessus de `LOD0_MIN_SCALE`, entre les
 * deux, puis sous `LOD1_MIN_SCALE` — l'échelle à laquelle la vue graphe cesse de
 * dessiner ses cartes et peint les agrégats. */
const PANEL_SCALES = [LOD0_MIN_SCALE + 0.1, (LOD0_MIN_SCALE + LOD1_MIN_SCALE) / 2, 0.08];

/** Grossissement d'une carte survolée. Miroir de `HOVER_LIFT`, qui n'est pas
 * exporté par `create.ts` : la valeur est recopiée, donc elle peut dériver — le
 * spécimen dit ce qu'il montre (« ×1.025 ») pour que l'écart se voie. */
const HOVER_LIFT = 0.025;

const NO_FIELDS: ReadonlySet<string> = new Set();

// --- Fabriques de donnée nue.

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

/** Un graphe minimal autour de nœuds et d'arêtes fabriqués. `entityIndex` et
 * `diagnostics` restent vides : aucune fonction de dessin ne les lit — elles ne
 * consultent que `nodes`, `containEdges` et `refEdges`. */
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

/** `to` nul = référence CASSÉE : c'est l'unique différence entre les deux cas,
 * côté donnée comme côté rendu. */
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

// --- Fabriques DOM.

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
 * L'ossature d'une section : titre, note, hôte du canvas.
 *
 * Les classes sont propres à cette vue (`gc-*`) et non celles de la vue Tokens
 * (`ds-*`) : celles-là vivent dans `views/tokens.css`, la feuille d'une AUTRE
 * vue. Une vue qui s'appuierait dessus casserait le jour où la vue Tokens
 * renomme ou déplace sa feuille, sans que rien ne l'ait annoncé.
 */
function section(title: string, note: string): { node: HTMLElement; host: HTMLElement } {
  const node = el("section", "gc-section");
  node.append(el("h2", "gc-section-title", title));
  node.append(el("p", "gc-note", note));
  const host = el("div", "gc-stage");
  node.append(host);
  return { node, host };
}

// --- Légendes dessinées.

function caption(text: string, theme: Theme): Text {
  return new Text({
    text,
    style: { fontFamily: theme.fonts.body, fontSize: 11, fill: theme.ink.subtle },
  });
}

/** Une case de grille : sa légende en haut, son spécimen dessous. */
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

// --- Section 1 : la carte de nœud.

const ORDER_ROWS: Row[] = [
  { key: "status", value: "shipped", valueType: "string" },
  { key: "total", value: 99.5, valueType: "number" },
  { key: "customerId", value: "c1", valueType: "string" },
  { key: "lines", value: 2, valueType: "array", arrayId: "order:lines" },
];

/** Le champ qui porte une référence, et l'indice de sa ligne. Les deux doivent
 * rester d'accord : `drawNode` étiquette le souligné du survol
 * `ref-underline:<indice de ligne>`, pas `<nom de champ>`. */
const REF_FIELDS: ReadonlySet<string> = new Set(["customerId"]);
const REF_ROW_INDEX = 2;

const ADDRESS_ROWS: Row[] = [
  { key: "street", value: "1 rue de la Paix", valueType: "string" },
  { key: "city", value: "Paris", valueType: "string" },
];

/**
 * Un spécimen : sa légende, et de quoi le construire.
 *
 * `build` reçoit `useBitmap` en ARGUMENT plutôt que de le capturer : la liste
 * est ainsi constructible dès le montage, avant que le renderer n'existe et ne
 * dise s'il sait rastériser du BitmapText. C'est ce qui laisse dimensionner la
 * scène sur `specimens.length` — la taille d'un canvas Pixi se fige à son
 * `init()`, donc avant `ready`, et un compte écrit en dur à côté de la liste
 * finirait par en diverger en silence, rognant la dernière rangée.
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
  // Un graphe d'UN nœud suffit au surlignage de sélection : il n'y suit que la
  // chaîne de parenté (vide ici) et les références sortantes (aucune tracée sur
  // une carte isolée). Ce que le spécimen montre est donc exactement le contour,
  // qui est ce qu'on vient regarder.
  const graph = graphOf([order]);

  // `expandedArrays: null` : la vue graphe ne plie pas les tableaux, donc la
  // pilule `[ 2 items ]` n'y porte pas de chevron — il promettrait un geste sans
  // effet. Sa LARGEUR réserve quand même la place, `measureNode` ne connaissant
  // pas la vue.
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
    { label: "repos (replié)", build: (bitmap) => card(bitmap) },
    { label: "déplié", build: (bitmap) => card(bitmap, { expanded: true }) },
    {
      label: `survol — lift ×${1 + HOVER_LIFT}`,
      build: (bitmap) => {
        const c = card(bitmap);
        const scale = 1 + HOVER_LIFT;
        c.scale.set(scale);
        // Même compensation que `create.ts` : Pixi met l'origine d'un container
        // en haut à gauche, donc une simple échelle pousserait la carte vers le
        // bas-droite au lieu de la faire grossir autour de son centre.
        c.position.set(-((scale - 1) * rect.width) / 2, -((scale - 1) * rect.height) / 2);
        return group(c);
      },
    },
    {
      label: "survol d'une ligne de référence",
      build: (bitmap) => {
        const c = card(bitmap);
        // `drawNode` a préparé le souligné caché ; savoir quelle ligne est sous
        // le pointeur appartient à `create.ts`, qui ne fait que basculer cette
        // visibilité. Le spécimen fait le même geste, par le même label.
        const underline = c.getChildByLabel(`ref-underline:${REF_ROW_INDEX}`);
        if (underline) underline.visible = true;
        return c;
      },
    },
    {
      label: "sélectionné",
      build: (bitmap) =>
        group(card(bitmap), drawSelectionOverlay(graph, positions, theme, order.id, "ref")),
    },
    {
      label: "résultat de recherche (match)",
      build: (bitmap) =>
        group(card(bitmap), drawSearchHighlights(positions, theme, [order.id], null)),
    },
    {
      label: "résultat courant (matchCurrent)",
      build: (bitmap) =>
        group(card(bitmap), drawSearchHighlights(positions, theme, [order.id], order.id)),
    },
    {
      label: "référence cassée (dangling)",
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

// --- Section 2 : les arêtes.

/**
 * Une paire de cartes reliées, et ce que `draw.ts` trace entre elles.
 *
 * Des cartes SANS ligne : la paire est là pour porter une arête, et des lignes
 * de contenu ne feraient que détourner le regard de ce qui est examiné — le
 * trait, son style et son point d'attache.
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
      label: "containment — bézier pleine (vue structure)",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [], [{ kind: "contain", from: from.id, to: to.id }]);
        return group(drawEdges(graph, positions, theme, 0, "contain"), cards);
      },
    },
    {
      label: "référence, vue graphe — trait plein + flèche",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, to.id, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "ref"), cards);
      },
    },
    {
      label: "référence, vue structure — pointillés + flèche",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, to.id, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "contain"), cards);
      },
    },
    {
      label: "référence cassée — aucun trait : le diagnostic est sur la carte",
      build: (bitmap) => {
        const { from, to, positions, cards } = pair(bitmap);
        const graph = graphOf([from, to], [refEdge(from.id, null, "customerId")]);
        return group(drawEdges(graph, positions, theme, 0, "ref"), cards);
      },
    },
    {
      label: "étiquette de référence (source sélectionnée)",
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

// --- Section 3 : les enveloppes d'agrégats.

/** Les trois états d'une enveloppe, tels que `drawClusters` les interpole. Le
 * survol arrive DÉJÀ adouci par `attachHover` : ce que le spécimen force ici est
 * la borne haute de cette intensité, pas une courbe de plus. */
const HULL_STATES: { label: string; hover?: number; dim?: boolean }[] = [
  { label: "repos (hover 0)" },
  { label: "survolée (hover 1)", hover: 1 },
  { label: "estompée (dim, hors sélection)", dim: true },
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

  // UN seul appel pour les trois : c'est ainsi que le renderer les peint (un
  // Graphics pour toutes les enveloppes visibles), et les séparer masquerait
  // qu'un `stroke()` ne porte qu'un style — la raison pour laquelle l'estompage
  // est un booléen et non un facteur libre.
  stage.app.stage.addChild(drawClusters(clusters, theme));

  clusters.forEach((cluster, index) => {
    const label = caption(HULL_STATES[index]!.label, theme);
    label.position.set(cluster.circle.cx - HULL_R, STAGE_PAD);
    stage.app.stage.addChild(label);
  });
}

// --- Section 4 : le zoom sémantique.

/** Le monde fictif : une grille d'agrégats, chacun un bloc de cartes. Assez
 * large pour que l'échelle la plus lointaine des trois panneaux ait encore des
 * disques à montrer sur tout son cadre.
 *
 * Le pas est pris NETTEMENT au-dessus du diamètre de l'enveloppe (~610 pour un
 * bloc de 3×3), et pas seulement au-dessus : les arêtes agrégées sont peintes
 * SOUS les disques, donc à disques presque jointifs il ne resterait d'elles que
 * quelques pixels et la planche prétendrait montrer `drawSemanticEdges` sans en
 * rien montrer. L'écart de respiration EST le spécimen.
 *
 * Le pas étant le même sur les deux axes et le bloc CENTRÉ dedans, le centre du
 * monde tombe exactement sur le centre de l'agrégat médian (`COLS/2 × pas`) :
 * les panneaux zoomés cadrent donc un bloc entier, quel que soit ce pas. */
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
  /** Le rayon de disque de référence dont `drawSemanticEdges` tire ses
   * épaisseurs. Tous les agrégats sont ici de même taille, donc n'importe lequel
   * fait l'affaire. */
  unit: number;
}

function buildFakeWorld(theme: Theme): FakeWorld {
  const types = ["Order", "Customer", "Product", "Invoice"];
  const accents = entityAccentMap(types, theme);

  // Le bloc est CENTRÉ dans le pas de la grille d'agrégats : ce pas est choisi
  // plus grand que le diamètre de l'enveloppe, sinon deux disques voisins se
  // recouvriraient — ce que la mise en page réelle interdit par construction
  // (elle packe des cercles disjoints).
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
          // Une chaîne de références dans le bloc : de quoi donner au panneau
          // le plus zoomé des arêtes à montrer sous ses cartes.
          if (previous !== null) refEdges.push(refEdge(previous, id, "next", type));
          previous = id;
        }
      }

      aggregates.push({
        id: `agg-${index}`,
        // Un identifiant hiérarchique, comme dans le jeu réel : c'est ce qui
        // rend visible la troncature par le MILIEU de `drawSemanticLabels` —
        // une troncature par la fin rendrait tous les disques homonymes.
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
          // Une graduation déterministe qui traverse les quatre paliers de
          // `bucketOf` : à poids constant, la planche ne montrerait qu'une
          // épaisseur sur les quatre.
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
 * Un panneau : ce que la vue graphe peint du MÊME monde à une échelle de caméra
 * donnée.
 *
 * Le monde est commun aux trois panneaux et seule la caméra change — c'est ce
 * qui fait de la planche trois niveaux de zoom d'un même jeu, et non trois
 * dessins qui se ressemblent. La conséquence est celle du produit : plus on
 * s'éloigne, plus il entre d'objets dans le cadre, jusqu'au point où une carte
 * n'est plus qu'un rectangle muet — et où le régime sémantique la remplace par
 * un disque nommé.
 *
 * Le contenu est CULLÉ sur la fenêtre monde, comme le fait `create.ts` : sans
 * ça le panneau le plus zoomé construirait les 315 cartes du monde pour en
 * montrer une dizaine.
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
    // L'ordre EST le recouvrement : les arêtes agrégées sous les disques (un
    // disque opaque doit les masquer), les libellés au-dessus.
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

  // Le masque borne le panneau à son cadre : sans lui, le monde déborderait sur
  // ses voisins et la planche ne montrerait plus trois cadrages mais une bouillie.
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
    const regime = lod === 2 ? "disques d'agrégats" : lod === 1 ? "cartes tronquées" : "cartes complètes";
    stage.app.stage.addChild(
      cell(
        `échelle ${scale.toFixed(2)} — LOD ${lod} : ${regime}`,
        semanticPanel(world, theme, useBitmap, scale),
        theme,
        STAGE_PAD + index * (PANEL_W + PANEL_GAP),
        STAGE_PAD,
      ),
    );
  });
}

// --- Montage.

/**
 * Monte la vue. Conforme au contrat de `PlaygroundView.mount` : `root` est vide
 * et nous appartient, le retour démonte. Aucun abonnement au thème — le shell
 * remonte la vue entière à chaque changement, et c'est ce qui garantit qu'une
 * scène Pixi à l'écran correspond bien au thème affiché (les couleurs se
 * repeignent à chaud, mais pas les atlas de police).
 */
export function mountGraphComponentsView(root: HTMLElement, state: ThemeState): () => void {
  const theme = currentTheme(state);
  // Un bail sur les atlas partagés du renderer, exactement comme une instance de
  // DataGraph : le registre les compte par référence, donc `dispose()` ne
  // désinstalle que si personne d'autre ne les porte.
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
    const status = el("p", "gc-note gc-status", "Initialisation du canvas…");
    node.append(status);
    page.append(node);

    const stage = createPixiStage(host, theme, size);
    stages.push(stage);

    stage.ready
      .then(() => {
        // Un démontage tombé pendant l'init : la scène est déjà soldée, et
        // dessiner dedans lèverait sur un renderer détruit.
        if (disposed || stage.isDestroyed()) return;
        const useBitmap = supportsBitmapText(stage.app);
        if (useBitmap && !fontsInstalled) {
          // AVANT tout BitmapText : `drawNode` dérive le nom d'atlas du thème
          // seul, et le lire avant que le bail ne l'ait installé rendrait des
          // textes vides.
          lease.sync(theme);
          fontsInstalled = true;
        }
        status.remove();
        paint(stage, useBitmap);
      })
      .catch((error: unknown) => {
        // Sans ça, une init de renderer qui échoue (WebGL coupé, contexte
        // refusé) laisserait la légende bloquée et la raison dans une rejection
        // non gérée. La panne se lit à l'endroit du spécimen manquant.
        status.textContent = `Le canvas Pixi n'a pas pu s'initialiser : ${String(error)}`;
      });
  };

  // Les listes sont construites ICI, avant les scènes : leur longueur dimensionne
  // le canvas, dont la taille se fige au `init()` — donc avant que `ready` ne
  // dise si le renderer sait rastériser du BitmapText, seule inconnue à ce stade.
  const cards = cardSpecimens(theme);
  const edges = edgeSpecimens(theme);

  mount(
    "Carte de nœud",
    "Le même nœud fictif décliné par les paramètres de drawNode. Les états d'interface (survol, sélection, recherche) sont FORCÉS ici : dans le produit c'est create.ts qui les décide, drawNode ne fait que préparer le visuel — un souligné caché, un contour, un remplissage lavé.",
    cardStageSize(cards.length),
    (stage, useBitmap) => paintCards(stage, theme, useBitmap, cards),
  );

  mount(
    "Arêtes",
    "Le style d'un trait dit sa nature ET la vue où il est tracé : le containment est une bézier pleine, une référence est pleine en vue graphe (où elle est la relation montrée) et pointillée en vue structure (où elle décore l'arbre). Une référence cassée n'est plus tracée du tout — son diagnostic a été déplacé sur la ligne de la carte, où la croix désigne le champ fautif plutôt que la carte entière.",
    edgeStageSize(edges.length),
    (stage, useBitmap) => paintEdges(stage, theme, useBitmap, edges),
  );

  mount(
    "Enveloppes d'agrégats",
    "Le disque que la mise en page a calculé pour un agrégat, peint sous les cartes. Les trois paliers — remplissage, épaisseur, opacité du contour — montent ensemble au survol : c'est cette montée simultanée qui fait lire l'enveloppe comme un objet saisissable, ce qu'elle est.",
    hullStageSize(),
    (stage) => paintHulls(stage, theme),
  );

  mount(
    "Zoom sémantique",
    `Le même monde fictif à trois échelles de caméra, de part et d'autre des seuils de lodForScale (${LOD0_MIN_SCALE} et ${LOD1_MIN_SCALE}). Sous le second seuil, une carte n'est plus qu'un rectangle muet : la vue graphe cesse alors de les dessiner et peint les agrégats comme des nœuds — disques, libellés tronqués par le milieu, et références repliées sur les paires, graduées par leur poids.`,
    semanticStageSize(),
    (stage, useBitmap) => paintSemantic(stage, theme, useBitmap),
  );

  root.append(page);

  return () => {
    disposed = true;
    // Avant les scènes : la libération des atlas ne dépend d'aucun renderer, et
    // elle doit avoir lieu même si aucune init n'a abouti.
    lease.dispose();
    for (const stage of stages) stage.destroy();
    page.remove();
  };
}
