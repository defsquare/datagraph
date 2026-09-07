import type { Graph, NodeId } from "./model.js"

/**
 * Nombre d'enfants-cartes révélés d'un coup. La pagination existe parce qu'un
 * seul nœud peut porter des centaines de milliers d'enfants : mesurer, poser
 * et dessiner tout ça coûte plus que ce qu'un écran peut montrer.
 */
export const PAGE_SIZE = 100

/**
 * La page ALIGNÉE qui contient l'indice de carte donné : la page `p` couvre
 * exactement `[p * PAGE_SIZE, (p + 1) * PAGE_SIZE)`. L'alignement est ce qui
 * rend une page identifiable par un seul entier, donc révélable, annulable et
 * comparable sans mémoriser de bornes.
 */
export function pageOf(cardIndex: number): number {
  return Math.floor(cardIndex / PAGE_SIZE)
}

/**
 * Nombre de cartes que le dépliage initial s'autorise à « acheter ». Ce n'est
 * pas une limite de rendu mais une limite d'APERÇU : au-delà, ce qui s'ouvre
 * n'est plus lisible et le coût du layout devient celui du document entier.
 */
export const INITIAL_CARD_BUDGET = 300

/**
 * Une plage CONTIGUË d'enfants-cartes non révélés : de quoi dessiner un jeton
 * « … n de plus » à sa place dans l'ordre des enfants, et savoir quelle page
 * révéler quand on le clique.
 */
export interface HiddenGap {
  fromIndex: number
  count: number
  nextPage: number
}

/**
 * Tracks which nodes of a Graph are expanded vs collapsed, and derives
 * visibility from that state.
 *
 * Initial state (constructor): BFS from the root, marking every
 * non-entity node encountered as expanded; descent stops at the first
 * entity node on each branch (entities start collapsed).
 *
 * Ce dépliage est en outre BORNÉ par un budget de cartes (`initialCardBudget`,
 * défaut `INITIAL_CARD_BUDGET`) : sans entités — le cas du mode CLI sans config
 * — la frontière d'entités ne freine rien et le BFS déplierait le document
 * entier. Le budget rend l'état initial un APERÇU des niveaux hauts ; ce qu'il
 * refuse reste visible, simplement replié.
 */
export class CollapseState {
  private readonly graph: Graph
  private readonly expanded: Set<NodeId> = new Set()
  /**
   * Pages d'enfants-cartes révélées, par nœud. L'ABSENCE d'entrée vaut `{0}` :
   * le dépliage ordinaire n'écrit donc rien, et la pagination s'applique d'
   * elle-même dès qu'un nœud dépasse `PAGE_SIZE` enfants-cartes — c'est ce qui
   * garde le coût de l'état proportionnel aux pages ouvertes, pas au graphe.
   * La PRÉSENCE d'une entrée fait foi, même vide : `unrevealPage(id, 0)` est un
   * état légitime (« rien de révélé ») et non un retour au défaut.
   */
  private readonly revealed: Map<NodeId, Set<number>> = new Map()
  private static readonly DEFAULT_PAGES: ReadonlySet<number> = new Set([0])

  constructor(graph: Graph, opts: { initialCardBudget?: number } = {}) {
    this.graph = graph
    const budget = opts.initialCardBudget ?? INITIAL_CARD_BUDGET

    // Le BFS historique dépliait tout jusqu'aux frontières d'entités — sans
    // config il n'y a pas d'entités, donc aucun frein, et le document entier
    // partait dans ELK en un appel (16 s à 50k nœuds). Le budget est le second
    // frein : on cesse de MARQUER déplié dès qu'on a « acheté » assez de cartes
    // visibles. Le BFS sert les niveaux hauts d'abord — c'est l'aperçu.
    // Un nœud atteint mais non marqué reste une carte repliée visible.
    let cards = 1 // la racine elle-même
    const queue: NodeId[] = [graph.rootId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = graph.nodes.get(id)
      if (!node) continue
      // The root is always expanded/visible, even in the (unusual) case
      // where it is itself an entity node; its children still respect
      // the entity-boundary rule below.
      if (node.kind === "entity" && id !== graph.rootId) continue

      // Déplier `id` révèle sa première page d'enfants-cartes : c'est ce que ça
      // coûte au budget. La racine est toujours dépliée — un document qui
      // s'ouvre sur rien du tout n'est pas un aperçu.
      const cost = Math.min(this.cardChildren(id).length, PAGE_SIZE)
      if (id !== graph.rootId && cards + cost > budget) continue
      cards += cost

      this.expanded.add(id)
      if (node.kind === "entity") continue // do not descend past an entity boundary

      // N'enfiler que ce qui peut devenir visible : les élidés (toujours des
      // lignes) et la PREMIÈRE page d'enfants-cartes. Enfiler au-delà ferait
      // dépenser le budget à marquer déplié des nœuds que les pages cachent.
      let cardIndex = 0
      for (const childId of node.childIds) {
        const child = graph.nodes.get(childId)
        if (!child) continue
        if (child.elided) {
          queue.push(childId)
          continue
        }
        if (cardIndex < PAGE_SIZE) queue.push(childId)
        cardIndex++
      }
    }
  }

  isExpanded(id: NodeId): boolean {
    return this.expanded.has(id)
  }

  expand(id: NodeId): void {
    this.expanded.add(id)
  }

