import { BitmapText, Circle, Color, Container, Graphics, Rectangle, Text } from "pixi.js";
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

/**
 * Même budget que `truncateToWidth`, mais l'ellipse mange le MILIEU.
 *
 * Réservé aux libellés d'agrégat du régime sémantique, et c'est leur nature qui
 * le justifie : la racine d'un agrégat est typiquement un identifiant
 * hiérarchique (`com.exemple.credit.domain`), dont les premiers segments sont
 * partagés par tout le jeu de données et le dernier est le seul qui distingue.
 * Une troncature par la fin rendrait mille disques nommés `com.exemple.cr…` —
 * un libellé qui coûte de la place et n'apprend rien. Les CARTES, elles, gardent
 * la troncature par la fin : leur en-tête est un id court, pas un chemin.
 *
 * Le milieu reste le bon endroit MÊME depuis que le contrôleur retire le préfixe
 * dominant avant de publier les libellés (`dominantSegmentPrefix`), et c'est un choix
 * et non un reste : ce préfixe est celui du jeu ENTIER, alors que la queue qu'il
 * laisse reste un chemin dont les segments intermédiaires se répètent d'une
 * branche à l'autre (`domain.project.service` contre `domain.project.repository`).
 * Une troncature par la fin sacrifierait donc encore la partie discriminante, à
 * un niveau plus bas ; celle-ci garde la tête — qui situe le package dans
 * l'arbre — ET la fin — qui le nomme. Le retrait du préfixe ne change pas OÙ
 * couper, il change combien de fois il faut couper : la plupart des libellés du
 * jeu réel tiennent désormais entiers.
 *
 * La tête reçoit le caractère en trop quand le budget est impair : mieux vaut un
 * préfixe complet d'un cran qu'un suffixe, la lecture partant de la gauche.
 */
