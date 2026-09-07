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
// est l'`import()` dynamique d'`ensureModule`, plus bas dans CE fichier.
// `test/bundle-purity.test.ts` (côté renderer) garde ces deux lignes : le test
// du cœur ne couvre que le `dist/` du cœur, pas ce fichier-ci.
//
// Ce que ces deux lignes valent a changé d'échelle depuis le retrait de
// l'ancien moteur : 3,58 ko gzip au lieu de 180,28. Elles restent parce
// qu'elles tiennent la FORME — la vue graphe se charge à la demande par
// construction — et non plus parce qu'elles tiennent un poids. Le raisonnement
// complet est dans les deux tests de pureté.
import type {
  ClusterShape,
  GraphLayoutEngine,
  GraphLayoutInput,
  GraphLayoutResult,
  TwoLevelLayoutOptions,
} from "@defsquare/data-graph-core/graph-layout";
import { clusterDimmed } from "./focus.js";

/**
 * LE PROTOCOLE DU WORKER DE MISE EN PAGE, déclaré ici parce que c'est ici qu'il
 * est parlé : le worker (`graph-layout-worker.ts`) n'en importe que les types,
 * par un `import type` que le bundler efface. Aucun code ne traverse donc dans
 * ce sens-là — le worker ne tire que le cœur pur du layout.
 *
 * `gen` est le NUMÉRO DE REQUÊTE, et le contrat est qu'une réponse ne vaut que
 * pour la requête qui porte le même. Un `setData`, un `setView` ou un `destroy`
 * peuvent atterrir pendant les secondes que dure un calcul ; sans ce numéro, une
 * réponse tardive serait indiscernable de celle qu'on attend et publierait des
 * positions calculées sur un graphe qui n'existe plus.
 */
export interface GraphLayoutWorkerRequest {
  gen: number;
  input: GraphLayoutInput;
}

/**
 * La réponse, dans une forme choisie pour le CLONAGE STRUCTURÉ et pas pour la
 * commodité de lecture.
 *
 * `positions` est un tableau de tuples `[id, x, y, w, h]` et non une `Map` de
 * `Rect` : à 6 251 cartes, c'est un tableau plat de nombres au lieu de 6 251
 * petits objets à allouer et à cloner des deux côtés de la frontière. Le
 * contrôleur les réhydrate en `Rect` mutables (voir `hydrateLayout`).
 *
 * L'échec voyage comme un MESSAGE et pas comme une `Error` : une exception ne
 * traverse pas `postMessage`, et ce qui compte au retour est de savoir qu'il
 * faut se replier — le détail va dans le `console.warn` du repli.
 */
export type GraphLayoutWorkerResponse =
  | {
      gen: number;
      ok: true;
      positions: [NodeId, number, number, number, number][];
      clusters: ClusterShape[];
    }
  | { gen: number; ok: false; message: string };

/** Ce que le contrôleur fait d'un worker : lui poster une requête, et le
 * terminer. Le reste — la construction, l'URL, `new Worker` — appartient à
 * l'orchestrateur (`create.ts`), qui est le seul à connaître le DOM. */
export interface GraphLayoutWorkerHandle {
  post(request: GraphLayoutWorkerRequest): void;
  terminate(): void;
}

/**
 * La fabrique de worker, injectée par l'appelant.
 *
 * C'est une FONCTION et non une URL, pour que ce module reste ce qu'il a
 * toujours été : une machine de données, sans `new Worker` ni la moindre
 * hypothèse d'environnement. `create.ts` en construit une depuis
 * `DataGraphOptions.graphLayoutWorkerUrl` ; les tests en injectent une qui rend
 * un faux worker, ce qui rend le protocole testable sans navigateur.
 *
 * Elle a le droit de LEVER (URL injouable, `Worker` absent) : l'appel est gardé
 * et un échec de construction déclenche le même repli définitif qu'un échec de
 * calcul.
 */
export type GraphLayoutWorkerSpawn = (
  onMessage: (data: unknown) => void,
  onError: (error: unknown) => void,
) => GraphLayoutWorkerHandle;

