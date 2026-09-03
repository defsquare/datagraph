// Moteur de mise en page de la vue graphe à DEUX NIVEAUX, et le seul.
//
// Il a remplacé un pipeline global corrigé — `createGraphLayoutEngine`, qui
// demandait à fcose une mise en page de toutes les cartes puis la réparait par
// deux passes de relaxation, `separateOverlaps` (cartes) puis
// `separateClusters` (enveloppes). Ces trois modules ont été RETIRÉS du dépôt
// avec `cytoscape` et `cytoscape-fcose`. Les nombreux renvois ci-dessous les
// nomment encore parce que c'est ce contre quoi les choix d'ici ont été
// mesurés ; leur code vit dans l'historique git, et le doc de sonde cité
// ci-dessous garde les mesures.
//
// Porté depuis la sonde (`bench/layout-two-level.ts`, retirée elle aussi) —
// voir `docs/superpowers/spikes/2026-09-01-two-level-layout.md` pour les
// mesures complètes. L'algorithme est repris à l'identique sur le fond ;
// l'enveloppe change (factory + `layout()` async, pour respecter
// `GraphLayoutEngine`, déclaré plus bas dans ce fichier), et
// deux constantes de la passe dure finale sont resserrées — voir sa
// documentation plus bas, qui donne les mesures et ce qu'elles coûtent. Ces
// deux écarts ne changent rien à la structure ; ils font tenir à toute échelle
// l'invariant que la sonde n'assurait qu'à 1e-3 près et qu'au-delà de ~200
// disques elle rompait silencieusement.
//
// Le principe tient à une propriété du modèle : l'appartenance à un agrégat est
// une PARTITION stricte (voir `aggregate.ts`), donc le problème se décompose
// sans recouvrement de responsabilités.
//
//   1. INTRA-agrégat — chaque agrégat est packé indépendamment des autres, en
//      RADIAL (racine au centre, un anneau par distance de référence) s'il a de
//      la profondeur, en ÉTAGÈRES (lignes centrées) sinon ; l'aiguillage et sa
//      justification sont au-dessus de `packCluster`. Dans les deux cas la
//      marge `cardGap` est INCLUSE dans le placement, donc le non-recouvrement
//      des cartes d'un même agrégat est acquis par construction et pas par
//      relaxation.
//   2. INTER-agrégat — chaque agrégat devient un disque rigide : le cercle
//      englobant minimal de ses cartes plus `hullPadding`, c'est-à-dire
//      exactement la forme que le renderer peint. Une entité hors agrégat est
//      un disque singleton, comme dans le `separateClusters` retiré. Les
//      références inter-agrégats sont agrégées en ressorts pondérés ; une petite
//      simulation pose les disques, et une passe dure finale fait de
//      dist ≥ r₁ + r₂ + `clusterGap` un INVARIANT DE SORTIE, pas un espoir de
//      convergence.
//
// Conséquence structurelle : il n'existe plus aucune passe de séparation de
// cartes. Deux cartes d'agrégats différents ne peuvent pas se recouvrir
// puisque leurs disques ne se touchent pas, et deux cartes du même agrégat
// sont packées avec marge. Le coût ne suit donc plus le nombre de CARTES mais
// le nombre d'AGRÉGATS : O(k² · itérations) sur k disques, plus un packing
// linéaire.
//
// Mesuré par la sonde (médiane de 3 runs, `clusterGap: 160` et
// `hullPadding: 18` des deux côtés, donc à garanties égales) :
//
//   bigShop(3000) du cœur — 334 entités, 167 agrégats, 0 réf. inter-agrégat
//     temps        1 624 ms → 143 ms (×11)
//     bbox         8 370×8 418 → 6 026×5 929 (aire ÷2,0)
//     remplissage  6,2 % → 12,3 %
//     paires de cartes sous 16 px : 28 → 0
//
//   bigShop(4000) de la démo — 350 entités, 108 agrégats + 8 singletons,
//   264 références inter-agrégats (le jeu des ~4,2 s de `setView("graph")`)
//     temps        4 138 ms → 64 ms (×65)
//     bbox         18 714×19 984 → 8 083×8 437 (aire ÷5,5)
//     remplissage  2,8 % → 15,1 %
//     longueur moyenne d'une réf. inter-agrégat : 6 104 px → 1 364 px (÷4,5)
//
// Pourquoi le remplissage double à quintuple, et ce n'est pas un réglage : dans
// le pipeline retiré, fcose éparpillait les membres d'un agrégat, donc le
// cercle englobant gonflait, donc `separateClusters` écartait de GRANDS cercles
// presque vides. Ici le cercle est minimal par construction — les cartes sont
// packées AVANT que le cercle existe — donc tout l'écartement est du couloir
// utile.
//
// Ce moteur n'importe NI cytoscape NI elkjs : il ne dépend que du cœur pur
// (`hull.ts`, `measure.ts`). Voir `graph-layout.ts` pour le canal d'exposition.
//
// CE QUE CE MOTEUR NE TRANCHE PAS (réserves de la sonde, reprises telles
// quelles parce qu'aucune n'a été levée depuis) :
//
//   - RÉSERVE LEVÉE. Le packing intra-agrégat ignorait les arêtes ; il existe
//     désormais en DEUX MODES, et le choix se fait par cluster sur la
//     PROFONDEUR de références — voir l'exposé du critère au-dessus de
//     `packCluster`, qui est l'endroit où cette histoire est racontée en
//     entier.
//
//     En deux lignes : le radial (racine au centre, un anneau par distance)
//     encode la profondeur en distance au centre, ce qui n'a de sens que s'il
//     y a une profondeur à encoder ; les étagères, plus denses, prennent tout
//     le reste. Mesuré sur `deepAggregate()` — 41 cartes, 4 niveaux :
//     référence intra-agrégat moyenne 591,4 → 363,0 px, max 976,3 → 488,1 px,
//     racine du 40e au 1er rang par proximité au centre (597,7 → 16,4 px). Et
//     sur les deux jeux réels du dépôt, dont tous les agrégats sont plats, le
//     remplissage ne bouge pas d'un dixième — 12,3 % (cœur) et 15,1 % (démo) —
//     parce qu'ils restent en étagères.
//   - O(k²) sur les agrégats : 143 ms à 167 disques dans la sonde, 194 ms ici
//     une fois la passe dure resserrée. Mais la croissance est quadratique —
//     mesuré à 500 disques (bigShop(9000), 1 000 cartes) : 3,6 s. Grille
//     spatiale pour la collision et Barnes-Hut pour les ressorts la
//     ramèneraient à k log k, à ne faire que si ce cardinal devient réel.
//   - La passe dure finale peut défaire un ressort : la garantie d'écart prime
//     sur la longueur d'arête. À 264 références sur 116 disques ça ne se voit
//     pas ; un graphe inter-agrégat très dense pourrait se dégrader — non
//     sondé.
//   - L'esthétique est régulière, pas organique (pavage quasi hexagonal sur les
//     agrégats sans arêtes). Assumé, mais c'est un choix de produit.
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./layout.js"
import { enclosingCircle } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"

