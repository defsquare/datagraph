import {
  AlphaFilter,
  Application,
  Container,
  Graphics,
  type FederatedPointerEvent,
  type Rectangle,
} from "pixi.js";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  buildGraph,
  buildSearchIndex,
  CollapseState,
  anchorRectFor,
  createStructureLayoutEngine,
  DEFAULT_METRICS,
  enclosingCircle,
  pageOf,
  validateConfig,
  type Aggregate,
  type DataGraphConfig,
  type Diagnostic,
  type Graph,
  type GraphNode,
  type StructureLayoutEngine,
  type LayoutResult,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
  type SearchIndex,
  type SearchResult,
} from "@defsquare/data-graph-core";
// `import type` UNIQUEMENT : ce point d'entrée porte la vue graphe et ne doit
// entrer dans le bundle que de qui y bascule réellement. Un import de type ne
// produit aucun code à l'exécution ; le seul chemin d'exécution vers le moteur
// est l'`import()` dynamique de `graph-view.ts`, qui possède aussi le seul
// `import type` que ce point d'entrée exige à l'exécution de la vue. Ce
// fichier-ci n'en garde qu'un usage d'API PUBLIQUE, le relais ci-dessous.
// `test/bundle-purity.test.ts` (côté renderer) garde tout ce fil : le test du
// cœur ne couvre que le `dist/` du cœur, pas les sources du renderer.
//
// Ce que cette discipline vaut a changé d'échelle depuis le retrait de l'ancien
// moteur : 3,58 ko gzip au lieu de 180,28. Elle reste parce qu'elle tient la
// FORME — la vue graphe se charge à la demande par construction — et non plus
// parce qu'elle tient un poids. Le raisonnement complet est dans les deux tests
// de pureté.
import type { TwoLevelLayoutOptions } from "@defsquare/data-graph-core/graph-layout";
// Relais et non réexport : `export … from "<ce specifier>"` est interdit par
// `test/bundle-purity.test.ts`, y compris sous forme type-only. Réexporter le
// symbole déjà importé ci-dessus donne le même service aux consommateurs sans
// écrire la forme interdite.
export type { TwoLevelLayoutOptions };
import { entityAccentMap, resolveTheme, type Theme, type ThemeOverride } from "./theme.js";
import { pixiFontRegistry } from "./font-registry.js";
import { fontsReady, measureFontMetrics } from "./font-metrics.js";
import { Camera, type Size } from "./camera.js";
import {
  drawEdgeHitAreas,
  drawEdgeLabels,
  drawEdges,
  drawClusterHitAreas,
  drawClusters,
  drawNode,
  drawRemainderToken,
  drawSearchHighlights,
  drawSelectionOverlay,
  drawSemanticDiscs,
  drawSemanticEdges,
  drawSemanticLabels,
  edgeLabelPlacements,
  edgeLabelPosition,
  labelParamInView,
  lodForScale,
  REMAINDER_TOKEN_GAP,
  REMAINDER_TOKEN_HEIGHT,
  type EdgeLabelPlacement,
  type Lod,
  TOKEN_HOVER_SHIFT,
} from "./draw.js";
import { attachDrag, TAP_THRESHOLD } from "./drag.js";
import { clusterRelatedIds, DIM_ALPHA, relatedIds } from "./focus.js";
import { attachHover, type HoverHandle } from "./hover.js";
import { createPositionAnimator } from "./animate.js";
import { createSearchController } from "./search.js";
import {
  createGraphViewController,
  type ClusterPaint,
  type ClustersForArgs,
  type GraphLayoutWorkerSpawn,
  type GraphViewState,
  type SemanticNodePaint,
} from "./graph-view.js";
import { Emitter } from "./events.js";

/** `"structure"` met en page l'arbre de containment ; `"graph"` met en page les
 * entités et leurs références, groupées par agrégat. */
export type DataGraphView = "structure" | "graph";

/** Ce que la vue courante permet aux cartes et aux arêtes. Donnée pure,
 * dérivée de `view` et du LOD courant : la calculer d'un bloc remplace les
 * ternaires éparpillés, et un futur troisième mode de vue s'écrirait ici.
 *
 * Le LOD s'y est ajouté avec le régime SÉMANTIQUE de la vue graphe, qui n'est
 * pas une vue de plus mais un autre régime de la même vue : sous le seuil du
 * LOD 2, elle cesse de dessiner ses cartes et peint ses agrégats comme des
 * nœuds. Ce que ce couple gouverne alors — quelles cartes existent, et ce que
 * les agrégats peignent — reste exactement de la politique, donc reste ici.
 *
 * Ne contient QUE de la politique. Ce qui lit de l'état — les positions et les
 * nœuds visibles de la vue courante (`activePositions`/`activeVisible`), ou
 * l'inertie d'`animatePositions`, qui est une décision d'orchestration — reste
 * dehors. */
interface ViewPolicy {
  /** `drawEdges`/`drawSelectionOverlay` : la vue graphe trace les références,
   * la vue structure le containment. */
  edgeMode: "ref" | "contain";
  /** `rebuild` : un chevron d'en-tête n'a de sens que là où un clic plie
   * quelque chose — l'arbre de containment, et RIEN en vue graphe, qui montre
   * tout et ne plie plus aucun agrégat. */
  chevrons: boolean;
  /** `rebuild` : l'état de pli est lu sur `collapseState` quand la vue plie,
   * sinon tout est déplié d'office. `handleNodeTap` : en-tête et jetons de
   * tableau plient. Déplier en vue graphe révélerait des nœuds qui ne sont pas
   * des entités, donc que cette vue ne positionne pas. */
  foldable: boolean;
  /** `rebuild` : survol des jetons de tableau, l'affordance de pli. */
  tokenHover: boolean;
  /** `rebuild` : chevrons de jetons orientés par l'ensemble des tableaux
   * dépliés. Sans lui les jetons restent lisibles mais inertes. */
  expandedArrays: boolean;
  /**
   * `rebuild` : QUELLES cartes existent.
   *
   * `"unclustered"` est le régime sémantique — seules les entités hors agrégat
   * gardent une carte, les autres étant déjà représentées par le disque de leur
   * agrégat. Le filtre est posé sur `CardContext.drawable`, et c'est le seul
   * endroit qui puisse le tenir : `syncCards` comme `ensureCard` s'y limitent,
   * donc aucun chemin ne peut matérialiser une carte que le disque remplace.
   * C'est l'invariant « jamais de cartes ET de disques ensemble », obtenu par
   * construction plutôt que par une garde à chaque site.
   */
  cards: "all" | "unclustered";
  /**
   * `redrawClusters` : ce que les agrégats peignent.
   *
   * `"none"` en vue structure, qui n'en a pas. `"hull"` est la région
   * translucide posée derrière les cartes ; `"disc"` est le nœud plein qui les
   * REMPLACE, avec son libellé et ses arêtes agrégées. Les trois valeurs
   * s'excluent, et c'est ce qui interdit de peindre une enveloppe sous un disque
   * qui occupe déjà le même cercle.
   */
  aggregates: "none" | "hull" | "disc";
}

/**
 * Ce qu'une reconstruction calcule UNE fois pour toutes ses cartes, et qu'une
 * carte matérialisée plus tard — au fil d'un déplacement de caméra, ou à la
 * demande d'un `select`/`focus` — doit retrouver à l'identique.
 *
 * L'existence de cet objet EST l'invariant du culling : une carte créée hors
 * de la boucle de `rebuild()` doit être indiscernable de celles qu'elle a
 * produites. Tout ce qui gouverne le dessin d'une carte et qui n'est pas dans
 * son nœud ni dans son rect est donc ici, figé au moment de la reconstruction.
 * Ce qui manque à l'appel se relit au contraire en direct — les positions (que
 * `dragCard` mute en place) et l'ensemble de mise au point (que la sélection
 * change) — parce que la carte doit alors refléter l'état COURANT, pas celui du
 * dernier rebuild.
 */
interface CardContext {
  policy: ViewPolicy;
  /** Champs porteurs d'une référence sortante, par nœud. */
  refFieldsByNode: Map<NodeId, Set<string>>;
  /** Idem, pour les références qui ne résolvent pas. */
  danglingFieldsByNode: Map<NodeId, Set<string>>;
  /** Tableaux dépliés, pour orienter le chevron des jetons. */
  expandedArrays: Set<NodeId>;
  /** Les ids qui ONT une carte dans cette vue : les nœuds visibles, non élidés
   * et positionnés. C'est le domaine que la matérialisation balaie — le
   * pré-filtrer ici évite de retester `elided`/`positions.has` sur des milliers
   * de nœuds à chaque image. */
  drawable: Set<NodeId>;
}

export interface DataGraphOptions {
  data: unknown;
  config: DataGraphConfig;
  theme?: ThemeOverride;
  elkWorkerUrl?: string | URL;
  /** Vue initiale. `"structure"` (défaut) met en page l'arbre de containment ;
   * `"graph"` met en page les entités et leurs références, groupées par
   * agrégat. */
  view?: DataGraphView;
  /**
   * Réglages de la mise en page de la vue graphe, passés tels quels à
   * `createTwoLevelLayoutEngine`. Le plus utile reste `clusterGap` (160 px par
   * défaut), l'écart ouvert entre deux enveloppes d'agrégats : c'est un réglage
   * d'œil, qui dépend de la densité des données et de la taille de l'écran, et
   * il doit pouvoir se régler sans toucher au cœur. Les valeurs sont lues au
   * premier passage en vue graphe ; les changer après coup demande de recréer
   * l'instance.
   *
   * CHANGEMENT D'API (0.x, sans couche de compatibilité). Ce champ portait des
   * `GraphLayoutOptions` — `{ hullPadding, separationMargin,
   * separationIterations, clusterGap }` —, il porte des `TwoLevelLayoutOptions`
   * — `{ hullPadding, cardGap, clusterGap, simIterations, jitter }`. `hullPadding` et
   * `clusterGap` gardent leur nom, leur sens et leur défaut. Les deux autres
   * disparaissent parce que la passe qu'elles réglaient n'existe plus : le
   * nouveau moteur n'a AUCUNE passe de séparation de cartes, donc pas de
   * plafond d'itérations à régler, et la marge entre cartes est posée par le
   * packing (`cardGap`, 16 px, l'ancienne valeur de `separationMargin`) au lieu
   * d'être visée par une relaxation. Passer `separationMargin` ou
   * `separationIterations` est désormais une erreur de type : c'est voulu,
   * l'objet aurait été accepté et ignoré en silence.
   *
   * `jitter` (32 px par défaut) est le second réglage d'œil, ajouté après
   * coup : l'amplitude du bruit déterministe qui empêche les enveloppes de se
   * ranger en pavage hexagonal. `0` le désactive. Comme `clusterGap`, il ne
   * peut dégrader aucune garantie — voir sa documentation côté cœur.
   */
  graphLayoutOptions?: TwoLevelLayoutOptions;
  /**
   * L'URL du Web Worker qui calcule la mise en page de la vue graphe. Absente,
   * le calcul reste EN PROCESSUS, exactement comme avant l'existence de cette
   * option.
   *
   * Ce que ça achète, mesuré : sur un audit réel de 6 251 entités et ~1 300
   * agrégats, `setView("graph")` passe ~4,4 s dans un calcul entièrement
   * synchrone. Sur le thread principal, c'est 4,4 s de page gelée — ni rendu, ni
   * pan, ni zoom. Déporté, le thread principal ne fait plus que l'extraction
   * (linéaire) et l'application du résultat, et la vue structure reste
   * manipulable pendant toute l'attente.
   *
   * L'URL doit désigner le worker publié par ce paquet,
   * `@defsquare/data-graph/graph-layout-worker` — un module ESM autonome, chargé
   * avec `{ type: "module" }`. Sous un empaqueteur, la forme usuelle est
   * `new URL("@defsquare/data-graph/graph-layout-worker", import.meta.url)` ;
   * `apps/demo` le fait ainsi, avec la note de `vite.config.ts` sur les quatre
   * modes d'exécution.
   *
   * REPLI. L'option est sûre à passer : au PREMIER échec — construction
   * impossible, worker injouable, calcul qui lève — l'instance avertit une fois
   * et rejoue la mise en page en processus, définitivement pour la session. Le
   * pire cas est donc le comportement d'avant l'option, jamais une vue qui ne
   * s'affiche pas. Même discipline que le repli d'`elkWorkerUrl`, en plus
   * strict : celui-ci ne réessaie pas à la mise en page suivante.
   */
  graphLayoutWorkerUrl?: string | URL;
}

export type DataGraphEvent = "select" | "followRef";

type DataGraphEvents = {
  select: GraphNode;
  followRef: RefEdge;
};

export interface DataGraph {
  ready: Promise<void>;
  fit(): void;
  /**
   * Recalcule la mise en page COMPLÈTE de la vue structure, puis cadre.
   *
   * La vue structure se construit par opérations incrémentales — dépliages,
   * replis, pages révélées —, chacune insérant un bloc dans une pose existante
   * plutôt que de la refaire. C'est ce qui les rend instantanées, et c'est aussi
   * ce qui fait dériver la vue : après une longue session d'exploration, les
   * colonnes ne sont plus celles qu'un rangement global donnerait. `tidy()` est
   * l'action de réparation — le « Ranger » de l'hôte —, à proposer à
   * l'utilisateur plutôt qu'à déclencher tout seul : la pose change sous ses
   * yeux, ce doit être son geste.
   *
   * Sans effet en vue graphe, qui a son propre moteur et ne dérive pas.
   */
  tidy(): Promise<void>;
  /** Déplie un nœud de l'arbre de containment — une opération de la VUE
   * STRUCTURE. En vue graphe elle reste sans effet visible : l'état est bien
   * mis à jour, et se verra au retour dans la vue structure, mais la vue graphe
   * ne montre pas le containment. La vue graphe, elle, ne plie rien : toutes
   * les entités y sont toujours visibles. */
  expand(id: NodeId): Promise<void>;
  /** Replie un nœud de l'arbre de containment. Même remarque que `expand`. */
  collapse(id: NodeId): Promise<void>;
  focus(id: NodeId): void;
  select(id: NodeId): void;
  search(query: string): SearchResult[];
  nextMatch(): SearchResult | null;
  prevMatch(): SearchResult | null;
  on(event: DataGraphEvent, callback: (payload: any) => void): () => void;
  setData(data: unknown, config?: DataGraphConfig): Promise<void>;
  diagnostics(): Diagnostic[];
  /** Compteurs pour une barre d'état hôte. */
  stats(): { logicalNodeCount: number; visibleNodeCount: number };
  /** Les arêtes de référence sortantes d'un nœud, pour qu'un hôte puisse
   * proposer « suivre la référence » sans connaître les internes. */
  refEdges(from: NodeId): RefEdge[];
  /** Remplace le thème et redessine, sans relancer le layout ni remesurer les
   * polices. Ceci n'est sûr que si `typography` et `fonts` ne changent pas —
   * c'est le cas pour un couple de thèmes clair/sombre, qui ne diffèrent que
   * par les couleurs. Les `NodeMetrics` sont mesurées une seule fois, à
   * l'initialisation ; changer `typography`/`fonts` ici désynchroniserait
   * ces métriques du thème effectivement dessiné (glyphes redimensionnés
   * sans que la mise en page des cartes ne bouge). Il n'existe aujourd'hui
   * aucune API pour changer la police après coup : cela demande de recréer
   * l'instance via `createDataGraph`. */
  setTheme(theme: Theme | ThemeOverride): void;
  /** Bascule de vue. Le premier passage en `"graph"` charge le moteur organique
   * à la demande (import dynamique) et calcule les agrégats, d'où la promesse.
   * La sélection est reportée sur l'entité la plus proche, car la vue graphe ne
   * connaît que des entités. */
  setView(view: DataGraphView): Promise<void>;
  currentView(): DataGraphView;
  destroy(): void;
}

/**
 * Le grossissement d'une carte au survol, en fraction de sa taille : 2,5 % à
 * pleine intensité.
 *
 * Volontairement au bord du perceptible. Une carte fait typiquement 200 px de
 * large, donc le lift la déborde de 2,5 px de chaque côté — assez pour que
 * l'œil voie ce que le pointeur désigne au milieu de dizaines de voisines, trop
 * peu pour recouvrir la carte d'à côté (le moteur en sépare les cartes de
 * `cardGap`, 16 px) ou pour donner l'impression que la mise en page bouge. Le
 * survol est un repère, pas un événement.
 */
const HOVER_LIFT = 0.025;

// L'autre réglage d'œil de l'interaction, `DIM_ALPHA`, ne peut pas vivre ici :
// il est partagé avec `drawEdges`, et `draw.ts` important ce fichier fermerait
// un cycle. Il est dans `focus.ts`, avec la fonction qui décide QUI est estompé.

/**
 * Le filtre qui estompe une carte, PARTAGÉ par toutes les cartes de toutes les
 * instances.
 *
 * Un filtre, et pas `container.alpha`. Une carte est peinte EN COUCHES dans un
 * seul Graphics — un fond accent qui occupe toute la carte, puis le corps
 * par-dessus (voir `drawNode`) —, et `alpha` s'applique primitive par primitive :
 * le corps devenu translucide laisse voir l'accent qu'il recouvrait, et la carte
 * estompée se rendait comme un pavé plein de sa couleur d'accent. L'`AlphaFilter`
 * aplatit d'abord la carte en une texture, PUIS lui applique l'alpha : le visuel
 * reste exactement celui d'une carte normale, simplement fantomatique. C'est ce
 * que dit la doc de Pixi (« use this instead of Container's alpha property to
 * avoid visual layering of individual elements »).
 *
 * Instancié PARESSEUSEMENT, et c'est nécessaire : le constructeur d'un filtre
 * Pixi compile son `GlProgram`, ce qui crée un canvas de test et exige donc un
 * `document`. Le construire au chargement du module ferait échouer l'import de
 * ce fichier sous l'environnement Node de vitest, où plusieurs tests l'importent
 * pour `attachTap`/`createBackgroundHit`/`recomputeClusterCircle`.
 *
 * Une seule instance, partagée : un filtre n'a d'état que son alpha, qui est ici
 * une constante. Il n'est jamais détruit — `destroy()` n'a rien à en libérer
 * qu'une autre instance ne puisse encore utiliser.
 *
 * `padding` vaut 0 (défaut de `Filter`), donc le filtre n'élargit pas les bornes
 * de la carte et le `cullArea` que `drawNode` pose reste exact.
 */
