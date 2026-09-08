// The `./graph-layout` entry point: the whole graph view, engine and contract.
// It is deliberately kept OUT of the `index.ts` barrel so the chunk stays
// separate and the graph view's loading stays lazy by construction — the
// renderer only reaches it through a dynamic `import()`.
// `test/bundle-purity.test.ts`, here as in the renderer, guards that invariant.
//
// The TWO-LEVEL graph view layout engine, and the only one.
//
// IT IS SPLIT IN TWO, and that split is the structure of the file:
// `extractGraphLayoutInput` (the only function that reads the `Graph`) produces
// a FLAT `GraphLayoutInput`, `layoutFromInput` does all the computation without
// ever touching the graph or a DOM. `createTwoLevelLayoutEngine` is nothing but
// their composition, with an unchanged signature. The why fits in one
// measurement: on a real audit of 6,251 entities the computation takes ~4.4 s,
// which is only tolerable off the main thread — and a `Graph` does not cross a
// `postMessage`. The full contract sits above `GraphLayoutInput`, and the
// invariant "the split changes no bit" in
// `test/graph-layout-identity.test.ts`.
//
// It replaced a globally-then-repaired pipeline — `createGraphLayoutEngine`,
// which asked fcose for a layout of all the cards then patched it with two
// relaxation passes, `separateOverlaps` (cards) then `separateClusters`
// (envelopes). Those three modules were REMOVED from the repo along with
// `cytoscape` and `cytoscape-fcose`. The many references below still name them
// because that is what the choices here were measured against; their code lives
// in the git history, and the probe doc cited below keeps the measurements.
//
// Ported from the probe (`bench/layout-two-level.ts`, removed as well) — see
// `docs/superpowers/spikes/2026-09-01-two-level-layout.md` for the complete
// measurements. The algorithm is carried over identically in substance; the
// envelope changes (factory + async `layout()`, to honor `GraphLayoutEngine`,
// declared further down in this file), and two constants of the final hard pass
// are tightened — see the documentation of `hardSeparation`
// (`disc-simulation.ts`), which gives the measurements and what they cost. These
// two departures change nothing structurally; they make the invariant hold at
// every scale, where the probe only ensured it to within 1e-3 and silently broke
// it beyond ~200 discs.
//
// The principle rests on a property of the model: aggregate membership is a
// strict PARTITION (see `aggregate.ts`), so the problem decomposes with no
// overlap of responsibilities.
//
//   1. INTRA-aggregate — each aggregate is packed independently of the others,
//      RADIALLY (root at the center, one ring per reference distance) if it has
//      depth, in SHELVES (centered rows) otherwise; the switch and its
//      justification sit above `packCluster` (`graph-pack.ts`). In both cases the
//      `cardGap` margin is INCLUDED in the placement, so non-overlap of the cards
//      of one aggregate is acquired by construction and not by relaxation.
//   2. INTER-aggregate — each aggregate becomes a rigid disc: the minimal
//      enclosing circle of its cards plus `hullPadding`, that is, exactly the
//      shape the renderer paints. An entity outside any aggregate is a singleton
//      disc, as in the removed `separateClusters`. Inter-aggregate references are
//      aggregated into weighted springs; a small simulation places the discs, and
//      a final hard pass makes dist ≥ r₁ + r₂ + `clusterGap` an EXIT INVARIANT,
//      not a hope of convergence.
//
// Structural consequence: there is no card separation pass any more. Two cards
// of different aggregates cannot overlap since their discs do not touch, and two
// cards of the same aggregate are packed with a margin. The cost therefore no
// longer follows the number of CARDS but the number of AGGREGATES: k discs ×
// iterations, plus a linear packing. It was O(k² · iterations) until collision
// went through a spatial grid — see the caveat lifted at the bottom of this
// header.
//
// Measured by the probe (median of 3 runs, `clusterGap: 160` and
// `hullPadding: 18` on both sides, hence at equal guarantees):
//
//   the core's bigShop(3000) — 334 entities, 167 aggregates, 0 inter-agg. ref.
//     time         1,624 ms → 143 ms (×11)
//     bbox         8,370×8,418 → 6,026×5,929 (area ÷2.0)
//     fill rate    6.2% → 12.3%
//     card pairs under 16 px: 28 → 0
//
//   the demo's bigShop(4000) — 350 entities, 108 aggregates + 8 singletons,
//   264 inter-aggregate references (the dataset behind the ~4.2 s of
//   `setView("graph")`)
//     time         4,138 ms → 64 ms (×65)
//     bbox         18,714×19,984 → 8,083×8,437 (area ÷5.5)
//     fill rate    2.8% → 15.1%
//     average length of an inter-agg. ref.: 6,104 px → 1,364 px (÷4.5)
//
// Why the fill rate doubles to quintuples, and it is not a tuning knob: in the
// removed pipeline, fcose scattered an aggregate's members, so the enclosing
// circle inflated, so `separateClusters` pushed apart LARGE nearly empty circles.
// Here the circle is minimal by construction — the cards are packed BEFORE the
// circle exists — so all the separation is useful corridor.
//
// This engine imports NEITHER cytoscape NOR elkjs: it depends only on the pure
// core (`hull.ts`, `measure.ts`) and on its two levels, `graph-pack.ts`
// (intra-aggregate packing) and `disc-simulation.ts` (disc separation), which are
// imported from here alone. See the header above for the exposure channel.
//
// WHAT THIS ENGINE DOES NOT SETTLE (the probe's caveats; those lifted since say
// so, and say by what):
//
//   - CAVEAT LIFTED. Intra-aggregate packing ignored the edges; it now exists in
//     TWO MODES, and the choice is made per cluster on reference DEPTH — see the
//     exposition of the criterion above `packCluster` (`graph-pack.ts`), which is
//     where that story is told in full.
//
//     In two lines: radial (root at the center, one ring per distance) encodes
//     depth as distance to the center, which only makes sense if there is depth
//     to encode; shelves, denser, take everything else. Measured on
//     `deepAggregate()` — 41 cards, 4 levels: average intra-aggregate reference
//     591.4 → 363.0 px, max 976.3 → 488.1 px, root from 40th to 1st by proximity
//     to the center (597.7 → 16.4 px). And on the repo's two real datasets, whose
//     aggregates are all flat, the fill rate does not move by a tenth — 12.3%
//     (core) and 15.1% (demo) — because they stay in shelves.
//   - CAVEAT LIFTED. "O(k²) over the aggregates […] only worth doing if that
//     cardinality becomes real": it became real. A real architecture audit —
//     6,251 entities, ~1,300 aggregates — took **55.4 s** to lay out, and the same
//     configuration without groups, where each entity is its own disc (6,251
//     discs, a regime the engine legitimately serves), **23.5 minutes**. Collision
//     therefore goes through a uniform SPATIAL GRID, rebuilt on every pass; the
//     complete exposition — cell sizing, window exhaustiveness, determinism, and
//     above all why the exit invariant stays PROVED with an index that goes stale
//     mid-pass — sits above `collisionPass` (`disc-simulation.ts`), which is where
//     that story is told in full.
//
//     Measured on that audit, full `layout()`, before → after:
//
//       aggregates (the regime the graph view exercises)
//         774 entities / 197 discs         283 ms →   120 ms   (×2.4)
//       1,147 entities / 238 discs         448 ms →   184 ms   (×2.4)
//       1,955 entities / 372 discs       1,537 ms →   512 ms   (×3.0)
//       6,251 entities / 1,300 discs    55,410 ms → 6,065 ms   (×9.1)
//
//       without groups (one disc per entity)
//         774 discs                     14,053 ms →   653 ms   (×22)
//       1,147 discs                     39,606 ms → 1,639 ms   (×24)
//       1,955 discs                    141,633 ms → 3,738 ms   (×38)
//       6,251 discs                  1,411,453 ms → 21,037 ms  (×67)
//
//     The "after" column above dates from the BARE grid. It has been dug deeper
//     since by a cell-by-cell pruning — the window stays sized on the GLOBAL max
//     radius, but each visited cell is filtered on the max radius it ACTUALLY
//     hosts, which stops a single giant disc from imposing its reach on everyone.
//     The two re-measured lines (median of 3 runs, same machine, bare grid → grid
//     + pruning):
//
//       6,251 entities / 1,300 discs     6,096 ms → 4,224 ms   (−31%)
//       6,251 discs without groups      21,416 ms → 21,626 ms  (+1%)
//
//     The second regime, with near-uniform radii, has no giant to route around:
//     all we ask of it is to lose nothing. The other six lines were not
//     re-measured. Detail and exhaustiveness proof above `collisionPass`.
//
//     A lead was also tried and DROPPED — following, from one hard pass to the
//     next, only the pairs one end of which moved. The "dirty" set never empties
//     on a dense pile (~1,291 discs out of 1,300 during 90% of the passes), so the
//     alternation cost more than it returned; the quantified case sits above
//     `hardSeparation`.
//
//     The springs PART of the caveat falls for a different reason: it had no
//     grounds. Barnes-Hut accelerates an ALL-PAIRS repulsion, and this engine has
//     none — it has only collision (now indexed) and a gravity toward the origin,
//     linear by construction. The cost of the springs follows the number of
//     AGGREGATED springs, that is, the deduplicated inter-aggregate references:
//     linear, and it was not the hot spot to begin with.
//
//     What REMAINS quadratic, and becomes the next ceiling: the number of hard
//     passes needed grows linearly with the discs, so that `MAX_HARD_PASSES`
//     (5000) saturates beyond ~1,700 discs and the separation invariant then stops
//     being one. Measurements and trade-off above `hardSeparation`.
//   - The final hard pass can undo a spring: the separation guarantee takes
//     precedence over edge length. At 264 references over 116 discs it does not
//     show; a very dense inter-aggregate graph could degrade — not probed.
//   - The aesthetic is regular, not organic (near-hexagonal tiling on
//     aggregates without edges). Accepted, but it is a product choice.
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./structure-layout.js"
import { enclosingCircle } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
// Les deux niveaux de l'algorithme, chacun dans son module et importés ICI et
// nulle part ailleurs — ce fichier reste le seul point d'entrée du moteur.
import { packCluster } from "./graph-pack.js"
import { layoutDiscs, type Disc } from "./disc-simulation.js"