// Le contrat de la vue graphe — l'enveloppe, le résultat, l'interface du moteur
// — est déclaré ICI depuis le retrait de `layout-graph.ts`, où il vivait tant
// que deux moteurs le partageaient. Il n'en reste qu'un, et un module de types
// dont le seul contenu serait ces trois interfaces demanderait sa propre
// justification. Ce qu'un consommateur importe ne bouge pas pour autant : le
// point d'entrée `./graph-layout` les republie, sous les mêmes noms.
//
// Ces types restent nommés « Graph… » et non « TwoLevel… » : ils décrivent la
// VUE, pas l'algorithme. Un second moteur de vue graphe les réimplémenterait
// tels quels — c'est exactement ce qui vient de se passer dans l'autre sens.

/** Enveloppe d'un agrégat : un disque, dans le repère de `positions`. */
export interface ClusterShape {
  aggregateId: string
  rootId: NodeId
  cx: number
  cy: number
  r: number
}

export interface GraphLayoutResult extends LayoutResult {
  clusters: ClusterShape[]
}

/**
 * Le moteur de mise en page de la vue graphe.
 *
 * `layout()` est asynchrone par contrat, pas par nécessité : l'implémentation
 * actuelle est entièrement synchrone (voir `createTwoLevelLayoutEngine`), mais
 * celle qu'elle remplace attendait un `layoutstop` de cytoscape, et le
 * renderer `await` déjà ce résultat. Rendre la signature synchrone
 * n'achèterait rien et fermerait la porte à une implémentation qui céderait la
 * main — un Web Worker, par exemple.
 */
