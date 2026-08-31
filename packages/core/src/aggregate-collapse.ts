import type { AggregateIndex } from "./aggregate.js"
import type { NodeId } from "./model.js"

/**
 * Suit quels agrégats sont dépliés dans la vue graphe, et en dérive
 * l'ensemble des entités visibles.
 *
 * Les agrégats démarrent **dépliés** : la vue graphe existe pour montrer le
 * graphe, pas pour le cacher. Replier réduit un agrégat à sa seule carte
 * racine.
 *
 * Distincte de `CollapseState`, qui gouverne l'arbre de containment de la vue
 * structure et n'est pas concernée ici.
 */
export class AggregateCollapseState {
  private readonly index: AggregateIndex
  private readonly allEntityIds: NodeId[]
  private readonly collapsed: Set<string> = new Set()

  constructor(index: AggregateIndex, allEntityIds: Iterable<NodeId>) {
    this.index = index
    this.allEntityIds = [...allEntityIds]
  }

  isExpanded(aggregateId: string): boolean {
    return !this.collapsed.has(aggregateId)
  }

  expand(aggregateId: string): void {
    this.collapsed.delete(aggregateId)
  }

  collapse(aggregateId: string): void {
    // Un id inconnu est ignoré plutôt que de lever : l'appelant est un
    // gestionnaire de clic, pas un contrat interne.
    if (!this.index.aggregates.has(aggregateId)) return
    this.collapsed.add(aggregateId)
  }

  /**
   * Une racine est toujours visible ; une entité qui n'appartient à aucun
   * agrégat aussi. Un membre non-racine est visible dès qu'**au moins un** de
   * ses agrégats est déplié — c'est la règle correcte sous chevauchement : une
   * entité partagée reste montrée par celui de ses agrégats qui est ouvert.
   */
  visibleEntityIds(): Set<NodeId> {
    const visible = new Set<NodeId>()

    // Une entité hors de tout agrégat n'est gouvernée par aucun pli : elle est
    // toujours visible. `AggregateIndex` ne la connaît pas, d'où la liste
    // complète passée au constructeur.
    for (const id of this.allEntityIds) {
      if (!this.index.byNode.has(id)) visible.add(id)
    }

    for (const aggregate of this.index.aggregates.values()) {
      visible.add(aggregate.rootId)
      if (this.collapsed.has(aggregate.id)) continue
      for (const memberId of aggregate.memberIds) visible.add(memberId)
    }

    return visible
  }
}