export function truncateMiddle(text: string, maxWidth: number, charWidth: number): string {
  if (maxWidth <= 0) return "";
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail === 0
    ? `${text.slice(0, head)}…`
    : `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
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
 * Hauteur du jeton de reliquat.
 *
 * INVARIANT : `REMAINDER_TOKEN_GAP + REMAINDER_TOKEN_HEIGHT < NODE_GAP`, où
 * `NODE_GAP` vaut 24 px (`packages/core/src/structure-layout.ts`, aligné sur
 * `elk.spacing.nodeNode`). La mise en page ne réserve AUCUNE place pour les
 * jetons — ce sont des pseudo-éléments qu'ELK ne voit pas — donc le jeton doit
 * tenir dans la bande qui sépare déjà deux cartes empilées. À 22 px + 8 px
 * d'écart il en débordait de 6, qu'il peignait par-dessus la carte suivante et,
 * son calque étant au-dessus, dont il volait les clics. 4 + 16 laisse 4 px de
 * dégagement. Si l'espacement du moteur change, ces deux constantes sont à
 * revoir avec lui.
 *
 * 16 px porte le libellé de rôle `value` (12 px) sans le serrer : c'est le même
 * couple que la pilule d'une ligne-tableau, haute de 15 px pour le même texte.
 *
 * Exportée parce que l'appelant en a besoin pour l'ANCRAGE : posé au-dessus de
 * la carte qui le suit, le jeton doit remonter de sa propre hauteur, que rien
 * d'autre ne lui apprend.
 */
export const REMAINDER_TOKEN_HEIGHT = 16;

/**
 * L'écart qui sépare un jeton de reliquat de la carte qui l'ancre.
 *
 * Vit ici, à côté de `REMAINDER_TOKEN_HEIGHT`, parce que les deux constantes
 * portent le MÊME invariant (voir ci-dessus) : `REMAINDER_TOKEN_GAP +
 * REMAINDER_TOKEN_HEIGHT < NODE_GAP`. Les séparer les rendrait faciles à faire
 * dériver l'une de l'autre sans que rien ne le remarque. `create.ts` l'importe
 * pour poser le jeton au-dessus ou en dessous de son ancre.
 */
export const REMAINDER_TOKEN_GAP = 4;

/**
 * Le jeton qui tient la place d'un bloc d'enfants-cartes non révélés : « + 47300 ».
 *
 * Il est dessiné en (0,0) dans son espace local — c'est l'appelant qui le pose,
 * puisque lui seul connaît les positions des cartes voisines qui l'ancrent.
 *
 * Le compte NU plutôt qu'une formule (« 47300 de plus », « avant », « après ») :
 * c'est la POSITION du jeton dans la colonne qui dit de quel côté est le trou,
 * et un libellé qui le redirait serait une seconde source à tenir d'accord avec
 * l'arithmétique d'ancrage. Le « + » suffit à annoncer que le clic ajoute.
 *
 * Le paramètre `width` vient de la carte d'ancrage et jamais du texte : un jeton
 * à la largeur de son libellé flotterait au milieu d'une colonne dont il est
 * censé occuper le gabarit. C'est aussi pourquoi le libellé est TRONQUÉ ici —
 * sur une colonne étroite, c'est lui qui cède, pas la pilule.
 */
export function drawRemainderToken(opts: {
  count: number;
  width: number;
  theme: Theme;
  metrics?: NodeMetrics;
  useBitmapText?: boolean;
}): Container {
  const { count, width, theme } = opts;
  const metrics = opts.metrics ?? DEFAULT_METRICS;
  const token = new Container();
  token.label = "remainder-token";

  // Le fond reprend la surface ATTÉNUÉE des cartes non-entités, comme les nœuds
  // conteneurs : le jeton est de la même famille que ce qu'il remplace, en
  // retrait. La bordure et l'arrondi sont ceux des cartes, pour la même raison —
  // un rayon propre en ferait un objet d'une autre nature dans la colonne.
  const rest = new Graphics();
  rest.label = "rest";
  rest
    .roundRect(0, 0, width, REMAINDER_TOKEN_HEIGHT, theme.radii.card)
    .fill(theme.surface.cardMuted)
    .stroke({ width: theme.strokes.border, color: theme.edge.border });
  token.addChild(rest);

  const charWidth = charWidthFor("value", metrics);
  const budget = width - 2 * metrics.tokenPaddingX;
  const text = truncateToWidth(`+ ${count}`, budget, charWidth);
  if (text.length > 0) {
    const label = createLabel(text, theme, "value", theme.ink.muted, opts.useBitmapText ?? false);
    // Centré : le jeton occupe toute la largeur de la colonne, et un libellé
    // calé à gauche laisserait une pilule qui paraît vide.
    label.position.set(
      Math.round(width / 2 - label.width / 2),
      Math.round(REMAINDER_TOKEN_HEIGHT / 2 - label.height / 2),
    );
    token.addChild(label);
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
 * La boîte englobante du segment `start`→`end` touche-t-elle `view` ?
 *
 * Test conservateur et volontairement grossier : il garde des segments qui
 * frôlent le cadre en diagonale sans l'atteindre, mais il ne peut JAMAIS en
 * écarter un qui le traverse — c'est la seule direction d'erreur acceptable
 * pour un filtre de visibilité. Le contact par un bord compte, comme partout
 * ailleurs.
 */
function segmentBoxInView(
  start: { x: number; y: number },
  end: { x: number; y: number },
  view: Rect,
): boolean {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return minX <= view.x + view.width && view.x <= maxX && minY <= view.y + view.height && view.y <= maxY;
}

/**
 * Une zone de clic invisible et épaissie (14px) par arête de référence
 * RÉSOLUE. Purement géométrique : l'appelant règle `eventMode`/`cursor` et
 * branche le tap. L'alpha est 0, mais le hit-test des Graphics étant
 * géométrique, la forme reste cliquable.
 *
 * Une référence cassée n'en reçoit aucune : plus rien n'est tracé pour elle, et
 * une cible posée dans le vide promettrait une navigation que `followRef` ne
 * peut pas faire. Ce qui la signale est sur la carte, où le tap de la carte suffit.
 *
 * `worldView`, s'il est fourni, restreint la production aux arêtes dont le SEGMENT
 * peut traverser ce rectangle monde — testé sur sa boîte englobante, donc
 * conservateur : une arête qui ne fait que traverser le cadre sans y avoir
 * d'extrémité est bien conservée, et seules celles dont la boîte manque
 * entièrement la fenêtre sont écartées. C'est le levier de coût de ce calque :
 * il produit un Graphics INTERACTIF par arête, et un gros jeu de données en
 * compte des dizaines de milliers, tous poussés dans la passe de rendu et dans
 * le hit-testing alors qu'on ne peut viser que ceux à l'écran. `null` (défaut)
 * les produit toutes, ce qui reste le comportement d'origine.
 */
export function drawEdgeHitAreas(
  graph: Graph,
  positions: Map<NodeId, Rect>,
  worldView: Rect | null = null,
): EdgeHit[] {
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
    if (worldView && !segmentBoxInView(start, end, worldView)) continue;
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

// --------------------------------------------------------------------------
// Régime SÉMANTIQUE de la vue graphe
//
// Sous le seuil du LOD 2, la vue graphe cesse de dessiner ses cartes et peint
// les AGRÉGATS comme des nœuds : un disque par agrégat, à la place et au rayon
// que la mise en page a déjà calculés, plus les références repliées sur les
// paires d'agrégats. Ce qu'on lit alors n'est plus la donnée, c'est
// l'architecture.
//
// Le seuil n'est pas un troisième réglage : c'est EXACTEMENT `lodForScale`, et
// le LOD 2 est précisément l'échelle à laquelle une carte n'est plus qu'un
// rectangle plein — c'est-à-dire à laquelle elle a cessé de porter la moindre
// information. Remplacer 6 251 rectangles muets par 1 300 disques nommés y est
// donc un gain strict, et jamais une perte. Un seuil propre au régime
// sémantique aurait demandé son propre déclencheur de reconstruction, en
// concurrence avec celui du LOD ; il aurait aussi ouvert une bande d'échelles
// où les deux régimes se disputent l'écran — l'état mixte que ce découpage
// interdit par construction.
// --------------------------------------------------------------------------

/**
 * Un agrégat prêt à peindre comme NŒUD : la donnée nue que les trois fonctions
 * ci-dessous consomment.
 *
 * Même forme que l'entrée de `drawClusters` — c'est le même disque —, augmentée
 * de ce qu'un nœud doit dire de lui : son nom et sa taille.
 */
export interface SemanticNode {
  /** L'id de l'agrégat. Sert d'ÉTIQUETTE au sous-conteneur de son libellé, ce
   * qui laisse l'appelant retrouver et déplacer le seul libellé concerné pendant
   * qu'un disque est saisi — au lieu de refaire les 1 300 par image. */
  id: string;
  circle: { cx: number; cy: number; r: number };
  color: string;
  label: string;
  count: number;
  /** Intensité du survol, de 0 à 1. Absente vaut 0. */
  hover?: number;
  /** Sans lien avec la sélection courante. Absent vaut faux. */
  dim?: boolean;
}

/**
 * La taille du libellé et celle de la pastille, en fraction du RAYON du disque.
 *
 * Proportionnelles, et c'est la seule façon dont un zoom sémantique tienne : le
 * disque grandit avec la caméra, donc son nom doit grandir avec lui. Une taille
 * en pixels de police fixe donnerait un libellé illisible au cadrage global puis
 * démesuré trois crans plus loin.
 */
export const SEMANTIC_LABEL_RATIO = 0.2;
export const SEMANTIC_BADGE_RATIO = 0.13;

/**
 * La largeur utile d'un libellé, en fraction du rayon — soit 70 % du diamètre,
 * ce qui garde le texte dans le disque plutôt que sur la corde la plus longue,
 * où il en sortirait par le haut et par le bas.
 *
 * Conséquence, et elle est voulue : combinée à `SEMANTIC_LABEL_RATIO`, cette
 * fraction rend le budget de troncature INDÉPENDANT du rayon — le rayon
 * s'élimine entre la largeur disponible et la taille de police. Tous les disques
 * montrent donc le même nombre de caractères, gros comme petits, ce qui fait
 * lire la taille du disque comme une quantité de membres et non comme une
 * quantité de texte.
 */
export const SEMANTIC_LABEL_WIDTH_RATIO = 1.4;

/** L'écart entre le libellé et sa pastille, en fraction de la taille du
 * libellé. */
const SEMANTIC_LABEL_GAP_RATIO = 0.18;

/** Épaisseur du contour d'un disque, en fraction de son rayon : au repos, puis
 * à pleine intensité. Proportionnelle pour la même raison que le libellé. */
const SEMANTIC_STROKE_RATIO = 0.03;
const SEMANTIC_STROKE_RATIO_HOVER = 0.05;

/**
 * Les intensités d'accent d'un disque, au repos et à pleine intensité — puis
 * celles de son contour.
 *
 * Nettement au-dessus de celles d'une enveloppe (0,08 → 0,15) : une enveloppe
 * est une RÉGION derrière des cartes, un disque sémantique EST l'objet.
 *
 * Ce ne sont PAS des alphas de rendu, et c'est une décision de performance
 * mesurée : les couleurs sont pré-mélangées au canevas (`blendOver`) et peintes
 * OPAQUES. Deux raisons, qui vont dans le même sens :
 *  - les arêtes agrégées passent SOUS les disques ; un disque translucide les
 *    laisserait le traverser, et sur un jeu dense chacun se remplit alors du
 *    réseau qui le contourne, libellé compris. Il fallait donc de toute façon un
 *    fond opaque ;
 *  - obtenu par un second remplissage à la couleur du canevas, ce fond doublait
 *    la surface peinte : mesuré sur le jeu réel (1 300 disques, 1600×1000, rendu
 *    logiciel headless), 755 ms d'image au repos contre 380 ms avec un seul
 *    remplissage. Le mélange en amont donne exactement le même pixel pour la
 *    moitié du coût.
 *
 * Le libellé reste peint en `ink.primary`, la même encre que sur une carte :
 * c'est la modération de ces intensités qui le permet, sans avoir à choisir une
 * couleur de contraste par accent — un calcul de luminance que le thème ne porte
 * pas et qu'un accent surchargé par l'hôte (`byEntityType`) rendrait faux.
 */
const SEMANTIC_FILL_MIX = 0.3;
const SEMANTIC_FILL_MIX_HOVER = 0.5;
const SEMANTIC_STROKE_MIX = 0.75;
const SEMANTIC_STROKE_MIX_HOVER = 1;

/**
 * `over` posé sur `base` à `amount`, rendu en couleur OPAQUE.
 *
 * Mémoïsé, et il le faut : `drawSemanticDiscs` est rappelée à chaque image d'un
 * survol d'agrégat, et sans cache elle allouerait deux `Color` par disque et par
 * image. Le nombre de couples distincts est minuscule — une poignée d'accents ×
 * une poignée d'intensités —, donc le cache se remplit une fois et ne grandit
 * plus. Il est global au module et survit à un changement de thème sans
 * risque : la clé porte les deux couleurs, donc deux thèmes ne peuvent pas
 * partager une entrée.
 *
 * `Color` de Pixi plutôt qu'un analyseur maison de « #rrggbb » : un hôte peut
 * poser n'importe quelle couleur CSS par `byEntityType`, et c'est exactement
 * l'ensemble que Pixi sait déjà lire.
 */
const blendCache = new Map<string, number>();
export function blendOver(base: string, over: string, amount: number): number {
  const key = `${base}|${over}|${amount.toFixed(4)}`;
  const known = blendCache.get(key);
  if (known !== undefined) return known;
  const [br, bg, bb] = new Color(base).toRgbArray();
  const [or, og, ob] = new Color(over).toRgbArray();
  const t = Math.min(1, Math.max(0, amount));
  const mix = (b: number, o: number): number =>
    Math.round(Math.min(255, Math.max(0, (b + (o - b) * t) * 255)));
  const value = (mix(br!, or!) << 16) | (mix(bg!, og!) << 8) | mix(bb!, ob!);
  blendCache.set(key, value);
  return value;
}

/**
 * Le nombre de côtés du polygone qui TIENT LIEU de disque.
 *
 * `Graphics.circle()` choisit sa finesse d'après le rayon en coordonnées MONDE,
 * qui n'a rien à voir avec la taille à l'écran : une enveloppe de 1 000 px monde
 * vue à l'échelle 0,04 fait 80 px, et Pixi la découpe pourtant en plusieurs
 * centaines de segments. Sur 1 300 disques, cela fait des centaines de milliers
 * de triangles par image — mesuré sur le jeu réel en rendu logiciel headless :
 * 494 ms d'image au repos, contre 60 ms avec ce polygone.
 *
 * 36 côtés, et c'est très au-delà du nécessaire : l'écart maximal entre le
 * polygone et le cercle vaut `r × (1 − cos(π/36))`, soit 0,4 % du rayon — moins
 * d'un tiers de pixel sur le plus gros disque du jeu réel, à l'échelle où le
 * régime sémantique existe. Au-delà du seuil du LOD 2, ce ne sont plus ces
 * disques qui sont peints mais les enveloppes de `drawClusters`, qui gardent le
 * vrai cercle : la comparaison ne se pose donc jamais côte à côte.
 */
const SEMANTIC_DISC_SEGMENTS = 36;

function discPath(g: Graphics, cx: number, cy: number, r: number): void {
  g.moveTo(cx + r, cy);
  for (let i = 1; i < SEMANTIC_DISC_SEGMENTS; i++) {
    const angle = (i / SEMANTIC_DISC_SEGMENTS) * Math.PI * 2;
    g.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  g.closePath();
}

/**
 * Peint les agrégats en disques pleins.
 *
 * SÉPARÉE des libellés, et ce n'est pas cosmétique : ce Graphics-ci est détruit
 * et refait à chaque image d'un survol d'agrégat (`redrawClusters`), alors que
 * les libellés ne dépendent d'aucune intensité. Les peindre dans le même passage
 * ferait reconstruire 1 300 textes soixante fois par seconde pour un rendu
 * strictement identique.
 *
 * Un rayon nul ou négatif est ignoré, comme pour une enveloppe : ce n'est pas
 * une surface.
 */
export function drawSemanticDiscs(nodes: SemanticNode[], theme: Theme): Graphics {
  const g = new Graphics();
  const canvas = theme.surface.canvas;
  for (const node of nodes) {
    const { cx, cy, r } = node.circle;
    if (!(r > 0)) continue;
    const t = Math.min(1, Math.max(0, node.hover ?? 0));
    // L'estompage MULTIPLIE l'intensité de l'accent au lieu d'ajouter une
    // transparence : un disque estompé recule vers le canevas, comme une
    // enveloppe estompée, mais il continue de MASQUER les arêtes qui passent
    // dessous — sans quoi le fond du dessin remonterait par les blocs qu'on a
    // justement écartés du regard.
    const dim = node.dim === true ? DIM_ALPHA : 1;
    discPath(g, cx, cy, r);
    g.fill(
      blendOver(
        canvas,
        node.color,
        (SEMANTIC_FILL_MIX + t * (SEMANTIC_FILL_MIX_HOVER - SEMANTIC_FILL_MIX)) * dim,
      ),
    );
    g.stroke({
      // L'épaisseur échappe à l'estompage, exactement comme sur une enveloppe :
      // elle dit la taille de l'objet, pas son importance.
      width: r * (SEMANTIC_STROKE_RATIO + t * (SEMANTIC_STROKE_RATIO_HOVER - SEMANTIC_STROKE_RATIO)),
      color: blendOver(
        canvas,
        node.color,
        (SEMANTIC_STROKE_MIX + t * (SEMANTIC_STROKE_MIX_HOVER - SEMANTIC_STROKE_MIX)) * dim,
      ),
    });
  }
  return g;
}

/**
 * Le nom de chaque agrégat et le compte de ses membres, centrés dans son disque.
 *
 * Le texte est créé à la taille du thème puis MIS À L'ÉCHELLE, au lieu d'être
 * créé à la taille voulue : c'est ce qui laisse les 1 300 libellés partager
 * l'atlas de police déjà installé pour les cartes. Créer 1 300 `BitmapText` à
 * 1 300 tailles différentes en demanderait autant d'atlas.
 *
 * Ne dépend NI du survol NI de rien qui change par image — l'appelant ne la
 * rappelle qu'à une reconstruction ou à un changement de sélection.
 *
 * Chaque libellé et sa pastille vivent dans un sous-conteneur ÉTIQUETÉ par l'id
 * de l'agrégat — même convention que `array-token:<index>` sur les cartes. C'est
 * ce qui laisse l'appelant translater le seul libellé d'un disque saisi, plutôt
 * que de reconstruire le calque entier à chaque image du geste.
 */
export function drawSemanticLabels(
  nodes: SemanticNode[],
  theme: Theme,
  useBitmapText: boolean,
  metrics: NodeMetrics = DEFAULT_METRICS,
): Container {
  const layer = new Container();
  // Aucun libellé n'est une cible : le disque en dessous porte le clic, le
  // déplacement et le survol. Sans ça, un texte posé au centre volerait le
  // pointeur à sa propre zone de saisie.
  layer.eventMode = "none";

  for (const node of nodes) {
    const { cx, cy, r } = node.circle;
    if (!(r > 0)) continue;
    const size = r * SEMANTIC_LABEL_RATIO;
    // L'échelle qui mène de la taille du thème à celle voulue pour ce disque.
    const k = size / theme.typography.header.size;
    if (!(k > 0)) continue;
    // Le budget est exprimé dans l'espace NON MIS À L'ÉCHELLE, celui où les
    // avances de `metrics` ont un sens : diviser la largeur utile par `k` est ce
    // qui garde la troncature d'accord avec le texte effectivement peint.
    const budget = (r * SEMANTIC_LABEL_WIDTH_RATIO) / k;
    const text = truncateMiddle(node.label, budget, charWidthFor("header", metrics));
    if (text.length === 0) continue;

    const label = createLabel(text, theme, "header", theme.ink.primary, useBitmapText);
    label.scale.set(k);

    const countText = String(node.count);
    const badge = createLabel(countText, theme, "badge", theme.ink.muted, useBitmapText);
    const kBadge = (r * SEMANTIC_BADGE_RATIO) / theme.typography.badge.size;
    badge.scale.set(kBadge);

    // Le bloc « nom + compte » est centré VERTICALEMENT sur le disque, et non
    // posé sur son centre : un libellé dont la ligne de base passerait par le
    // centre pousserait la pastille hors du cercle sur les petits agrégats.
    //
    // Les deux boîtes sont BUDGÉTÉES depuis `metrics` et la typographie, et non
    // mesurées sur l'objet rendu. C'est la même discipline que `measureNode` et
    // `drawNode` sur les cartes — dessiner exactement ce qui a été budgété —, et
    // ça a en plus une conséquence pratique : lire `.width`/`.height` d'un `Text`
    // déclenche une mesure par canvas, donc un `document`, ce qui rendrait cette
    // fonction intestable hors navigateur.
    const labelWidth = text.length * charWidthFor("header", metrics) * k;
    const labelHeight = theme.typography.header.size * k;
    const badgeWidth = countText.length * charWidthFor("badge", metrics) * kBadge;
    const badgeHeight = theme.typography.badge.size * kBadge;

    const gap = size * SEMANTIC_LABEL_GAP_RATIO;
    const top = cy - (labelHeight + gap + badgeHeight) / 2;
    label.position.set(Math.round(cx - labelWidth / 2), Math.round(top));
    badge.position.set(
      Math.round(cx - badgeWidth / 2),
      Math.round(top + labelHeight + gap),
    );
    const group = new Container();
    group.label = node.id;
    group.addChild(label, badge);
    layer.addChild(group);
  }

  return layer;
}

/**
 * Le poids à partir duquel une arête agrégée est peinte au maximum.
 *
 * Le plafonnement est du même esprit que celui du niveau 2 de la mise en page
 * (`min(1, w/2)`) : au-delà d'un certain couplage, « encore plus lié » n'a plus
 * de traduction visuelle utile, et laisser le poids courir ferait qu'une seule
 * paire très bavarde écraserait toute la graduation. La valeur, elle, est
 * propre au TRACÉ et pas à la simulation : sur le jeu réel (28 685 références
 * repliées sur ~1 300 agrégats), un plafond à 2 saturerait presque toutes les
 * paires et rendrait la graduation muette.
 */
export const SEMANTIC_EDGE_WEIGHT_FULL = 8;

/**
 * Le nombre de paliers de poids.
 *
 * Un `stroke()` ne porte qu'UN style, donc une épaisseur par arête voudrait dire
 * un appel de tracé par arête — des milliers. Quantifier en quatre paliers
 * ramène le tracé à huit appels au plus (quatre paliers × estompé/plein), pour
 * une graduation que l'œil lit tout aussi bien : c'est le même découpage en
 * passes que `drawEdges` fait déjà pour ses deux alphas.
 */
const SEMANTIC_EDGE_BUCKETS = 4;

/** Épaisseur et alpha d'une arête agrégée, du palier le plus faible au plus
 * fort. L'épaisseur est en fraction de `unit` — un rayon de disque de référence
 * — et non en pixels : comme les libellés, elle doit grandir avec la vue. */
const SEMANTIC_EDGE_WIDTH_MIN = 0.02;
const SEMANTIC_EDGE_WIDTH_MAX = 0.12;
// Volontairement TRÈS bas en bas de gamme. Sur le jeu réel, 28 685 références se
// replient en plusieurs milliers de paires : à alpha lisible, chaque trait est
// une information mais leur somme est une nappe opaque, et la vue redevient le
// plat de spaghettis qu'elle remplace. Presque transparents, les liens faibles
// s'ADDITIONNENT en ombrage — c'est la densité de couplage qui se lit — pendant
// que les liens forts, eux, restent des traits qu'on suit à l'œil.
const SEMANTIC_EDGE_ALPHA_MIN = 0.05;
const SEMANTIC_EDGE_ALPHA_MAX = 0.45;

export interface SemanticEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /** Sans lien avec la sélection courante. Absent vaut faux. */
  dim?: boolean;
}

/**
 * Trace les références repliées sur les agrégats, graduées par leur poids.
 *
 * `unit` est le rayon de disque de RÉFÉRENCE dont les épaisseurs sont des
 * fractions. Un nombre nu, fourni par l'appelant : cette fonction ne connaît ni
 * les disques ni la caméra, et une épaisseur en pixels écran demanderait l'une
 * ou l'autre.
 *
 * L'ordre d'émission EST le recouvrement, dans un Graphics unique : les
 * estompées d'abord, puis les pleines, et à l'intérieur de chaque groupe du
 * palier le plus faible au plus fort. Une arête lourde passe donc au-dessus des
 * légères qui la croisent, et la sélection au-dessus de tout.
 */
export function drawSemanticEdges(edges: SemanticEdge[], theme: Theme, unit: number): Graphics {
  const g = new Graphics();
  if (edges.length === 0 || !(unit > 0)) return g;

  for (const full of [false, true]) {
    for (let bucket = 0; bucket < SEMANTIC_EDGE_BUCKETS; bucket++) {
      let has = false;
      for (const edge of edges) {
        if ((edge.dim !== true) !== full) continue;
        if (bucketOf(edge.weight) !== bucket) continue;
        g.moveTo(edge.x1, edge.y1);
        g.lineTo(edge.x2, edge.y2);
        has = true;
      }
      if (!has) continue;
      // Le représentant du palier est son MILIEU : le palier le plus faible n'est
      // ainsi jamais tracé à épaisseur nulle, et le plus fort jamais au maximum
      // absolu, ce qui garde une marge visuelle au survol des cartes qui
      // reviendront au zoom.
      const t = (bucket + 0.5) / SEMANTIC_EDGE_BUCKETS;
      g.stroke({
        width: unit * (SEMANTIC_EDGE_WIDTH_MIN + t * (SEMANTIC_EDGE_WIDTH_MAX - SEMANTIC_EDGE_WIDTH_MIN)),
        color: theme.edge.ref,
        alpha:
          (SEMANTIC_EDGE_ALPHA_MIN + t * (SEMANTIC_EDGE_ALPHA_MAX - SEMANTIC_EDGE_ALPHA_MIN)) *
          (full ? 1 : DIM_ALPHA),
      });
    }
  }

  return g;
}

/** Le palier d'un poids, de 0 à `SEMANTIC_EDGE_BUCKETS - 1`. Exporté pour être
 * testé sans Graphics : c'est toute la graduation, et une erreur d'un cran y
 * serait invisible dans le rendu. */
export function bucketOf(weight: number): number {
  const t = Math.min(1, Math.max(0, weight / SEMANTIC_EDGE_WEIGHT_FULL));
  return Math.min(SEMANTIC_EDGE_BUCKETS - 1, Math.floor(t * SEMANTIC_EDGE_BUCKETS));
}