export interface GraphLayoutEngine {
  layout(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<GraphLayoutResult>
}

export interface TwoLevelLayoutOptions {
  /** Marge entre le coin de carte le plus éloigné du centre de l'enveloppe et
   * le bord de celle-ci. Même sens et même valeur que dans le moteur retiré :
   * c'est le rayon du disque que le renderer peint. */
  hullPadding?: number
  /** Marge entre deux cartes d'un même agrégat, INCLUSE dans le packing (donc
   * acquise par construction, là où le `separationMargin` du moteur retiré
   * était le but d'une relaxation plafonnée). */
  cardGap?: number
  /** Écart bord à bord garanti entre deux disques d'agrégats. */
  clusterGap?: number
  /** Itérations de la simulation à ressorts du niveau 2. */
  simIterations?: number
  /**
   * Amplitude, en pixels, du gonflement virtuel des disques PENDANT la
   * simulation — le bruit déterministe qui casse la régularité du pavage. `0`
   * le désactive. Voir le commentaire au-dessus de `simR` pour le mécanisme et
   * `TWO_LEVEL_LAYOUT_DEFAULTS` pour le choix de l'amplitude.
   *
   * Ce réglage ne peut pas dégrader une garantie : la passe dure finale ignore
   * le gonflement, et la forme peinte n'est jamais gonflée.
   */
  jitter?: number
}

/**
 * Les valeurs par défaut, EXPORTÉES — et pas seulement parce que c'est plus
 * poli. Le renderer a besoin de `hullPadding` pour recalculer l'enveloppe d'un
 * agrégat quand une carte est déplacée à la souris : sans cette constante, il
 * en garderait une copie, et le jour où la valeur bouge ici les enveloppes
 * peintes après un déplacement ne coïncideraient plus avec celles que le moteur
 * calcule — un décalage silencieux de 18 px, visible seulement après un drag.
 *
 * Il la lit par le NAMESPACE de l'`import()` dynamique de la vue graphe, celui
 * de `ensureGraphEngine`, et non par un import statique : les deux tests de
 * pureté de bundle exigent que ce module ne soit atteignable que par là. C'est
 * gratuit — la constante n'a de sens qu'en vue graphe, donc exactement quand ce
 * module est déjà chargé.
 */
export const TWO_LEVEL_LAYOUT_DEFAULTS: Required<TwoLevelLayoutOptions> = {
  // Repris du moteur retiré sans les rejuger : ce sont les mêmes formes
  // dessinées et le même contrat visuel. La sonde a mesuré les deux moteurs
  // avec ces valeurs des deux côtés, pour comparer à garanties égales.
  //
  // `clusterGap: 160` n'est pas un choix au goût : il vient d'un balayage
  // complet (gap 0 / 80 / 160 / 240 / 320 / 400, en mesurant recouvrements
  // d'enveloppes, écart au plus proche voisin, bbox et remplissage) fait sur le
  // moteur retiré. Le tableau vivait dans son `DEFAULTS` ; il est reporté dans
  // la section « Graph view » du README racine, et son code dans l'historique
  // git. Ce qu'il établit et qui vaut toujours : la CORRECTION — zéro paire
  // d'enveloppes en recouvrement — est déjà acquise à 80 px, tout ce qui est
  // au-dessus achète de la largeur de couloir. 160 px valent 10× `cardGap` et
  // une hauteur et demie de carte : l'écart se voit sans zoomer.
  //
  // Il n'a PAS été re-balayé sur ce moteur-ci, et le résultat serait
  // différent : le balayage mesurait des cercles gonflés par l'éparpillement de
  // fcose, là où ceux d'ici sont minimaux par construction. À remesurer si la
  // valeur redevient une question ; elle ne l'est pas devenue.
  hullPadding: 18,
  cardGap: 16,
  clusterGap: 160,
  // CALIBRÉ, et « calibré » veut dire MESURÉ — pas nécessairement changé. Ces
  // quatre constantes du niveau 2 (400 itérations, force de ressort 0,15,
  // plafond de poids `min(1, w/2)`, gravité 0,02) étaient le PREMIER jeu
  // essayé, ce que ce commentaire disait sans détour. Le balayage a été fait ;
  // il les CONFIRME toutes les quatre, et c'est un résultat, pas une absence de
  // résultat.
  //
  // Trois fixtures, choisis parce qu'ils épuisent les régimes du niveau 2 :
  // **A** `bigShop(3000)` — 167 disques, ZÉRO arête, donc seules la gravité et
  // la collision agissent ; **B** le jeu de la démo — 116 disques, degré moyen
  // 4,6 ; **D** `denseRefs()` — 80 disques, degré 12,0 partout, le fixture de
  // la réserve « un graphe inter-agrégat très dense pourrait se dégrader ».
  // Métrique de qualité : la longueur moyenne d'une référence INTER-agrégat,
  // celle que les ressorts servent. Le moteur étant déterministe, un run par
  // configuration suffit.
  //
  //   FORCE DE RESSORT (réf. inter moyenne)      B       D      sd nn sur D
  //     0,05                                   2084    1699       13,1
  //     0,10                                   1557    1618       13,1
  //     0,15  ← retenue                        1439  **1554**     11,8
  //     0,25                                   1418    1611        7,9
  //     0,40                                   1398    1694        4,1
  //
  // 0,15 est le MINIMUM EXACT sur D. Au-delà, les ressorts tirent si fort que
  // la passe dure doit les contredire, et les références RALLONGENT au lieu de
  // raccourcir — c'est précisément la réserve n°5 de la sonde, observée. Sur B,
  // 0,40 gagne 3 % de longueur, pour un écart-type de voisinage divisé par 3.
  //
  //   PLAFOND DE POIDS min(1, w/N)               B       D      sd nn sur D
  //     N=1 (aucune gradation)                  1341    1570        4,7
  //     N=2  ← retenu                           1439  **1554**     11,8
  //     N=4                                     1753    1589       11,7
  //     N=8                                     2155    1756       12,1
  //
  //   GRAVITÉ                            A rempl.      B       D
  //     0,005                               8,9 %    1445    1543
  //     0,01                                9,5 %    1407    1614
  //     0,02  ← retenue                  **10,3 %**  1439    1554
  //     0,04                               10,3 %    1497    1572
  //     0,08                               10,7 %    1687    1685   (339 passes dures)
  //
  //   ITÉRATIONS                         A rempl.      B       D      sd nn sur D   ms (A/B/D)
  //     100                                 9,5 %    1609    1742        4,1        66/45/39
  //     200                                10,1 %    1487    1647        4,4        53/36/23
  //     400  ← retenues                    10,3 %    1439  **1554**     11,8        88/58/32
  //     800                                10,7 %    1392    1582       12,8       170/98/59
  //    1600                                 9,9 %    1392    1560       13,0      342/187/117
  //
  // CE QUE LE BALAYAGE A APPRIS, et qui n'était pas prévu : **les constantes du
  // niveau 2 et le `jitter` interagissent**. Une force de ressort forte (0,25,
  // 0,40) ou des poids non gradués (N=1) RECOMPRIMENT le pavage et défont le
  // bruit — l'écart-type de l'écart au plus proche voisin tombe de 11,8 à 4,1
  // px sur D, soit l'essentiel de ce que `jitter: 32` avait acheté. Un
  // `simIterations` trop bas fait pareil, pour une autre raison : à 100 ou 200
  // la simulation n'a pas convergé assez pour que la variance s'exprime (4,1 et
  // 4,4). Les valeurs retenues sont donc aussi celles qui LAISSENT le jitter
  // fonctionner, ce qui n'était pas un critère au moment de le régler.
  //
  // LE SEUL ARBITRAGE RÉEL, exposé plutôt que tranché en douce : la grille
  // croisée donne `spring 0,15 / gravité 0,01 / N=1` meilleur sur B (référence
  // 1282 contre 1439, −11 %). Il est écarté parce qu'il coûte l'écart-type de D
  // (11,8 → 6,3) et 0,8 point de remplissage sur A. B est un cas nominal parmi
  // trois ; sacrifier le pavage de A et la densité de D pour 11 % sur lui seul
  // n'est pas un bon échange, et la mesure ne le dit pas — c'est un jugement,
  // et il est ici pour être contesté.
  //
  // Ce que ces constantes N'ACHÈTENT PAS, à aucune valeur : la correction. Les
  // garanties de sortie (non-recouvrement des cartes, écart des disques) sont
  // portées par le packing et par la passe dure finale. `min nn = 160,00 px`
  // dans les 27 configurations mesurées, sans exception.
  simIterations: 400,
  // RÉGLAGE D'ŒIL, comme `clusterGap`, et assumé comme tel — mais pas choisi
  // sans chiffres. Ce que le jitter corrige est un artefact visuel : sur des
  // disques de MÊME rayon, gravité + collision convergent vers l'empilement
  // hexagonal, qui est l'optimum de densité de cercles égaux. `bigShop(3000)`
  // — 167 agrégats identiques, aucune arête entre eux — sortait en pavage
  // hexagonal si régulier que les alignements traversaient toute la toile.
  //
  // La métrique qui objective ça est l'ÉCART-TYPE de l'écart bord à bord au
  // plus proche voisin entre disques. À jitter nul il vaut **0,00 px** : tous
  // les voisins exactement à `clusterGap`, ce qui EST la définition d'un
  // réseau régulier. Balayage complet, `bigShop(3000)` :
  //
  //   jitter | é.-type nn | moyenne nn | min nn | remplissage |   bbox
  //        0 |    0,00 px |   160,0 px | 160,00 |    12,3 %   | 6026×5929
  //       16 |    6,36 px |   166,1 px | 160,00 |    11,2 %   | 6141×6397
  //       32 |   12,02 px |   177,9 px | 160,00 |    10,3 %   | 6394×6692
  //       48 |   17,65 px |   189,2 px | 160,00 |     9,8 %   | 6617×6806
  //       64 |   22,72 px |   201,5 px | 160,00 |     8,9 %   | 6917×7142
  //
  // La colonne qui compte le plus est `min nn` : **160,00 à toutes les
  // amplitudes**. La garantie ne bouge pas d'un centième, parce que la passe
  // dure finale ignore le gonflement. Le jitter n'achète que de la variance.
  //
  // 32 RETENU, aux rendus (les quatre SVG sont dans la section B du doc de
  // sonde). À 16 les alignements diagonaux survivent par plaques : l'œil lit
  // encore un réseau. À 32 plus aucun alignement long ne subsiste, alors que le
  // champ reste uniformément dense — ni trou ni grappe. À 48 la variance
  // commence à se voir comme telle, avec des couloirs franchement plus larges
  // que d'autres, sans que le rendu soit plus « vivant » qu'à 32 ; elle coûte
  // 0,5 point de remplissage de plus pour ça.
  //
  // Ce que 32 coûte, précisément : sur `bigShop(3000)`, remplissage 12,3 →
  // 10,3 % (−2,0 points) et bbox 6026×5929 → 6394×6692, parce que l'écart
  // MOYEN monte de 160,0 à 177,9 px — gonfler les disques pendant la
  // simulation les fait converger un peu plus au large. Sur le jeu de la démo
  // le coût est dans le bruit et non monotone (15,1 % à 0, 15,5 % à 16, 13,7 %
  // à 32, 14,8 % à 48) : ses ressorts inter-agrégats rebattent la mise en page
  // à chaque amplitude, donc la comparaison amplitude par amplitude n'y a pas
  // de sens fin. C'est le fixture SANS arête qui isole l'effet, et c'est sur
  // lui que le choix se fait.
  jitter: 32,
}

/** Hachage FNV-1a de l'id — le MÊME que celui du moteur retiré, et pour la
 * même raison : c'est toute la source d'« aléa » du moteur. Aucun `Math.random`
 * ni `Date.now` n'intervient nulle part ici, sans quoi le déterminisme au bit
 * près, asserté par les tests, tomberait. */
function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Un cluster du niveau 2 : un agrégat, ou une entité seule promue en disque. */
interface LocalCluster {
  id: string
  /** `null` pour un singleton hors agrégat — il n'émettra pas d'enveloppe. */
  rootId: NodeId | null
  isAggregate: boolean
  /** Ordre du packing : racine d'abord, puis ids triés. */
  memberIds: NodeId[]
  /** Rects LOCAUX, recentrés pour que le centre du cercle englobant soit à
   * l'origine — c'est ce qui permet de traiter le cluster comme un disque
   * centré en (x, y) au niveau 2. */
  local: Map<NodeId, Rect>
  r: number
  x: number
  y: number
}

/**
 * Rayon du disque englobant d'une carte : la demi-diagonale.
 *
 * C'est la pièce qui rend la géométrie des anneaux traitable. Une carte est un
 * rectangle axis-aligned posé à un angle quelconque autour d'un centre ; tester
 * le recouvrement de deux rectangles ainsi disposés demande de raisonner sur
 * quatre projections et deux positions angulaires. En les remplaçant par leurs
 * disques englobants, la condition devient une seule inégalité de distance,
 * indépendante de l'angle : deux cartes dont les disques sont disjoints d'au
 * moins `gap` sont disjointes d'au moins `gap`.
 *
 * C'est une condition SUFFISANTE, pas nécessaire — donc conservatrice. Ce
 * qu'elle coûte est borné et petit sur ces cartes : le disque déborde le
 * rectangle de `(diagonale − largeur) / 2`, soit 7,1 px pour une carte de
 * 340×100 et 4,6 px pour une de 140×49. Un test exact gagnerait ces quelques
 * pixels au prix d'une garantie qu'on ne saurait plus écrire en une ligne.
 */
function discRadiusOf(size: { width: number; height: number }): number {
  return Math.hypot(size.width, size.height) / 2
}

/**
 * Distance de référence de chaque membre à la racine, par BFS local sur les
 * références INTRA-agrégat.
 *
 * Le parcours remonte de la CIBLE vers la SOURCE, comme `buildAggregates` : une
 * commande pointe vers son client, donc elle est à distance 1 de lui. C'est ce
 * qui fait coïncider la distance d'anneau avec la distance d'appartenance qui a
 * formé le cluster. Les listes d'adjacence étant triées, la file est
 * déterministe et les égalités sont départagées par id.
 *
 * Les membres NON ATTEINTS ne figurent pas dans `dist`. Ils existent :
 * l'appartenance se calcule sur le graphe entier, la mise en page sur les
 * entités VISIBLES, donc un maillon intermédiaire masqué détache tout ce qui
 * pendait dessous. Ils sont rendus à part parce que les deux consommateurs les
 * traitent différemment — le placement radial leur donne un anneau
 * supplémentaire, le CRITÈRE de choix les ignore.
 */
function referenceDepths(
  memberIds: NodeId[],
  childrenOf: Map<NodeId, NodeId[]>,
): { dist: Map<NodeId, number>; parent: Map<NodeId, NodeId>; maxDist: number; orphans: NodeId[] } {
  const rootId = memberIds[0]!
  const memberSet = new Set(memberIds)
  const dist = new Map<NodeId, number>([[rootId, 0]])
  const parent = new Map<NodeId, NodeId>()
  const queue: NodeId[] = [rootId]
  let maxDist = 0

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const next = dist.get(current)! + 1
    for (const child of childrenOf.get(current) ?? []) {
      if (!memberSet.has(child) || dist.has(child)) continue
      dist.set(child, next)
      parent.set(child, current)
      queue.push(child)
      if (next > maxDist) maxDist = next
    }
  }