// Le contrat de la vue graphe — l'enveloppe, le résultat, l'interface du moteur
// — est déclaré ICI depuis le retrait de `layout-graph.ts`, où il vivait tant
// que deux moteurs le partageaient. Il n'en reste qu'un, et un module de types
// dont le seul contenu serait ces trois interfaces demanderait sa propre
// justification. Ce qu'un consommateur importe ne bouge pas pour autant : ce
// fichier EST le point d'entrée `./graph-layout`, et les expose sous ces noms.
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
   * le désactive. Voir le commentaire au-dessus de `virtualRadii`
   * (`disc-simulation.ts`) pour le mécanisme et
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

/**
 * L'ENTRÉE DU CŒUR PUR : tout ce que le moteur consomme, et rien d'autre.
 *
 * Ce type existe pour une raison unique et mesurée : sur un audit réel — 6 251
 * entités, ~1 300 agrégats — `layout()` passe ~4,4 s dans un calcul entièrement
 * synchrone, ce qui gèle le thread principal du navigateur pendant toute la
 * bascule de vue. Le seul remède qui garde le temps total est de déporter le
 * calcul dans un Web Worker ; or un `Graph` ne traverse pas un `postMessage` —
 * il porte des `Map` de nœuds, des arêtes indexées, et pèse plusieurs ordres de
 * grandeur de plus que ce que le moteur en lit.
 *
 * D'où la scission : `extractGraphLayoutInput` est la SEULE partie qui touche au
 * `Graph`, elle tourne sur le thread principal, et elle rend cet objet PLAT —
 * que le clonage structuré transporte tel quel. `layoutFromInput` est tout le
 * reste : pur, sans DOM, sans graphe, donc exécutable des deux côtés de la
 * frontière. L'invariant qui tient l'ensemble est écrit dans
 * `test/graph-layout-identity.test.ts` : la scission ne change AUCUN bit de la
 * sortie, c'est le même code réordonné.
 *
 * CE QUI N'Y EST PAS, et pourquoi : les `NodeMetrics`. Elles ne servent qu'à
 * `measureNode`, que l'extraction a déjà appelé — la taille de chaque carte est
 * dans `entities`. Les faire traverser en plus serait transporter la RECETTE
 * d'un résultat qu'on transporte déjà.
 */