let sharedDimFilters: AlphaFilter[] | undefined;
function dimFilters(): AlphaFilter[] {
  sharedDimFilters ??= [new AlphaFilter({ alpha: DIM_ALPHA })];
  return sharedDimFilters;
}

/**
 * Ce que désigne la sélection : une CARTE ou un AGRÉGAT entier (vue graphe
 * seulement, la seule à peindre des enveloppes).
 *
 * Un type somme plutôt que deux champs qui pourraient être renseignés ensemble :
 * les deux sélections s'excluent, et l'exprimer dans le type évite d'avoir à le
 * maintenir à la main à chaque geste. L'API publique, elle, ne connaît toujours
 * que la sélection NODALE — `select(id)`, l'événement `"select"` et l'anneau de
 * `drawSelectionOverlay` ne voient un id que quand `kind === "node"`.
 */
type Selection = { kind: "node"; id: NodeId } | { kind: "cluster"; aggregateId: string };

/**
 * Un maillon de la cascade de `doFocus` : le chemin vers une cible profonde se
 * franchit désormais avec DEUX gestes distincts par niveau, un dépliage et une
 * révélation de page, chacun ayant sa propre mise en page incrémentale
 * (`layoutAfterExpand` pousse un sous-arbre à côté de son ancre,
 * `layoutAfterReveal` insère un bloc dans une colonne déjà posée). Les typer
 * plutôt que d'aligner deux listes garde l'ordre d'exécution — et donc le
 * retour arrière — dans une seule séquence.
 */
type FocusStep =
  | { kind: "expand"; id: NodeId }
  | { kind: "reveal"; parentId: NodeId; page: number };

/**
 * Les trois fenêtres de la matérialisation des cartes, en FRACTIONS d'écran
 * ajoutées de chaque côté du rectangle monde visible.
 *
 * Seule `PAINT` est un contrat visuel : toute carte qui l'intersecte est
 * dessinée AVANT l'image suivante, sans budget ni report, donc l'écran montre
 * exactement ce qu'il montrait du temps où toutes les cartes étaient créées
 * d'un bloc. Les 15 % de marge absorbent l'image de retard entre le mouvement
 * de la caméra et notre passage — sans eux, une carte entrant par le bord
 * apparaîtrait une image trop tard.
 *
 * `PREFETCH` n'est que du confort : un écran de chaque côté, rempli au fil des
 * images dans un budget de temps, pour qu'un déplacement franc n'ait pas à
 * fabriquer sa bande de cartes exactement au moment où elle devient visible.
 *
 * `RECLAIM` est le seuil de destruction, délibérément bien plus large que
 * `PREFETCH` : c'est cette hystérésis qui empêche un aller-retour de caméra de
 * détruire puis recréer les mêmes cartes à chaque image.
 */
const PAINT_MARGIN = 0.15;
const PREFETCH_MARGIN = 1;
const RECLAIM_MARGIN = 2.5;

/**
 * Le temps, par image, que la matérialisation de CONFORT a le droit de prendre.
 *
 * 4 ms sur un budget d'image de 16 : de quoi avancer franchement sans jamais
 * être à soi seul responsable d'une image perdue. Le budget est en TEMPS et non
 * en nombre de cartes parce que le coût d'une carte varie d'un facteur ~100
 * entre le LOD 2 (un rectangle plein) et le LOD 0 (en-tête, lignes, mesures de
 * texte) : un quota fixe serait soit famélique en bas, soit ruineux en haut.
 *
 * La fenêtre `PAINT`, elle, n'est PAS budgétée. La rogner ferait apparaître des
 * trous à l'écran, et elle est de toute façon bornée par ce que le rendu doit
 * peindre de toute manière.
 */
const PREFETCH_BUDGET_MS = 4;

/**
 * Élargit `rect` de `margin` fois sa taille, de CHAQUE côté : `margin = 1`
 * triple donc chaque dimension. Pur, et exporté pour être testé sans instance —
 * ce n'est pas une API publique du paquet, `index.ts` ne le relaie pas.
 */
export function inflateRect(rect: Rect, margin: number): Rect {
  const dx = rect.width * margin;
  const dy = rect.height * margin;
  return { x: rect.x - dx, y: rect.y - dy, width: rect.width + dx * 2, height: rect.height + dy * 2 };
}

/**
 * Deux rectangles se touchent-ils ? Le contact par un bord COMPTE comme une
 * intersection : une carte posée exactement sur le bord de la fenêtre doit être
 * dessinée, et l'exclure la ferait clignoter au pixel près.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/**
 * Les trois fenêtres d'un passage de matérialisation, dérivées du seul
 * rectangle monde visible. `null` partout quand il n'y a pas de caméra : aucune
 * fenêtre n'a alors de sens, et tout doit être matérialisé — c'est le
 * comportement d'avant le culling, gardé comme repli.
 */
export interface CardWindows {
  paint: Rect | null;
  prefetch: Rect | null;
  reclaim: Rect | null;
}

export function cardWindowsFor(worldView: Rect | null): CardWindows {
  if (!worldView) return { paint: null, prefetch: null, reclaim: null };
  return {
    paint: inflateRect(worldView, PAINT_MARGIN),
    prefetch: inflateRect(worldView, PREFETCH_MARGIN),
    reclaim: inflateRect(worldView, RECLAIM_MARGIN),
  };
}

/**
 * Le sort d'UNE carte au passage de la matérialisation. Toute la politique du
 * culling tient ici, en donnée pure et sans scène — comme `ViewPolicy` pour la
 * vue, comme `focus.ts` pour l'estompage : la décision se teste sans instance,
 * et `syncCards` n'a plus qu'à l'exécuter.
 *
 * `"defer"` se distingue de `"none"` et ce n'est pas cosmétique : la première
 * dit « il faudra la faire, mais pas dans cette image », la seconde « il n'y a
 * rien à faire ». Les confondre effacerait du code la seule trace du budget.
 *
 * L'ordre des tests EST la politique :
 *  - à l'écran (`paint`), on crée, budget ou pas — c'est le contrat visuel ;
 *  - autour (`prefetch`), on crée si le budget de l'image le permet ;
 *  - au-delà, rien ;
 *  - une carte épinglée (sélectionnée, ou saisie par un geste en cours) n'est
 *    jamais recyclée, où qu'elle soit ;
 *  - une carte matérialisée n'est recyclée que HORS de `reclaim`, bien plus
 *    large que `prefetch` : c'est l'hystérésis qui empêche un aller-retour de
 *    caméra de détruire et recréer les mêmes cartes image après image.
 */
export function cardFate(
  rect: Rect,
  windows: CardWindows,
  state: { materialized: boolean; pinned: boolean; budgetLeft: boolean },
): "create" | "defer" | "reclaim" | "none" {
  if (!state.materialized) {
    if (windows.paint === null || rectsOverlap(rect, windows.paint)) return "create";
    if (windows.prefetch !== null && rectsOverlap(rect, windows.prefetch)) {
      return state.budgetLeft ? "create" : "defer";
    }
    return "none";
  }
  if (state.pinned) return "none";
  if (windows.reclaim === null || rectsOverlap(rect, windows.reclaim)) return "none";
  return "reclaim";
}

/**
 * `outer` contient-il entièrement `inner` ? Sert de test de PÉREMPTION à ce qui
 * est construit pour une fenêtre plus large que l'écran : tant que la fenêtre à
 * peindre tient dans celle qui a servi à construire, il n'y a rien à refaire.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function boundsOf(positions: Map<NodeId, Rect>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of positions.values()) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Remonte `parentId` jusqu'à trouver une entité. Sert au report de sélection
 * entre les deux vues : la vue graphe ne connaît que des entités, donc quitter
 * la vue structure depuis un objet imbriqué doit sélectionner l'entité qui le
 * contient plutôt que de vider la sélection.
 */