  const orphans: NodeId[] = []
  for (const id of memberIds) if (!dist.has(id)) orphans.push(id)
  return { dist, parent, maxDist, orphans }
}

/**
 * Packing en ÉTAGÈRES : lignes remplies de gauche à droite jusqu'à une largeur
 * cible en √(aire totale), chaque ligne centrée.
 *
 * Trivial, déterministe, dense — et non-recouvrant par construction, la marge
 * `gap` étant posée entre deux voisins de ligne comme entre deux lignes. Les
 * lignes sont CENTRÉES et non alignées à gauche : un bloc centré donne un
 * cercle englobant plus serré, donc un disque plus petit à écarter au niveau 2.
 *
 * La largeur cible en √(aire) vise un bloc à peu près carré ; `maxW` la borne
 * par le bas pour qu'une carte plus large que la cible ne parte jamais seule
 * sur une ligne débordante.
 *
 * C'est le mode le plus DENSE des deux, et c'est sa seule raison d'être ici :
 * il ne dit rien de la connectivité, et pose la racine en tête de la première
 * ligne, donc dans un coin. Voir `packCluster` pour savoir quand il l'emporte.
 */
function packShelf(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
): Map<NodeId, Rect> {
  let totalArea = 0
  let maxW = 0
  for (const id of memberIds) {
    const s = sizes.get(id)!
    totalArea += (s.width + gap) * (s.height + gap)
    if (s.width > maxW) maxW = s.width
  }
  const targetW = Math.max(maxW, Math.sqrt(totalArea))

  const rows: { ids: NodeId[]; width: number; height: number }[] = []
  let current: { ids: NodeId[]; width: number; height: number } = { ids: [], width: 0, height: 0 }
  for (const id of memberIds) {
    const s = sizes.get(id)!
    const w = s.width + (current.ids.length > 0 ? gap : 0)
    if (current.ids.length > 0 && current.width + w > targetW) {
      rows.push(current)
      current = { ids: [], width: 0, height: 0 }
    }
    current.ids.push(id)
    current.width += current.ids.length > 1 ? s.width + gap : s.width
    current.height = Math.max(current.height, s.height)
  }
  if (current.ids.length > 0) rows.push(current)

  const blockW = Math.max(...rows.map((r) => r.width))
  const local = new Map<NodeId, Rect>()
  let y = 0
  for (const row of rows) {
    let x = (blockW - row.width) / 2
    for (const id of row.ids) {
      const s = sizes.get(id)!
      local.set(id, { x, y, width: s.width, height: s.height })
      x += s.width + gap
    }
    y += row.height + gap
  }
  return local
}

