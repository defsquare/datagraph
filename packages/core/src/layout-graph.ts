import cytoscape from "cytoscape"
import fcose from "cytoscape-fcose"
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./layout.js"
import type { Point } from "./hull.js"
import { paddedHull } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
import { separateOverlaps } from "./separate.js"

cytoscape.use(fcose as cytoscape.Ext)

export interface GraphLayoutOptions {
  /** Marge entre une carte et le bord de l'enveloppe de son agrégat. */
  hullPadding?: number
  /** Marge garantie entre deux cartes par la passe de séparation. */
  separationMargin?: number
  separationIterations?: number
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
  layoutAfterExpand(
    prev: GraphLayoutResult,
    graph: Graph,
    aggregates: AggregateIndex,
    expandedAggId: string,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<GraphLayoutResult>
  layoutAfterCollapse(
    prev: GraphLayoutResult,
    graph: Graph,
    aggregates: AggregateIndex,
    collapsedAggId: string,
    visible: Set<NodeId>,
  ): GraphLayoutResult
}

const DEFAULTS: Required<GraphLayoutOptions> = {
  hullPadding: 18,
  separationMargin: 16,
  // `iterations` est un PLAFOND, pas un coût fixe : `separateOverlaps` sort dès
  // qu'une passe ne bouge plus rien. Le relever est donc quasi gratuit sur une
  // entrée facile, et seul le cas difficile paie.
  //
  // Mesure de la Task 4 : la convergence suit la SÉVÉRITÉ du recouvrement, pas
  // le nombre de nœuds — une pile de 40 cartes en recouvrement quasi total
  // demande ~3000 passes, avec un long plateau avant la libération. Le chiffre
  // « ~600 passes à 800 cartes » de la sonde ne se transpose donc pas, et fcose
  // peut produire jusqu'à 94 % d'aire recouverte avant cette passe.
  separationIterations: 3000,
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
 * lui-même l'ordre de déclaration de la config. Extrait ici pour être
 * réutilisé tel quel par `layoutAfterCollapse` (Task 8), qui recalcule les
 * enveloppes sans relancer tout le layout.
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

  return {
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
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
    },

    // Task 8 : relayout incrémental après expansion d'un agrégat.
    async layoutAfterExpand() {
      throw new Error("layoutAfterExpand n'est pas encore implémenté (Task 8)")
    },

    // Task 8 : relayout incrémental après réduction d'un agrégat.
    layoutAfterCollapse() {
      throw new Error("layoutAfterCollapse n'est pas encore implémenté (Task 8)")
    },
  }
}