export interface GraphLayoutInput {
  /** Les entités à placer, triées par id — le tri est une CONDITION du
   * déterminisme du moteur, pas un confort de lecture. `w`/`h` sont la taille
   * de la carte, déjà mesurée. */
  entities: { id: NodeId; w: number; h: number }[]
  /**
   * Les références qui relient deux entités placées, DANS L'ORDRE de
   * `graph.refEdges` et sans dédoublonnage : le niveau 2 fait le poids de
   * chaque ressort avec la multiplicité, et le niveau 1 dédoublonne lui-même ce
   * dont il a besoin. Les bouts sont `fromEntity` et `to` — c'est l'entité
   * porteuse qui est placée, jamais le value object qui écrit le champ.
   */
  refs: { from: NodeId; to: NodeId }[]
  /**
   * Les agrégats qui revendiquent au moins une entité placée, avec ces
   * entités-là pour membres. C'est la forme groupée de la partition que porte
   * `AggregateIndex.byNode` — une entité absente de toutes ces listes est un
   * singleton, exactement comme un `byNode` vide chez l'appelant.
   */
  aggregates: { id: string; rootId: NodeId; memberIds: NodeId[] }[]
  /** Les réglages RÉSOLUS : l'extraction applique les défauts, le cœur pur ne
   * relit jamais `TWO_LEVEL_LAYOUT_DEFAULTS`. */
  options: Required<TwoLevelLayoutOptions>
}