export function nearestEntityAncestor(graph: Graph, id: NodeId): NodeId | null {
  let current = graph.nodes.get(id);
  while (current) {
    if (current.kind === "entity") return current.id;
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * Recalcule EN PLACE l'enveloppe d'un agrégat depuis les positions courantes de
 * ses membres.
 *
 * C'est exactement le calcul du moteur — `enclosingCircle` des rects des
 * membres, plus `hullPadding` —, refait ici pendant qu'une carte est déplacée à
 * la souris. Le refaire plutôt que de translater le cercle est ce qui le rend
 * juste : sortir une carte de son agrégat doit gonfler l'enveloppe, la ramener
 * doit la resserrer, et un cercle qu'on se contenterait de suivre ne ferait ni
 * l'un ni l'autre.
 *
 * La mutation en place n'est pas une économie : le `ClusterShape` passé ici EST
 * celui de `graphView.clusters()`, et c'est par là que le prochain
 * `clustersFor()` verra la nouvelle forme. Les membres sans position (non
 * visibles) sont ignorés — l'enveloppe ne décrit que ce qui est peint.
 *
 * Le paramètre est typé structurellement plutôt qu'en `ClusterShape` : la
 * fonction n'a besoin que du disque, et s'en tenir là la rend testable sans
 * fabriquer un agrégat ni toucher au point d'entrée de la vue graphe.
 */
export function recomputeClusterCircle(
  cluster: { cx: number; cy: number; r: number },
  memberIds: Iterable<NodeId>,
  positions: Map<NodeId, Rect>,
  padding: number,
): void {
  const rects: Rect[] = [];
  for (const memberId of memberIds) {
    const rect = positions.get(memberId);
    if (rect) rects.push(rect);
  }
  const circle = enclosingCircle(rects, padding);
  cluster.cx = circle.cx;
  cluster.cy = circle.cy;
  cluster.r = circle.r;
}

/**
 * Translate EN PLACE un agrégat entier : son disque et les rects de tous ses
 * membres qui ont une position, du même delta.
 *
 * Rien n'est recalculé, et c'est la différence de nature avec
 * `recomputeClusterCircle` : déplacer un agrégat est un geste RIGIDE. Le disque
 * était le cercle englobant minimal de ses cartes avant le geste, il l'est
 * encore après, puisque tout a bougé ensemble — c'est d'ailleurs exactement ce
 * que fait le moteur, qui calcule l'enveloppe une fois sur le bloc packé puis
 * la translate avec ses cartes. Recalculer ici ne changerait rien au résultat
 * et coûterait un Welzl par image.
 *
 * Les membres sans position (non visibles) sont ignorés, comme partout
 * ailleurs : la mise en page ne décrit que ce qui est peint.
 */
export function translateCluster(
  cluster: { cx: number; cy: number; r: number },
  memberIds: Iterable<NodeId>,
  positions: Map<NodeId, Rect>,
  dx: number,
  dy: number,
): void {
  cluster.cx += dx;
  cluster.cy += dy;
  for (const memberId of memberIds) {
    const rect = positions.get(memberId);
    if (!rect) continue;
    rect.x += dx;
    rect.y += dy;
  }
}

function buildLayoutEngine(elkWorkerUrl: string | URL | undefined): StructureLayoutEngine {
  if (!elkWorkerUrl) return createStructureLayoutEngine();
  // NOTE: elk.bundled.js's `workerUrl` path only spawns a real worker when
  // the optional `web-worker` package is present (it's a Node worker_threads
  // shim, not a browser API) — under Vite/browser it silently falls back to
  // elkjs's in-process "fake worker" instead of throwing. Passing the option is
  // therefore always safe: the worst case is a layout that runs in-process,
  // never a failed construction, so there is nothing to guard or feature-detect.
  return createStructureLayoutEngine({ elkFactory: () => new ELK({ workerUrl: String(elkWorkerUrl) }) });
}

/**
 * La fabrique du worker de mise en page de la vue graphe, ou `undefined` quand
 * l'hôte n'en a pas fourni l'URL.
 *
 * C'est le SEUL endroit du dépôt où `new Worker` est écrit, et c'est voulu : le
 * contrôleur de la vue graphe (`graph-view.ts`) reste une machine de données
 * sans hypothèse d'environnement, et reçoit une fonction plutôt qu'une URL. Les
 * tests du protocole en injectent une autre, sans navigateur.
 *
 * `{ type: "module" }` n'est pas négociable : le worker publié est un module
 * ESM, et en développement l'empaqueteur en sert la SOURCE, dont les imports
 * sont réécrits en imports de module. Un worker classique refuserait les deux.
 *
 * Rien n'est gardé ici : `new Worker` peut lever (URL injouable, `Worker` absent
 * de l'environnement) et c'est le contrôleur qui traite cet échec comme tous les
 * autres — un avertissement, puis le moteur en processus pour la session.
 */
function buildGraphLayoutWorkerSpawn(
  graphLayoutWorkerUrl: string | URL | undefined,
): GraphLayoutWorkerSpawn | undefined {
  if (!graphLayoutWorkerUrl) return undefined;
  return (onMessage, onError) => {
    const worker = new Worker(graphLayoutWorkerUrl, { type: "module" });
    worker.onmessage = (event: MessageEvent) => onMessage(event.data);
    // Les deux échecs qu'un worker signale hors protocole : le script qui ne se
    // charge ou ne s'exécute pas (`error`), et un message qu'on n'a pas pu
    // désérialiser (`messageerror`). Aucun des deux ne dit à quelle requête il
    // se rapporte, d'où le traitement global côté contrôleur.
    worker.onerror = (event) => onError(event);
    worker.onmessageerror = (event) => onError(event);
    return {
      post: (request) => worker.postMessage(request),
      terminate: () => worker.terminate(),
    };
  };
}

/**
 * Wires a display object for click interaction: `eventMode = "static"`,
 * a pointer cursor, and a `pointertap` handler gated by a `TAP_THRESHOLD`px
 * movement check against the matching `pointerdown` (so a drag-to-pan
 * gesture that starts/ends over the object never fires `onTap`).
 *
 * Le seuil vient de `drag.ts`, qui porte l'autre moitié du même partage : ce
 * qui n'est plus un tap ici est exactement ce qui devient un déplacement de
 * carte là-bas. Exporté pour que ce partage soit testable de bout en bout
 * (`test/drag.test.ts`) — ce n'est pas une API publique du paquet, `index.ts`
 * ne le relaie pas.
 */
export function attachTap(target: Container, onTap: (event: FederatedPointerEvent) => void): void {
  target.eventMode = "static";
  target.cursor = "pointer";
  let downX = 0;
  let downY = 0;
  target.on("pointerdown", (event: FederatedPointerEvent) => {
    downX = event.global.x;
    downY = event.global.y;
  });
  target.on("pointertap", (event: FederatedPointerEvent) => {
    const dx = event.global.x - downX;
    const dy = event.global.y - downY;
    if (Math.hypot(dx, dy) > TAP_THRESHOLD) return;
    onTap(event);
  });
}

/**
 * Le FOND de la toile en tant que cible de clic : un container vide et
 * transparent, couvrant `hitArea`, dont le tap appelle `onTap`. Destiné à être
 * inséré SOUS tout le reste, où il est le seul objet que le pointeur puisse
 * atteindre sur le vide.
 *
 * Pourquoi un calque dédié et pas `app.stage` lui-même, qu'il suffirait de
 * passer en `"static"` avec une `hitArea` : parce que le hit-testing de Pixi
 * HÉRITE le mode d'événement en descendant (`EventBoundary.hitTestRecursive`
 * repasse le mode du parent dès qu'il est interactif). Un stage `"static"`
 * rendrait donc interactifs tous ses descendants, Graphics décoratifs compris —
 * et le premier d'entre eux touché AVALERAIT le hit, la boucle s'arrêtant au
 * premier enfant qui répond : l'anneau de sélection ou un surlignage de
 * recherche empêcherait de cliquer la carte qu'il recouvre. Un frère de plus
 * bas niveau n'a pas cet effet — il n'est consulté que si rien au-dessus n'a
 * répondu, c'est-à-dire sur le vide.
 *
 * Deux conditions au tap, et il faut les deux. `event.target === background` :
 * le `pointertap` d'une carte ou d'une zone de clic d'arête REMONTE jusqu'ici,
 * et sans ce test tout clic désélectionnerait juste après avoir sélectionné. Le
 * seuil de `TAP_THRESHOLD` px : le pan de la caméra part du même bouton sur le
 * même vide et émet lui aussi un `pointertap` à l'arrivée. C'est le partage de
 * `attachTap`/`attachDrag`, avec la même constante — mais écrit ici plutôt que
 * délégué à `attachTap`, qui poserait un curseur `"pointer"` sur la totalité du
 * canvas.
 *
 * Exporté pour la même raison qu'`attachTap` : le geste se teste ainsi sans
 * canvas ni WebGL. Ce n'est pas une API publique du paquet, `index.ts` ne le
 * relaie pas.
 */
export function createBackgroundHit(hitArea: Rectangle, onTap: () => void): Container {
  const background = new Container();
  background.eventMode = "static";
  background.hitArea = hitArea;
  let downX = 0;
  let downY = 0;
  background.on("pointerdown", (event: FederatedPointerEvent) => {
    downX = event.global.x;
    downY = event.global.y;
  });
  background.on("pointertap", (event: FederatedPointerEvent) => {
    if (event.target !== background) return;
    if (Math.hypot(event.global.x - downX, event.global.y - downY) > TAP_THRESHOLD) return;
    onTap();
  });
  return background;
}

/**
 * Creates a DataGraph instance: builds the graph from `data`/`config`,
 * initializes Pixi (async), lays out the initially-visible nodes, and
 * renders them. Returns immediately; await `.ready` before calling `fit()`
 * or other methods that need the graph/layout to be available.
 */
export function createDataGraph(container: HTMLElement, options: DataGraphOptions): DataGraph {
  // Fail fast: an invalid config must throw synchronously here, before the
  // Pixi Application is even created, rather than surfacing later as a
  // rejection of `ready`. validateConfig is idempotent — buildGraph (in the
  // `ready` IIFE below) calls it again on the same config.
  validateConfig(options.config);

  let theme: Theme = resolveTheme(options.theme);
  let metrics: NodeMetrics = DEFAULT_METRICS;
  let entityAccents = new Map<string, string>();

  const app = new Application();
  const world = new Container();
  // Les arêtes AGRÉGÉES du régime sémantique : le calque le plus bas de tous,
  // sous les disques qu'elles relient — un trait qui passerait par-dessus ne
  // ferait qu'épaissir leur contour par en dessous. Vide hors régime sémantique.
  //
  // Container PERMANENT dont on remplace les enfants, et non un Graphics
  // réassigné comme ses deux voisins : il est refait à une reconstruction ou à
  // un changement de sélection, jamais à l'image d'un survol, donc il n'a pas
  // besoin de la mécanique `destroy()` + `addChildAt` — et l'éviter garde les
  // profondeurs des autres calques stables.
  const semanticEdgeLayer = new Container();
  // Les agrégats : enveloppes translucides derrière les cartes, ou disques
  // pleins qui les remplacent au régime sémantique. Vide en vue structure.
  let clustersGraphics = new Graphics();
  // Les libellés des disques sémantiques, AU-DESSUS d'eux. Calque à part et non
  // enfants de `clustersGraphics` : celui-ci est détruit et repeint à chaque
  // image d'un survol d'agrégat, alors qu'un libellé ne dépend d'aucune
  // intensité — les fondre ensemble reconstruirait 1 300 textes par image pour
  // un rendu identique. Même partage que les arêtes et leur `edgeHitLayer`.
  const semanticLabelLayer = new Container();
  // Les cibles de saisie des enveloppes, juste AU-DESSUS de leur visuel et SOUS
  // tout le reste. La profondeur est ce qui règle l'arbitrage des gestes : le
  // hit-testing de Pixi va du haut vers le bas, donc une carte, une zone de
  // clic d'arête ou l'overlay attrapent le pointeur avant le disque, et seul
  // le vide d'une enveloppe la fait saisir. Calque séparé du visuel parce que
  // ce dernier est détruit et repeint à chaque image d'un déplacement — voir
  // `drawClusterHitAreas`.
  const clusterHitLayer = new Container();
  let edgesGraphics = new Graphics();
  // Les étiquettes des références sortantes de la sélection. Un calque À PART et
  // non des enfants d'`edgesGraphics` : celui-ci est un Graphics, qui ne porte
  // que de la géométrie, alors qu'une étiquette est un Text dans une pilule.
  // Reconstruit par `redrawEdges` — c'est la même donnée (les arêtes, la
  // sélection) qui les gouverne tous les deux, les séparer les ferait diverger.
  // `null` tant qu'aucun rebuild n'a eu lieu, et au LOD 2 où il n'y a rien à
  // écrire.
  let edgeLabelsView: Container | null = null;
  // Les placements qui ont produit `edgeLabelsView`, appariés à ses enfants par
  // INDEX (contrat de `drawEdgeLabels`). Mémorisés parce que reposer une
  // étiquette au fil de la caméra demande son segment, que le sous-conteneur
  // rendu ne porte plus.
  let edgeLabels: EdgeLabelPlacement[] = [];
  const edgeHitLayer = new Container();
  const nodesLayer = new Container();
  // Les jetons de reliquat : un par bloc d'enfants-cartes non révélés, posé dans
  // la colonne à la place qu'occuperaient ces cartes. Ce sont des
  // PSEUDO-ÉLÉMENTS du renderer — jamais des nœuds du graphe, jamais des boîtes
  // ELK : les faire entrer dans la mise en page les ferait participer au calcul
  // qu'ils existent justement pour éviter.
  //
  // Calque à part, et AU-DESSUS des cartes : leur position est arithmétique et
  // rien ne garantit qu'aucune carte ne les recouvre (un déplacement de carte
  // suffit), or un jeton recouvert n'attraperait plus le clic qui le révèle.
  const remainderLayer = new Container();
  // Les arêtes restent SOUS les cartes, au repos : une référence remonte
  // souvent vers la gauche et traverserait les cartes qui la séparent de sa
  // cible, ce qui surchargerait la lecture pour un gain nul la plupart du
  // temps. C'est la sélection qui la révèle — `drawSelectionOverlay` redessine
  // les références sortantes du nœud sélectionné dans `overlayGraphics`, le
  // calque le plus haut, où elles passent donc par-dessus tout.
  let overlayGraphics = new Container();
  world.addChild(
    semanticEdgeLayer,
    clustersGraphics,
    semanticLabelLayer,
    clusterHitLayer,
    edgesGraphics,
    edgeHitLayer,
    nodesLayer,
    remainderLayer,
    overlayGraphics,
  );

  // Le bail d'atlas de cette instance. Les atlas Pixi sont globaux par nom,
  // donc partagés entre instances ; le registre les compte par référence et ne
  // désinstalle qu'au départ du dernier porteur. Sans lui, `destroy()` ne
  // pouvait rien libérer et la mémoire de texture fuyait à chaque montage.
  const fontLease = pixiFontRegistry.lease();

  let camera: Camera | null = null;
  let graph: Graph | undefined;
  let collapseState: CollapseState | undefined;
  let layoutResult: LayoutResult | undefined;
  let engine: StructureLayoutEngine | undefined;
  let searchIndex: SearchIndex | undefined;
  // La vue courante. L'état PROPRE à la vue graphe — index d'agrégats, mise en
  // page, moteur, marge d'enveloppe — vit entièrement dans `graphView` ; `view`
  // reste ici parce qu'elle appartient à l'orchestration inter-vues, que ce
  // fichier est seul à porter.
  let view: DataGraphView = options.view ?? "structure";
  // Vrai entre le franchissement du seuil et le relâchement, pendant qu'une
  // carte OU une enveloppe d'agrégat est déplacée — les deux gestes sont le
  // même du point de vue de la caméra. Un seul lecteur : elle, dont il inhibe
  // le pan (sans quoi le contenu saisi fuirait sous le curseur au double de la
  // vitesse du pointeur). Le reste passe par `dragCard`/`dragCluster`.
  let contentDragging = false;
  // L'intensité de survol de chaque enveloppe, indexée par agrégat. Elle vit
  // ICI et non sur le container de saisie parce que ce n'est pas lui qui la
  // peint : le visuel des enveloppes est un unique Graphics détruit et repeint
  // d'un bloc (`redrawClusters`), qui a donc besoin de lire l'état de TOUTES les
  // enveloppes à chaque passage. Indexée par `aggregateId` et non par container
  // pour la même raison — c'est la clé que `clustersFor()` a sous la main.
  // Vidée par `redrawClusterHitAreas`, qui détruit les containers qui
  // l'alimentent (voir là-bas).
  const clusterHover = new Map<string, number>();
  // The config currently in effect — `options.config` initially, replaced by
  // whatever setData() was last called with. setData(data) (config omitted)
  // reuses this rather than re-reading options.config, so a second setData
  // without a config keeps whatever the *previous* setData installed.
  let currentConfig: DataGraphConfig = options.config;
  let currentLod: Lod = 0;
  let selection: Selection | null = null;
  let destroyed = false;
  // Bumped by every mutating operation (doExpand/doCollapse/doFocus's expand
  // cascade) before it awaits a layout; after each await the operation
  // compares its captured value against the current counter and bails if
  // some other operation ran (and thus already applied its own layout)
  // in the meantime. Without that guard, a layout resolved late overwrites
  // `layoutResult` after a newer operation already mutated `collapseState`:
  // the two then describe different graphs, and the canvas shows positions
  // for nodes the collapse state no longer considers visible.
  let opGen = 0;
  // BitmapText's canvas-fallback rendering path is unreliable (see draw.ts);
  // use plain Text there instead. Resolved once renderer type is known.
  let useBitmapText = true;

  // Node id -> its currently rendered container, so an expand/collapse can
  // interpolate each surviving node from its old to its new position.
  //
  // Depuis le culling à la création, cette table ne contient PLUS toutes les
  // cartes de la vue : seulement celles qui sont matérialisées, c'est-à-dire au
  // voisinage de l'écran. Tous ses lecteurs le supportaient déjà, parce qu'ils
  // gardaient tous une branche pour le nœud absent (`applyFocusDim` saute,
  // `positionAnimator` saute, `dragCluster` teste) — la seule chose qui change
  // est que cette branche est désormais le cas COURANT et non plus une
  // précaution. Ce qui doit voir TOUTE la vue lit `activeVisible()` ou les
  // positions, jamais cette table : c'est le cas de `stats()`, des arêtes et des
  // enveloppes.
  const nodeViews = new Map<NodeId, Container>();

  // Le contexte de la reconstruction courante, ou `null` tant qu'aucune n'a eu
  // lieu. C'est lui qui rend une carte matérialisée après coup identique à
  // celles que `rebuild()` a produites — voir `CardContext`.
  let cardContext: CardContext | null = null;

  // La transition de dépliage/repliage. La table est passée TELLE QUELLE et non
  // recopiée : `rebuild()` la vide et la re-remplit en place, et l'animateur doit
  // voir les containers du dernier rebuild.
  // Le ticker est passé en ACCESSEUR : `app.ticker` n'existe qu'après
  // `app.init()`, et cet animateur-ci est construit avec l'instance, avant.
  const positionAnimator = createPositionAnimator({ ticker: () => app.ticker, nodeViews });

  // L'état de recherche vit ENTIÈREMENT là-dedans (résultats + curseur) ; ce
  // fichier ne lui fournit que ses points de contact avec le reste de l'instance.
  // L'index, lui, reste ici : c'est le pipeline de données qui le produit.
  const searchController = createSearchController({
    getIndex: () => searchIndex,
    getActiveVisible: () => activeVisible(),
    redrawOverlay: () => redrawOverlay(),
    // `void` : `nextMatch()`/`prevMatch()` rendent leur résultat sans attendre
    // le cadrage, qui peut demander une cascade de dépliages.
    focus: (id) => void doFocus(id),
  });

  // L'état de la vue graphe vit ENTIÈREMENT là-dedans (index d'agrégats, mise en
  // page, moteur chargé à la demande, marge d'enveloppe) ; ce fichier ne lui
  // fournit que ses deux points de contact avec l'instance. `opGen`, les gardes
  // de génération et les politiques de repli restent ici : la course traverse
  // les deux vues, et le contrôleur sépare `compute` de `publish` précisément
  // pour qu'elles puissent s'intercaler entre les deux.
  const graphView = createGraphViewController({
    layoutOptions: options.graphLayoutOptions,
    // Accesseur et non valeur : `metrics` n'est mesurée qu'après `fontsReady`,
    // bien après la construction du contrôleur.
    getMetrics: () => metrics,
    // Construite à la création mais APPELÉE au premier besoin seulement : le
    // worker n'est ouvert que par la première mise en page de la vue graphe.
    spawnLayoutWorker: buildGraphLayoutWorkerSpawn(options.graphLayoutWorkerUrl),
  });

  const emitter = new Emitter<DataGraphEvents>();

  /** Recalcule la table type d'entité → couleur de rail. L'ordre vient des
   * clés de `config.ids` : déterministe et sous contrôle de l'auteur de
   * la config, contrairement à l'ordre d'apparition dans les données. */
  function refreshEntityAccents(config: DataGraphConfig): void {
    entityAccents = entityAccentMap(Object.keys(config.ids), theme);
  }

  function accentFor(node: GraphNode): string {
    if (node.kind !== "entity") return theme.edge.contain;
    return entityAccents.get(node.entityType) ?? theme.accent.entity;
  }

  /**
   * Met en page `target` pour la vue structure, avec le repli du moteur ELK :
   * `elkWorkerUrl` désigne un worker qui peut être injouable (chunk absent,
   * origine différente), et son échec ne doit pas condamner l'instance — on
   * rejoue alors la même mise en page sur un moteur en processus.
   *
   * Rend le couple (moteur, mise en page) sans rien publier : `ready` et
   * `doSetData` l'assignent eux-mêmes, chacun derrière ses propres gardes. Le
   * moteur fait partie du résultat parce que le repli le REMPLACE : publier la
   * mise en page sans lui laisserait les `expansionDeltas` des opérations
   * suivantes sur un moteur qui n'a pas produit ces positions.
   */
  async function layoutStructure(
    target: Graph,
    visible: Set<NodeId>,
  ): Promise<{ engine: StructureLayoutEngine; layout: LayoutResult }> {
    const primary = buildLayoutEngine(options.elkWorkerUrl);
    try {
      return { engine: primary, layout: await primary.layout(target, visible, metrics) };
    } catch (err) {
      console.warn("[data-graph] layout via elkWorkerUrl failed, falling back to in-process elk", err);
      const fallback = createStructureLayoutEngine();
      return { engine: fallback, layout: await fallback.layout(target, visible, metrics) };
    }
  }

  /**
   * La politique de la vue COURANTE, recalculée à chaque lecture.
   *
   * Aucun cache : `view` change sous `setView` et sous les replis de `ready` /
   * `doSetData`, et une politique gardée dans l'état serait un sixième membre
   * du quintuple à resynchroniser. L'objet est minuscule et lu une fois par
   * repeint, pas par carte.
   *
   * Les deux vues sont symétriques ici, mais l'asymétrie est dans les valeurs :
   * la vue graphe montre tout et ne plie rien, donc tout ce qui parle de pli y
   * est faux.
   */
  function viewPolicy(): ViewPolicy {
    if (view === "graph") {
      // Le LOD 2 est le régime SÉMANTIQUE : à cette échelle une carte n'est plus
      // qu'un rectangle plein, donc elle ne dit plus rien, et les 1 300 agrégats
      // nommés qui la remplacent disent l'architecture. Le seuil est celui de
      // `lodForScale` et pas un troisième réglage — voir la note en tête de la
      // section sémantique de `draw.ts`.
      const semantic = currentLod === 2;
      return {
        edgeMode: "ref",
        chevrons: false,
        foldable: false,
        tokenHover: false,
        expandedArrays: false,
        cards: semantic ? "unclustered" : "all",
        aggregates: semantic ? "disc" : "hull",
      };
    }
    return {
      edgeMode: "contain",
      chevrons: true,
      foldable: true,
      tokenHover: true,
      expandedArrays: true,
      cards: "all",
      aggregates: "none",
    };
  }

  /** Les positions de la vue courante. */
  function activePositions(): Map<NodeId, Rect> | undefined {
    return view === "graph" ? graphView.positions() : layoutResult?.positions;
  }

  /** Les nœuds visibles de la vue courante : TOUTES les entités en vue graphe,
   * qui ne plie rien, et les nœuds dépliés de l'arbre de containment en vue
   * structure. */
  function activeVisible(): Set<NodeId> {
    if (view === "graph") return graph ? graphView.entityIds(graph) : new Set();
    return collapseState?.visibleNodeIds() ?? new Set();
  }

  /**
   * Combien de CARTES la vue courante dessine. Les nœuds élidés en sont exclus :
   * ils sont visibles — leur ligne l'est — mais ils ne sont pas des cartes, et
   * `stats()` a toujours rapporté ce que l'utilisateur peut compter à l'écran.
   * Les inclure ferait grimper le compteur d'un cran par tableau sans qu'aucune
   * carte de plus n'apparaisse.
   */
  function drawnVisibleCount(): number {
    if (!graph) return 0;
    let count = 0;
    for (const id of activeVisible()) {
      if (!graph.nodes.get(id)?.elided) count++;
    }
    return count;
  }

  /** L'id du NŒUD sélectionné, ou `null` — y compris quand c'est un agrégat qui
   * est sélectionné. C'est par cette lucarne que passe tout ce qui ne connaît
   * que la sélection nodale : l'API publique, l'événement `"select"` et
   * `drawSelectionOverlay`. */
  function selectedNodeId(): NodeId | null {
    return selection?.kind === "node" ? selection.id : null;
  }

  /**
   * L'agrégat sélectionné. La résolution contre l'index courant — et le fait
   * qu'elle soit refaite à chaque lecture — appartient au contrôleur ; ce qui
   * reste ici est la seule chose qu'il ne connaît pas, la sélection.
   */
  function selectedAggregate(): Aggregate | undefined {
    if (selection?.kind !== "cluster") return undefined;
    return graphView.aggregateOf(selection.aggregateId);
  }

  /**
   * L'ensemble d'ids que `drawEdges` garde à pleine opacité.
   *
   * Pour une carte, c'est le SINGLETON de son id : le rendu est alors
   * exactement celui d'avant la sélection d'agrégat, arête par arête. Pour un
   * agrégat, ce sont ses MEMBRES, et pas l'ensemble plus large que les cartes
   * utilisent (`clusterRelatedIds`) : une arête est pleine dès qu'elle touche le
   * bloc, donc les internes et les traversantes le sont, tandis qu'une arête
   * entre deux voisins extérieurs recule — elle ne dit rien du bloc désigné.
   */
  function edgeFocusIds(): ReadonlySet<NodeId> | null {
    if (selection === null) return null;
    if (selection.kind === "node") return new Set([selection.id]);
    return selectedAggregate()?.memberIds ?? null;
  }

  /**
   * Les enveloppes à peindre : vide en vue structure.
   *
   * Tout ce qui se résout contre la mise en page et l'index appartient au
   * contrôleur ; ce qui reste ici est ce qu'il ne possède pas — la vue courante,
   * la sélection, le survol, et la palette du thème.
   */
  function clustersFor(): ClusterPaint[] {
    // La garde sur la mise en page tient chez le contrôleur, qui rend un tableau
    // vide tant que rien n'est publié : seule la vue courante se teste ici.
    if (view !== "graph" || !graph) return [];
    return graphView.clustersFor(clustersForArgs(graph));
  }

  /** Les agrégats prêts à peindre COMME NŒUDS. Même garde et mêmes arguments que
   * `clustersFor` : c'est le même objet, vu sous l'autre régime. */
  function semanticNodesFor(): SemanticNodePaint[] {
    if (view !== "graph" || !graph) return [];
    return graphView.semanticNodesFor(clustersForArgs(graph));
  }

  /** Ce que le contrôleur ne possède pas et que les deux régimes lui apportent
   * à l'identique : la palette du thème, la sélection et le survol. */
  function clustersForArgs(target: Graph): ClustersForArgs {
    return {
      graph: target,
      accentFor,
      fallbackColor: theme.edge.border,
      selectedAggregateId: selection?.kind === "cluster" ? selection.aggregateId : null,
      // Calculé UNE fois pour toutes les enveloppes : `focusKeep()` balaie toutes
      // les références du graphe, et le rappeler par enveloppe rendrait le repeint
      // quadratique alors qu'il tourne à chaque image d'un déplacement.
      keep: focusKeep(),
      hoverOf: (aggregateId) => clusterHover.get(aggregateId) ?? 0,
    };
  }

  function viewport(): Size {
    // `screen` et `width`/`height` sont actuellement d'accord sous
    // `autoDensity` (le view texture a son frame en pixels logiques). On lit
    // `screen` quand même : c'est l'API qui signifie explicitement "pixels
    // CSS", ce sur quoi travaille le `stage` — et donc celle qui reste
    // correcte si ce détail d'implémentation de Pixi change.
    const screen = app.renderer?.screen;
    return { width: screen?.width ?? 0, height: screen?.height ?? 0 };
  }

  /**
   * La transition de dépliage/repliage, avec la seule décision que
   * `positionAnimator` ne peut pas prendre : elle est INERTE en vue graphe.
   *
   * Et c'est essentiel : les deux jeux de rects passés ici viennent TOUJOURS de
   * la vue structure (`doExpand`/`doCollapse`), alors que `nodeViews` est alors
   * indexée par des entités posées aux coordonnées de la vue graphe. Ces ids
   * existent aussi dans les positions de la vue structure dès qu'elle a été
   * dépliée jusqu'à eux : sans cette garde, `expand()`/`collapse()`
   * téléporteraient les cartes vers le repère de l'autre vue, en laissant
   * enveloppes, arêtes et zones de clic là où elles sont — un état de rendu
   * incohérent jusqu'au prochain `rebuild()`.
   *
   * La garde reste ICI, et pas dans `animate.ts` : elle parle des VUES, que ce
   * fichier est seul à connaître. L'annulation, elle, a lieu dans les deux
   * branches — un dépliage demandé en vue graphe doit quand même couper une
   * transition encore en vol, exactement comme avant l'extraction.
   */
  function animatePositions(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
    if (view === "graph") {
      positionAnimator.cancel();
      return;
    }
    positionAnimator.animate(prevPositions, nextPositions);
  }

  function redrawOverlay(): void {
    overlayGraphics.destroy({ children: true });
    overlayGraphics = new Container();
    const positions = activePositions();
    if (graph && positions) {
      // La sélection NODALE seulement : un agrégat sélectionné se signale par
      // son enveloppe (voir `clustersFor`), pas par l'anneau d'une carte.
      // Même expression de mode que `redrawEdges` : le surlignage restyle
      // l'arête existante, il ne peut donc pas ignorer le style qu'elle a.
      overlayGraphics.addChild(
        drawSelectionOverlay(
          graph,
          positions,
          theme,
          selectedNodeId(),
          viewPolicy().edgeMode,
        ),
      );
      // Les deux lectures de l'état de recherche passent par le contrôleur, qui
      // en est le seul propriétaire : les ids visibles à surligner, et celui du
      // résultat courant, peint plus fort que les autres.
      overlayGraphics.addChild(
        drawSearchHighlights(
          positions,
          theme,
          searchController.visibleMatchIds(),
          searchController.currentMatchId(),
        ),
      );
    }
    world.addChild(overlayGraphics);
  }

  /**
   * L'ensemble des cartes à garder à pleine opacité, ou `null` s'il n'y a rien à
   * estomper. Une propriété du GRAPHE et pas de la mise en page, donc identique
   * dans les deux vues.
   *
   * Deux unités de sélection, deux règles, toutes deux déléguées à `focus.ts`
   * (pur, testable) : autour d'une carte, son voisinage à distance 1 ; autour
   * d'un agrégat, ses membres plus tout ce qui leur parle.
   */
  function focusKeep(): Set<NodeId> | null {
    const aggregate = selectedAggregate();
    if (aggregate) return clusterRelatedIds(graph?.refEdges ?? [], aggregate.memberIds);
    const id = selectedNodeId();
    const focused = id !== null ? graph?.nodes.get(id) : undefined;
    return relatedIds(
      graph?.refEdges ?? [],
      // L'id du NŒUD retrouvé, et pas celui de la sélection : une sélection qui
      // ne désigne plus rien dans le graphe courant n'a pas de voisinage, donc
      // pas d'estompage — plutôt que d'estomper tout sauf un fantôme. Même
      // raison pour l'agrégat ci-dessus, résolu contre l'index courant.
      focused?.id ?? null,
      focused?.parentId ?? null,
      focused?.childIds ?? [],
    );
  }

  /**
   * Estompe chaque carte sans lien avec la sélection, et rend les autres.
   *
   * Un `AlphaFilter` PARTAGÉ et non `container.alpha` : voir `dimFilters()`,
   * qui porte le pourquoi — une carte est peinte en couches, et l'alpha de
   * container s'applique couche par couche, ce qui la réduisait à un pavé de sa
   * couleur d'accent. Le filtre aplatit d'abord, estompe ensuite.
   *
   * Sans sélection, `focusKeep()` renvoie `null` et tout se retrouve sans
   * filtre — c'est aussi le chemin de la désélection, qui n'a donc rien de
   * particulier à restaurer. Le test `filters?.length` évite de poser un
   * `FilterEffect` sur les cartes qui n'en ont jamais eu, c'est-à-dire sur
   * toutes, au repos.
   *
   * Rien à faire pour garder les cartes estompées cliquables : le hit-testing
   * de Pixi est géométrique et ignore l'opacité, filtre compris.
   */
  function applyFocusDim(): void {
    const keep = focusKeep();
    for (const [id, nodeView] of nodeViews) {
      if (nodeView.destroyed) continue;
      if (keep !== null && !keep.has(id)) nodeView.filters = dimFilters();
      else if (nodeView.filters?.length) nodeView.filters = null;
    }
  }

  // Les calques du fond sont repeints d'un bloc à chaque `rebuild()`, mais
  // AUSSI, pour les enveloppes et les arêtes, à chaque image d'un déplacement :
  // ils sont donc extraits ici plutôt que recopiés. Chacun se détruit avant de
  // se reconstruire — `destroy()` détache du parent, d'où le `addChildAt` qui
  // suit, qui réinsère à la profondeur voulue. Les index sont ceux de
  // l'`addChild` initial du monde, et n'ont de sens qu'avec lui sous les yeux.
  function redrawClusters(): void {
    clustersGraphics.destroy();
    const policy = viewPolicy();
    clustersGraphics =
      policy.aggregates === "disc"
        ? drawSemanticDiscs(semanticNodesFor(), theme)
        : drawClusters(clustersFor(), theme);
    // Index 1 : les arêtes agrégées occupent le fond (0).
    world.addChildAt(clustersGraphics, 1);
  }

  /**
   * Les deux calques du régime sémantique qui NE dépendent pas du survol : les
   * arêtes agrégées et les libellés des disques.
   *
   * Séparés de `redrawClusters` par leur RYTHME et non par leur nature : celui-ci
   * est rappelé à chaque image d'un survol d'agrégat et à chaque image d'un
   * déplacement, ceux-ci seulement à une reconstruction ou à un changement de
   * sélection. Les fondre reviendrait à refaire 1 300 textes et quelques
   * milliers de segments soixante fois par seconde pour un rendu identique.
   *
   * Les deux sont vidés hors du régime sémantique, et pas seulement sautés : ce
   * sont eux qui resteraient peints sous les cartes après un zoom.
   */
  function redrawSemanticLayers(): void {
    redrawSemanticEdges();
    for (const child of semanticLabelLayer.removeChildren()) child.destroy({ children: true });
    if (viewPolicy().aggregates !== "disc") return;
    semanticLabelLayer.addChild(
      drawSemanticLabels(semanticNodesFor(), theme, useBitmapText, metrics),
    );
  }

  /**
   * Les seules arêtes agrégées, sans les libellés.
   *
   * Séparées parce qu'un déplacement d'agrégat les périme à chaque image — le
   * disque saisi bouge, donc tous ses traits changent de bout — alors que son
   * libellé se contente de suivre en bloc, ce que `dragCluster` fait en
   * translatant le sous-conteneur étiqueté à son nom. Refaire 1 300 textes par
   * image du geste pour le même rendu serait le seul vrai coût du régime.
   */
  function redrawSemanticEdges(): void {
    for (const child of semanticEdgeLayer.removeChildren()) child.destroy({ children: true });
    if (viewPolicy().aggregates !== "disc") return;
    semanticEdgeLayer.addChild(
      drawSemanticEdges(
        graphView.semanticEdges(selection?.kind === "cluster" ? selection.aggregateId : null),
        theme,
        semanticEdgeUnit(),
      ),
    );
  }

  /**
   * Le rayon de disque de RÉFÉRENCE dont les épaisseurs d'arêtes agrégées sont
   * des fractions : la MÉDIANE des rayons peints.
   *
   * Une grandeur tirée de la mise en page et non de la caméra, et c'est ce qui
   * évite de retracer les arêtes à chaque cran de zoom : les disques grandissent
   * avec la vue, donc des traits exprimés en fraction de leur rayon gardent
   * d'eux-mêmes leur épaisseur RELATIVE. La médiane plutôt que la moyenne parce
   * que la distribution des tailles d'agrégats est très dissymétrique — un seul
   * bloc géant tirerait la moyenne et rendrait tous les traits énormes.
   */
  function semanticEdgeUnit(): number {
    // Lu sur les FORMES du moteur et non sur les nœuds peints : résoudre
    // libellés, couleurs et estompage pour n'en garder que les rayons ferait
    // payer un balayage des références à chaque image d'un déplacement.
    const radii = graphView.clusters().map((cluster) => cluster.r).filter((r) => r > 0);
    if (radii.length === 0) return 0;
    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)]!;
  }

  function redrawEdges(): void {
    const positions = activePositions();
    if (!graph || !positions) return;
    edgesGraphics.destroy();
    // Index 4 : le fond est occupé par les arêtes agrégées (0), le visuel des
    // agrégats (1), les libellés sémantiques (2) puis les cibles de saisie des
    // agrégats (3).
    // `drawEdges` estompe les arêtes qui ne touchent aucun id de l'ensemble, et
    // `null` (rien de sélectionné) rend le tracé nu. Au LOD 2 — donc au régime
    // sémantique — elle rend un Graphics vide : les références y sont montrées
    // repliées sur les agrégats, par `redrawSemanticLayers`.
    edgesGraphics = drawEdges(
      graph,
      positions,
      theme,
      currentLod,
      viewPolicy().edgeMode,
      edgeFocusIds(),
      metrics,
    );
    world.addChildAt(edgesGraphics, 4);

    // AU-DESSUS des cartes, comme le surlignage de sélection : une étiquette
    // posée sous les cartes disparaissait dès qu'une voisine chevauchait son
    // bout de trait (constaté sur la démo), or c'est précisément l'information
    // que la sélection est censée révéler. L'occlusion inverse — l'étiquette
    // sur une carte — reste rare (elle vit au tiers du lien, entre les cartes)
    // et transitoire : elle part avec la sélection.
    edgeLabelsView?.destroy({ children: true });
    edgeLabelsView = null;
    edgeLabels = [];
    // Rien au LOD 2, comme les arêtes : le texte n'y est ni lisible ni
    // rentable, et il n'y a plus de trait à annoter.
    if (currentLod !== 2) {
      // `selectedNodeId()` : une sélection d'AGRÉGAT rend `null` par cette
      // lucarne, et n'étiquette donc rien — c'est voulu, l'agrégat ne désigne
      // aucun champ d'où une référence partirait.
      edgeLabels = edgeLabelPlacements(graph, positions, selectedNodeId());
      edgeLabelsView = drawEdgeLabels(edgeLabels, theme, useBitmapText, metrics);
      world.addChild(edgeLabelsView);
      // Reposées TOUT DE SUITE, et pas seulement au prochain passage du ticker :
      // sinon la première image montre les étiquettes à leur fraction de repos,
      // même quand la caméra est déjà zoomée sur la cible — un saut visible à
      // chaque sélection.
      repositionEdgeLabels();
    }
  }

  /**
   * La marge, en pixels ÉCRAN, entre une étiquette qui a glissé et le bord du
   * cadre. Assez large pour que la pilule entière tienne dedans avec de l'air,
   * et convertie en monde à l'usage : c'est une distance perçue, elle ne doit
   * pas se dilater avec le zoom.
   */
  const EDGE_LABEL_VIEW_MARGIN = 48;

  /**
   * Fait glisser chaque étiquette le long de SON trait pour qu'elle reste dans
   * le cadre — comme le nom d'une route sur une carte. Sans ça, zoomer sur la
   * cible d'une référence montre un trait qui arrive sans dire lequel.
   *
   * Ne recrée aucun objet : seuls les sous-conteneurs se déplacent. Recréer un
   * `Text` par image de pan serait le vrai coût de cette fonctionnalité.
   */
  function repositionEdgeLabels(): void {
    if (!camera || !edgeLabelsView || edgeLabels.length === 0) return;
    const worldView = camera.worldViewport(viewport());
    const margin = EDGE_LABEL_VIEW_MARGIN / camera.scale();
    for (let i = 0; i < edgeLabels.length; i++) {
      const placement = edgeLabels[i]!;
      const item = edgeLabelsView.children[i];
      if (!item) continue;
      const t = labelParamInView(placement.start, placement.end, placement.fraction, worldView, margin);
      const at = edgeLabelPosition(placement.start, placement.end, t);
      item.position.set(at.x, at.y);
    }
  }

  /**
   * Les cibles de saisie des enveloppes. Vide hors vue graphe, qui est la seule
   * à en avoir.
   *
   * Contrairement au visuel des enveloppes, ce calque n'est PAS refait pendant
   * un déplacement : les containers de saisie sont déplacés (par
   * `dragCluster`), pas reconstruits — autrement le geste détruirait le
   * container qui le porte à sa première image.
   */
  function redrawClusterHitAreas(): void {
    // Les intensités de survol sont stockées hors des containers, mais elles en
    // DÉPENDENT : ce sont eux qui les alimentent, et ceux qu'on détruit juste
    // en dessous n'émettront jamais le `pointerout` qui aurait rendu leur
    // enveloppe au repos. Sans cette remise à zéro, une enveloppe survolée au
    // moment d'un rebuild — ou au relâchement d'un drag de carte, qui repasse
    // ici — resterait allumée pour toujours. Le repeint n'a lieu que si quelque
    // chose était effectivement allumé : le cas courant ne paie rien.
    if (clusterHover.size > 0) {
      clusterHover.clear();
      redrawClusters();
    }
    for (const child of clusterHitLayer.removeChildren()) child.destroy();
    // `clusters()` rend un tableau vide tant que rien n'est publié : la boucle
    // ne tourne alors pas, et seule la vue courante reste à tester ici.
    if (view !== "graph") return;
    for (const { cluster, container } of drawClusterHitAreas(graphView.clusters())) {
      const aggregate = graphView.aggregateOf(cluster.aggregateId);
      // Une enveloppe sans agrégat n'a pas de membres à emporter : la peindre
      // reste juste, la rendre saisissable ne le serait pas. Le cas ne se
      // produit pas aujourd'hui (le moteur ne publie d'enveloppe que pour un
      // agrégat), d'où la destruction du container plutôt qu'une garde plus
      // haut.
      if (!aggregate) {
        container.destroy();
        continue;
      }
      attachDrag(container, {
        scale: () => camera?.scale() ?? 1,
        onStart: beginDrag,
        onMove: (dx, dy) =>
          dragCluster(cluster.aggregateId, cluster, aggregate.memberIds, container, dx, dy),
        // Pas de rafraîchissement des cibles de saisie au relâchement :
        // `dragCluster` a déjà tenu celle-ci à jour, et la refaire ici
        // détruirait le container depuis son propre écouteur.
        onEnd: () => endDrag(false),
      });
      // Même complémentarité que sur les cartes, avec le même seuil :
      // `attachTap` ne réagit qu'en deçà, `attachDrag` qu'au-delà. Un clic net
      // sélectionne l'agrégat, un clic maintenu qui bouge le déplace.
      //
      // Conséquence assumée : un tap DANS une enveloppe mais hors de toute carte
      // tombait déjà sur cette cible-ci et n'y trouvait rien à faire ; il
      // sélectionne désormais l'agrégat, ce qui est la seule chose qu'il puisse
      // vouloir dire.
      attachTap(container, () => doSelectCluster(cluster.aggregateId));
      // `attachTap` vient de poser `"pointer"` : on rend la main ouverte, qui
      // dit le geste dominant du disque (voir `drawClusterHitAreas`). L'ordre
      // compte — la reposer avant `attachTap` ne servirait à rien.
      container.cursor = "grab";
      // Le survol est posé sur la CIBLE DE SAISIE et non sur le visuel : ce
      // container-ci survit aux repeints de l'enveloppe, qui est justement la
      // raison de son existence. Des écouteurs sur le Graphics mourraient à la
      // première image du survol qu'ils viennent de démarrer.
      //
      // Pas de `cancel()` au début d'un drag d'agrégat, à la différence des
      // cartes : rien n'est ici déformé par le survol (il ne change que des
      // couleurs), le pointeur est toujours dessus pendant le geste, et
      // l'éteindre dirait faussement qu'on a lâché.
      attachHover(container, {
        ticker: app.ticker,
        isBlocked: () => contentDragging,
        onFrame: (t) => {
          clusterHover.set(cluster.aggregateId, t);
          redrawClusters();
        },
      });
      clusterHitLayer.addChild(container);
    }
  }

  /**
   * La fenêtre monde pour laquelle les zones de clic d'arêtes ont été
   * construites, et le LOD sous lequel elles l'ont été. `null` = rien de
   * construit. Voir `redrawEdgeHitAreas` et `syncEdgeHitAreas`.
   */
  let edgeHitWindow: Rect | null = null;
  let edgeHitLod: Lod | null = null;

  /** Les zones de clic des arêtes. Volontairement ABSENTES de la boucle de
   * déplacement d'une carte : ce sont des polygones épais, un par arête, et les
   * refaire à chaque image coûterait cher pour une cible qu'on ne peut de toute
   * façon pas viser tant qu'un bouton est enfoncé. Elles sont donc remises à
   * jour au relâchement.
   *
   * CE CALQUE EST LE PLUS CHER DE LA SCÈNE, et de loin. Mesuré sur 6 251 cartes
   * et 28 685 références : le retirer fait passer une image au repos en vue
   * graphe de ~1 850 ms à ~480 ms, là où retirer le TRACÉ des arêtes (un unique
   * Graphics) ne change rien. La raison est le nombre d'objets — un Graphics
   * interactif PAR arête, chacun un lot de rendu et un candidat au hit-test —
   * et non la géométrie. D'où les deux restrictions ci-dessous, qui ne changent
   * rien à ce qu'on voit puisque ce calque est invisible :
   *
   *  1. RIEN AU LOD 2. `drawEdges` n'y trace aucune arête (draw.ts) : les cibles
   *     y viseraient des traits qui n'existent pas, et personne ne peut pointer
   *     ce qu'il ne voit pas.
   *  2. Seulement les arêtes dont le segment peut traverser la fenêtre élargie.
   *     Une cible hors écran n'est pas atteignable. `syncEdgeHitAreas` refait le
   *     calque quand la caméra sort de la fenêtre pour laquelle il a été bâti.
   */
  function redrawEdgeHitAreas(): void {
    for (const child of edgeHitLayer.removeChildren()) child.destroy();
    edgeHitWindow = null;
    edgeHitLod = currentLod;
    const positions = activePositions();
    if (!graph || !positions) return;
    if (currentLod === 2) return;
    const built = camera ? inflateRect(camera.worldViewport(viewport()), PREFETCH_MARGIN) : null;
    for (const hit of drawEdgeHitAreas(graph, positions, built)) {
      attachTap(hit.graphics, () => followRef(hit.edge));
      edgeHitLayer.addChild(hit.graphics);
    }
    edgeHitWindow = built;
  }

  /**
   * Refait les zones de clic d'arêtes quand la caméra a quitté la fenêtre pour
   * laquelle elles ont été bâties.
   *
   * Le déclencheur est un CONTENANT et non une distance : tant que la fenêtre à
   * peindre reste incluse dans celle du dernier calque, toute arête atteignable
   * a déjà sa cible, et il n'y a rien à refaire. Comme la fenêtre bâtie est un
   * écran plus large de chaque côté, il faut déplacer la caméra de près d'un
   * écran pour payer une reconstruction — le pan courant n'en paie aucune.
   */
  function syncEdgeHitAreas(paint: Rect | null): void {
    // Changement de LOD : les cibles du LOD précédent ne visent plus les mêmes
    // traits (et au LOD 2, plus aucun).
    if (edgeHitLod !== currentLod) {
      redrawEdgeHitAreas();
      return;
    }
    // Au LOD 2 il n'y a rien à tenir à jour, et un calque bâti SANS caméra les
    // contient déjà toutes.
    if (currentLod === 2 || edgeHitWindow === null) return;
    if (paint !== null && rectContains(edgeHitWindow, paint)) return;
    redrawEdgeHitAreas();
  }

  /** Les deux bouts communs à tout déplacement, carte ou agrégat. */
  function beginDrag(): void {
    contentDragging = true;
    // Une transition de dépliage encore en vol repositionnerait les cartes à
    // chaque image, en concurrence avec le pointeur : le geste de
    // l'utilisateur a le dernier mot.
    positionAnimator.cancel();
  }

  /** `refreshClusterHits` : à passer quand le geste a pu DÉFORMER une
   * enveloppe, c'est-à-dire après un déplacement de carte, qui en recalcule le
   * cercle. Un déplacement d'agrégat, lui, translate sa cible de saisie au fil
   * du geste et ne doit surtout pas la reconstruire depuis son propre
   * écouteur. */
  function endDrag(refreshClusterHits: boolean): void {
    contentDragging = false;
    redrawEdgeHitAreas();
    if (refreshClusterHits && view === "graph") redrawClusterHitAreas();
  }

  /**
   * Une image d'un déplacement d'agrégat : le disque et toutes ses cartes
   * suivent le pointeur d'un bloc, sans se déformer.
   *
   * La cible de saisie est déplacée avec eux plutôt que refaite : c'est elle
   * qui porte les écouteurs du geste en cours, et la reconstruire le tuerait
   * net. Même absence de persistance que pour une carte — le prochain re-layout
   * écrase ces coordonnées.
   */
  function dragCluster(
    aggregateId: string,
    cluster: { cx: number; cy: number; r: number },
    memberIds: Set<NodeId>,
    hit: Container,
    dxWorld: number,
    dyWorld: number,
  ): void {
    const positions = activePositions();
    if (!positions) return;
    translateCluster(cluster, memberIds, positions, dxWorld, dyWorld);
    for (const memberId of memberIds) {
      const rect = positions.get(memberId);
      const nodeView = nodeViews.get(memberId);
      if (rect && nodeView) nodeView.position.set(rect.x, rect.y);
    }
    hit.position.set(cluster.cx, cluster.cy);
    redrawClusters();
    // Au régime sémantique, le libellé du disque saisi SUIT en bloc plutôt que
    // d'être refait : le geste est RIGIDE, donc le texte n'a ni à être retronqué
    // ni à changer d'échelle — exactement le raisonnement qui fait translater
    // l'enveloppe au lieu de la recalculer. Les arêtes agrégées, elles, changent
    // toutes de bout et doivent bien être retracées. Les deux sont sans effet
    // hors régime sémantique, où les calques sont vides.
    // `children[0]` : le calque permanent ne contient qu'un enfant, le conteneur
    // que rend `drawSemanticLabels`, dont les enfants directs sont les groupes
    // étiquetés. Chercher depuis le calque lui-même ne trouverait rien — la
    // recherche par étiquette de Pixi ne descend pas d'un cran par défaut.
    const labelGroup = semanticLabelLayer.children[0]?.getChildByLabel(aggregateId);
    if (labelGroup) labelGroup.position.set(labelGroup.x + dxWorld, labelGroup.y + dyWorld);
    redrawSemanticEdges();
    redrawEdges();
    redrawOverlay();
  }

  /**
   * Une image d'un déplacement de carte à la souris : la position de la carte
   * dans la mise en page courante suit le pointeur, et tout ce qui en dépend
   * est repeint.
   *
   * Les positions sont mutées EN PLACE dans la mise en page courante — celle de
   * `layoutResult` ou celle du contrôleur de vue graphe —, sans aucune
   * persistance : le prochain re-layout (déplier, replier,
   * `setData`, bascule de vue) reprend la main et écrase ces coordonnées. C'est
   * un choix, pas un oubli — un déplacement est ici un geste de lecture (« ôte
   * cette carte de mon chemin »), pas une édition de la mise en page.
   *
   * `rebuild()` n'est PAS appelé : il détruirait et recréerait toutes les
   * cartes, donc le container que `attachDrag` tient sous le curseur. Seuls les
   * calques dépendant de la position sont repeints.
   */
  function dragCard(id: NodeId, nodeView: Container, dxWorld: number, dyWorld: number): void {
    const positions = activePositions();
    const rect = positions?.get(id);
    if (!positions || !rect) return;
    rect.x += dxWorld;
    rect.y += dyWorld;
    nodeView.position.set(rect.x, rect.y);
    redrawEdges();
    // En vue graphe, la carte déplacée emporte l'enveloppe de son agrégat : une
    // enveloppe qui ne suivrait pas laisserait la carte flotter dehors, ce qui
    // dirait le contraire de ce que la vue affirme. Une carte hors agrégat n'a
    // pas d'enveloppe — le contrôleur n'en trouve simplement aucune.
    if (view === "graph") {
      const owner = graphView.memberIdsContaining(id);
      if (owner) {
        recomputeClusterCircle(owner.cluster, owner.memberIds, positions, graphView.hullPadding());
        redrawClusters();
      }
    }
    redrawOverlay();
  }

  function rebuild(): void {
    const positions = activePositions();
    if (!graph || !positions) return;
    // Any in-flight position animation is about to have its containers
    // destroyed below — cancel it first so its next tick can't run against
    // stale/destroyed Containers.
    positionAnimator.cancel();
    // Même raisonnement pour un déplacement en cours, de carte ou d'agrégat :
    // les containers qui portent ses écouteurs vont être détruits, donc son
    // `onEnd` ne viendra jamais. Sans cette remise à zéro, un zoom molette
    // pendant un drag (le ticker reconstruit au changement de LOD) laisserait
    // le pan de la caméra inhibé pour le reste de la session.
    contentDragging = false;
    currentLod = lodForScale(camera ? camera.scale() : 1);

    for (const child of nodesLayer.removeChildren()) child.destroy({ children: true });
    nodeViews.clear();

    // Les atlas doivent exister avant que `drawNode` n'en dérive les noms.
    if (useBitmapText) fontLease.sync(theme);

    redrawClusters();
    redrawSemanticLayers();
    redrawClusterHitAreas();
    redrawEdges();
    redrawEdgeHitAreas();

    // Les champs porteurs d'une référence sortante, indexés UNE fois par
    // rebuild : `drawNode` en a besoin carte par carte, et re-parcourir
    // `refEdges` pour chacune rendrait le rebuild quadratique. Les deux index
    // sont remplis dans la MÊME boucle, chaque champ allant dans l'un ou dans
    // l'autre selon que son arête résout : c'est la même information lue une
    // fois, pas deux parcours à tenir d'accord.
    const refFieldsByNode = new Map<NodeId, Set<string>>();
    const danglingFieldsByNode = new Map<NodeId, Set<string>>();
    for (const edge of graph.refEdges) {
      const index = edge.dangling ? danglingFieldsByNode : refFieldsByNode;
      let fields = index.get(edge.from);
      if (!fields) {
        fields = new Set();
        index.set(edge.from, fields);
      }
      fields.add(edge.field);
    }

    const visible = activeVisible();
    // Lue UNE fois pour toute la reconstruction : `view` ne peut pas changer
    // pendant la boucle (aucun `await` dedans), et toutes les cartes doivent de
    // toute façon être dessinées sous la même politique.
    const policy = viewPolicy();

    // Les tableaux dépliés, pour orienter le chevron de chaque jeton. Construit
    // une fois par reconstruction : interroger `collapseState` ligne par ligne
    // referait le même travail une fois par jeton dessiné.
    const expandedArrays = new Set<NodeId>();
    for (const id of visible) {
      const arrayNode = graph.nodes.get(id);
      if (arrayNode?.elided && (collapseState?.isExpanded(id) ?? false)) expandedArrays.add(id);
    }

    // Le domaine de la matérialisation, filtré ici une fois pour toutes.
    // Un nœud ÉLIDÉ n'a pas de carte : il est déjà dessiné, en ligne, par la
    // carte de son parent. Le test est explicite plutôt que laissé à l'absence
    // de rect — celle-ci signifierait « pas encore mis en page », un tout autre
    // cas.
    //
    // Au régime SÉMANTIQUE, une entité qu'un agrégat revendique n'a plus de
    // carte du tout : son disque la dit déjà, et la dessiner par-dessus ferait
    // l'état mixte que ce régime existe pour supprimer. Le filtre est ici et
    // nulle part ailleurs — `syncCards` comme `ensureCard` ne balaient que cet
    // ensemble, donc aucun chemin de matérialisation ne peut le contourner. Les
    // entités HORS agrégat, elles, gardent leur rectangle plein : elles ne sont
    // représentées par rien d'autre.
    const drawable = new Set<NodeId>();
    for (const id of visible) {
      const node = graph.nodes.get(id);
      if (!node || node.elided) continue;
      if (!positions.has(id)) continue;
      if (policy.cards === "unclustered" && graphView.aggregateIdOf(id) !== undefined) continue;
      drawable.add(id);
    }

    cardContext = { policy, refFieldsByNode, danglingFieldsByNode, expandedArrays, drawable };

    // Et c'est tout : les cartes ne sont plus fabriquées d'un bloc ici, mais par
    // la passe de matérialisation, qui n'en crée que le voisinage de l'écran.
    // Elle est appelée de façon SYNCHRONE — sa fenêtre `PAINT` n'est pas
    // budgétée —, donc la première image d'après ce rebuild montre exactement ce
    // qu'elle montrait quand la boucle vivait ici.
    syncCards();

    redrawRemainderTokens();
    redrawOverlay();
    // `applyFocusDim()` n'a plus lieu d'être ici : chaque carte reçoit son
    // filtre à sa création (`createCard`), ce qui est la seule façon de tenir
    // l'estompage pour une carte matérialisée plus tard. La fonction reste,
    // pour les changements de sélection, qui doivent bien repasser sur les
    // cartes DÉJÀ dessinées.
  }

  /**
   * Repeint le calque des jetons de reliquat : un jeton par bloc d'enfants-cartes
   * non révélés, à la place que ces cartes occuperaient dans la colonne.
   *
   * La position est ARITHMÉTIQUE et non issue d'ELK, et c'est le cœur du
   * dispositif : un jeton mis en page serait une boîte de plus dans le calcul,
   * or il existe précisément pour que les 47 300 cartes qu'il remplace n'y
   * entrent pas. Il se raccroche donc à une carte voisine déjà posée — celle
   * d'avant si le bloc précédent est là (le jeton prolonge la colonne), sinon
   * celle d'après (le jeton la précède).
   *
   * Le jeton emprunte la LARGEUR de cette voisine : sa taille dit « ici, des
   * cartes comme celles-là », ce qu'une largeur propre ne dirait pas.
   *
   * Les jetons ne suivent délibérément PAS une carte déplacée à la main : ils
   * sont posés depuis les positions du dernier `rebuild()` et attendent le
   * suivant, un déplacement étant un geste local qui ne change ni les pages
   * révélées ni la colonne où le bloc caché s'insérera.
   */
  function redrawRemainderTokens(): void {
    for (const child of remainderLayer.removeChildren()) child.destroy({ children: true });
    // La pagination est un fait de la vue STRUCTURE : la vue graphe ne plie ni
    // ne révèle rien, et y poser des jetons annoncerait un geste sans effet.
    // Même politique que les chevrons, lue au même endroit.
    const g = graph;
    if (!g || !collapseState || !viewPolicy().foldable) return;
    const positions = activePositions();
    if (!positions) return;

    for (const id of collapseState.visibleNodeIds()) {
      // `hiddenGaps` ne regarde QUE les pages : il rapporte les mêmes trous pour
      // un nœud REPLIÉ, dont pourtant aucun enfant n'est à l'écran. Le pli se
      // teste donc ici, et il n'a pas d'autre site où se tester : un jeton posé
      // sous une carte repliée pendrait dans le vide, à côté d'une colonne
      // d'enfants qui n'existe pas.
      if (!collapseState.isExpanded(id)) continue;
      const gaps = collapseState.hiddenGaps(id);
      if (gaps.length === 0) continue;
      const node = g.nodes.get(id);
      if (!node) continue;
      // Les enfants-CARTES, dans l'ordre de `childIds` : c'est l'indexation dont
      // parlent les trous. Les élidés sont des lignes de la carte de `id`, donc
      // les compter décalerait tous les indices d'un jeton à l'autre.
      const cards = node.childIds.filter((childId) => g.nodes.get(childId)?.elided === false);

      for (const gap of gaps) {
        let anchor: Rect | undefined;
        let below = true;
        for (let i = gap.fromIndex - 1; i >= 0 && !anchor; i--) anchor = positions.get(cards[i]!);
        if (!anchor) {
          below = false;
          for (let i = gap.fromIndex + gap.count; i < cards.length && !anchor; i++) {
            anchor = positions.get(cards[i]!);
          }
        }
        // Aucune carte posée de part et d'autre du trou. Ne devrait pas arriver
        // pour un nœud déplié et visible — il a au moins une page révélée — mais
        // dessiner sans ancre reviendrait à inventer une position.
        if (!anchor) continue;

        const token = drawRemainderToken({
          count: gap.count,
          width: anchor.width,
          theme,
          metrics,
          useBitmapText,
        });
        token.position.set(
          anchor.x,
          below
            ? anchor.y + anchor.height + REMAINDER_TOKEN_GAP
            : anchor.y - REMAINDER_TOKEN_HEIGHT - REMAINDER_TOKEN_GAP,
        );
        // `attachTap` et non un `pointertap` nu : il pose bien `eventMode` et le
        // curseur, mais il ajoute surtout le seuil que partage `attachDrag` —
        // sans lui, un pan de la caméra commencé sur un jeton révélerait une page
        // au relâchement, alors que le geste demandé était un déplacement.
        attachTap(token, () => void doReveal(id, gap.nextPage));
        remainderLayer.addChild(token);
      }
    }
  }

  /**
   * Fabrique la carte de `id` et la câble : clic, survol, souligné de référence,
   * déplacement, estompage.
   *
   * Extrait de la boucle de `rebuild()` sans rien changer à ce qu'elle
   * produisait, parce qu'une carte n'est plus créée à un seul moment : elle
   * l'est aussi au fil de la caméra et à la demande d'un `select`/`focus`. Tout
   * ce qui distinguerait ces trois chemins serait un écart visible à l'écran,
   * d'où le `CardContext` — il porte exactement ce que la reconstruction avait
   * calculé une fois pour toutes.
   *
   * `keep` est l'ensemble de mise au point du MOMENT (voir `focusKeep`) : la
   * carte naît estompée si la sélection courante l'exclut, au lieu de naître à
   * pleine opacité et d'attendre un repeint qui n'aurait aucune raison de venir.
   */
  function createCard(
    id: NodeId,
    rect: Rect,
    ctx: CardContext,
    keep: ReadonlySet<NodeId> | null,
  ): void {
    const node = graph?.nodes.get(id);
    if (!node) return;
    const { policy, refFieldsByNode, danglingFieldsByNode, expandedArrays } = ctx;
    // Les enfants élidés sont exclus du chevron (`cardChildCount`) : ils ne
    // sont pas ce qu'il révèle. Sans pli, tout est déplié d'office — on ne
    // lit même pas `collapseState`, qui décrit alors une autre vue.
    const hasChevron = policy.chevrons && node.cardChildCount > 0;
    const expanded = policy.foldable ? (collapseState?.isExpanded(id) ?? false) : true;
    const nodeView = drawNode(
      node,
      rect,
      theme,
      currentLod,
      useBitmapText,
      accentFor(node),
      metrics,
      expanded,
      hasChevron,
      // `undefined` pour un nœud sans référence sortante : `drawNode` retombe
      // alors sur son ensemble vide partagé plutôt que d'en allouer un par
      // carte.
      refFieldsByNode.get(id),
      danglingFieldsByNode.get(id),
      // `null` là où la vue ne plie rien : les jetons y restent lisibles mais
      // inertes, comme le chevron d'en-tête.
      policy.expandedArrays ? expandedArrays : null,
    );
    nodeView.position.set(rect.x, rect.y);
    attachTap(nodeView, (event) => handleNodeTap(node, nodeView, event));

    // Le jeton d'une ligne-tableau répond au pointeur POUR LUI-MÊME : c'est un
    // objet de la scène, pas une bande calculée, donc `attachHover` s'y applique
    // directement — même mécanique et même courbe que le lift des cartes, sans
    // repasser par l'arithmétique de lignes de `rowIndexAt`.
    //
    // C'est le survol, et non le clic, qui porte l'affordance de pli, et c'est
    // une contrainte réelle et non un choix esthétique : un clic déclenche un
    // `rebuild()` qui reconstruit les vues de cartes, donc toute animation
    // démarrée au clic serait détruite avant d'être vue. Le survol, lui, se joue
    // entièrement sur la carte existante.
    const tokenHovers: HoverHandle[] = [];
    if (currentLod === 0 && policy.tokenHover) {
      node.rows.forEach((row, index) => {
        if (row.valueType !== "array") return;
        const token = nodeView.getChildByLabel(`array-token:${index}`);
        if (!token) return;
        const accent = token.getChildByLabel("hover");
        tokenHovers.push(
          attachHover(token, {
            ticker: app.ticker,
            isBlocked: () => contentDragging,
            onFrame: (t) => {
              token.x = TOKEN_HOVER_SHIFT * t;
              if (accent) {
                // La visibilité suit l'alpha : un Graphics à alpha nul reste
                // dans la passe de rendu, et le garder caché tant qu'il ne
                // peint rien évite ce coût sur toutes les cartes au repos.
                accent.visible = t > 0;
                accent.alpha = t;
              }
            },
          }),
        );
      });
    }

    // Le souligné d'une valeur référençante, révélé au survol de SA ligne :
    // l'affordance de lien hypertexte, que la seule teinte ne donne pas — une
    // couleur dit « ceci est particulier », un souligné qui suit le pointeur
    // dit « ceci répond au clic ». `drawNode` a préparé un Graphics caché par
    // ligne concernée ; tout ce qui reste ici est une visibilité à basculer.
    const refFields = refFieldsByNode.get(id);
    const danglingFields = danglingFieldsByNode.get(id);
    let underlined: number | null = null;
    // L'index courant est MÉMORISÉ : `pointermove` arrive à chaque pixel, et
    // une recherche par label à chaque événement parcourrait tous les enfants
    // de la carte pour, presque toujours, retrouver la même ligne. On ne
    // touche au graphe d'affichage que sur un vrai changement de ligne.
    const underline = (index: number | null): void => {
      if (index === underlined) return;
      if (underlined !== null) {
        const previous = nodeView.getChildByLabel(`ref-underline:${underlined}`);
        if (previous) previous.visible = false;
      }
      if (index !== null) {
        const next = nodeView.getChildByLabel(`ref-underline:${index}`);
        if (next) next.visible = true;
      }
      underlined = index;
    };
    // Rien à câbler sur une carte sans référence sortante, ni hors du LOD 0 où
    // aucune ligne n'est rendue : `underline` y reste un no-op, ce qui laisse
    // le `onStart` du déplacement ci-dessous inconditionnel.
    if (refFields && currentLod === 0) {
      nodeView.on("pointermove", (event: FederatedPointerEvent) => {
        // Pendant un déplacement, le pointeur ne DÉSIGNE plus une ligne, il
        // tient la carte : souligner sous lui promettrait un clic que le
        // geste en cours ne fera pas.
        if (contentDragging) {
          underline(null);
          return;
        }
        const index = rowIndexAt(nodeView, node, event);
        const row = index === null ? undefined : node.rows[index];
        // Une référence CASSÉE est exclue explicitement, alors même que
        // `drawNode` ne lui a préparé aucun Graphics : sans ce filtre, la
        // ligne serait mémorisée comme « soulignée » et le prochain
        // changement de ligne irait éteindre un souligné qui n'existe pas.
        const underlinable =
          row !== undefined && refFields.has(row.key) && !(danglingFields?.has(row.key) ?? false);
        underline(underlinable ? index : null);
      });
      nodeView.on("pointerout", () => underline(null));
    }
    // Le « lift » du survol : la carte grossit de `HOVER_LIFT` AUTOUR DE SON
    // CENTRE. Pixi met l'origine d'un container en haut à gauche, donc une
    // simple échelle la ferait pousser vers le bas-droite ; la position est
    // décalée d'une demi-croissance pour compenser. Ce décalage reste LOCAL à
    // ce rappel : le rect de la mise en page, lui, garde la convention
    // top-left que suivent `dragCard`, `dragCluster` et `animatePositions`.
    //
    // Le rect est RELU à chaque image plutôt que capturé : un déplacement le
    // mute en place, et une copie figée ramènerait la carte à son point de
    // départ au premier survol d'après le geste.
    const hover = attachHover(nodeView, {
      ticker: app.ticker,
      // Pendant un déplacement, la carte saisie doit rester exactement sous
      // le pointeur : la grossir la ferait décrocher de lui.
      isBlocked: () => contentDragging,
      onFrame: (t) => {
        const live = activePositions()?.get(id);
        if (!live) return;
        const scale = 1 + HOVER_LIFT * t;
        nodeView.scale.set(scale);
        nodeView.position.set(
          live.x - ((scale - 1) * live.width) / 2,
          live.y - ((scale - 1) * live.height) / 2,
        );
      },
    });
    // Les deux câblages sont complémentaires et non concurrents : ils
    // partagent le même seuil, `attachTap` ne réagit qu'en deçà et
    // `attachDrag` qu'au-delà (voir `drag.ts`). Un clic sélectionne, plie ou
    // suit une référence ; un clic maintenu qui bouge déplace la carte.
    attachDrag(nodeView, {
      scale: () => camera?.scale() ?? 1,
      onStart: () => {
        // Le survol est annulé AVANT que le geste ne prenne la main : il
        // laisserait sinon la carte à une échelle et à un décalage que
        // `dragCard` ne connaît pas, et la carte suivrait le pointeur avec un
        // biais d'une demi-croissance pour tout le reste du geste.
        // `isBlocked` ne suffit pas — il empêche un survol de COMMENCER, pas
        // celui qui est déjà là de rester peint.
        hover.cancel();
        // Même raison, et même moment, pour le souligné et pour les jetons :
        // un autre geste prend la main, et l'affordance d'un clic qui n'aura
        // pas lieu doit disparaître AVEC lui, pas au prochain `pointermove`.
        // Un jeton laissé décalé de 2 px suivrait la carte tout le geste.
        underline(null);
        for (const tokenHover of tokenHovers) tokenHover.cancel();
        beginDrag();
      },
      onMove: (dx, dy) => dragCard(id, nodeView, dx, dy),
      // `true` : déplacer une carte a rebattu le cercle de son agrégat, donc
      // la zone de saisie de celui-ci est périmée. La refaire ici est sans
      // danger — elle ne touche pas au container de la carte, qui porte le
      // geste en train de se terminer.
      onEnd: () => endDrag(true),
    });
    // L'estompage est posé À LA CRÉATION : une carte qui naît hors de la
    // boucle d'un rebuild n'a aucun repeint global derrière elle pour le lui
    // donner. `keep === null` veut dire « rien de sélectionné », donc rien à
    // estomper — c'est aussi l'état de repos, où aucune carte ne porte de
    // filtre.
    if (keep !== null && !keep.has(id)) nodeView.filters = dimFilters();
    nodesLayer.addChild(nodeView);
    nodeViews.set(id, nodeView);
  }

  /**
   * Met le calque des cartes d'accord avec la fenêtre courante : fabrique celles
   * qui sont entrées, recycle celles qui sont sorties LARGEMENT.
   *
   * C'est la seconde moitié du culling, et la raison pour laquelle le
   * `container.cullable` que pose `drawNode` ne suffisait pas — deux raisons,
   * en fait. Il ne parle que du RENDU, alors que le coût qui faisait mal était
   * la CRÉATION : 6 251 cartes fabriquées à chaque franchissement de seuil de
   * LOD, dont quelques dizaines seulement à l'écran. Et il est de toute façon
   * INERTE tant que `CullerPlugin` n'est pas installé sur l'application, ce
   * qu'aucun site de ce paquet ne fait — le drapeau n'a jamais rien coupé.
   *
   * Appelée à chaque image. Le balayage est un test de rectangles par carte de
   * la vue, soit quelques dizaines de microsecondes pour 6 000 nœuds : moins
   * cher qu'un index spatial à tenir à jour sous un `dragCard` qui mute les
   * positions en place. Elle tourne INCONDITIONNELLEMENT et non pas seulement
   * quand la caméra a bougé, parce que les cartes bougent aussi sans elle — un
   * déplacement d'agrégat en fait entrer et sortir du cadre.
   */
  function syncCards(): void {
    const ctx = cardContext;
    const positions = activePositions();
    if (!ctx || !positions) return;
    // Une transition de dépliage est en vol : ses containers sont à des
    // positions INTERMÉDIAIRES, qui ne disent rien de leur point d'arrivée.
    // Décider d'après elles ferait disparaître une carte en plein vol. 200 ms
    // plus tard, le passage suivant remet tout d'accord.
    if (positionAnimator.isRunning()) return;

    // Sans caméra (avant l'init, ou après `destroy`), aucune fenêtre n'a de
    // sens : on retombe sur le comportement d'origine, tout est matérialisé.
    const windows = cardWindowsFor(camera ? camera.worldViewport(viewport()) : null);
    const deadline = performance.now() + PREFETCH_BUDGET_MS;
    // La carte sélectionnée n'est JAMAIS recyclée : l'anneau et le panneau de
    // détail de l'hôte la désignent, et la voir disparaître en s'éloignant
    // serait un mensonge sur ce qui est sélectionné.
    const selected = selectedNodeId();

    // Les cibles de clic des arêtes suivent la même fenêtre, mais avec leur
    // propre rythme : elles ne sont refaites que lorsque la caméra sort de
    // celle qui a servi à les bâtir (voir là-bas).
    syncEdgeHitAreas(windows.paint);

    // `focusKeep()` balaie toutes les références du graphe : calculé au plus une
    // fois par passage, et seulement si une carte est effectivement créée.
    let keep: ReadonlySet<NodeId> | null | undefined;

    for (const id of ctx.drawable) {
      const rect = positions.get(id);
      if (!rect) continue;
      const nodeView = nodeViews.get(id);
      const materialized = nodeView !== undefined;
      const fate = cardFate(rect, windows, {
        materialized,
        // Rien n'est recyclé pendant un déplacement : le container saisi porte
        // les écouteurs du geste en cours, et son `onEnd` ne viendrait jamais.
        // Il est de toute façon sous le pointeur, donc dans `paint` — mais la
        // garde ne coûte rien et ne dépend d'aucun raisonnement géométrique.
        pinned: contentDragging || id === selected,
        // L'horloge n'est lue que quand elle peut servir : une carte déjà
        // matérialisée ne consomme aucun budget, et `performance.now()` coûte
        // plus cher que le test de rectangle qui la précède.
        budgetLeft: materialized ? false : performance.now() < deadline,
      });
      if (fate === "create") {
        if (keep === undefined) keep = focusKeep();
        createCard(id, rect, ctx, keep);
      } else if (fate === "reclaim" && nodeView) {
        nodeViews.delete(id);
        nodeView.destroy({ children: true });
      }
    }
  }

  /**
   * Matérialise séance tenante la carte de `id`, où qu'elle soit.
   *
   * C'est l'échappatoire des chemins qui DÉSIGNENT une carte sans passer par le
   * pointeur — `select()`, `focus()`, la recherche, le suivi de référence. Ils
   * peuvent viser une carte hors de la fenêtre, et la caméra qui saute dessus
   * doit la trouver dessinée à l'arrivée.
   *
   * Sans effet sur un id déjà matérialisé, hors de la vue courante, ou non
   * positionné.
   */
  function ensureCard(id: NodeId): void {
    const ctx = cardContext;
    if (!ctx || nodeViews.has(id) || !ctx.drawable.has(id)) return;
    const rect = activePositions()?.get(id);
    if (!rect) return;
    createCard(id, rect, ctx, focusKeep());
  }

  /**
   * Remet les cartes d'accord avec la caméra : une reconstruction COMPLÈTE si le
   * LOD a changé — toutes les cartes changent alors de forme —, une simple mise
   * à jour de la fenêtre sinon.
   *
   * Le seul endroit qui décide entre les deux. L'avoir en un point unique est ce
   * qui garantit qu'un mouvement de caméra ne produit jamais plus d'UNE
   * reconstruction : le ticker, `fit()` et `doFocus` y passent tous.
   */
  function refreshCards(): void {
    if (!camera) return;
    if (lodForScale(camera.scale()) !== currentLod) rebuild();
    else syncCards();
  }

  function doFit(): void {
    const positions = activePositions();
    if (!camera || !positions) return;
    const bounds = boundsOf(positions);
    // Les enveloppes débordent des cartes : les inclure, sans quoi le cadrage
    // les rognerait. Le contrôleur ne fait rien tant que rien n'est publié, ce
    // que la garde sur la mise en page disait avant.
    if (view === "graph") graphView.extendBoundsToClusters(bounds);
    camera.fitTo(bounds, viewport());
  }

  /**
   * L'index de la ligne sous le pointeur, ou `null` si le pointeur n'est sur
   * aucune : hors du LOD 0 (seul LOD qui rende des lignes), dans l'en-tête, ou
   * dans le padding bas — où le clic tombe sous la dernière ligne.
   *
   * Partagé par le clic et par le survol, et c'est le partage lui-même qui est
   * l'intérêt : deux copies de cette arithmétique dériveraient au premier
   * changement de métrique, et la carte soulignerait alors une ligne pendant
   * que le clic en suivrait une autre — le pire des deux défauts, puisque
   * l'affordance mentirait sur ce que le geste va faire.
   */
  function rowIndexAt(
    nodeView: Container,
    node: GraphNode,
    event: FederatedPointerEvent,
  ): number | null {
    if (currentLod !== 0) return null;
    const local = nodeView.toLocal(event.global);
    if (local.y < metrics.headerHeight) return null;
    const index = Math.floor((local.y - metrics.headerHeight) / metrics.rowHeight);
    return index < node.rows.length ? index : null;
  }

  /** Header click on a node with children toggles expand/collapse; a header
   * click on a childless node, or a body click that isn't a ref-field row,
   * selects the node; a click on a row backed by an outgoing ref edge
   * follows that reference. Only meaningful at LOD 0 (the only LOD that
   * renders a header/rows distinction) — anywhere else, tapping the node
   * just selects it.
   *
   * En vue graphe, aucun clic d'en-tête ne plie quoi que ce soit : tout y est
   * toujours visible, donc l'en-tête sélectionne comme le corps. Le reste
   * (lignes, références) est identique. */
  function handleNodeTap(node: GraphNode, nodeView: Container, event: FederatedPointerEvent): void {
    if (!graph) return;
    if (currentLod === 0) {
      const policy = viewPolicy();
      const local = nodeView.toLocal(event.global);
      if (local.y < metrics.headerHeight) {
        if (policy.foldable && node.cardChildCount > 0) {
          toggleExpand(node.id);
          return;
        }
      } else {
        const rowIndex = rowIndexAt(nodeView, node, event);
        const row = rowIndex === null ? undefined : node.rows[rowIndex];
        if (row) {
          // Le jeton d'une ligne-tableau plie le nœud qu'il représente, jamais
          // celui qui le porte. Aucune collision possible avec le suivi de
          // référence : une ligne référençante est scalaire par construction.
          // Là où la vue ne plie rien, le clic retombe sur la sélection, comme
          // le fait déjà l'en-tête.
          if (row.valueType === "array" && policy.foldable) {
            toggleExpand(row.arrayId);
            return;
          }
          const edge = graph.refEdges.find((e) => e.from === node.id && e.field === row.key);
          if (edge) {
            followRef(edge);
            return;
          }
        }
      }
    }
    doSelect(node.id);
  }

  function toggleExpand(id: NodeId): void {
    if (!collapseState) return;
    if (collapseState.isExpanded(id)) doCollapse(id);
    else void doExpand(id);
  }

  async function doExpand(id: NodeId): Promise<void> {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!graph.nodes.has(id) || collapseState.isExpanded(id)) return;
    const gen = ++opGen;
    collapseState.expand(id);
    const visible = collapseState.visibleNodeIds();
    const prevPositions = new Map(layoutResult.positions);
    const next = await engine.layoutAfterExpand(layoutResult, graph, id, visible, metrics);
    // A concurrent doCollapse/doExpand/doFocus ran while we were awaiting
    // (bumping opGen) and already applied its own layoutResult — applying
    // this stale one now would silently revert that operation. Bail.
    if (destroyed || gen !== opGen) {
      // ...mais en ANNULANT d'abord la mutation faite plus haut, comme le font
      // déjà `toggleAggregate` et `doFocus`. Sans ce retour arrière,
      // `collapseState` reste en avance sur `layoutResult` : il déclare
      // `id` déplié, donc ses enfants visibles, alors qu'aucun d'eux n'a de
      // position dans le `layoutResult` publié. Ils ne sont jamais dessinés,
      // et ce `layoutResult` à moitié fusionné corrompt l'opération suivante
      // en lui servant de `prev`.
      //
      // `opGen` est PARTAGÉ avec la vue graphe : `setView` l'incrémente
      // aussi. Une bascule de vue peut donc court-circuiter un `expand()` en
      // vol — et le symétrique est immédiat, un `collapse()` appelé par
      // l'hôte (sans effet visible en vue graphe, par contrat) incrémentant
      // `opGen` de façon synchrone. La course ne demande plus deux opérations
      // de la vue structure : elle traverse les vues, et le dégât ne se voit
      // qu'au retour en vue structure.
      collapseState.collapse(id);
      return;
    }
    layoutResult = next;
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  /**
   * Révèle une page d'enfants-cartes de `parentId` : le geste du jeton de
   * reliquat.
   *
   * Frère de `doExpand`, et distinct de lui pour une raison de MISE EN PAGE et
   * non d'état : déplier ouvre un sous-arbre À CÔTÉ de son ancre, révéler
   * insère un bloc DANS une colonne déjà posée et pousse ce qui est dessous.
   * D'où `layoutAfterReveal`, et d'où le fait qu'un jeton n'est pas un chevron.
   */
  async function doReveal(parentId: NodeId, page: number): Promise<void> {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!graph.nodes.has(parentId) || collapseState.revealedPages(parentId).has(page)) return;
    const gen = ++opGen;
    collapseState.revealPage(parentId, page);
    const visible = collapseState.visibleNodeIds();
    const prevPositions = new Map(layoutResult.positions);
    const next = await engine.layoutAfterReveal(layoutResult, graph, parentId, visible, metrics);
    if (destroyed || gen !== opGen) {
      // Même retour arrière que `doExpand`, et pour la même raison :
      // `collapseState` ne doit jamais devancer `layoutResult`, sans quoi il
      // déclare visibles des cartes qu'aucune position ne porte.
      //
      // APPROXIMATION ASSUMÉE : le moteur, lui, a déjà accumulé le décalage de
      // ce bloc dans sa mémoire privée (`expansionDeltas`), et rien ici ne le
      // lui retire — cette page révélée puis jetée y laisse donc une trace, et
      // les prochaines poses sous `parentId` seront décalées d'autant. C'est
      // toléré : la course est rare (il faut une seconde opération pendant
      // l'aller-retour du layout) et le prochain `tidy()` ou la prochaine mise
      // en page globale répare. Ce n'est pas un oubli.
      collapseState.unrevealPage(parentId, page);
      return;
    }
    layoutResult = next;
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  function doCollapse(id: NodeId): void {
    if (!graph || !collapseState || !layoutResult || !engine) return;
    if (!collapseState.isExpanded(id)) return;
    // Synchronous, but still bumps the generation counter so any in-flight
    // async doExpand/doFocus awaiting a layout notices it's been superseded.
    //
    // Pas de retour arrière à prévoir ici, contrairement à `doExpand` :
    // `layoutAfterCollapse` est synchrone, donc il n'existe aucun `await`
    // entre la mutation de `collapseState` et la publication de
    // `layoutResult`. Les deux ne peuvent pas se désynchroniser, et aucune
    // opération concurrente ne peut s'intercaler entre elles.
    ++opGen;
    collapseState.collapse(id);
    const visible = collapseState.visibleNodeIds();
    const prevPositions = new Map(layoutResult.positions);
    layoutResult = engine.layoutAfterCollapse(layoutResult, graph, id, visible);
    rebuild();
    animatePositions(prevPositions, layoutResult.positions);
  }

  /** Tout ce qu'un changement de sélection repeint. Les enveloppes n'en font
   * partie qu'en vue graphe, la seule qui en ait : ailleurs `clustersFor()`
   * rend un tableau vide et le repeint serait un détour sans effet.
   *
   * `rebuild()` ne passe PAS par ici et ne finit que sur `redrawOverlay()` +
   * `applyFocusDim()` : il vient déjà de repeindre enveloppes et arêtes (avec
   * leurs zones de saisie, que cette fonction-ci ne touche pas) au milieu de sa
   * propre passe. Les fusionner rejouerait ces deux repeints à chaque
   * reconstruction. */
  function redrawSelection(): void {
    if (view === "graph") {
      redrawClusters();
      // Les arêtes agrégées et les libellés portent eux aussi l'estompage : sans
      // ce passage, sélectionner un agrégat allumerait son disque en laissant
      // ses voisins à pleine intensité. Sans effet hors régime sémantique, où
      // les deux calques sont vides.
      redrawSemanticLayers();
    }
    redrawOverlay();
    // Les arêtes portent la moitié de l'estompage : elles sont repeintes avec
    // la nouvelle sélection, les cartes reçoivent leur filtre.
    redrawEdges();
    applyFocusDim();
  }

  function doSelect(id: NodeId): void {
    if (!graph) return;
    const node = graph.nodes.get(id);
    if (!node) return;
    // Remplace une éventuelle sélection d'agrégat : les deux s'excluent, ce que
    // le type porte déjà.
    selection = { kind: "node", id };
    // La sélection peut viser une carte hors fenêtre (API publique, recherche,
    // suivi de référence) : on la matérialise AVANT de repeindre, sinon
    // `applyFocusDim` ne trouverait rien à ne pas estomper et la carte
    // sélectionnée resterait absente jusqu'à ce que la caméra la rejoigne.
    // `syncCards` la garde ensuite en vie tant qu'elle est sélectionnée.
    ensureCard(id);
    redrawSelection();
    emitter.emit("select", node);
  }

  /**
   * Sélectionne un AGRÉGAT entier : son enveloppe s'allume et tout ce qui ne lui
   * parle pas s'estompe.
   *
   * Aucun événement public, à la différence de `doSelect`. `"select"` porte un
   * `GraphNode` et un agrégat n'en est pas un ; en émettre un sur sa racine
   * mentirait à l'hôte sur ce qui a été désigné, et inventer un événement
   * d'agrégat agrandirait l'API pour un geste dont personne n'a encore demandé
   * la notification.
   *
   * Un agrégat inconnu de l'index courant n'est pas sélectionnable : la garde
   * évite d'installer une sélection que tous les lecteurs traiteraient ensuite
   * comme absente.
   */
  function doSelectCluster(aggregateId: string): void {
    if (view !== "graph" || !graphView.aggregateOf(aggregateId)) return;
    selection = { kind: "cluster", aggregateId };
    redrawSelection();
  }

  /**
   * Vide la sélection et défait tout ce qu'elle avait posé : l'anneau et les
   * références surlignées de l'overlay, l'estompage des cartes, celui des
   * arêtes, l'enveloppe allumée.
   *
   * Aucun événement public : la sélection est un état que l'hôte lit par
   * `"select"`, et inventer un `"deselect"` ici agrandirait l'API pour un geste
   * qui ne fait que revenir au repos. Sans sélection, il n'y a rien à défaire —
   * d'où le retour immédiat, qui évite plusieurs repeints par touche Échap tapée
   * dans le vide.
   */
  function doDeselect(): void {
    if (selection === null) return;
    selection = null;
    redrawSelection();
  }

  /** Always emits "followRef" (even for a dangling edge, so a host can show
   * feedback), but only selects+focuses the target when `edge.to` resolves —
   * a dangling edge never navigates anywhere. */
  function followRef(edge: RefEdge): void {
    emitter.emit("followRef", edge);
    if (edge.to !== null) {
      doSelect(edge.to);
      void doFocus(edge.to);
    }
  }

  async function doFocus(id: NodeId): Promise<void> {
    if (!graph || !camera) return;
    if (!graph.nodes.has(id)) return;

    // La vue graphe n'a pas d'arbre à déplier : elle n'a que des entités, et
    // elles y sont toutes visibles — aucun chemin d'ancêtres à ouvrir.
    // On centre donc sur la carte si elle est là, et rien d'autre — surtout pas
    // la cascade d'expansion ci-dessous, qui mettrait l'état de la vue
    // structure au travail sans rien montrer.
    if (view === "graph") {
      const rect = graphView.positions()?.get(id);
      if (rect) {
        camera.centerOn(rect, viewport(), 1);
        // La caméra vient de sauter : les cartes doivent la suivre TOUT DE
        // SUITE, sans attendre le prochain passage du ticker. `refreshCards`
        // d'abord (le saut fixe l'échelle à 1, ce qui peut changer le LOD et
        // donc tout reconstruire), `ensureCard` ensuite — dans cet ordre, sinon
        // la reconstruction jetterait la carte qu'on vient de garantir.
        refreshCards();
        ensureCard(id);
      }
      return;
    }

    if (!collapseState || !layoutResult || !engine) return;

    if (!collapseState.visibleNodeIds().has(id)) {
      // Collect the steps WITHOUT mutating collapseState yet (unlike
      // expandPathTo, which mutates the whole path upfront) — mutation must
      // happen one step at a time, in lockstep with the layout that actually
      // gets applied for it. Otherwise an abort mid-cascade (gen mismatch)
      // leaves collapseState reporting nodes as expanded/visible that have no
      // entry in layoutResult.positions: they silently never render, and that
      // partially-merged layoutResult goes on to corrupt the next operation as
      // its `prev`.
      //
      // Depuis la pagination, la cascade ouvre les PAGES autant que les
      // ancêtres : déplier un parent ne suffit plus à rendre la cible visible
      // si elle vit sur une page non révélée. On parcourt donc la chaîne
      // COMPLÈTE des parents (pas seulement les repliés), et on ne révèle que
      // la page de l'enfant du chemin — jamais tout le préfixe, sinon
      // atteindre le 47 312ᵉ enfant paierait 47 313 cartes.
      const steps: FocusStep[] = [];
      let childOnPath: NodeId = id;
      let node = graph.nodes.get(id);
      let parentId = node?.parentId ?? null;
      while (parentId !== null) {
        // `reverse()` renverse AUSSI l'ordre intra-niveau : pour exécuter
        // expand AVANT reveal à chaque niveau (révéler une page d'un nœud
        // encore replié ne montre rien), on pousse reveal d'abord ici.
        //
        // Un enfant du chemin ÉLIDÉ (`cardIndexOf` < 0) est une ligne de la
        // carte de son parent : il n'a pas de page à révéler.
        const cardIndex = collapseState.cardIndexOf(parentId, childOnPath);
        if (cardIndex >= 0 && !collapseState.revealedPages(parentId).has(pageOf(cardIndex))) {
          steps.push({ kind: "reveal", parentId, page: pageOf(cardIndex) });
        }
        if (!collapseState.isExpanded(parentId)) steps.push({ kind: "expand", id: parentId });
        childOnPath = parentId;
        node = graph.nodes.get(parentId);
        parentId = node?.parentId ?? null;
      }
      steps.reverse(); // root-first, et expand avant reveal à chaque niveau

      const gen = ++opGen;
      for (const step of steps) {
        if (destroyed || gen !== opGen) return;
        if (step.kind === "expand") collapseState.expand(step.id);
        else collapseState.revealPage(step.parentId, step.page);
        const prev = layoutResult;
        const visible = collapseState.visibleNodeIds();
        // Annotation explicite : sans elle, `layoutResult = next` plus bas rend
        // l'inférence de `next` circulaire (elle dépendrait du type de
        // `layoutResult`, qui dépendrait d'elle) et TS abandonne le
        // rétrécissement `LayoutResult | undefined` → `LayoutResult`.
        const next: LayoutResult =
          step.kind === "expand"
            ? await engine.layoutAfterExpand(prev, graph, step.id, visible, metrics)
            : await engine.layoutAfterReveal(prev, graph, step.parentId, visible, metrics);
        if (destroyed) return;
        if (gen !== opGen) {
          // Superseded mid-cascade: revert ONLY this not-yet-applied step so
          // collapseState never gets ahead of layoutResult by more than one
          // in-flight step.
          //
          // Sur une étape de révélation, le moteur garde le décalage déjà
          // accumulé pour ce bloc : même approximation assumée que
          // `doReveal`, dont le commentaire porte le raisonnement complet.
          if (step.kind === "expand") collapseState.collapse(step.id);
          else collapseState.unrevealPage(step.parentId, step.page);
          return;
        }
        layoutResult = next;
      }
      rebuild();
    }

    // `anchorRectFor` et non `positions.get` : un hôte peut appeler
    // `focus()` sur un tableau, qui n'a pas de carte. Centrer sur la bande de sa
    // ligne amène bien son jeton à l'écran ; `positions.get` seul rendrait
    // `undefined` et l'appel ne ferait rien du tout, sans le dire.
    const rect = anchorRectFor(graph, layoutResult.positions, id, metrics);
    if (rect) {
      camera.centerOn(rect, viewport(), 1);
      // Même discipline qu'en vue graphe, et pour la même raison : la carte
      // visée doit être dessinée quand la caméra arrive dessus. `ensureCard` est
      // sans effet sur un nœud sans carte (un tableau, que `anchorRectFor`
      // sait pourtant cadrer par la bande de sa ligne).
      refreshCards();
      ensureCard(id);
    }
  }

  /** Le fond cliquable, glissé sous le monde. La `hitArea` est
   * `app.renderer.screen`, que Pixi mute EN PLACE à chaque redimensionnement :
   * la zone suit donc le canvas sans qu'on ait à la rafraîchir. Le container
   * reste à l'origine du stage, hors du monde, donc ses coordonnées locales
   * sont déjà celles de l'écran, quel que soit le zoom. */
  function attachBackgroundDeselect(): void {
    // Index 0 : sous le monde, donc consulté en dernier par le hit-testing, qui
    // parcourt les enfants du plus haut au plus bas.
    app.stage.addChildAt(createBackgroundHit(app.renderer.screen, doDeselect), 0);
  }

  /**
   * Échap désélectionne. L'écouteur est posé sur `window` et non sur le canvas :
   * la toile n'a pas le focus clavier (elle n'est pas focusable), donc un
   * écouteur local ne verrait jamais la touche.
   *
   * Posé de façon SYNCHRONE, à la création, et retiré par `destroy()` : le
   * poser dans l'initialisation asynchrone laisserait un `destroy()` appelé
   * pendant celle-ci enregistrer l'écouteur APRÈS son propre retrait, et fuir
   * pour le reste de la session. La garde `destroyed` couvre le reste.
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (destroyed) return;
    if (event.key !== "Escape") return;
    doDeselect();
  };
  window.addEventListener("keydown", handleKeyDown);

  const ready = (async () => {
    await app.init({
      background: theme.surface.canvas,
      resizeTo: container,
      antialias: true,
      // Sans ces deux options, le canvas est rendu en 1x puis étiré par le CSS
      // sur tout écran à forte densité — la cause principale du flou.
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    });
    if (destroyed) {
      // destroy() may have run while app.init() was still in flight — at
      // that point app.renderer didn't exist yet, so destroy()'s own
      // `if (app.renderer) app.destroy(...)` guard skipped it, leaving this
      // now-initialized Application (and its renderer/canvas) never torn
      // down. Finish the job here instead of silently leaking it.
      app.destroy(true, { children: true });
      return;
    }

    // `setTheme` a pu tourner pendant que `app.init()` était en vol : à ce
    // moment `app.renderer` n'existait pas encore, donc son assignation de
    // fond a été sautée (elle est gardée par `if (app.renderer)`). Ré-appliquer
    // ici honore un thème installé pendant l'init.
    app.renderer.background.color = theme.surface.canvas;

    // Pixi v8's BitmapText only rasterizes reliably on WebGL/WebGPU; its
    // software "canvas" fallback renderer (used when neither is available)
    // leaves BitmapText blank, so use plain Text there (see draw.ts).
    useBitmapText = app.renderer.name !== "canvas";

    container.appendChild(app.canvas);
    app.stage.addChild(world);
    attachBackgroundDeselect();
    // Le pan de la toile, le déplacement d'une carte et celui d'une enveloppe
    // partent du même bouton : seul CE QU'ON PRESSE les départage, et la caméra
    // n'a aucun moyen de le savoir depuis ses écouteurs natifs. C'est donc le
    // renderer qui le lui dit, par ce prédicat relu à chaque mouvement.
    camera = new Camera(world, app.canvas, { isBlocked: () => contentDragging });

    currentConfig = options.config;
    graph = buildGraph(options.data, currentConfig);
    // Les avances ne sont mesurées qu'une fois. Mesurer avant que la police web
    // soit prête figerait celles de la pile de repli pour toute la session, et
    // les largeurs de cartes varieraient d'un chargement à l'autre. Le timeout
    // borne l'attente : un service de polices lent ne doit pas bloquer le rendu.
    await fontsReady(theme, 1500);
    if (destroyed) return;
    metrics = measureFontMetrics(theme, DEFAULT_METRICS);
    refreshEntityAccents(currentConfig);
    // Publiés AVANT l'attente de la mise en page, et non au retour comme dans
    // `doSetData` : `search()` et les gardes de `doExpand`/`doCollapse` lisent
    // ces deux-là sans passer par `ready`, et les retarder d'une mise en page
    // ELK entière changerait ce qu'elles répondent. C'est cette différence de
    // discipline de publication — au fil de l'eau ici, en un seul geste après
    // la garde de génération là-bas — qui garde les deux sites distincts.
    collapseState = new CollapseState(graph);
    searchIndex = buildSearchIndex(graph);

    const structure = await layoutStructure(graph, collapseState.visibleNodeIds());
    engine = structure.engine;
    layoutResult = structure.layout;
    if (destroyed) return;

    // La vue structure est toujours mise en page, même si l'hôte démarre en vue
    // graphe : c'est elle qui sert de repli et elle est déjà payée ici. La vue
    // graphe, elle, ne se construit que si on la demande — et son échec ne doit
    // pas rejeter `ready`, ce qui condamnerait toutes les méthodes qui
    // l'attendent. On retombe sur la vue structure, comme le repli ELK
    // ci-dessus retombe sur un moteur en processus.
    if (view === "graph") {
      const state = await graphView.tryCompute(
        graph,
        currentConfig,
        true,
        "the graph view failed to build, falling back to the structure view",
      );
      if (state) {
        if (destroyed) return;
        graphView.publish(state);
      } else {
        view = "structure";
      }
      if (destroyed) return;
    }

    // CADRER AVANT DE CONSTRUIRE, et c'est l'ordre qui compte : `doFit` ne lit
    // que les positions de la mise en page, jamais la scène, alors que
    // `rebuild()` lit l'échelle de la caméra pour choisir son LOD. Construire
    // d'abord dessinait donc toutes les cartes au LOD de l'échelle SORTANTE
    // (1, donc LOD 0 : texte complet), puis le cadrage changeait l'échelle et le
    // ticker constatait le changement de LOD et reconstruisait tout — la
    // première passe entièrement jetée. Le même renversement est appliqué à
    // `doSetData` et à `setView`.
    doFit();
    rebuild();
    // Force one immediate, synchronous frame so the first paint is
    // deterministic instead of waiting on the ticker's next scheduled tick.
    app.render();

    // La transformation caméra vue au dernier passage. La caméra n'émet aucun
    // événement (ses gestes sont des écouteurs DOM natifs), donc c'est le
    // ticker qui constate le mouvement — et il ne travaille que s'il y a
    // quelque chose à reposer.
    let lastCameraScale = Number.NaN;
    let lastCameraX = Number.NaN;
    let lastCameraY = Number.NaN;

    app.ticker.add(() => {
      if (destroyed || !camera) return;
      // Reconstruit au changement de LOD, matérialise/recycle sinon. C'est ici
      // que le culling suit la caméra, image par image.
      refreshCards();

      // Aucune étiquette : aucun coût au repos, qui est l'état le plus fréquent
      // (rien de sélectionné, ou sélection sans référence sortante).
      if (!edgeLabelsView || edgeLabels.length === 0) return;
      const scale = camera.scale();
      if (scale === lastCameraScale && world.x === lastCameraX && world.y === lastCameraY) return;
      lastCameraScale = scale;
      lastCameraX = world.x;
      lastCameraY = world.y;
      repositionEdgeLabels();
    });
  })();

  /** Re-runs the full pipeline (buildGraph → CollapseState → SearchIndex →
   * initial layout → rebuild → fit) against new `data`, reusing
   * `currentConfig` when `configOverride` is omitted. Search/selection state
   * is reset. Uses a fresh StructureLayoutEngine (rather than reusing
   * `engine`) so the new graph never inherits the old one's `expansionDeltas`,
   * which is keyed by NodeId (a JSON pointer) and could otherwise collide
   * with an unrelated node at the same path in the new dataset.
   *
   * Awaits `ready` first so a setData() called before initial init has
   * finished (camera/app not yet available) queues behind it instead of
   * being a silent no-op; guarded by the same opGen/destroyed machinery as
   * every other mutating operation so a concurrent setData/expand/collapse/
   * focus started after this one wins. */
  async function doSetData(data: unknown, configOverride?: DataGraphConfig): Promise<void> {
    // Fail fast, same as createDataGraph: validate a newly-passed config
    // before touching any state (including `await ready` and `opGen`) so an
    // invalid config rejects immediately instead of after a wasted
    // build/layout pass. validateConfig is idempotent — buildGraph below
    // calls it again on the same config.
    if (configOverride) validateConfig(configOverride);

    await ready;
    if (destroyed) return;
    const gen = ++opGen;

    const config = configOverride ?? currentConfig;
    const newGraph = buildGraph(data, config);
    const newCollapseState = new CollapseState(newGraph);
    const newSearchIndex = buildSearchIndex(newGraph);

    const structure = await layoutStructure(newGraph, newCollapseState.visibleNodeIds());

    // La vue graphe se recalcule sur le NOUVEAU graphe, avant publication et
    // sans réutiliser l'index en place, qui décrit l'ancien. Un échec ici ne
    // doit pas rejeter `setData` en laissant l'instance à moitié remplacée : on
    // retombe sur la vue structure, dont la mise en page est déjà prête.
    let newGraphView: GraphViewState | null = null;
    let graphViewFailed = false;
    if (view === "graph") {
      newGraphView = await graphView.tryCompute(
        newGraph,
        config,
        false,
        "the graph view failed to rebuild, falling back to the structure view",
      );
      graphViewFailed = newGraphView === null;
    }

    // A concurrent setData/doExpand/doCollapse/doFocus ran while we were
    // awaiting the layout (bumping opGen) and already applied its own
    // state — applying this stale one now would silently revert it. Bail.
    if (destroyed || gen !== opGen) return;

    graph = newGraph;
    collapseState = newCollapseState;
    searchIndex = newSearchIndex;
    engine = structure.engine;
    layoutResult = structure.layout;
    currentConfig = config;
    refreshEntityAccents(config);
    // Nodale comme d'agrégat : les deux sont indexées par une clé du graphe
    // remplacé.
    selection = null;
    // Même raison : les résultats en place pointent des nœuds du graphe
    // remplacé. Sans repeint — le `rebuild()` qui clôt cette fonction s'en
    // charge (voir `SearchController.reset`).
    searchController.reset();

    // L'état de la vue graphe est indexé par id de nœud : il ne survit pas à un
    // changement de données. On l'invalide, puis on publie celui calculé plus
    // haut — sinon `rebuild()` peindrait les positions de l'ancien graphe. Les
    // trois pas restent un bloc SYNCHRONE après la garde de génération, et dans
    // cet ordre : rien ne doit pouvoir s'intercaler entre l'invalidation et la
    // republication.
    graphView.invalidate();
    if (graphViewFailed) view = "structure";
    if (newGraphView) graphView.publish(newGraphView);

    // Cadrage AVANT reconstruction : voir la note de `ready`. Les nouvelles
    // données ont leur propre étendue, donc leur propre échelle de cadrage, donc
    // potentiellement un autre LOD que celui des données remplacées.
    doFit();
    rebuild();
  }

  // Après `destroy()`, chaque méthode publique doit être un no-op sûr plutôt
  // qu'un throw : un hôte qui démonte son composant n'a aucun moyen d'annuler
  // un callback déjà planifié, et `camera`/`app.stage` sont alors détruits.
  return {
    ready,

    fit(): void {
      if (destroyed) return;
      doFit();
      // Le cadrage change l'échelle, donc peut-être le LOD et à coup sûr la
      // fenêtre : les cartes suivent immédiatement plutôt qu'à la prochaine
      // image. Un seul rebuild au pire, `refreshCards` étant le seul arbitre.
      refreshCards();
    },

    async tidy(): Promise<void> {
      // Vue structure seulement : la vue graphe a son propre moteur deux
      // niveaux, qui repose tout à chaque calcul et ne dérive donc pas — un
      // rangement n'y aurait rien à réparer.
      if (destroyed || view === "graph") return;
      if (!graph || !collapseState || !engine || !layoutResult) return;
      const gen = ++opGen;
      const prevPositions = new Map(layoutResult.positions);
      const visible = collapseState.visibleNodeIds();
      // Le chemin GLOBAL, celui de la mise en page initiale. Il est abordable
      // parce que l'ensemble visible est borné — budget de cartes et pages de
      // fratrie —, et c'est précisément ce qui rend ce bouton possible.
      //
      // `layout()` purge au passage la mémoire de deltas du moteur : cette pose
      // globale devient la nouvelle vérité, et les décalages accumulés par les
      // dépliages passés n'ont plus rien à annuler. C'est ce qui fait de `tidy`
      // la réparation de la dérive incrémentale, et pas seulement un recadrage.
      const next = await engine.layout(graph, visible, metrics);
      // Une opération concurrente a publié sa propre pose pendant l'attente :
      // appliquer celle-ci l'écraserait. Aucun retour arrière à faire, à la
      // différence de `doExpand` — rien n'a été muté avant l'`await`.
      //
      // APPROXIMATION ASSUMÉE : la purge des deltas a déjà eu lieu dans
      // `layout()`, synchrone à l'appel — un repli d'ici au prochain rangement
      // défera trop peu. Même famille d'approximation que le retour arrière de
      // `doReveal` ci-dessus : Ranger répare.
      if (destroyed || gen !== opGen) return;
      layoutResult = next;
      rebuild();
      animatePositions(prevPositions, layoutResult.positions);
      doFit();
      // Même raison que dans `fit()` : le cadrage vient de changer l'échelle, et
      // la pose globale n'a pas la même étendue que celle qu'elle remplace — le
      // LOD peut donc basculer. `refreshCards` est le seul arbitre, un rebuild
      // au pire.
      refreshCards();
    },

    async expand(id: NodeId): Promise<void> {
      if (destroyed) return;
      await doExpand(id);
    },

    async collapse(id: NodeId): Promise<void> {
      if (destroyed) return;
      doCollapse(id);
    },

    focus(id: NodeId): void {
      if (destroyed) return;
      void doFocus(id);
    },

    select(id: NodeId): void {
      if (destroyed) return;
      doSelect(id);
    },

    search(query: string): SearchResult[] {
      if (destroyed) return [];
      return searchController.search(query);
    },
    nextMatch(): SearchResult | null {
      if (destroyed) return null;
      return searchController.step(1);
    },
    prevMatch(): SearchResult | null {
      if (destroyed) return null;
      return searchController.step(-1);
    },

    on(event: DataGraphEvent, callback: (payload: any) => void): () => void {
      if (destroyed) return () => {};
      return emitter.on(event, callback);
    },

    async setData(data: unknown, config?: DataGraphConfig): Promise<void> {
      await doSetData(data, config);
    },

    diagnostics(): Diagnostic[] {
      return graph ? graph.diagnostics : [];
    },

    stats(): { logicalNodeCount: number; visibleNodeCount: number } {
      return {
        logicalNodeCount: graph?.logicalNodeCount ?? 0,
        // Le compte de la vue affichée : des entités en vue graphe, des nœuds
        // de l'arbre en vue structure.
        visibleNodeCount: drawnVisibleCount(),
      };
    },

    refEdges(from: NodeId): RefEdge[] {
      return graph ? graph.refEdges.filter((e) => e.from === from) : [];
    },

    setTheme(next: Theme | ThemeOverride): void {
      if (destroyed) return;
      // Un `Theme` complet est aussi structurellement valide comme
      // `ThemeOverride` (chaque groupe de `DeepPartial` est optionnel, donc
      // aucun champ ne peut servir de discriminant sûr — un override qui
      // fixe `entityPalette` est parfaitement légal et ne doit pas être
      // confondu avec un thème complet). `resolveTheme` est idempotente sur
      // un `Theme` complet : chaque groupe étale `base` puis `partial`, donc
      // passer un `Theme` entier reproduit exactement ce `Theme`.
      // Conséquence assumée : un `byEntityType` déjà en place survit à un
      // changement de thème, puisque `resolveTheme` le reporte depuis
      // `base` quand `partial` n'en fournit pas — c'est le comportement
      // voulu pour un bascule clair/sombre.
      theme = resolveTheme(next as ThemeOverride, theme);
      refreshEntityAccents(currentConfig);
      if (app.renderer) app.renderer.background.color = theme.surface.canvas;
      rebuild();
    },

    async setView(next: DataGraphView): Promise<void> {
      await ready;
      if (destroyed || next === view || !graph) return;

      if (next === "graph") {
        // Même discipline de génération que toutes les autres opérations
        // asynchrones du fichier : le calcul dure le temps d'un import
        // dynamique plus une passe de force, pendant lesquels un `setData` peut
        // très bien atterrir. `view` n'est donc basculée, et l'état publié,
        // qu'une fois cette course tranchée.
        const gen = ++opGen;
        const state = await graphView.tryCompute(
          graph,
          currentConfig,
          true,
          "switching to the graph view failed",
        );
        // Seul site à RENONCER sur échec au lieu de retomber en vue structure :
        // un import qui échoue ne doit pas laisser l'instance dans une vue
        // qu'elle ne sait pas peindre, et `view` n'a pas encore bougé.
        if (state === null) return;
        if (destroyed || gen !== opGen) return;
        graphView.publish(state);
      }

      // `graph` a pu être remplacé pendant l'attente ; la garde de génération
      // ci-dessus l'exclut, mais on le relit plutôt que de faire confiance à un
      // narrowing d'avant l'`await`.
      const current = graph;
      if (!current) return;
      view = next;

      if (view === "graph") {
        // La vue graphe ne connaît que des entités : reporter la sélection sur
        // l'entité englobante plutôt que de la perdre.
        if (selection?.kind === "node") {
          const nearest = nearestEntityAncestor(current, selection.id);
          selection = nearest === null ? null : { kind: "node", id: nearest };
        }
      } else if (selection?.kind === "cluster") {
        // Symétrique, et sans report possible : une sélection d'agrégat n'a de
        // sens que là où des enveloppes sont peintes. La reporter sur la racine
        // de l'agrégat désignerait une carte que l'utilisateur n'a pas choisie.
        selection = null;
      }

      // Recadrer est légitime ici : les deux vues n'ont aucun repère commun. Et
      // c'est AVANT la reconstruction que ça se joue — voir la note de `ready` :
      // les deux vues n'ont pas la même étendue, donc pas la même échelle de
      // cadrage, donc rarement le même LOD. Cadrer après faisait dessiner les
      // 6 251 cartes à l'échelle de la vue sortante avant de tout jeter au
      // premier passage du ticker.
      doFit();
      rebuild();
      app.render();
    },

    currentView(): DataGraphView {
      return view;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      camera?.dispose();
      camera = null;
      // Le seul écouteur global qui ne soit pas porté par la caméra ni par le
      // stage (que `app.destroy` emporte) : il faut le retirer à la main.
      window.removeEventListener("keydown", handleKeyDown);
      // Le worker de la vue graphe ne meurt pas avec le canvas : il survivrait à
      // l'instance et continuerait à mouliner des secondes de mise en page pour
      // personne. `graphView.destroy()` le termine et solde les calculs en vol.
      graphView.destroy();
      // Libère la part de cette instance dans les atlas partagés : ils ne sont
      // désinstallés que si plus aucune autre instance ne les porte.
      fontLease.dispose();
      emitter.clear();
      // `ready` may still be in flight (destroy() called before app.init()
      // resolved); guard so we never throw on a half-initialized renderer.
      if (app.renderer) app.destroy(true, { children: true });
    },
  };
}