/**
 * Placement RADIAL : la racine au centre, les autres membres sur des anneaux
 * concentriques, un anneau par distance de référence à la racine.
 *
 * Ce qu'il corrige, mesuré sur `deepAggregate()` — 41 cartes, quatre niveaux de
 * profondeur — contre le packing en étagères : la racine sortait **40e sur 41**
 * par proximité au centre de son propre disque, à 597,7 px de ce centre, et une
 * référence intra-agrégat mesurait 591,4 px en moyenne. Le tri par id posait la
 * racine en tête de la première ligne, c'est-à-dire dans un COIN du bloc — le
 * point le plus éloigné du centre du cercle englobant. En radial : racine 1re,
 * à 16,4 px du centre, référence moyenne 363,0 px et max 976,3 → 488,1 px.
 *
 * ── LA GARANTIE ────────────────────────────────────────────────────────────
 *
 * Non-recouvrement avec marge `gap`, par construction, en deux conditions
 * indépendantes. On raisonne sur les disques englobants (`discRadiusOf`), donc
 * sur des distances de centre à centre.
 *
 * **1. Entre deux cartes d'un même anneau.** Une carte de disque ρ posée à la
 * distance R du centre se voit allouer la largeur angulaire
 *
 *     α = 2·asin((ρ + gap/2) / R)
 *
 * qui est exactement l'angle sous lequel on voit, depuis le centre, un disque
 * de rayon `ρ + gap/2` centré à la distance R. Deux cartes consécutives i et j
 * sont posées à un écart angulaire d'au moins `α_i/2 + α_j/2`. Leur distance
 * de centre à centre est la corde `2R·sin(Δθ/2)`, et
 *
 *     2R·sin((x + y)/2)  ≥  R·sin x + R·sin y     avec x = asin(a/R), y = asin(b/R)
 *
 * parce que `sin x + sin y = 2·sin((x+y)/2)·cos((x−y)/2)` et que le cosinus
 * vaut au plus 1. Le membre de droite vaut `a + b = ρ_i + ρ_j + gap`. La corde
 * est donc toujours au moins égale à la somme des rayons plus la marge. C'est
 * cette identité trigonométrique, et rien d'autre, qui porte la garantie
 * intra-anneau — elle vaut pour toute paire, pas seulement pour des voisines,
 * puisque l'écart angulaire ne fait que croître entre non-voisines.
 *
 * La condition de bouclage est donc `Σα_i ≤ 2π` : c'est elle qui garantit que
 * la DERNIÈRE carte et la PREMIÈRE, qui se rejoignent par l'autre côté, sont
 * elles aussi assez écartées.
 *
 * **2. Entre deux cartes d'anneaux différents.** Le rayon d'un anneau est posé
 * à `R_k = R_{k−1} + ρmax_{k−1} + ρmax_k + gap`. Deux cartes d'anneaux
 * différents sont donc distantes d'au moins `R_k − R_{k−1}` (le pire cas est
 * l'alignement radial), soit au moins `ρ_i + ρ_j + gap`. Les anneaux non
 * consécutifs le sont a fortiori, R croissant.
 *
 * ── SCISSION D'UN ANNEAU ───────────────────────────────────────────────────
 *
 * Un anneau de N cartes ne « déborde » jamais au sens où il échouerait : on
 * pourrait toujours grossir R jusqu'à ce que `Σα ≤ 2π`. Mais ce R croît
 * linéairement en N, alors que le scinder en deux demi-anneaux fait croître
 * deux rayons de N/2 chacun — et deux anneaux séparés par une hauteur de carte
 * coûtent bien moins que le double du rayon. On remplit donc l'anneau
 * GLOUTONNEMENT au rayon minimal autorisé par la condition 2, et ce qui ne
 * tient pas part sur un anneau suivant, à la MÊME distance logique. Les
 * sous-anneaux se comportent en tout point comme des anneaux pour la condition
 * 2, donc la garantie traverse la scission sans changement.
 *
 * Le remplissage se termine toujours : `α ≤ π` pour toute carte (l'`asin` est
 * borné par π/2), donc au moins une carte tient sur chaque sous-anneau.
 *
 * ── ORDRE ──────────────────────────────────────────────────────────────────
 *
 * À l'intérieur d'un anneau, les cartes sont ordonnées par ANGLE DU PARENT puis
 * par id : un enfant se pose près de son parent, ce qui est ce qui raccourcit
 * les chaînes de références. Les ORPHELINS (voir `referenceDepths`) forment un
 * anneau supplémentaire au-delà du dernier ; ils n'ont pas de parent, retombent
 * sur l'angle 0, et leur id tranche.
 */
function packRadial(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  depths: ReturnType<typeof referenceDepths>,
): Map<NodeId, Rect> {
  const local = new Map<NodeId, Rect>()
  const rootId = memberIds[0]!

  const rectFor = (id: NodeId, cx: number, cy: number) => {
    const s = sizes.get(id)!
    local.set(id, { x: cx - s.width / 2, y: cy - s.height / 2, width: s.width, height: s.height })
  }

  rectFor(rootId, 0, 0)
  if (memberIds.length === 1) return local

  const { dist, parent, orphans } = depths
  let maxDist = depths.maxDist
  if (orphans.length > 0) {
    maxDist++
    for (const id of orphans) dist.set(id, maxDist)
  }

  const rings: NodeId[][] = Array.from({ length: maxDist + 1 }, () => [])
  for (const id of memberIds) {
    if (id !== rootId) rings[dist.get(id)!]!.push(id)
  }

  const angleOf = new Map<NodeId, number>([[rootId, 0]])
  let prevR = 0
  let prevMaxRho = discRadiusOf(sizes.get(rootId)!)

  for (let k = 1; k <= maxDist; k++) {
    const pending = rings[k]!.slice().sort((a, b) => {
      const pa = angleOf.get(parent.get(a) ?? rootId) ?? 0
      const pb = angleOf.get(parent.get(b) ?? rootId) ?? 0
      return pa !== pb ? pa - pb : a < b ? -1 : 1
    })

    let from = 0
    while (from < pending.length) {
      // ρmax est pris sur tout ce qui RESTE à poser, et non sur ce qui tiendra
      // sur ce sous-anneau : il faut R pour savoir ce qui tient, et ρmax pour
      // savoir R. Prendre le max du reste est le choix conservateur, donc sûr.
      let maxRho = 0
      for (let i = from; i < pending.length; i++) {
        maxRho = Math.max(maxRho, discRadiusOf(sizes.get(pending[i]!)!))
      }
      const R = prevR + prevMaxRho + maxRho + gap

      const widths: number[] = []
      let sum = 0
      let to = from
      while (to < pending.length) {
        const rho = discRadiusOf(sizes.get(pending[to]!)!)
        const a = 2 * Math.asin(Math.min(1, (rho + gap / 2) / R))
        if (to > from && sum + a > 2 * Math.PI) break
        widths.push(a)
        sum += a
        to++
      }

      // Le jeu restant est réparti également entre les N intervalles (les N−1
      // internes plus celui du bouclage) : les cartes s'étalent au lieu de se
      // tasser sur un arc en laissant un trou. Ça ne fait qu'AUGMENTER les
      // écarts, donc la garantie est intacte.
      const n = to - from
      const slack = (2 * Math.PI - sum) / n

      // Rotation rigide de tout le sous-anneau pour que sa première carte se
      // pose à l'angle de son parent. Rigide, donc sans effet sur la garantie.
      const firstParent = parent.get(pending[from]!)
      const offset = (firstParent !== undefined ? (angleOf.get(firstParent) ?? 0) : 0) - widths[0]! / 2

      let theta = offset
      let placedMaxRho = 0
      for (let i = from; i < to; i++) {
        const id = pending[i]!
        const a = widths[i - from]!
        theta += i === from ? a / 2 : a / 2 + slack
        angleOf.set(id, theta)
        rectFor(id, R * Math.cos(theta), R * Math.sin(theta))
        theta += a / 2
        placedMaxRho = Math.max(placedMaxRho, discRadiusOf(sizes.get(id)!))
      }

      prevR = R
      prevMaxRho = placedMaxRho
      from = to
    }
  }

  return local
}