/**
 * Un cluster du niveau 2 : un agrégat, ou une entité seule promue en disque.
 *
 * Il ÉTEND `Disc`, ce qui est tout le raccord entre les deux niveaux : la
 * simulation ne voit que `id`, `r`, `x`, `y` et écrit `x`/`y` en place, sans
 * jamais rien savoir des membres ni des rects que ce même objet transporte.
 */
interface LocalCluster extends Disc {
  /** `null` pour un singleton hors agrégat — il n'émettra pas d'enveloppe. */
  rootId: NodeId | null
  isAggregate: boolean
  /** Ordre du packing : racine d'abord, puis ids triés. */
  memberIds: NodeId[]
  /** Rects LOCAUX, recentrés pour que le centre du cercle englobant soit à
   * l'origine — c'est ce qui permet de traiter le cluster comme un disque
   * centré en (x, y) au niveau 2. */
  local: Map<NodeId, Rect>
}

/**
 * L'EXTRACTION : la seule fonction du moteur qui lise le `Graph`, et tout ce
 * qu'elle en lit.
 *
 * Trois lectures, et pas une de plus — c'est ce qui rend la frontière du worker
 * vérifiable plutôt que crue sur parole :
 *  1. les ids des nœuds VISIBLES de type entité (les nœuds structurels — racine,
 *     tableaux, objets — n'existent pas dans cette vue) ;
 *  2. `measureNode` sur chacun, pour la taille de sa carte ;
 *  3. `graph.refEdges`, filtré aux références résolues dont les DEUX bouts sont
 *     des entités placées.
 *
 * Le reste vient de l'`AggregateIndex`. `byNode[0]` est sûr parce que
 * l'appartenance est une PARTITION — chaque tableau tient au plus un id (voir
 * `AggregateIndex`), et l'index qui le produit remplit toujours `aggregates` en
 * même temps, ce qui est ce qui autorise le `rootId` non nullable ci-dessous.
 *
 * Exportée parce qu'un appelant qui veut faire tourner le cœur AILLEURS — un
 * Web Worker, typiquement — doit pouvoir faire cette moitié-ci sur le thread qui
 * possède le graphe. `createTwoLevelLayoutEngine` n'est plus que la composition
 * des deux.
 */
