import {
  buildAggregates,
  validateConfig,
  type Aggregate,
  type AggregateIndex,
  type DataGraphConfig,
  type Graph,
  type GraphNode,
  type NodeId,
  type NodeMetrics,
  type Rect,
  type RefEdge,
} from "@defsquare/data-graph-core";
// `import type` UNIQUEMENT : ce point d'entrée porte la vue graphe et ne doit
// entrer dans le bundle que de qui y bascule réellement. Un import de type ne
// produit aucun code à l'exécution ; le seul chemin d'exécution vers le moteur
// est l'`import()` dynamique d'`ensureEngine`, plus bas dans CE fichier.
// `test/bundle-purity.test.ts` (côté renderer) garde ces deux lignes : le test
// du cœur ne couvre que le `dist/` du cœur, pas ce fichier-ci.
//
// Ce que ces deux lignes valent a changé d'échelle depuis le retrait de
// l'ancien moteur : 2,64 ko gzip au lieu de 180,28. Elles restent parce
// qu'elles tiennent la FORME — la vue graphe se charge à la demande par
// construction — et non plus parce qu'elles tiennent un poids. Le raisonnement
// complet est dans les deux tests de pureté.
import type {
  ClusterShape,
  GraphLayoutEngine,
  GraphLayoutResult,
  TwoLevelLayoutOptions,
} from "@defsquare/data-graph-core/graph-layout";
import { clusterDimmed } from "./focus.js";

/**
 * Le lien entre DEUX AGRÉGATS, et le nombre de références qu'il résume.
 *
 * NON ORIENTÉ, `a` étant toujours le plus petit des deux ids : à l'échelle où
 * ces arêtes sont peintes — le régime sémantique, sous le seuil du LOD 2 — une
 * tête de flèche mesurerait une fraction de pixel. Garder le sens doublerait
 * donc le nombre de traits pour une distinction que personne ne peut voir. Ce
 * que la vue dézoomée montre est un COUPLAGE entre blocs ; la dépendance
 * dirigée se lit en zoomant, où les cartes et leurs flèches reviennent.
 */
export interface AggregateEdge {
  a: string;
  b: string;
  weight: number;
}

/**
 * Replie les références du graphe sur les agrégats : une arête par PAIRE
 * d'agrégats reliés, pondérée par le nombre de références qu'elle résume.
 *
 * Pure, et c'est ce qui la rend testable sans mise en page ni instance. Appelée
 * UNE fois par calcul de la vue graphe (`compute`), jamais par image : son
 * résultat ne dépend que du graphe et de l'index, dont aucun ne bouge entre deux
 * publications. Seules les POSITIONS des disques bougent — un déplacement les
 * mute en place — et elles ne sont résolues qu'au moment de peindre.
 *
 * Trois exclusions, dans cet ordre :
 *  - une référence CASSÉE ou sans cible ne relie rien ;
 *  - une entité hors agrégat n'a pas de disque, donc pas de bout à relier — elle
 *    garde sa carte au régime sémantique, et sa référence n'y est pas montrée ;
 *  - une référence INTRA-agrégat est déjà dite par le disque lui-même : la
 *    tracer reviendrait à poser une boucle sur place.
 *
 * `fromEntity` et non `from` : une référence portée par un value object est
 * celle de l'entité qui le contient — c'est le niveau auquel l'appartenance
 * d'agrégat est définie, et `byNode` n'indexe que des entités.
 *
 * `byNode` est lue en `[0]`, comme le fait déjà le seul autre consommateur du
 * cœur : l'appartenance est une PARTITION (voir `AggregateIndex.byNode`), donc
 * chaque tableau tient exactement un id.
 *
 * L'ordre du résultat est celui de PREMIÈRE RENCONTRE dans `refEdges`, donc
 * entièrement déterminé par le graphe : deux appels sur le même graphe rendent
 * le même tableau dans le même ordre, ce dont dépend la stabilité du tracé d'une
 * publication à l'autre.
 */
export function aggregateRefEdges(
  refEdges: readonly RefEdge[],
  byNode: ReadonlyMap<NodeId, string[]>,
): AggregateEdge[] {
  const out: AggregateEdge[] = [];
  const index = new Map<string, AggregateEdge>();
  for (const edge of refEdges) {
    if (edge.to === null || edge.dangling) continue;
    const from = byNode.get(edge.fromEntity)?.[0];
    const to = byNode.get(edge.to)?.[0];
    if (from === undefined || to === undefined) continue;
    if (from === to) continue;
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    // Le séparateur est un caractère de contrôle : un id d'agrégat vaut
    // `${type}#${entityId}` et un id d'entité peut contenir n'importe quel
    // caractère imprimable — un « # » ou un « | » rendraient deux paires
    // distinctes confondables.
    const key = `${a}\u0000${b}`;
    const known = index.get(key);
    if (known) {
      known.weight++;
      continue;
    }
    const created: AggregateEdge = { a, b, weight: 1 };
    index.set(key, created);
    out.push(created);
  }
  return out;
}

