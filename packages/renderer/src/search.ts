import type { NodeId, SearchIndex, SearchResult } from "@defsquare/data-graph-core";

export interface SearchHooks {
  /**
   * L'index de recherche COURANT, relu à chaque requête et non capturé à la
   * construction : `setData()` en installe un nouveau, et un index figé
   * répondrait pour l'ancien graphe. `undefined` tant que le pipeline n'a pas
   * publié le sien — `search()` rend alors un résultat vide plutôt que d'être
   * un no-op silencieux.
   */
  getIndex(): SearchIndex | undefined;
  /** Les nœuds visibles de la vue courante. Relu à chaque repeint, jamais
   * mémorisé : la visibilité change indépendamment de la recherche (un dépliage
   * ailleurs, une bascule de vue). */
  getActiveVisible(): ReadonlySet<NodeId>;
  /** Le repeint du calque haut, seul endroit où le surlignage de recherche est
   * peint. C'est lui qui rappelle `visibleMatchIds()`/`currentMatchId()`. */
  redrawOverlay(): void;
  /** Centre la vue sur un résultat, en dépliant le chemin qui y mène si besoin.
   * Asynchrone chez l'appelant, délibérément ignoré ici : `nextMatch()` rend son
   * résultat tout de suite, le cadrage suit. */
  focus(id: NodeId): void;
}

export interface SearchController {
  /**
   * Interroge l'index, remet le curseur `nextMatch`/`prevMatch` à `-1` et
   * repeint le surlignage. `query === ""` rend un ensemble vide (c'est le
   * comportement propre de `SearchIndex.search`), ce qui efface surlignage et
   * état par le même chemin de code — il n'y a donc rien à effacer à part.
   */
  search(query: string): SearchResult[];
  /**
   * Partagé par `nextMatch` (`direction: 1`) et `prevMatch` (`direction: -1`) :
   * avance le curseur circulaire, centre sur le résultat obtenu (dépliage
   * automatique compris) et renforce son surlignage ; rend `null` sans bouger le
   * curseur quand il n'y a aucun résultat.
   *
   * La sentinelle `-1` (aucun résultat courant) est traitée à part plutôt que
   * pliée dans le calcul modulaire générique `(cursor + direction + count) %
   * count` : cette formule voit `-1` comme « un cran avant 0 », donc un pas en
   * arrière depuis là tomberait sur `count - 2` et non sur le dernier résultat —
   * ce qui n'est pas le comportement voulu (« le premier `prevMatch` d'une
   * recherche fraîche saute au dernier match »). Depuis `-1`, next va au premier
   * (0) et prev au dernier (`count - 1`) ; depuis toute position réelle, le
   * calcul modulaire s'applique tel quel.
   */
  step(direction: 1 | -1): SearchResult | null;
  /**
   * Les ids des résultats actuellement VISIBLES — l'ensemble sur lequel le
   * surlignage est dessiné. Recalculé à chaque repeint plutôt que mémorisé : la
   * visibilité peut changer sans que la recherche ne bouge.
   */
  visibleMatchIds(): NodeId[];
  /** L'id du résultat sous le curseur, ou `null` — c'est lui que le surlignage
   * peint plus fort que les autres. */
  currentMatchId(): NodeId | null;
  /**
   * Remet la recherche à zéro SANS repeindre : le seul appelant (`setData`)
   * remplace tout l'état de l'instance et finit sur un `rebuild()`, qui repeint
   * déjà le calque haut. Repeindre ici le ferait deux fois, sur un graphe
   * à moitié remplacé pour le premier.
   */
  reset(): void;
}

/**
 * Le contrôleur de recherche d'une instance : il POSSÈDE les résultats courants
 * et le curseur qui les parcourt, et il est le seul à les lire.
 *
 * Ce module ne connaît ni Pixi, ni le graphe, ni la mise en page : il traduit
 * des requêtes en résultats et un curseur en id courant, puis redonne la main à
 * l'appelant par des rappels — même forme que `drag.ts`, `hover.ts` et
 * `focus.ts`, et c'est ce qui le rend testable sans canvas ni instance.
 *
 * Il n'importe RIEN de `create.ts`, y compris l'index : celui-ci est produit par
 * le pipeline de données et arrive par `getIndex()`. Un import dans ce sens
 * fermerait un cycle, `create.ts` étant le seul point d'orchestration.
 */
export function createSearchController(hooks: SearchHooks): SearchController {
  // Les résultats du dernier `search()`, et le curseur de `step()` dedans
  // (`-1` = aucun résultat courant, c'est-à-dire juste après une recherche
  // fraîche ou avant toute recherche).
  let results: SearchResult[] = [];
  let cursor = -1;

  return {
    search(query: string): SearchResult[] {
      const index = hooks.getIndex();
      results = index ? index.search(query) : [];
      cursor = -1;
      hooks.redrawOverlay();
      return results;
    },

    step(direction: 1 | -1): SearchResult | null {
      const count = results.length;
      if (count === 0) return null;
      cursor = cursor === -1 ? (direction === 1 ? 0 : count - 1) : (cursor + direction + count) % count;
      const result = results[cursor]!;
      hooks.focus(result.nodeId);
      hooks.redrawOverlay();
      return result;
    },

    visibleMatchIds(): NodeId[] {
      if (results.length === 0) return [];
      const visible = hooks.getActiveVisible();
      return results.map((r) => r.nodeId).filter((id) => visible.has(id));
    },

    currentMatchId(): NodeId | null {
      return results[cursor]?.nodeId ?? null;
    },

    reset(): void {
      results = [];
      cursor = -1;
    },
  };
}