export function extractGraphLayoutInput(
  graph: Graph,
  aggregates: AggregateIndex,
  visible: Set<NodeId>,
  metrics: NodeMetrics = DEFAULT_METRICS,
  options: TwoLevelLayoutOptions = {},
): GraphLayoutInput {
  // Le tri est une CONDITION du déterminisme, pas une commodité de lecture :
  // `visible` est un `Set` construit par l'appelant, dont l'ordre d'itération
  // n'est le contrat de personne.
  const entityIds: NodeId[] = []
  for (const id of visible) {
    const node = graph.nodes.get(id)
    if (node && node.kind === "entity") entityIds.push(id)
  }
  entityIds.sort()

  const entities: GraphLayoutInput["entities"] = []
  const entitySet = new Set<NodeId>()
  for (const id of entityIds) {
    const size = measureNode(graph.nodes.get(id)!, metrics)
    entities.push({ id, w: size.width, h: size.height })
    entitySet.add(id)
  }

  // Les agrégats, groupés depuis `byNode` : c'est la même partition, dite dans
  // l'autre sens. Ne sont retenus que ceux qui revendiquent une entité PLACÉE —
  // un agrégat dont aucun membre n'est visible n'a ni disque ni enveloppe.
  const memberIdsByAggregate = new Map<string, NodeId[]>()
  for (const id of entityIds) {
    const aggId = aggregates.byNode.get(id)?.[0]
    if (aggId === undefined) continue
    const list = memberIdsByAggregate.get(aggId)
    if (list) list.push(id)
    else memberIdsByAggregate.set(aggId, [id])
  }
  const inputAggregates: GraphLayoutInput["aggregates"] = []
  for (const [id, memberIds] of memberIdsByAggregate) {
    // Un id de `byNode` absent d'`aggregates` ne peut pas arriver — les deux
    // tables sortent du même `buildAggregates` — et le sauter plutôt que de
    // porter un `rootId` nullable dans le contrat public est le choix assumé :
    // la seule sortie possible d'un tel cluster serait un groupe sans enveloppe
    // à peindre, indiscernable de singletons.
    const rootId = aggregates.aggregates.get(id)?.rootId
    if (rootId === undefined) continue
    inputAggregates.push({ id, rootId, memberIds })
  }

  // Une paire PAR référence, doublons compris et dans l'ordre du graphe : la
  // multiplicité fait le poids des ressorts du niveau 2, et le niveau 1
  // dédoublonne lui-même ce dont il a besoin. `fromEntity` et non `from` : c'est
  // l'entité porteuse qui est placée, un value object n'a pas de carte.
  const refs: GraphLayoutInput["refs"] = []
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    if (!entitySet.has(edge.fromEntity) || !entitySet.has(edge.to)) continue
    refs.push({ from: edge.fromEntity, to: edge.to })
  }

  return {
    entities,
    refs,
    aggregates: inputAggregates,
    options: { ...TWO_LEVEL_LAYOUT_DEFAULTS, ...options },
  }
}

/**
 * LE CŒUR PUR : les deux niveaux, sans graphe, sans DOM, sans état.
 *
 * C'est exactement l'ancien `run` moins ses lectures du `Graph`, qui sont
 * passées dans `extractGraphLayoutInput`. Le déplacement est textuel et
 * l'identité de la sortie est asserté au bit près
 * (`test/graph-layout-identity.test.ts`).
 *
 * « Pure » a ici un sens opérationnel : cette fonction peut tourner dans un Web
 * Worker, où il n'existe ni `document`, ni `window`, ni le `Graph` du thread
 * principal. Y ajouter la moindre lecture d'environnement casserait le worker
 * du renderer (`packages/renderer/src/graph-layout-worker.ts`) sans casser un
 * seul test de ce dossier — d'où cet avertissement plutôt qu'une garde
 * illusoire.
 */