/**
 * La part des libellés qu'un préfixe doit couvrir pour être retiré.
 *
 * Une majorité NETTE et non l'unanimité, et c'est le jeu réel qui l'impose : ses
 * 1 300 agrégats comptent 1 277 packages sous `com.bnpparibas.bddf.fipro`, mais
 * aussi 18 MODULES (`bddf-fipro-domain`, `arch-audit`…) et cinq packages
 * étrangers (`com.axway.…`, un `x` isolé). Exiger que TOUS le portent revient à
 * ne rien retirer dès qu'un jeu mélange deux familles de noms — c'est-à-dire
 * dans le cas réel, où la configuration groupe presque toujours par plusieurs
 * types. Le seuil dit « ce préfixe est du bruit » plutôt que « ce préfixe est
 * universel ».
 *
 * Les libellés qui ne le portent PAS gardent leur nom entier : ce sont les
 * exceptions du jeu, et les montrer en entier est justement ce qui les signale.
 */
const DOMINANT_PREFIX_SHARE = 0.8;

/**
 * Le plus long préfixe PAR SEGMENTS POINTÉS que partage la grande majorité de
 * `labels`, terminé par son point, ou la chaîne vide quand il n'y a rien à
 * retirer.
 *
 * Le problème est celui du jeu réel : un audit d'application n'a qu'un seul
 * arbre de packages, donc ses ~1 300 agrégats s'appellent presque tous
 * `com.bnpparibas.bddf.fipro.quelquechose`. Peint tel quel, chaque disque dépense
 * la moitié de son budget de caractères à répéter ce que ses 1 299 voisins disent
 * aussi — l'écran affiche mille fois la même chose et jamais ce qui distingue.
 * Retirer le préfixe rend ce budget à la QUEUE du chemin, qui est la seule partie
 * discriminante.
 *
 * Par SEGMENTS et non par caractères : un préfixe coupé au milieu d'un segment
 * (`com.exemple.cre`) laisserait des libellés qui ne sont plus des chemins et ne
 * se recollent plus mentalement à leur racine.
 *
 * Trois cas rendent la chaîne vide, et tous disent « affiche les libellés
 * entiers » :
 *  - moins de deux agrégats — il n'y a alors aucune répétition à retirer, et le
 *    seul libellé présent perdrait son nom complet sans rien gagner ;
 *  - aucun préfixe d'au moins DEUX segments assez répandu — retirer `com.` ne
 *    rendrait presque rien et coûterait la racine du chemin ;
 *  - des noms sans hiérarchie (`k1`, `p1`), où il n'y a pas de préfixe du tout.
 *
 * Un préfixe n'est compté que sur les libellés qui ont ENCORE un segment après
 * lui : c'est ce qui garantit qu'aucun disque ne devient anonyme — un jeu
 * `a.b.c` / `a.b.c.d` retient `a.b.` et non `a.b.c.`. Le plus long l'emporte, à
 * égalité le plus répandu, puis l'ordre alphabétique : le résultat ne dépend pas
 * de l'ordre dans lequel la mise en page a rendu ses agrégats.
 */
export function dominantSegmentPrefix(labels: readonly string[]): string {
  if (labels.length < 2) return "";
  const needed = Math.ceil(labels.length * DOMINANT_PREFIX_SHARE);
  const counts = new Map<string, number>();
  for (const label of labels) {
    const segments = label.split(".");
    // `n < segments.length` et non `<=` : un préfixe qui couvrirait le libellé
    // entier ne laisserait rien à peindre sur le disque.
    for (let n = 2; n < segments.length; n++) {
      const prefix = segments.slice(0, n).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  let best = "";
  let bestSegments = 0;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count < needed) continue;
    const segments = prefix.split(".").length;
    const better =
      segments > bestSegments ||
      (segments === bestSegments && (count > bestCount || (count === bestCount && prefix < best)));
    if (!better) continue;
    best = prefix;
    bestSegments = segments;
    bestCount = count;
  }
  return best === "" ? "" : `${best}.`;
}

/** L'état complet de la vue graphe, calculé d'un bloc puis publié d'un bloc :
 * l'index, la mise en page et les arêtes agrégées doivent toujours décrire le
 * même graphe. */