/**
 * Le namespace du point d'entrée `./graph-layout`, tel que l'`import()`
 * dynamique d'`ensureModule` le rend.
 *
 * `typeof import(…)` est une position de TYPE : elle n'émet aucun code, donc
 * elle ne rouvre pas la porte que les deux tests de pureté ferment. Il en faut
 * un nom parce que le contrôleur garde ce namespace en variable — le chemin
 * worker y prend `extractGraphLayoutInput`, le chemin en processus
 * `createTwoLevelLayoutEngine`, et les deux `TWO_LEVEL_LAYOUT_DEFAULTS`.
 */
type GraphLayoutModule = typeof import("@defsquare/data-graph-core/graph-layout");

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
  /**
   * De quoi ouvrir le Web Worker de mise en page, ou `undefined` pour rester en
   * processus.
   *
   * `undefined` est le DÉFAUT et pas un mode dégradé : c'est ce que voient
   * vitest, un hôte sans worker, et tout consommateur qui n'a pas fourni
   * `graphLayoutWorkerUrl`. Le comportement y est exactement celui d'avant le
   * worker — même moteur, même sortie, même thread.
   */
  spawnLayoutWorker?: GraphLayoutWorkerSpawn | undefined;
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
  /**
   * Termine le worker de mise en page, s'il y en a un, et fait échouer les
   * calculs encore en vol.
   *
   * Distinct d'`invalidate()`, qui jette l'état PUBLIÉ et laisse le contrôleur
   * utilisable : celui-ci est définitif, et c'est ce que `destroy()` côté
   * instance appelle. Sans lui, un worker survivrait à l'instance qui l'a
   * ouvert et continuerait à mouliner 4 s de mise en page pour personne.
   *
   * Les requêtes en vol sont REJETÉES plutôt que laissées en suspens : un
   * `setView` qui attendait doit se terminer, pas geler son appelant (et le
   * bouton qu'il a mis en attente). Le rejet ne déclenche PAS le repli en
   * processus — rejouer 4 s de calcul pour une instance détruite serait
   * exactement le gel qu'on vient de supprimer.
   */
  destroy(): void;

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
  // Le NAMESPACE du point d'entrée `./graph-layout`, gardé plutôt que le seul
  // moteur : le chemin worker en tire aussi `extractGraphLayoutInput`, et le
  // chemin en processus reste construit depuis lui.
  let graphModule: GraphLayoutModule | undefined;
  let graphEngine: GraphLayoutEngine | undefined;
  // Renseignée en même temps que le module, dont elle sort : le défaut vient du
  // cœur (voir `ensureModule`), jamais d'une copie locale du nombre.
  let graphHullPadding = 0;

  // --- Le worker de mise en page, et le peu d'état qu'il demande.
  let workerHandle: GraphLayoutWorkerHandle | null = null;
  // Vrai dès le premier échec, et pour toute la session : voir `retireWorker`.
  let workerRetired = false;
  let controllerDestroyed = false;
  // Le numéro de la prochaine requête. Monotone et jamais réinitialisé, y
  // compris après un `invalidate()` : deux requêtes de la même session ne
  // doivent jamais partager un numéro, sans quoi la réponse de l'une pourrait
  // résoudre l'autre.
  let workerGen = 0;
  const pendingByGen = new Map<
    number,
    { resolve: (result: GraphLayoutResult) => void; reject: (error: unknown) => void }
  >();
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
   * Charge le POINT D'ENTRÉE de la vue graphe à la demande — le namespace, pas
   * seulement le moteur.
   *
   * Le namespace, parce qu'il y a désormais deux chemins qui en tirent des
   * choses différentes : le chemin en processus prend `createTwoLevelLayoutEngine`
   * (voir `ensureEngine`), le chemin worker prend `extractGraphLayoutInput` pour
   * faire, ici, la seule moitié du calcul qui ait besoin du `Graph`. Les deux
   * prennent `TWO_LEVEL_LAYOUT_DEFAULTS`.
   *
   * Le moteur, lui, c'est `createTwoLevelLayoutEngine` — packing en étagères intra-agrégat,
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
   * d'`apps/demo` ne pèse plus que **3,58 ko gzip** (7,80 ko bruts, contre
   * 180,28 / 577,17 avant le retrait), donc ce n'est plus le poids qui justifie
   * la paresse : c'est qu'elle est la forme par défaut de cette vue, et que
   * `setView` est asynchrone pour cette raison. Les deux tests de pureté de
   * bundle portent le raisonnement complet.
   */
  async function ensureModule(): Promise<GraphLayoutModule> {
    if (!graphModule) {
      graphModule = await import("@defsquare/data-graph-core/graph-layout");
      // C'est ici, et NULLE PART ailleurs, qu'on apprend la marge d'enveloppe
      // par défaut : le namespace du module chargé la porte, donc le renderer
      // la connaît sans en garder de copie et sans importer statiquement ce
      // point d'entrée — ce que les deux tests de pureté interdisent. Le
      // déplacement d'une carte en a besoin pour recalculer les disques comme
      // le moteur les a calculés, et il n'y a de disques qu'en vue graphe,
      // c'est-à-dire exactement quand ce module est déjà chargé.
      graphHullPadding =
        hooks.layoutOptions?.hullPadding ?? graphModule.TWO_LEVEL_LAYOUT_DEFAULTS.hullPadding;
    }
    return graphModule;
  }

  /**
   * Le moteur EN PROCESSUS, construit une fois sur le module déjà chargé.
   *
   * Il reste le chemin par défaut (pas d'URL de worker : vitest, headless, hôte
   * sans worker) ET le repli du worker. Le construire paresseusement ici plutôt
   * qu'au chargement du module évite de l'allouer dans la session qui n'utilise
   * que le worker et n'échoue jamais.
   */
  async function ensureEngine(): Promise<GraphLayoutEngine> {
    const mod = await ensureModule();
    if (!graphEngine) graphEngine = mod.createTwoLevelLayoutEngine(hooks.layoutOptions);
    return graphEngine;
  }

  /**
   * Ouvre le worker au PREMIER besoin, et le garde pour la session.
   *
   * Un seul worker, réutilisé : le démarrer coûte le chargement d'un module, et
   * une bascule de vue peut se répéter. Il est ouvert à la première mise en page
   * et non à la construction du contrôleur, pour la raison qui vaut déjà pour le
   * moteur — un consommateur de la seule vue structure ne paie rien de la vue
   * graphe.
   *
   * Rend `null` dès que le worker est hors jeu : pas d'URL fournie, ou repli
   * définitif déjà déclenché.
   */
  function ensureWorker(): GraphLayoutWorkerHandle | null {
    if (workerRetired || !hooks.spawnLayoutWorker) return null;
    if (workerHandle) return workerHandle;
    try {
      workerHandle = hooks.spawnLayoutWorker(onWorkerMessage, onWorkerError);
    } catch (err) {
      // Une construction qui lève (URL injouable, chunk absent, `Worker` absent)
      // se traite exactement comme un calcul qui échoue.
      retireWorker(err);
      return null;
    }
    return workerHandle;
  }

  /**
   * LE REPLI, et il est DÉFINITIF pour la session.
   *
   * Même discipline que le repli d'`elkWorkerUrl` côté vue structure : au
   * premier échec, on avertit une fois et on rejoue en processus, pour toujours.
   * Pas de seconde chance et pas de délai d'attente arbitraire — les deux causes
   * réelles (URL qui ne se charge pas, environnement sans worker utilisable) ne
   * se réparent pas d'un essai à l'autre, et un `setTimeout` sur un calcul dont
   * on sait qu'il dure des secondes ne mesurerait qu'une opinion sur la vitesse
   * de la machine.
   *
   * Les requêtes encore en vol sont rejetées : leurs appelants se replieront
   * chacun de leur côté, ce qui est exactement la bonne chose — elles portent
   * des graphes potentiellement différents.
   */
  function retireWorker(reason: unknown): void {
    if (!workerRetired) {
      workerRetired = true;
      console.warn("[data-graph] graph layout via graphLayoutWorkerUrl failed, falling back to in-process layout", reason);
    }
    closeWorker(new Error("[data-graph] graph layout worker retired"));
  }

  /** Termine le worker et solde les requêtes en vol avec `reason`. */
  function closeWorker(reason: Error): void {
    workerHandle?.terminate();
    workerHandle = null;
    const inFlight = [...pendingByGen.values()];
    pendingByGen.clear();
    for (const entry of inFlight) entry.reject(reason);
  }

  /**
   * L'arrivée d'une réponse. Toute la garde de génération tient dans la
   * recherche : une réponse dont la génération n'a plus de requête en vol est
   * JETÉE en silence — c'est le cas d'un worker qu'on vient de retirer ou de
   * terminer, dont les messages déjà postés continuent d'arriver.
   */
  function onWorkerMessage(data: unknown): void {
    const response = data as GraphLayoutWorkerResponse;
    const entry = pendingByGen.get(response.gen);
    if (!entry) return;
    pendingByGen.delete(response.gen);
    if (!response.ok) {
      entry.reject(new Error(response.message));
      return;
    }
    entry.resolve(hydrateLayout(response));
  }

  /** Une erreur du worker lui-même (et non d'un calcul) : rien ne dit quelle
   * requête elle concerne, donc elle condamne le worker. */
  function onWorkerError(error: unknown): void {
    retireWorker(error);
  }

  /**
   * Reconstruit la mise en page depuis la réponse.
   *
   * Les `Rect` sont alloués ici et les `ClusterShape` viennent du clonage
   * structuré : dans les deux cas ce sont des OBJETS ORDINAIRES ET MUTABLES, et
   * ce n'est pas un détail. Le déplacement d'une carte ou d'un agrégat mute les
   * enveloppes et les rects EN PLACE (`translateCluster`,
   * `recomputeClusterCircle` chez l'appelant), et les calques sémantiques
   * relisent ces mêmes objets à chaque image. Une structure figée ou un
   * `Object.freeze` de confort casserait le déplacement, et seulement lui.
   */
  function hydrateLayout(response: GraphLayoutWorkerResponse & { ok: true }): GraphLayoutResult {
    const positions = new Map<NodeId, Rect>();
    for (const [id, x, y, width, height] of response.positions) {
      positions.set(id, { x, y, width, height });
    }
    return { positions, clusters: response.clusters };
  }

  /** Poste une requête et rend la promesse de SA réponse. */
  function postToWorker(
    worker: GraphLayoutWorkerHandle,
    input: GraphLayoutInput,
  ): Promise<GraphLayoutResult> {
    const gen = ++workerGen;
    return new Promise<GraphLayoutResult>((resolve, reject) => {
      pendingByGen.set(gen, { resolve, reject });
      try {
        worker.post({ gen, input });
      } catch (err) {
        // Un `postMessage` qui lève (entrée non clonable) ne produira jamais de
        // réponse : sans ce rattrapage la promesse resterait en suspens à vie.
        pendingByGen.delete(gen);
        reject(err);
      }
    });
  }

  /**
   * La mise en page, par le worker si l'hôte en a fourni un, en processus
   * sinon — et en processus AUSSI au premier échec du worker.
   *
   * L'EXTRACTION reste ici, sur le thread principal, et c'est structurel : elle
   * est la seule partie qui lise le `Graph`, qui ne traverse pas un
   * `postMessage`. Ce qu'elle coûte est linéaire (une mesure de carte par
   * entité, un balayage des références) ; ce qu'elle épargne est la simulation,
   * qui est tout le temps mesuré.
   */
  async function layoutOf(target: Graph, index: AggregateIndex): Promise<GraphLayoutResult> {
    const mod = await ensureModule();
    const visible = entityIdsOf(target);
    const metrics = hooks.getMetrics();

    const worker = ensureWorker();
    if (worker) {
      const input = mod.extractGraphLayoutInput(target, index, visible, metrics, hooks.layoutOptions);
      try {
        return await postToWorker(worker, input);
      } catch (err) {
        // Une instance détruite ne se replie pas : rejouer en processus le
        // calcul de plusieurs secondes qu'on vient d'abandonner est le contraire
        // de ce que `destroy()` demande.
        if (controllerDestroyed) throw err;
        retireWorker(err);
      }
    }

    return (await ensureEngine()).layout(target, index, visible, metrics);
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
    // `layoutOf` tranche worker / en processus et porte le repli : voir là-bas.
    const layout = await layoutOf(target, base.index);
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

    destroy(): void {
      if (controllerDestroyed) return;
      controllerDestroyed = true;
      closeWorker(new Error("[data-graph] instance destroyed while the graph layout was in flight"));
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