export function layoutFromInput(input: GraphLayoutInput): GraphLayoutResult {
  const o = input.options

  const sizes = new Map<NodeId, { width: number; height: number }>()
  for (const entity of input.entities) sizes.set(entity.id, { width: entity.w, height: entity.h })

  // Partition en clusters : l'agrégat s'il existe, un singleton sinon.
  const clusterOf = new Map<NodeId, string>()
  const rootOf = new Map<string, NodeId>()
  for (const agg of input.aggregates) {
    rootOf.set(agg.id, agg.rootId)
    for (const memberId of agg.memberIds) clusterOf.set(memberId, agg.id)
  }
  const members = new Map<string, NodeId[]>()
  for (const entity of input.entities) {
    let cid = clusterOf.get(entity.id)
    if (cid === undefined) {
      cid = `single:${entity.id}`
      clusterOf.set(entity.id, cid)
    }
    const list = members.get(cid)
    if (list) list.push(entity.id)
    else members.set(cid, [entity.id])
  }

  // Adjacence inverse INTRA-cluster : cible → sources qui la référencent, les
  // deux bouts dans le même cluster. C'est ce qui donne au placement radial sa
  // distance de référence ; le niveau 2 ignore ces arêtes-là, et se sert des
  // arêtes INTER-cluster (`refPairs`, plus bas), qui sont exactement les autres.
  //
  // Le sens est celui de `buildAggregates` — on remonte de la cible vers la
  // source —, sans quoi la distance d'anneau ne coïnciderait pas avec la
  // distance d'appartenance qui a formé le cluster.
  const childrenOf = new Map<NodeId, NodeId[]>()
  for (const ref of input.refs) {
    if (clusterOf.get(ref.from) !== clusterOf.get(ref.to)) continue
    const list = childrenOf.get(ref.to)
    if (list) list.push(ref.from)
    else childrenOf.set(ref.to, [ref.from])
  }
  // Tri des listes d'adjacence : l'ordre des références du graphe ne doit pas
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
    const rootId = rootOf.get(cid)
    const ids = members.get(cid)!
    ids.sort()
    if (rootId !== undefined) {
      const i = ids.indexOf(rootId)
      if (i > 0) {
        ids.splice(i, 1)
        ids.unshift(rootId)
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
      rootId: rootId ?? null,
      isAggregate: rootId !== undefined,
      memberIds: ids,
      local,
      r: circle.r,
      x: 0,
      y: 0,
    })
  }

  // Les paires de clusters reliées par une référence, dans l'ordre des
  // références du graphe : une paire PAR référence, les doublons faisant le
  // poids du ressort et les paires intra-cluster étant écartées par
  // `aggregateSprings`. C'est tout ce que le niveau 2 apprend du graphe.
  const refPairs: [string, string][] = []
  for (const ref of input.refs) {
    refPairs.push([clusterOf.get(ref.from)!, clusterOf.get(ref.to)!])
  }

  // NIVEAU 2 : amorçage, ressorts, gravité, collision, puis la passe dure qui
  // porte l'invariant de sortie. Il écrit `x`/`y` en place sur les clusters ;
  // leur contenu — rects locaux et rayon — est figé depuis le niveau 1.
  layoutDiscs(clusters, refPairs, o)

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
 * Moteur de mise en page à deux niveaux, et le seul depuis le retrait de
 * `createGraphLayoutEngine`. Il reprend l'interface `GraphLayoutEngine` que les
 * deux partageaient tant que l'ancien existait, ce qui a rendu la bascule
 * transparente au point d'appel.
 *
 * `layout()` est `async` par conformité d'interface seulement : ce calcul est
 * entièrement synchrone et ne cède jamais la main (~64–143 ms sur les jeux
 * mesurés, contre 1,6–4,2 s pour l'ancien moteur qui, lui, attendait un
 * `layoutstop` de cytoscape ; ~4,4 s sur l'audit réel de 6 251 entités, ce qui
 * est la mesure qui a motivé la scission ci-dessus).
 *
 * Ce moteur-ci reste le chemin EN PROCESSUS, et il ne devient pas un détail
 * d'implémentation du worker : c'est lui que le renderer exécute quand aucune
 * URL de worker n'est fournie (vitest, headless, hôte sans worker) et c'est sur
 * lui qu'il se replie DÉFINITIVEMENT au premier échec du worker. Sa signature
 * ne bouge donc pas d'un iota.
 */
export function createTwoLevelLayoutEngine(opts: TwoLevelLayoutOptions = {}): GraphLayoutEngine {
  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return layoutFromInput(extractGraphLayoutInput(graph, aggregates, visible, metrics, opts))
    },
  }
}