export interface GraphViewState {
  index: AggregateIndex;
  layout: GraphLayoutResult;
  /** Les références repliées sur les agrégats. Calculées ICI et pas au dessin :
   * c'est un balayage des références du graphe entier — 28 685 sur le jeu réel
   * — qui n'a rien à faire dans une boucle d'image. */
  semanticEdges: AggregateEdge[];
  /**
   * Le libellé PRÊT À AFFICHER de chaque disque, indexé par id d'agrégat.
   *
   * Ici et pas dans `semanticNodesFor` pour deux raisons. La première tient à la
   * NATURE du calcul : le préfixe commun retiré (voir `commonSegmentPrefix`) est
   * une propriété de l'ENSEMBLE des libellés, pas de chacun — le résoudre dans
   * une passe qui produit un disque à la fois mêlerait deux portées. La seconde
   * est le rythme : `semanticNodesFor` est rappelée à chaque image d'un survol
   * ou d'un déplacement d'agrégat (voir `redrawClusters` chez l'appelant), et
   * refaire 1 300 découpes de chaîne par image pour un texte identique serait
   * payer le régime sémantique en permanence.
   *
   * L'id COMPLET reste celui de l'agrégat (`SemanticNodePaint.id`) : le panneau
   * de détail, la sélection et la recherche continuent de travailler dessus —
   * seul ce qui est PEINT sur le disque est raccourci.
   */
  semanticLabels: Map<string, string>;
}

/**
 * Une enveloppe prête à peindre : la donnée NUE que `drawClusters` consomme.
 *
 * Ni agrégat, ni index, ni graphe — couleur, estompage et survol sont déjà
 * résolus ici. C'est ce qui garde `draw.ts` testable sans instance : la fonction
 * de dessin ne sait plus rien de ce qui a produit ces valeurs.
 */
export interface ClusterPaint {
  circle: { cx: number; cy: number; r: number };
  color: string;
  hover: number;
  dim: boolean;
}

/**
 * Un agrégat prêt à peindre COMME NŒUD : la même enveloppe, plus ce qu'il faut
 * pour l'étiqueter.
 *
 * Le régime sémantique ne change pas la GÉOMÉTRIE des agrégats — c'est le même
 * `ClusterShape`, à la même place et au même rayon, calculé une fois par la mise
 * en page. Il change ce qu'on peint dessus : au lieu d'une région translucide
 * derrière des cartes, un disque qui EST l'objet, avec le nom de sa racine et le
 * compte de ses membres. D'où l'extension plutôt qu'un type parallèle : les
 * deux régimes lisent la même donnée, le second en demande simplement plus.
 */
export interface SemanticNodePaint extends ClusterPaint {
  /** L'id de l'AGRÉGAT — celui du clic, du survol et de la sélection. C'est par
   * lui que l'appelant retrouve le libellé d'un disque saisi. */
  id: string;
  /** L'id d'entité de la racine — le nom du package, pas le pointeur JSON, et
   * sans le « # » que la carte met en en-tête : ce disque n'a pas de pastille de
   * type à côté pour justifier le préfixe. */
  label: string;
  /** Nombre de membres, racine comprise. */
  count: number;
}

/**
 * Une arête agrégée RÉSOLUE en géométrie : le segment déjà rogné aux bords des
 * deux disques, et le poids qu'il porte.
 *
 * Les bouts sont calculés ici, et pas au dessin, parce que le rognage demande
 * les RAYONS — que seul le contrôleur connaît. Ce qui arrive à `draw.ts` est
 * alors quatre nombres et un poids : de la donnée nue, sans agrégat ni forme.
 *
 * Recalculés à chaque repeint et non mémorisés : un déplacement de carte ou
 * d'agrégat mute les `ClusterShape` en place, et un segment gardé décrirait
 * l'image d'avant le geste.
 */
export interface SemanticEdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /** Vrai quand ni l'un ni l'autre bout ne touche l'agrégat sélectionné. Même
   * rôle que le `dim` d'une enveloppe, et même valeur par défaut : faux quand
   * rien n'est sélectionné, donc le tracé au repos est celui d'avant
   * l'estompage. */
  dim: boolean;
}

/** Ce que l'appelant apporte à `clustersFor` : le graphe courant, la palette, et
 * les deux morceaux d'ÉTAT D'INTERFACE que le contrôleur ne possède pas — la
 * sélection et le survol. */
export interface ClustersForArgs {
  graph: Graph;
  /** La couleur d'accent du type d'une carte, comme pour les cartes elles-mêmes.
   * Fournie par l'appelant : elle dépend du thème, pas de la vue. */
  accentFor(node: GraphNode): string;
  /** La couleur d'une enveloppe dont la racine manque au graphe. */
  fallbackColor: string;
  selectedAggregateId: string | null;
  /** Les ids à garder pleins, ou `null` s'il n'y a rien à estomper. */
  keep: Set<NodeId> | null;
  /** L'intensité de survol courante d'une enveloppe, de 0 à 1. */
  hoverOf(aggregateId: string): number;
}