  collapse(id: NodeId): void {
    this.expanded.delete(id)
  }

  revealedPages(id: NodeId): ReadonlySet<number> {
    return this.revealed.get(id) ?? CollapseState.DEFAULT_PAGES
  }

  revealPage(id: NodeId, page: number): void {
    this.mutablePages(id).add(page)
  }

  unrevealPage(id: NodeId, page: number): void {
    this.mutablePages(id).delete(page)
  }

  /**
   * L'ensemble modifiable des pages de `id`, matérialisé au premier écrit à
   * partir du défaut. Copier `DEFAULT_PAGES` plutôt que la partager est vital :
   * elle est statique, la muter paginerait tout le graphe d'un coup.
   */
  private mutablePages(id: NodeId): Set<number> {
    let pages = this.revealed.get(id)
    if (!pages) {
      pages = new Set(CollapseState.DEFAULT_PAGES)
      this.revealed.set(id, pages)
    }
    return pages
  }

  /**
   * Les enfants de `id` qui sont des CARTES, dans l'ordre de `childIds`. Les
   * élidés sont écartés parce qu'ils sont des lignes de la carte de `id` : ils
   * ne se paginent pas, et les compter décalerait l'indice des vraies cartes.
   */
  private cardChildren(id: NodeId): NodeId[] {
    const node = this.graph.nodes.get(id)
    if (!node) return []
    return node.childIds.filter((childId) => {
      const child = this.graph.nodes.get(childId)
      return child !== undefined && !child.elided
    })
  }

  /** Rang de `childId` parmi les enfants-cartes de `parentId` ; -1 si absent ou élidé. */
  cardIndexOf(parentId: NodeId, childId: NodeId): number {
    return this.cardChildren(parentId).indexOf(childId)
  }

  /**
   * Les plages d'enfants-cartes non révélées de `id`, en ordre d'indices
   * croissants. Les pages non révélées consécutives sont FUSIONNÉES en une
   * seule plage : elles se remplacent à l'écran par un jeton unique, et le
   * révéler entame le trou par sa première page (`nextPage`).
   */
  hiddenGaps(id: NodeId): HiddenGap[] {
    const cards = this.cardChildren(id)
    const pageCount = Math.ceil(cards.length / PAGE_SIZE)
    const pages = this.revealedPages(id)
    const gaps: HiddenGap[] = []
    let page = 0
    while (page < pageCount) {
      if (pages.has(page)) {
        page++
        continue
      }
      const start = page
      while (page < pageCount && !pages.has(page)) page++
      const fromIndex = start * PAGE_SIZE
      // La dernière page est incomplète : borner sur le nombre réel de cartes,
      // sinon le jeton annoncerait des enfants qui n'existent pas.
      const count = Math.min(page * PAGE_SIZE, cards.length) - fromIndex
      gaps.push({ fromIndex, count, nextPage: start })
    }
    return gaps
  }

  /**
   * DFS from root; a node is included as soon as it is reached (its
   * parent chain is all expanded), and we only descend through it if
   * it is itself expanded. Root is always expanded and always visible.
   *
   * Un enfant ÉLIDÉ échappe à cette règle : il n'est pas une carte à révéler
   * mais une LIGNE de la carte de son parent, donc il est là dès que cette
   * carte l'est, sans attendre que le parent soit déplié. C'est ce qui rend le
   * jeton `[ n items ]` visible sur une entité repliée — sinon le jeton serait
   * dessiné (les lignes le sont toujours) alors que le nœud qu'il pilote
   * n'existerait pas pour le pli, et le clic ne déplierait rien.
   *
   * Un enfant-CARTE, lui, ne suffit pas d'être atteint : sa page doit être
   * révélée. L'indice de carte se tient au fil du parcours plutôt que par
   * `cardIndexOf`, qui referait la liste filtrée pour chaque enfant.
   */
  visibleNodeIds(): Set<NodeId> {
    const visible = new Set<NodeId>()
    const stack: NodeId[] = [this.graph.rootId]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = this.graph.nodes.get(id)
      if (!node) continue
      visible.add(id)
      const expanded = this.isExpanded(id)
      const pages = this.revealedPages(id)
      let cardIndex = 0
      for (const childId of node.childIds) {
        const child = this.graph.nodes.get(childId)
        if (!child) continue
        if (child.elided) {
          stack.push(childId)
          continue
        }
        if (expanded && pages.has(pageOf(cardIndex))) stack.push(childId)
        cardIndex++
      }
    }
    return visible
  }

  /**
   * Expands every ancestor of `id` (not `id` itself). Returns the ids
   * that were newly expanded by this call, in root-first order.
   * Idempotent: calling again with the same id returns [].
   */
  expandPathTo(id: NodeId): NodeId[] {
    const ancestors: NodeId[] = []
    let node = this.graph.nodes.get(id)
    let parentId = node?.parentId ?? null
    while (parentId !== null) {
      ancestors.push(parentId)
      node = this.graph.nodes.get(parentId)
      parentId = node?.parentId ?? null
    }
    ancestors.reverse() // root-first

    const newly: NodeId[] = []
    for (const ancestorId of ancestors) {
      if (!this.expanded.has(ancestorId)) {
        this.expanded.add(ancestorId)
        newly.push(ancestorId)
      }
    }
    return newly
  }
}
