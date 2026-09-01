// Moteur de mise en page de la vue graphe à DEUX NIVEAUX, alternative au
// pipeline global corrigé de `layout-graph.ts` (fcose → `separateOverlaps` →
// `separateClusters`).
//
// Porté depuis la sonde `bench/layout-two-level.ts` — voir
// `docs/superpowers/spikes/2026-09-01-two-level-layout.md` pour les mesures
// complètes. L'algorithme est repris à l'identique sur le fond ; l'enveloppe
// change (factory + `layout()` async, pour respecter `GraphLayoutEngine`), et
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
//   1. INTRA-agrégat — chaque agrégat est packé indépendamment des autres :
//      racine en premier, puis membres triés par id, en étagères centrées avec
//      la marge `cardGap` INCLUSE dans le packing. Le non-recouvrement des
//      cartes d'un même agrégat est acquis par construction, pas par
//      relaxation.
//   2. INTER-agrégat — chaque agrégat devient un disque rigide : le cercle
//      englobant minimal de ses cartes plus `hullPadding`, c'est-à-dire
//      exactement la forme que le renderer peint. Une entité hors agrégat est
//      un disque singleton, comme dans `separateClusters`. Les références
//      inter-agrégats sont agrégées en ressorts pondérés ; une petite
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
// le pipeline actuel fcose éparpille les membres d'un agrégat, donc le cercle
// englobant gonfle, donc `separateClusters` écarte de GRANDS cercles presque
// vides. Ici le cercle est minimal par construction — les cartes sont packées
// AVANT que le cercle existe — donc tout l'écartement est du couloir utile.
//
// Ce moteur n'importe NI cytoscape NI elkjs : il ne dépend que du cœur pur
// (`hull.ts`, `measure.ts`). Les imports de `layout-graph.js` sont
// délibérément des `import type` — ils s'effacent à la compilation, donc
// aucune chaîne d'import runtime ne mène d'ici à cytoscape. Voir
// `graph-layout.ts` pour le canal d'exposition et `test/bundle-purity.test.ts`
// pour la garde.
//
// CE QUE CE MOTEUR NE TRANCHE PAS (réserves de la sonde, reprises telles
// quelles parce qu'aucune n'a été levée depuis) :
//
//   - Le packing intra-agrégat IGNORE les arêtes : les membres sont posés par
//     id, pas par connectivité, donc une référence intra-agrégat peut traverser
//     le bloc. Invisible à 2–5 cartes par agrégat (l'échelle des fixtures ici),
//     réel sur des agrégats de dizaines de cartes.
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
import type { Rect } from "./layout.js"
import type { ClusterShape, GraphLayoutEngine, GraphLayoutResult } from "./layout-graph.js"
import { enclosingCircle } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"

export interface TwoLevelLayoutOptions {
  /** Marge entre le coin de carte le plus éloigné du centre de l'enveloppe et
   * le bord de celle-ci. Même sens et même valeur que dans `layout-graph.ts` :
   * c'est le rayon du disque que le renderer peint. */
  hullPadding?: number
  /** Marge entre deux cartes d'un même agrégat, INCLUSE dans le packing (donc
   * acquise par construction, là où `separationMargin` de `layout-graph.ts`
   * est le but d'une relaxation plafonnée). */
  cardGap?: number
  /** Écart bord à bord garanti entre deux disques d'agrégats. */
  clusterGap?: number
  /** Itérations de la simulation à ressorts du niveau 2. */
  simIterations?: number
}

const DEFAULTS: Required<TwoLevelLayoutOptions> = {
  // Repris de `layout-graph.ts` sans les rejuger : ce sont les mêmes formes
  // dessinées et le même contrat visuel. La sonde a mesuré les deux moteurs
  // avec ces valeurs des deux côtés, pour comparer à garanties égales — et
  // `clusterGap: 160` reste le fruit du balayage documenté dans les `DEFAULTS`
  // de `layout-graph.ts`, pas un choix au goût.
  hullPadding: 18,
  cardGap: 16,
  clusterGap: 160,
  // NON CALIBRÉ, et c'est un fait mesurable de la sonde, pas une omission :
  // les chiffres ci-dessus (×11 à ×65, remplissage ×2 à ×5,4) sont ceux du
  // PREMIER jeu de constantes essayé — 400 itérations, force de ressort 0,15,
  // poids plafonné à 2, gravité 0,02 — sans aucun balayage de réglages. Cela
  // suggère que l'architecture est robuste au réglage plus que ces valeurs ne
  // sont bonnes. Un calibrage à la façon de `clusterGap` reste à faire avant
  // d'en faire le défaut de la vue.
  //
  // Ce que 400 achète : rien de la CORRECTION. Les garanties de sortie
  // (non-recouvrement des cartes, écart des disques) sont portées par le
  // packing et par la passe dure finale, pas par la simulation. Réduire ce
  // nombre dégrade la longueur des références inter-agrégats et la compacité,
  // jamais la justesse.
  simIterations: 400,
}

/** Hachage FNV-1a de l'id — le MÊME que celui de `layout-graph.ts`, et pour la
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
 * Packing en étagères : lignes remplies de gauche à droite jusqu'à une largeur
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
 */
function packCluster(
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

  // NIVEAU 1 : packing local de chaque cluster, racine en premier.
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
    const local = packCluster(ids, sizes, o.cardGap)
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
  // disques — même idée que `seedPosition` de `layout-graph.ts`, mais à la
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
  // sont ignorées — elles ne peuvent rien tirer, le bloc étant rigide.
  const entitySet = new Set(entityIds)
  const edgeWeight = new Map<string, { a: number; b: number; w: number }>()
  const index = new Map<string, number>()
  clusters.forEach((c, i) => index.set(c.id, i))
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    if (!entitySet.has(edge.from) || !entitySet.has(edge.to)) continue
    const ca = clusterOf.get(edge.from)!
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
      const ideal = a.r + b.r + o.clusterGap
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
        const min = a.r + b.r + o.clusterGap
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
  // coin haut-gauche de la bbox à l'origine, comme `layout-graph.ts`.
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
  const options: Required<TwoLevelLayoutOptions> = { ...DEFAULTS, ...opts }
  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return run(graph, aggregates, visible, metrics, options)
    },
  }
}
