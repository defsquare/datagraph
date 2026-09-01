import cytoscape from "cytoscape"
import fcose from "cytoscape-fcose"
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./layout.js"
import type { Point } from "./hull.js"
import { paddedHull } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
import { separateOverlaps } from "./separate.js"
import { separateClusters } from "./cluster-separate.js"

cytoscape.use(fcose as cytoscape.Ext)

export interface GraphLayoutOptions {
  /** Marge entre une carte et le bord de l'enveloppe de son agrégat. */
  hullPadding?: number
  /** Marge garantie entre deux cartes par la passe de séparation. */
  separationMargin?: number
  separationIterations?: number
  /** Écart visé entre les boîtes englobantes de deux agrégats voisins, ouvert
   * par `separateClusters`. Voir le calibrage dans `DEFAULTS`. */
  clusterGap?: number
}

export interface ClusterShape {
  aggregateId: string
  rootId: NodeId
  polygon: Point[]
}

export interface GraphLayoutResult extends LayoutResult {
  clusters: ClusterShape[]
}

export interface GraphLayoutEngine {
  layout(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<GraphLayoutResult>
}

const DEFAULTS: Required<GraphLayoutOptions> = {
  hullPadding: 18,
  separationMargin: 16,
  // Mesure de la Task 4 : la convergence suit la SÉVÉRITÉ du recouvrement, pas
  // le nombre de nœuds — une pile de 40 cartes en recouvrement quasi total
  // demande ~3000 passes, avec un long plateau avant la libération. Le chiffre
  // « ~600 passes à 800 cartes » de la sonde ne se transpose donc pas.
  //
  // La passe elle-même est indispensable, et c'est maintenant mesuré sur la
  // sortie BRUTE de fcose (moteur construit avec `separationIterations: 0`) :
  // 448 paires en recouvrement à 450 cartes, la pire carte recouverte à 90,8 %
  // de son aire ; 160 paires et 40,5 % à 334 cartes. En revanche, sur les 4
  // cartes de `shopData`, fcose ne produit AUCUN recouvrement — d'où le
  // déplacement du test de non-recouvrement vers une vraie échelle : sur ce
  // fixture-là, il passait sans rien exercer.
  //
  // TRACE HISTORIQUE (défaut corrigé) : cette section documentait `iterations`
  // comme un coût FIXE plutôt qu'un plafond, parce que la sortie anticipée de
  // `separateOverlaps` ne se déclenchait jamais — elle comparait la
  // pénétration à zéro, et une paire posée exactement à la marge garde une
  // pénétration résiduelle de l'ordre de 1e-14 qui repasse le test `> 0` : la
  // boucle continuait de « bouger » des picomètres jusqu'au plafond. Mesuré
  // alors sur 334 cartes déjà séparées dès la 3000e passe : plafond 3000 →
  // 1,9 s, plafond 10 000 → 6,3 s, plafond 100 000 → 63,5 s — linéaire dans le
  // plafond, signature d'une sortie anticipée qui ne se déclenche jamais. Ces
  // trois chiffres sont laissés tels quels comme trace historique ; ils ne
  // décrivent plus le comportement actuel.
  //
  // CORRIGÉ dans `separate.ts` : la comparaison se fait désormais contre une
  // épsilon plutôt que contre zéro (voir sa doc). La sortie anticipée se
  // déclenche réellement — mesurée à la passe 1998 sur ce même fixture de 334
  // cartes — et `iterations` redevient un vrai PLAFOND : coûteux seulement
  // quand la passe en a vraiment besoin, pas systématiquement.
  //
  // 3000 n'est par ailleurs pas suffisant à toute échelle, indépendamment de
  // ce défaut : il reste 47 paires sous la marge (jamais en recouvrement) à
  // 450 cartes et 289 à 900. Les relever demanderait 10 000 passes, soit ~3×
  // le temps de la passe sur toute entrée qui converge avant le plafond. Le
  // compromis est assumé et documenté dans la section « Graph view » du
  // README.
  separationIterations: 3000,
  // CALIBRÉ, pas choisi au goût. Balayage complet de `layout()` sur deux
  // fixtures à l'échelle, en mesurant l'écart bord à bord au plus proche
  // voisin (« nn ») entre boîtes englobantes d'agrégats, la taille de la bbox
  // globale et le remplissage. `clusterGap: 0` = passe désactivée, c'est-à-dire
  // l'état d'avant ce réglage.
  //
  //   bigShop(3000) — 334 entités, 167 agrégats de 2 cartes
  //   gap |  nn   | paires en recouvrement |    bbox     | aire  | remplissage
  //     0 |   0,7 |                    310 |  3494×2969 |  ×1   | 42,4 %
  //    80 |  80,0 |                      0 |  5969×6571 |  ×3,8 | 11,2 %
  //   160 | 160,0 |                      0 |  6778×8171 |  ×5,3 |  7,9 %
  //   240 | 240,2 |                      0 |  7987×9879 |  ×7,6 |  5,6 %
  //   320 | 320,4 |                      0 |  9072×10833|  ×9,5 |  4,5 %
  //   400 | 401,3 |                      0 | 12045×12543| ×14,6 |  2,9 %
  //
  //   ancien jeu de la démo — 211 entités, 53 agrégats de 3 à 5 cartes
  //   (le jeu de la démo a depuis doublé et déclare DEUX racines d'agrégat :
  //   ses 108 agrégats fusionnent en un seul super-cluster de 342 cartes sur
  //   350, où cette passe n'a plus rien à écarter. Le balayage ci-dessous
  //   garde donc la forme mesurée à une racine, qui est celle où le réglage
  //   compte.)
  //   gap |  nn   | paires en recouvrement |    bbox     | aire  | remplissage
  //     0 |   0,0 |                    138 |  2673×2404 |  ×1   | 43,2 %
  //    80 |  80,9 |                      0 |  3958×5288 |  ×3,3 | 13,3 %
  //   160 | 160,0 |                      0 |  5151×5799 |  ×4,7 |  9,3 %
  //   240 | 241,2 |                      0 |  6105×6845 |  ×6,5 |  6,6 %
  //   320 | 323,0 |                      0 |  6400×7842 |  ×7,8 |  5,5 %
  //   400 | 400,5 |                      0 |  6674×8588 |  ×8,9 |  4,8 %
  //
  // Aucun recouvrement de CARTES à aucune valeur, y compris 0 : la passe de
  // séparation garde son contrat, celle-ci ne fait que translater des blocs.
  //
  // 160 retenu. Sans la passe, les enveloppes se touchent (0,7 px d'écart
  // moyen au plus proche voisin, 310 paires franchement superposées) : elles
  // sont illisibles. La CORRECTION — plus aucune paire d'enveloppes en
  // recouvrement — est déjà acquise à 80 px ; tout ce qui est au-dessus achète
  // de la largeur de couloir, pas de la justesse. 160 px valent 10×
  // `separationMargin` et une hauteur et demie de carte : l'écart se voit sans
  // zoomer, pour ×5,3 d'aire et 7,9 % de remplissage.
  //
  // Au-delà, le coût grimpe plus vite que le bénéfice : 160 → 240 coûte +42 %
  // d'aire pour faire passer le remplissage de 7,9 % à 5,6 %, soit plus près
  // des 2,5 % de la mise en page que cette vue REMPLACE que des ~43 % d'où
  // elle part. `fit()` doit alors dézoomer d'un facteur √7,6 ≈ 2,8, donc les
  // cartes s'affichent au tiers de leur taille en vue d'ensemble et tombent
  // plus tôt dans les LOD dégradés.
  //
  // C'est un réglage d'œil, pas de correction : il est exposé jusque dans
  // `createDataGraph` via `graphLayoutOptions`, pour se régler sans toucher au
  // cœur ni reconstruire.
  clusterGap: 160,
}

/** Hachage FNV-1a de l'id, base de l'amorçage déterministe des positions. */
function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Position initiale déterministe, tirée du seul id du nœud et projetée sur un
 * disque de rayon `radius`. C'est la pièce qui rend la vue reproductible : la
 * sonde mesurait 1589 px d'écart médian entre deux runs identiques, parce que
 * fcose place ses nœuds par une méthode spectrale ALÉATOIRE. En fournissant
 * nous-mêmes les positions et en passant `randomize: false`, ce tirage est
 * court-circuité et la sortie devient stable d'une session à l'autre.
 */
function seedPosition(id: string, radius: number): Point {
  const h = hashOf(id)
  const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI
  const r = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * radius
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
}

// Regroupement visuel : PAS de nœud virtuel de centre par agrégat. Une
// version antérieure en ajoutait un (relié à chaque membre visible par une
// arête plus courte/élastique) pour tirer les membres d'un agrégat les uns
// vers les autres. Mesuré sur trois formes de graphe (membres à 1 saut de la
// racine, à 2 sauts, et éventail large sous une racine) : les centres
// rapprochaient les composantes DISJOINTES entre elles (une seule échelle de
// répulsion globale chez fcose, non décomposée par composante connexe) plus
// qu'ils ne rapprochaient les membres d'un même agrégat — les co-membres se
// retrouvaient 2,2 à 2,4× PLUS ÉLOIGNÉS avec centre que sans, aux profondeurs
// 1 et 2, pour un gain non mesurable sur l'éventail large. L'appartenance à
// un agrégat est par construction une accessibilité par arêtes de référence
// (voir aggregate.ts) : cette arête existe déjà dans le layout, le centre ne
// faisait que la doubler. Le regroupement visuel vient donc uniquement des
// arêtes de référence déjà posées ci-dessus ; seule l'enveloppe, tracée
// après coup à partir des positions obtenues, reste propre à l'agrégat.

/**
 * Une enveloppe par agrégat ayant au moins un membre positionné, dans le
 * repère de `positions`. Ordre stable : celui de `aggregates`, qui suit
 * lui-même l'ordre de déclaration de la config.
 *
 * Le chevauchement (une entité membre de plusieurs agrégats) n'a pas besoin
 * d'un montage particulier ici : chaque agrégat calcule son enveloppe
 * indépendamment à partir des positions de SES membres, donc une entité
 * partagée tombe naturellement dans les deux polygones — tirée vers ses deux
 * racines par ses propres arêtes de référence pendant le layout.
 */
function computeClusters(
  aggregates: AggregateIndex,
  positions: Map<NodeId, Rect>,
  hullPadding: number,
): ClusterShape[] {
  const clusters: ClusterShape[] = []
  for (const aggregate of aggregates.aggregates.values()) {
    const rects: Rect[] = []
    for (const memberId of aggregate.memberIds) {
      const rect = positions.get(memberId)
      if (rect) rects.push(rect)
    }
    if (rects.length === 0) continue
    clusters.push({
      aggregateId: aggregate.id,
      rootId: aggregate.rootId,
      polygon: paddedHull(rects, hullPadding),
    })
  }
  return clusters
}

export function createGraphLayoutEngine(opts: GraphLayoutOptions = {}): GraphLayoutEngine {
  const options: Required<GraphLayoutOptions> = { ...DEFAULTS, ...opts }

  async function run(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics: NodeMetrics,
  ): Promise<GraphLayoutResult> {
    const sizes = new Map<NodeId, { width: number; height: number }>()
    const elements: cytoscape.ElementDefinition[] = []

    // Sommets : les entités visibles, et rien d'autre. Les nœuds structurels
    // (racine, tableaux, objets) n'existent pas dans cette vue.
    const entityIds: NodeId[] = []
    for (const id of visible) {
      const node = graph.nodes.get(id)
      if (!node || node.kind !== "entity") continue
      entityIds.push(id)
    }
    entityIds.sort() // ordre stable, condition du déterminisme

    const radius = Math.sqrt(Math.max(1, entityIds.length)) * 220
    for (const id of entityIds) {
      const node = graph.nodes.get(id)!
      const size = measureNode(node, metrics)
      sizes.set(id, size)
      elements.push({
        group: "nodes",
        data: { id, w: size.width, h: size.height },
        position: seedPosition(id, radius),
      })
    }

    // Arêtes : les références non cassées dont les deux bouts sont visibles.
    const entitySet = new Set(entityIds)
    for (const edge of graph.refEdges) {
      if (edge.to === null || edge.dangling) continue
      if (!entitySet.has(edge.from) || !entitySet.has(edge.to)) continue
      elements.push({
        group: "edges",
        data: { id: `r:${edge.from}->${edge.to}:${edge.field}`, source: edge.from, target: edge.to },
      })
    }

    // `styleEnabled: true` est indispensable en headless : sans lui cytoscape
    // ne calcule aucune dimension et fcose traite les cartes comme des points
    // de taille nulle — elles se recouvrent alors massivement.
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements,
      style: [{ selector: "node", style: { width: "data(w)", height: "data(h)" } }],
    })