export interface GraphViewHooks {
  /**
   * Les réglages passés à `createTwoLevelLayoutEngine` au PREMIER chargement du
   * moteur. Une valeur simple et non un accesseur : le contrat public
   * (`DataGraphOptions.graphLayoutOptions`) dit déjà que ces valeurs sont lues
   * au premier passage en vue graphe et qu'en changer demande de recréer
   * l'instance.
   */
  layoutOptions: TwoLevelLayoutOptions | undefined;
  /**
   * Les métriques de carte COURANTES, relues à chaque mise en page et non
   * capturées à la construction. C'est une contrainte réelle : le contrôleur est
   * construit avec l'instance, alors que les métriques ne sont mesurées qu'après
   * `fontsReady` dans `ready` — les capturer figerait les valeurs par défaut
   * pour toute la session, et la vue graphe mettrait en page des cartes d'une
   * autre taille que celles qui sont peintes.
   */
  getMetrics(): NodeMetrics;
}

export interface GraphViewController {
  /**
   * Calcule l'état de la vue graphe pour `target` **sans rien publier** :
   * l'appelant garde sa garde de génération entre `compute` et `publish`, ce qui
   * est exactement la discipline en vigueur. Sans cette séparation, un calcul
   * lancé avant un `setData` et terminé après lui écraserait la mise en page du
   * nouveau graphe par des positions calculées sur l'ancien — voire appellerait
   * `layout()` sur une paire (graphe, index) dépareillée.
   *
   * `reuse` conserve l'index en place, qui ne dépend que du couple (graphe,
   * config) et n'a donc pas à être recalculé d'une bascule de vue à l'autre ;
   * un changement de données passe `false`, l'index étant indexé par id de
   * nœud.
   */
  compute(target: Graph, config: DataGraphConfig, reuse: boolean): Promise<GraphViewState>;
  /**
   * `compute` avec son repli : un échec rend `null` au lieu de propager. Les
   * trois appelants partagent la même règle — le moteur de la vue graphe est
   * chargé dynamiquement, donc un import qui échoue ne doit jamais rejeter
   * l'opération englobante — mais ce qu'ils FONT du `null` diffère (retomber en
   * vue structure, ou renoncer à la bascule) et reste donc au point d'appel,
   * comme les gardes de génération : le contrôleur rend `null`, il ne décide
   * pas.
   *
   * `context` n'est là que pour le débogage : il garde à chaque site son message
   * d'avertissement d'origine.
   */
  tryCompute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
    context: string,
  ): Promise<GraphViewState | null>;
  /** Publie en un seul geste l'état calculé par `compute`. */
  publish(state: GraphViewState): void;
  /** Index et mise en page tombent ENSEMBLE : ils sont indexés par id de nœud et
   * ne survivent pas à un changement de données. Les invalider séparément
   * laisserait un couple dépareillé le temps d'une instruction. */
  invalidate(): void;

  /** Les positions publiées, `undefined` tant que rien ne l'a été. */
  positions(): Map<NodeId, Rect> | undefined;
  /** Toutes les entités de `target` : c'est exactement ce que montre la vue
   * graphe, qui ne cache rien. Ne dépend d'aucun état publié — un appelant peut
   * l'interroger avant même le premier calcul. */
  entityIds(target: Graph): Set<NodeId>;
  /** Les enveloppes publiées, ou un tableau vide. Le tableau est celui du
   * moteur, RENDU TEL QUEL et non recopié : c'est en mutant ces formes en place
   * qu'un déplacement de carte ou d'agrégat met les disques à jour. */
  clusters(): ClusterShape[];
  /**
   * L'agrégat d'`aggregateId`, résolu contre l'index COURANT, ou `undefined`.
   *
   * La résolution est refaite à chaque lecture plutôt que gardée chez
   * l'appelant : un `setData` ou un échec de la vue graphe peuvent remplacer
   * l'index sous une sélection qui le désignait, et un agrégat qui n'existe plus
   * doit se lire comme « pas de sélection » — ce que fait `undefined` chez tous
   * les appelants — plutôt que de laisser l'estompage tourner sur un fantôme.
   */
  aggregateOf(aggregateId: string): Aggregate | undefined;
  /**
   * L'enveloppe publiée dont l'agrégat contient `id`, avec les membres de cet
   * agrégat — de quoi recalculer le disque quand une de ses cartes bouge.
   *
   * `undefined` pour une carte hors agrégat, ou tant que rien n'est publié.
   */
  memberIdsContaining(id: NodeId): { cluster: ClusterShape; memberIds: Set<NodeId> } | undefined;
  /**
   * Étend `bounds` EN PLACE à toutes les enveloppes publiées : la contribution
   * de la vue graphe au cadrage, qui rognerait les disques sans elle.
   *
   * Mutation en place et non un nouveau rect : l'appelant compose les bornes des
   * cartes puis celles-ci, et rendre une copie l'obligerait à réassigner un
   * `Rect` que la caméra consomme juste après.
   */
  extendBoundsToClusters(bounds: Rect): void;
  /**
   * Les enveloppes prêtes à peindre, ou un tableau vide tant que rien n'est
   * publié.
   *
   * Les résolutions vivent ici, et pas dans `drawClusters` : la fonction de
   * dessin ne prend que de la donnée nue, donc elle se teste sans graphe ni
   * index d'agrégats.
   */
  clustersFor(args: ClustersForArgs): ClusterPaint[];
  /**
   * Les agrégats prêts à peindre COMME NŒUDS — le régime sémantique.
   *
   * Mêmes arguments et mêmes résolutions que `clustersFor`, dont c'est
   * l'extension : le libellé et le compte de membres viennent s'ajouter à la
   * couleur, à l'estompage et au survol déjà résolus là-bas. Deux méthodes et
   * non une seule qui rendrait toujours le tout, parce que le régime des cartes
   * appelle celle-ci une fois par image d'un survol : lui faire résoudre des
   * libellés dont il ne fait rien serait payer le régime sémantique en
   * permanence.
   */
  semanticNodesFor(args: ClustersForArgs): SemanticNodePaint[];
  /**
   * Les arêtes agrégées publiées, résolues contre les positions COURANTES des
   * disques et rognées à leurs bords.
   *
   * Une paire dont l'un des disques a disparu de la mise en page, ou dont les
   * deux se recouvrent au point qu'il ne reste aucun segment, est omise : il n'y
   * a rien à tracer, et un segment de longueur nulle ou négative serait un trait
   * retourné.
   */
  semanticEdges(selectedAggregateId: string | null): SemanticEdgeSegment[];
  /**
   * L'id de l'agrégat qui revendique `id` selon l'index publié, ou `undefined`
   * pour une entité hors agrégat.
   *
   * Lecture DIRECTE de `byNode`, en `[0]` : l'appartenance est une partition.
   * Distincte de `memberIdsContaining`, qui balaie les ENVELOPPES pour en
   * ramener une avec ses membres ; celle-ci répond à la seule question « cette
   * carte est-elle déjà représentée par un disque ? », et le régime sémantique
   * la pose une fois par entité à chaque reconstruction.
   */
  aggregateIdOf(id: NodeId): string | undefined;
  /**
   * La marge d'enveloppe EFFECTIVE — celle avec laquelle le moteur a calculé les
   * disques, et donc la seule avec laquelle on ait le droit de les recalculer
   * quand une carte bouge.
   *
   * Vaut 0 tant que le moteur n'a pas été chargé, et c'est sans conséquence :
   * il n'y a de disques à recalculer qu'en vue graphe, c'est-à-dire exactement
   * quand le moteur est déjà là.
   */
  hullPadding(): number;
}