/**
 * Aiguillage entre les deux modes de placement, par cluster.
 *
 * ── LE CRITÈRE : LA PROFONDEUR, PAS LE CARDINAL ────────────────────────────
 *
 * Radial si et seulement si **au moins un membre est à distance de référence
 * ≥ 2 de la racine**. Étagères sinon.
 *
 * Ce que fait le radial, c'est ENCODER LA PROFONDEUR DE RÉFÉRENCE EN DISTANCE
 * AU CENTRE. À profondeur ≤ 1, il n'y a rien à encoder : tous les non-racines
 * sont à la même distance, ils se retrouvent sur un unique anneau, et la
 * structure lue par l'œil ne dit rien de plus que « ces cartes appartiennent à
 * cette racine » — ce que l'enveloppe disait déjà. Le radial n'y apporte que
 * son coût.
 *
 * Et ce coût est mesuré. Le radial est moins dense partout, parce qu'un anneau
 * paie un diamètre de carte de rayon même s'il ne porte qu'une carte. Rayon du
 * disque, étagères → radial : 2 cartes 162 → 209 px (×1,29), 3 cartes 225 → 335
 * (×1,49), 5 cartes sur un anneau 258 → 371 (×1,44). Répercuté sur les jeux
 * réels, en radial partout : remplissage 12,3 → 7,8 % sur `bigShop(3000)` et
 * 15,1 → 10,9 % sur celui de la démo — pour zéro gain, leurs agrégats étant
 * tous plats.
 *
 * Le critère ne mentionne AUCUNE taille, et c'est délibéré. Un seuil par
 * cardinal aurait été ajusté aux fixtures : celui qui annulait le coût sur les
 * jeux du dépôt valait exactement leur taille maximale d'agrégat (5), ce qui
 * n'est pas une raison mais une coïncidence qu'on aurait gravée. Le critère de
 * profondeur, lui, est ajusté à la RAISON D'ÊTRE du radial, et se prononce sans
 * rien savoir du nombre de cartes.
 *
 * ── LES ORPHELINS SONT EXCLUS DU CRITÈRE ───────────────────────────────────
 *
 * Un membre non atteint par le BFS local (maillon intermédiaire masqué, voir
 * `referenceDepths`) reçoit en radial un anneau SYNTHÉTIQUE au-delà du dernier.
 * Cet anneau-là ne doit pas déclencher le radial : il ne traduit aucune
 * profondeur de référence, seulement une absence d'information. Sans cette
 * exclusion, un agrégat parfaitement plat dont une carte serait détachée
 * basculerait en radial et en paierait le prix pour rien. Le critère lit donc
 * `depths.dist`, qui ne contient que les membres réellement atteints.
 *
 * ── CE QUE LES DEUX MODES PARTAGENT ────────────────────────────────────────
 *
 * La même signature, et la même garantie : non-recouvrement avec marge `gap`
 * par construction. Chacun l'obtient à sa manière — les étagères par des lignes
 * et des colonnes séparées de `gap`, le radial par la géométrie des cordes
 * démontrée au-dessus de `packRadial` —, et le reste du moteur n'a pas à savoir
 * lequel a répondu.
 */
function packCluster(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  /** Membres du cluster référençant la clé — l'adjacence inverse, triée. */
  childrenOf: Map<NodeId, NodeId[]>,
): Map<NodeId, Rect> {
  if (memberIds.length === 1) {
    // Une seule carte : les deux modes donnent le même résultat au recentrage
    // près, et le BFS n'aurait rien à parcourir.
    const s = sizes.get(memberIds[0]!)!
    return new Map([[memberIds[0]!, { x: 0, y: 0, width: s.width, height: s.height }]])
  }

  const depths = referenceDepths(memberIds, childrenOf)
  let deep = false
  for (const d of depths.dist.values()) {
    if (d >= 2) {
      deep = true
      break
    }
  }
  return deep ? packRadial(memberIds, sizes, gap, depths) : packShelf(memberIds, sizes, gap)
}