    const layout = cy.layout({
      name: "fcose",
      randomize: false,
      animate: false,
      fit: false,
      nodeDimensionsIncludeLabels: false,
      // Les défauts de fcose sont calibrés pour des nœuds ponctuels : une
      // longueur d'arête idéale de 50 px est absurde entre deux cartes de
      // 140–340 px de large. On la dérive de la taille des deux boîtes.
      //
      // IMPORTANT — piège déjà mesuré une fois, à ne pas réintroduire : si
      // un jour une autre arête synthétique s'ajoute ici (un nœud qui
      // n'existe pas dans `graph`, comme l'ancien centre virtuel
      // d'agrégat — voir la note au-dessus de `computeClusters`), NE PAS
      // lui donner une longueur idéale différente de celle des arêtes de
      // référence. fcose recalibre son échelle interne de répulsion
      // (`DEFAULT_EDGE_LENGTH`, dont dérivent `MIN_REPULSION_DIST` et
      // `DEFAULT_RADIAL_SEPARATION`) sur la MOYENNE de `idealLength` de
      // TOUTES les arêtes du graphe — une seule échelle globale, pas une
      // par composante. Mélanger des arêtes courtes et des arêtes de la
      // largeur d'une carte tire cette moyenne vers le bas et,
      // `packComponents` étant inerte ici, resserre anormalement des
      // COMPOSANTES DISJOINTES qui ne partagent pourtant aucune arête —
      // c'est ce qui a fait régresser un test de la Task 6 quand les
      // centres d'agrégat existaient encore. La distance à laquelle une
      // arête veut se poser (`idealEdgeLength`) et la force avec laquelle
      // elle tire (`edgeElasticity`) sont deux réglages distincts ; ne pas
      // les confondre pour obtenir une attraction plus forte.
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
        const s = sizes.get(edge.source().id()) ?? { width: 160, height: 40 }
        const t = sizes.get(edge.target().id()) ?? { width: 160, height: 40 }
        return (s.width + t.width) / 2 + options.separationMargin * 2
      },
    } as cytoscape.LayoutOptions)

    const done = layout.promiseOn("layoutstop")
    layout.run()
    await done

    const positions = new Map<NodeId, Rect>()
    for (const id of entityIds) {
      const size = sizes.get(id)!
      const pos = cy.getElementById(id).position()
      // cytoscape positionne par le centre ; `Rect` est un coin haut-gauche.
      positions.set(id, {
        x: pos.x - size.width / 2,
        y: pos.y - size.height / 2,
        width: size.width,
        height: size.height,
      })
    }
    cy.destroy()

    separateOverlaps(positions, options.separationMargin, options.separationIterations)

    // Puis, à la granularité de l'agrégat : ouvrir les couloirs entre
    // enveloppes. La passe translate chaque cluster RIGIDEMENT, donc elle ne
    // défait rien du travail de fcose ni de `separateOverlaps` à l'intérieur
    // d'un agrégat. Elle réutilise le plafond d'itérations de la séparation :
    // il y a bien moins de clusters que de cartes, et sa sortie anticipée
    // fonctionne (comparaison à une épsilon), donc ce plafond n'est jamais
    // atteint en pratique.
    separateClusters(positions, aggregates, options.clusterGap, options.separationIterations)

    // Normalisation : le coin haut-gauche de la bbox à l'origine.
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

    // Enveloppes, calculées APRÈS la normalisation pour être dans le même
    // repère que les positions.
    const clusters = computeClusters(aggregates, positions, options.hullPadding)

    return { positions, clusters }
  }

  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return run(graph, aggregates, visible, metrics)
    },
  }
}