/**
 * L'état de la VUE GRAPHE d'une instance, et son cycle de vie : l'index
 * d'agrégats, la mise en page, le moteur chargé à la demande et la marge
 * d'enveloppe qui en sort. Le contrôleur en est le seul propriétaire.
 *
 * Aucun import de Pixi, ici ni transitivement : c'est une machine de données,
 * testable sans canvas ni instance — même forme que `search.ts` et `animate.ts`,
 * et pour la même raison.
 *
 * Ce qui reste chez l'appelant, volontairement : `opGen` et toutes les gardes de
 * génération (la course traverse les deux vues, le compteur appartient à
 * l'orchestrateur — la séparation `compute`/`publish` est précisément ce qui le
 * permet), les trois politiques de repli sur un `null`, et la vue courante
 * elle-même.
 */
export function createGraphViewController(hooks: GraphViewHooks): GraphViewController {
  // Tout reste `undefined` tant qu'on n'a pas basculé en vue graphe au moins une
  // fois : un consommateur de la seule vue structure ne paie ni le calcul des
  // agrégats ni le chargement du moteur.
  let aggregateIndex: AggregateIndex | undefined;
  let graphLayout: GraphLayoutResult | undefined;
  let graphEngine: GraphLayoutEngine | undefined;
  // Renseignée en même temps que le moteur, dont elle sort : le défaut vient du
  // cœur (voir `ensureEngine`), jamais d'une copie locale du nombre.
  let graphHullPadding = 0;
  // Les références repliées sur les agrégats, publiées avec le reste.
  let semanticEdgeList: AggregateEdge[] = [];
  // Les libellés prêts à peindre, publiés avec le reste : préfixe commun déjà
  // retiré, donc identiques d'une image à l'autre tant que rien n'est republié.
  let semanticLabelById = new Map<string, string>();
  // Les enveloppes publiées, indexées par agrégat : c'est par là qu'une arête
  // agrégée retrouve ses deux bouts. Construite à la PUBLICATION et non à chaque
  // repeint — les `ClusterShape` sont mutés en place par les déplacements, donc
  // la table reste juste sans être refaite.
  let clusterById = new Map<string, ClusterShape>();

  // Partagé plutôt qu'alloué à chaque lecture : `clusters()` est appelé à chaque
  // repeint, donc à chaque image d'un déplacement, et le cas « rien de publié »
  // n'a rien à distinguer d'un appel à l'autre.
  const NO_CLUSTERS: ClusterShape[] = [];

  /**
   * Charge le moteur de la vue graphe à la demande.
   *
   * C'est `createTwoLevelLayoutEngine` — packing en étagères intra-agrégat,
   * puis simulation sur les agrégats devenus disques rigides —, et c'est le
   * seul depuis le retrait de `createGraphLayoutEngine` (fcose +
   * `separateOverlaps` + `separateClusters`) et de `cytoscape` avec lui. La
   * sonde qui a motivé la bascule le mesurait ×11 à ×65 plus rapide et ×2 à
   * ×5,4 plus dense, à garanties égales :
   * `docs/superpowers/spikes/2026-09-01-two-level-layout.md`. Mesuré dans
   * Chromium via l'e2e, sur le jeu étendu de la démo : `setView("graph")` est
   * passé de 4 310–4 484 ms à 220–252 ms.
   *
   * L'`import()` reste dynamique. Le chunk qu'émet le build Vite de production
   * d'`apps/demo` ne pèse plus que **2,64 ko gzip** (5,76 ko bruts, contre
   * 180,28 / 577,17 avant le retrait), donc ce n'est plus le poids qui justifie
   * la paresse : c'est qu'elle est la forme par défaut de cette vue, et que
   * `setView` est asynchrone pour cette raison. Les deux tests de pureté de
   * bundle portent le raisonnement complet.
   */
  async function ensureEngine(): Promise<GraphLayoutEngine> {
    if (!graphEngine) {
      const mod = await import("@defsquare/data-graph-core/graph-layout");
      graphEngine = mod.createTwoLevelLayoutEngine(hooks.layoutOptions);
      // C'est ici, et NULLE PART ailleurs, qu'on apprend la marge d'enveloppe
      // par défaut : le namespace du module chargé la porte, donc le renderer
      // la connaît sans en garder de copie et sans importer statiquement ce
      // point d'entrée — ce que les deux tests de pureté interdisent. Le
      // déplacement d'une carte en a besoin pour recalculer les disques comme
      // le moteur les a calculés, et il n'y a de disques qu'en vue graphe,
      // c'est-à-dire exactement quand ce module est déjà chargé.
      graphHullPadding = hooks.layoutOptions?.hullPadding ?? mod.TWO_LEVEL_LAYOUT_DEFAULTS.hullPadding;
    }
    return graphEngine;
  }

  /** Index d'agrégats pour `target`. */
  function buildAggregateState(target: Graph, config: DataGraphConfig): { index: AggregateIndex } {
    return { index: buildAggregates(target, validateConfig(config)) };
  }

  /**
   * Les libellés de disque, résolus puis DÉBARRASSÉS de leur préfixe commun.
   *
   * L'id d'ENTITÉ et non le pointeur JSON : c'est le nom que l'utilisateur
   * reconnaît (« com.exemple.credit.domain »), là où `rootId` est un chemin dans
   * le document. Et sans le « # » que la carte met en en-tête : ce disque n'a pas
   * de pastille de type à côté pour justifier le préfixe. Une racine qui manque
   * au graphe garde son id d'agrégat plutôt qu'une case vide — mieux vaut un
   * libellé technique qu'un disque anonyme.
   *
   * Le retrait du préfixe se fait sur l'ensemble complet, y compris ces libellés
   * de repli : ils sont ce qu'on affichera, donc ils comptent dans ce qui est
   * répandu. Le `startsWith` n'est pas une précaution mais la RÈGLE : le préfixe
   * est dominant et non universel (voir `dominantSegmentPrefix`), donc les
   * libellés d'une autre famille gardent leur nom entier. Un `slice` suffit pour
   * les autres — le préfixe n'est retenu que s'il leur laisse un segment.
   */
  function semanticLabelsOf(target: Graph, clusters: readonly ClusterShape[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const cluster of clusters) {
      const root = target.nodes.get(cluster.rootId);
      labels.set(
        cluster.aggregateId,
        root?.kind === "entity" ? root.entityId : (root?.label ?? cluster.aggregateId),
      );
    }
    const prefix = dominantSegmentPrefix([...labels.values()]);
    if (prefix.length === 0) return labels;
    for (const [aggregateId, label] of labels) {
      if (label.startsWith(prefix)) labels.set(aggregateId, label.slice(prefix.length));
    }
    return labels;
  }

  function entityIdsOf(target: Graph): Set<NodeId> {
    const ids = new Set<NodeId>();
    for (const node of target.nodes.values()) {
      if (node.kind === "entity") ids.add(node.id);
    }
    return ids;
  }

  // Nommée plutôt que méthode de l'objet rendu, et appelée telle quelle par
  // `tryCompute` : passer par `this` ferait dépendre le repli de la façon dont
  // l'appelant a obtenu la méthode (un `const { tryCompute } = controller`
  // suffirait à le casser).
  async function compute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
  ): Promise<GraphViewState> {
    const base = reuse && aggregateIndex ? { index: aggregateIndex } : buildAggregateState(target, config);
    // Pas `engine` tout court à l'appel : chez l'appelant ce nom désigne le
    // moteur ELK de la vue structure, et les deux ne doivent pas se confondre.
    const twoLevelEngine = await ensureEngine();
    const layout = await twoLevelEngine.layout(
      target,
      base.index,
      entityIdsOf(target),
      hooks.getMetrics(),
    );
    // Recalculé même quand l'index est réutilisé : c'est un seul balayage des
    // références, sans commune mesure avec la mise en page qu'on vient
    // d'attendre, et le mémoriser demanderait de savoir contre quel graphe il a
    // été calculé — exactement l'appariement que la publication d'un bloc existe
    // pour rendre impossible à rater.
    const semanticEdges = aggregateRefEdges(target.refEdges, base.index.byNode);
    return {
      ...base,
      layout,
      semanticEdges,
      semanticLabels: semanticLabelsOf(target, layout.clusters),
    };
  }

  return {
    compute,

    async tryCompute(
      target: Graph,
      config: DataGraphConfig,
      reuse: boolean,
      context: string,
    ): Promise<GraphViewState | null> {
      try {
        return await compute(target, config, reuse);
      } catch (err) {
        console.warn(`[data-graph] ${context}`, err);
        return null;
      }
    },

    publish(state: GraphViewState): void {
      aggregateIndex = state.index;
      graphLayout = state.layout;
      semanticEdgeList = state.semanticEdges;
      semanticLabelById = state.semanticLabels;
      // Reconstruite ici et nulle part ailleurs : elle indexe LES objets du
      // moteur, ceux-là mêmes que les déplacements mutent en place.
      clusterById = new Map(state.layout.clusters.map((cluster) => [cluster.aggregateId, cluster]));
    },

    invalidate(): void {
      aggregateIndex = undefined;
      graphLayout = undefined;
      // Les cinq tombent ENSEMBLE, pour la raison qui vaut déjà pour les deux
      // premiers : ils sont indexés par id de nœud et d'agrégat, et n'ont aucun
      // sens sur un autre graphe. Les libellés le sont doublement : le préfixe
      // qu'on leur a retiré est celui de CE jeu d'agrégats.
      semanticEdgeList = [];
      semanticLabelById = new Map();
      clusterById = new Map();
    },

    positions(): Map<NodeId, Rect> | undefined {
      return graphLayout?.positions;
    },

    // L'index d'agrégats ne connaît que les entités rattachées à un agrégat,
    // donc on balaie le graphe et pas l'index — sans quoi une entité isolée
    // disparaîtrait de la vue.
    entityIds: entityIdsOf,

    clusters(): ClusterShape[] {
      return graphLayout?.clusters ?? NO_CLUSTERS;
    },

    aggregateOf(aggregateId: string): Aggregate | undefined {
      return aggregateIndex?.aggregates.get(aggregateId);
    },

    memberIdsContaining(id: NodeId): { cluster: ClusterShape; memberIds: Set<NodeId> } | undefined {
      const aggregates = aggregateIndex?.aggregates;
      if (!aggregates || !graphLayout) return undefined;
      for (const cluster of graphLayout.clusters) {
        const aggregate = aggregates.get(cluster.aggregateId);
        if (!aggregate?.memberIds.has(id)) continue;
        // Les agrégats sont une PARTITION : une carte n'appartient qu'à un seul
        // d'entre eux, il n'y a rien à chercher après celui-ci.
        return { cluster, memberIds: aggregate.memberIds };
      }
      return undefined;
    },

    extendBoundsToClusters(bounds: Rect): void {
      // Le disque déborde des cartes de sa marge ; sa boîte englobante est
      // `cx ± r`, `cy ± r`, et c'est elle qu'on unit aux bornes des cartes.
      for (const cluster of graphLayout?.clusters ?? NO_CLUSTERS) {
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        bounds.x = Math.min(bounds.x, cluster.cx - cluster.r);
        bounds.y = Math.min(bounds.y, cluster.cy - cluster.r);
        bounds.width = Math.max(right, cluster.cx + cluster.r) - bounds.x;
        bounds.height = Math.max(bottom, cluster.cy + cluster.r) - bounds.y;
      }
    },

    clustersFor(args: ClustersForArgs): ClusterPaint[] {
      return (graphLayout?.clusters ?? NO_CLUSTERS).map((cluster) => paintOf(cluster, args));
    },

    semanticNodesFor(args: ClustersForArgs): SemanticNodePaint[] {
      const aggregates = aggregateIndex?.aggregates;
      return (graphLayout?.clusters ?? NO_CLUSTERS).map((cluster) => {
        return {
          ...paintOf(cluster, args),
          id: cluster.aggregateId,
          // Simple lecture : le libellé a été résolu et raccourci à la
          // publication (voir `semanticLabelsOf`), parce qu'il ne dépend que du
          // couple (graphe, mise en page) et que cette méthode-ci tourne à
          // chaque image d'un survol. Le repli sur l'id d'agrégat couvre l'état
          // publié à la main par un test, sans table de libellés.
          label: semanticLabelById.get(cluster.aggregateId) ?? cluster.aggregateId,
          // Le compte de MEMBRES, pas d'enfants : c'est ce que le disque
          // remplace — les cartes qu'on ne dessine plus.
          count: aggregates?.get(cluster.aggregateId)?.memberIds.size ?? 0,
        };
      });
    },

    semanticEdges(selectedAggregateId: string | null): SemanticEdgeSegment[] {
      const out: SemanticEdgeSegment[] = [];
      for (const edge of semanticEdgeList) {
        const a = clusterById.get(edge.a);
        const b = clusterById.get(edge.b);
        if (!a || !b) continue;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const len = Math.hypot(dx, dy);
        // Deux disques concentriques (ou confondus) n'ont pas de direction : il
        // n'existe alors aucun segment à rogner, et diviser par `len` rendrait
        // des NaN que le renderer propagerait dans sa géométrie.
        if (len === 0) continue;
        const ux = dx / len;
        const uy = dy / len;
        // Le trait part du BORD de chaque disque et non de son centre : les
        // disques du régime sémantique sont opaques et se peignent par-dessus,
        // donc un trait qui les traverserait ne servirait qu'à épaissir leur
        // contour par en dessous. Deux disques trop proches pour laisser un
        // segment n'en produisent aucun.
        if (len <= a.r + b.r) continue;
        out.push({
          x1: a.cx + ux * a.r,
          y1: a.cy + uy * a.r,
          x2: b.cx - ux * b.r,
          y2: b.cy - uy * b.r,
          weight: edge.weight,
          // Une arête reste pleine dès qu'elle TOUCHE l'agrégat sélectionné :
          // même règle que `edgeFocusIds` côté cartes, où une arête traversant le
          // bloc compte pour lui.
          dim: selectedAggregateId !== null && edge.a !== selectedAggregateId && edge.b !== selectedAggregateId,
        });
      }
      return out;
    },

    aggregateIdOf(id: NodeId): string | undefined {
      return aggregateIndex?.byNode.get(id)?.[0];
    },

    hullPadding(): number {
      return graphHullPadding;
    },
  };

  /**
   * Ce que les deux régimes résolvent de la MÊME façon sur une enveloppe :
   * couleur, estompage, intensité. Le régime sémantique n'y ajoute qu'un libellé
   * et un compte — il ne redéfinit rien —, et c'est cette fonction partagée qui
   * garantit qu'un disque et l'enveloppe qu'il remplace s'estompent et
   * s'allument ensemble.
   */
  function paintOf(cluster: ClusterShape, args: ClustersForArgs): ClusterPaint {
    const root = args.graph.nodes.get(cluster.rootId);
    const members = aggregateIndex?.aggregates.get(cluster.aggregateId)?.memberIds;
    return {
      circle: { cx: cluster.cx, cy: cluster.cy, r: cluster.r },
      color: root ? args.accentFor(root) : args.fallbackColor,
      // Une enveloppe recule quand AUCUN de ses membres n'est lié à la
      // sélection ; celle qui est sélectionnée reste donc pleine sans cas
      // particulier (voir `clusterDimmed`).
      //
      // Une enveloppe dont l'agrégat manque à l'index reste PLEINE plutôt que
      // de s'estomper par défaut : on ne sait alors rien de ses membres, et le
      // même raisonnement vaut ici que pour la sélection fantôme de
      // `focusKeep()` — mieux vaut ne rien estomper que d'estomper sur une
      // information qu'on n'a pas.
      dim: members ? clusterDimmed(args.keep, members) : false,
      // Relayé et non stocké dans la forme : `clusters()` est la sortie du
      // moteur, et y greffer un état d'interface la rendrait dépendante de
      // qui la survole.
      //
      // La sélection d'un agrégat le peint à son intensité de survol PLEINE,
      // et pas par un anneau de plus : l'enveloppe a déjà un état « allumé »
      // que le survol fait connaître, et le réutiliser dit « celui-ci » sans
      // ajouter de vocabulaire visuel. Le `max` est ce qui empêche le survol
      // de FAIRE BAISSER l'enveloppe sélectionnée quand le pointeur la quitte
      // (`attachHover` y écrit alors des valeurs décroissantes jusqu'à 0).
      hover: Math.max(
        args.hoverOf(cluster.aggregateId),
        cluster.aggregateId === args.selectedAggregateId ? 1 : 0,
      ),
    };
  }
}