function run(
  graph: Graph,
  aggregates: AggregateIndex,
  visible: Set<NodeId>,
  metrics: NodeMetrics,
  o: Required<TwoLevelLayoutOptions>,
): GraphLayoutResult {
  // Sommets : les entités visibles, et rien d'autre. Les nœuds structurels
  // (racine, tableaux, objets) n'existent pas dans cette vue. Le tri est une
  // CONDITION du déterminisme, pas une commodité de lecture.
  const entityIds: NodeId[] = []
  for (const id of visible) {
    const node = graph.nodes.get(id)
    if (node && node.kind === "entity") entityIds.push(id)
  }
  entityIds.sort()

  const sizes = new Map<NodeId, { width: number; height: number }>()
  for (const id of entityIds) sizes.set(id, measureNode(graph.nodes.get(id)!, metrics))

  // Partition en clusters : l'agrégat s'il existe, un singleton sinon. Le
  // `byNode[0]` est sûr parce que l'appartenance est une partition — chaque
  // tableau tient au plus un id (voir `AggregateIndex`).
  const clusterOf = new Map<NodeId, string>()
  const members = new Map<string, NodeId[]>()
  for (const id of entityIds) {
    const aggIds = aggregates.byNode.get(id)
    const cid = aggIds && aggIds.length > 0 ? aggIds[0]! : `single:${id}`
    clusterOf.set(id, cid)
    const list = members.get(cid)
    if (list) list.push(id)
    else members.set(cid, [id])
  }

  // Adjacence inverse INTRA-cluster : cible → sources qui la référencent, les
  // deux bouts dans le même cluster. C'est ce qui donne au placement radial sa
  // distance de référence ; le niveau 2 ignore ces arêtes-là, et se sert des
  // arêtes INTER-cluster (plus bas), qui sont exactement les autres.
  //
  // Le sens est celui de `buildAggregates` — on remonte de la cible vers la
  // source —, sans quoi la distance d'anneau ne coïnciderait pas avec la
  // distance d'appartenance qui a formé le cluster. Et la source est
  // `fromEntity` pour la même raison : la vue graphe ne place que des entités,
  // un value object n'y a pas de carte à mettre dans un anneau.
  const childrenOf = new Map<NodeId, NodeId[]>()
  const entitySet = new Set(entityIds)
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    if (!entitySet.has(edge.fromEntity) || !entitySet.has(edge.to)) continue
    if (clusterOf.get(edge.fromEntity) !== clusterOf.get(edge.to)) continue
    const list = childrenOf.get(edge.to)
    if (list) list.push(edge.fromEntity)
    else childrenOf.set(edge.to, [edge.fromEntity])
  }
  // Tri des listes d'adjacence : l'ordre de `graph.refEdges` ne doit pas
  // transparaître dans la sortie. Dédoublonnage au passage — deux champs de la
  // même carte peuvent référencer la même cible, ce qui la ferait compter deux
  // fois dans un anneau.
  for (const [key, list] of childrenOf) {
    list.sort()
    childrenOf.set(
      key,
      list.filter((id, i) => i === 0 || id !== list[i - 1]),
    )
  }

  // NIVEAU 1 : packing local de chaque cluster, racine au centre.
  const clusters: LocalCluster[] = []
  for (const cid of [...members.keys()].sort()) {
    const agg = aggregates.aggregates.get(cid)
    const ids = members.get(cid)!
    ids.sort()
    if (agg) {
      const i = ids.indexOf(agg.rootId)
      if (i > 0) {
        ids.splice(i, 1)
        ids.unshift(agg.rootId)
      }
    }
    const local = packCluster(ids, sizes, o.cardGap, childrenOf)
    const circle = enclosingCircle([...local.values()], o.hullPadding)
    for (const rect of local.values()) {
      rect.x -= circle.cx
      rect.y -= circle.cy
    }
    clusters.push({
      id: cid,
      rootId: agg ? agg.rootId : null,
      isAggregate: Boolean(agg),
      memberIds: ids,
      local,
      r: circle.r,
      x: 0,
      y: 0,
    })
  }

  // Amorçage déterministe sur un disque proportionné à l'aire totale des
  // disques — même idée que le `seedPosition` du moteur retiré, mais à la
  // granularité de l'agrégat et non de la carte.
  let discArea = 0
  for (const c of clusters) discArea += (2 * c.r + o.clusterGap) ** 2
  const seedRadius = Math.sqrt(discArea) * 0.75
  for (const c of clusters) {
    const h = hashOf(c.id)
    const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI
    const rr = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * seedRadius
    c.x = rr * Math.cos(angle)
    c.y = rr * Math.sin(angle)
  }

  // Arêtes inter-clusters agrégées : une seule par paire d'agrégats, de poids
  // le nombre de références qui la traversent. Les références INTRA-agrégat
  // sont ignorées — elles ne peuvent rien tirer, le bloc étant rigide, et le
  // placement radial les a déjà consommées au niveau 1.
  const edgeWeight = new Map<string, { a: number; b: number; w: number }>()
  const index = new Map<string, number>()
  clusters.forEach((c, i) => index.set(c.id, i))
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    // `fromEntity` : c'est l'entité qui est placée, donc elle seule appartient
    // à un cluster et peut tirer sur un autre.
    if (!entitySet.has(edge.fromEntity) || !entitySet.has(edge.to)) continue
    const ca = clusterOf.get(edge.fromEntity)!
    const cb = clusterOf.get(edge.to)!
    if (ca === cb) continue
    const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca]
    const key = `${lo} ${hi}`
    const found = edgeWeight.get(key)
    if (found) found.w++
    else edgeWeight.set(key, { a: index.get(lo)!, b: index.get(hi)!, w: 1 })
  }
  // Tri par clé : l'ordre d'itération d'une Map suit l'insertion, donc l'ordre
  // de `graph.refEdges`. Il est stable en pratique, mais l'addition flottante
  // n'étant pas associative, on ne s'en remet pas à lui.
  const springs = [...edgeWeight.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, v]) => v)

  // GONFLEMENT VIRTUEL — le bruit déterministe qui casse le pavage.
  //
  // Le problème : la gravité et la collision, sur des disques de MÊME rayon,
  // convergent vers l'empilement hexagonal, qui est l'optimum de densité de
  // cercles égaux. Sur `bigShop(3000)` — 167 agrégats identiques, aucune arête
  // entre eux — le résultat est un pavage quasi hexagonal parfaitement
  // régulier, et ça se lit comme une grille plutôt que comme un graphe. La
  // signature chiffrée de cette régularité : l'écart au plus proche voisin
  // entre disques a un écart-type de **0,00 px**, tout le monde exactement à
  // `clusterGap`.
  //
  // Le mécanisme : chaque cluster se voit attribuer un rayon GONFLÉ, `r +
  // jitter_i`, avec `jitter_i` tiré du hachage de son id — donc stable d'une
  // exécution à l'autre, et sans rapport avec sa position d'amorçage (le
  // hachage porte un suffixe distinct, sans quoi les deux tirages seraient
  // corrélés). La SIMULATION SEULE travaille avec ce rayon gonflé.
  //
  // Trois propriétés, dans l'ordre d'importance :
  //
  // 1. **Les garanties sont rigoureusement inchangées.** La passe dure finale
  //    utilise le VRAI rayon et le vrai `clusterGap` ; c'est elle, et elle
  //    seule, qui porte l'invariant de sortie. Un jitter arbitrairement grand
  //    ne pourrait pas produire un recouvrement, seulement un layout plus
  //    aéré.
  // 2. **La forme peinte n'est jamais gonflée.** `jitter` n'entre ni dans
  //    `LocalCluster.r`, ni dans le cercle englobant, ni dans `ClusterShape` :
  //    la forme dessinée reste exactement la forme minimale des cartes.
  // 3. **C'est la variance qui casse le pavage**, pas un déplacement. Les
  //    voisins se posent à un écart réparti dans
  //    `[clusterGap, clusterGap + jitter_i + jitter_j]` au lieu de tous tomber
  //    sur `clusterGap` : les disques ne peuvent plus former un réseau
  //    régulier puisqu'ils ne demandent plus tous la même place.
  //
  // C'est l'UNIQUE source de bruit du moteur. Aucun angle, aucune position, ni
  // aucune constante n'est perturbée ailleurs, et il n'y a toujours ni
  // `Math.random` ni `Date.now` : le déterminisme au bit près reste testé.
  const simR = clusters.map((c) => {
    if (o.jitter <= 0) return c.r
    // Suffixe `:jitter` : décorrèle ce tirage de celui de l'amorçage, qui
    // hache le même id juste au-dessus.
    return c.r + (hashOf(`${c.id}:jitter`) / 0xffffffff) * o.jitter
  })

  // NIVEAU 2 : ressorts + gravité + collision disque-disque, sur k disques.
  // `alpha` décroît linéairement : recuit simple, les grands déplacements en
  // début de simulation, les ajustements à la fin.
  const I = o.simIterations
  for (let it = 0; it < I; it++) {
    const alpha = 1 - it / I

    for (const s of springs) {
      const a = clusters[s.a]!
      const b = clusters[s.b]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      // Longueur idéale = la position de repos autorisée par la contrainte de
      // collision. Un ressort ne demande donc jamais l'impossible.
      const ideal = simR[s.a]! + simR[s.b]! + o.clusterGap
      // Poids PLAFONNÉ : dix références entre deux agrégats ne doivent pas
      // tirer dix fois plus fort qu'une seule, sinon une paire très couplée
      // écrase le reste du graphe.
      const k = Math.min(1, s.w / 2)
      const f = ((d - ideal) / d) * 0.15 * alpha * k
      a.x += dx * f
      a.y += dy * f
      b.x -= dx * f
      b.y -= dy * f
    }

    // Gravité vers l'origine : sans elle, les composantes disjointes (167
    // agrégats sans aucune arête entre eux, cf. bigShop) n'auraient aucune
    // raison de se rapprocher et la bbox exploserait.
    const g = 0.02 * alpha
    for (const c of clusters) {
      c.x -= c.x * g
      c.y -= c.y * g
    }

    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i]!
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = simR[i]! + simR[j]! + o.clusterGap
        const d = Math.hypot(dx, dy)
        if (d >= min) continue
        // Deux centres confondus : la direction de poussée est indéterminée.
        // On la tire des ids plutôt que de diviser par zéro, comme le fait
        // `separateClusters` avec son axe fixe.
        const ux = d > 1e-9 ? dx / d : Math.cos((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
        const uy = d > 1e-9 ? dy / d : Math.sin((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
        const push = (min - d) / 2
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
      }
    }
  }

  // Passe dure finale. La collision intégrée à la boucle ci-dessus n'est qu'une
  // force parmi d'autres : ressorts et gravité peuvent la contredire à
  // l'itération suivante. Cette passe-ci ne fait QUE séparer, jusqu'à
  // convergence, ce qui fait de dist ≥ r₁ + r₂ + `clusterGap` un invariant de
  // sortie et non un espoir de convergence. C'est elle qui porte la garantie
  // que les tests assertent, et elle prime délibérément sur la longueur des
  // ressorts.
  //
  // DEUX ÉCARTS AVEC LA SONDE, les seuls du portage, tous deux MESURÉS.
  //
  // 1. La sonde sortait sur `worst < 1e-3` alors que sa garde de collision
  //    ignore les paires à moins de `1e-6` du but : la boucle s'arrêtait donc
  //    trois ordres de grandeur AVANT ce que sa propre garde considère comme
  //    séparé, et l'invariant réel valait `clusterGap − 1e-3`, pas
  //    `clusterGap − 1e-6`. Mesuré sur bigShop(3000) — 167 disques : sortie à
  //    la passe 338, résidu 9,301e-4 ; à `clusterGap: 400`, passe 424, résidu
  //    6,617e-4. Ce n'est pas du bruit flottant, c'est le seuil qui parle.
  //
  //    La sortie se fait donc ici sur `worst === 0`, c'est-à-dire « plus AUCUNE
  //    paire ne franchit la garde » — le seul seuil qui rende l'invariant de
  //    sortie égal à celui que la garde applique. Résidus alors mesurés :
  //    9,987e-7 à 167 disques, 9,758e-7 à 34, 4,914e-7 sur `shopData` — tous
  //    sous 1e-6, qui est bien le contrat que les tests assertent.
  //
  //    Ce que ça coûte : 338 → 538 passes à 167 disques, soit `layout()`
  //    complet de 157 à 194 ms — **+24 %**, et c'est le seul chiffre de ce
  //    paragraphe qui compare deux mesures prises ici, sur la même machine. Les
  //    143 ms et 1 624 ms cités en tête de fichier sont ceux de la sonde, sur
  //    la sienne : le facteur d'accélération reste d'un ordre de grandeur, mais
  //    on ne le recalcule pas en divisant des mesures de machines différentes.
  //    Le surcoût achète un invariant qui n'est plus approximatif.
  //
  // 2. Le plafond passe de 1000 à 5000 passes. À 167 disques il n'est pas un
  //    coût — la sortie anticipée se déclenche à 538, soit 11 % du plafond, et
  //    le compteur ne l'atteint sur AUCUNE entrée du dépôt. Mais il n'était pas
  //    non plus une simple sécurité : mesuré sur bigShop(9000) — 1 000 cartes,
  //    500 disques —, la convergence demande 1 722 passes, donc un plafond de
  //    1000 la coupe en route et laisse un résidu de 2,925e-3, cent fois
  //    au-dessus du seuil. Autrement dit l'« invariant de sortie » cessait
  //    silencieusement d'en être un au-delà de ~200 disques. Avec 5000 il tient
  //    (résidu 9,988e-7), pour 3,6 s au lieu de 2,4 s à cette échelle-là — un
  //    cardinal qu'aucun jeu du dépôt n'atteint et où l'O(k²) de la simulation
  //    est de toute façon le vrai problème (voir la réserve en tête de
  //    fichier).
  for (let pass = 0; pass < 5000; pass++) {
    let worst = 0
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i]!
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = a.r + b.r + o.clusterGap
        const d = Math.hypot(dx, dy)
        if (d >= min - 1e-6) continue
        const ux = d > 1e-9 ? dx / d : Math.cos((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
        const uy = d > 1e-9 ? dy / d : Math.sin((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
        const push = (min - d) / 2
        if (min - d > worst) worst = min - d
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
      }
    }
    // `worst` ne prend que des violations franchissant la garde, donc il vaut
    // soit exactement 0 (converge), soit plus de 1e-6. Comparer à 0 est ici
    // exact, pas fragile : ce n'est pas une somme flottante qu'on espère
    // nulle, c'est un compteur qui n'a jamais été affecté.
    if (worst === 0) break
  }

  // Report des positions locales dans le repère global, puis normalisation : le
  // coin haut-gauche de la bbox à l'origine, comme le moteur retiré.
  const positions = new Map<NodeId, Rect>()
  for (const c of clusters) {
    for (const id of c.memberIds) {
      const rect = c.local.get(id)!
      positions.set(id, { x: rect.x + c.x, y: rect.y + c.y, width: rect.width, height: rect.height })
    }
  }
  let minX = Infinity
  let minY = Infinity
  for (const rect of positions.values()) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
  }
  if (Number.isFinite(minX)) {
    for (const rect of positions.values()) {
      rect.x -= minX
      rect.y -= minY
    }
  }

  // Enveloppes : seuls les VRAIS agrégats en émettent une. Un singleton a bien
  // été traité comme un disque au niveau 2 — c'est ce qui l'empêche d'atterrir
  // dans l'enveloppe d'un voisin — mais il n'a pas d'enveloppe à peindre.
  //
  // Le centre translaté de la même quantité que les positions : c'est le MÊME
  // disque, à la même marge, que celui que la simulation a écarté. Pas de
  // recalcul après coup, donc aucune dérive possible entre la forme séparée et
  // la forme dessinée.
  const shapes: ClusterShape[] = []
  for (const c of clusters) {
    if (!c.isAggregate) continue
    shapes.push({ aggregateId: c.id, rootId: c.rootId!, cx: c.x - minX, cy: c.y - minY, r: c.r })
  }

  return { positions, clusters: shapes }
}

/**
 * Moteur de mise en page à deux niveaux, derrière la MÊME interface
 * `GraphLayoutEngine` que `createGraphLayoutEngine`. Les deux sont donc
 * interchangeables au point d'appel.
 *
 * `layout()` est `async` par conformité d'interface seulement : ce calcul est
 * entièrement synchrone et ne cède jamais la main (~64–143 ms sur les jeux
 * mesurés, contre 1,6–4,2 s pour le moteur actuel qui, lui, attend un
 * `layoutstop` de cytoscape).
 */
export function createTwoLevelLayoutEngine(opts: TwoLevelLayoutOptions = {}): GraphLayoutEngine {
  const options: Required<TwoLevelLayoutOptions> = { ...TWO_LEVEL_LAYOUT_DEFAULTS, ...opts }
  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return run(graph, aggregates, visible, metrics, options)
    },
  }
}
