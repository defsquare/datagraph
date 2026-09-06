import type { DataGraph } from "@defsquare/data-graph";

// Recherche : saisie débouncée, navigation Entrée/Maj+Entrée, boutons ↑/↓ et
// compteur « N/total ». `graph.search`/`nextMatch`/`prevMatch` n'exposent pas
// l'index courant, donc le compteur refait localement l'arithmétique du curseur
// circulaire du renderer (voir `doStepMatch` dans create.ts) — les deux partent
// synchronisés (remis à -1 par chaque `search()`) et ne bougent que par les
// mêmes appels next/prev, ils ne peuvent donc pas diverger.

const SEARCH_DEBOUNCE_MS = 150;

export interface SearchUi {
  /** Remet champ, compteur et curseur à zéro — ce que `setData()` fait de son
   * côté sur l'état de recherche du renderer. */
  reset(): void;
  /** Donne le focus au champ et sélectionne son contenu, au dépliage. */
  focus(): void;
}

export function createSearchUi(graph: DataGraph): SearchUi {
  const searchInput = document.getElementById("search") as HTMLInputElement | null;
  const matchCounterEl = document.getElementById("match-counter");
  const prevMatchBtn = document.getElementById("prev-match");
  const nextMatchBtn = document.getElementById("next-match");

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let matchTotal = 0;
  let matchCursor = -1;

  function updateMatchCounter(): void {
    if (!matchCounterEl) return;
    matchCounterEl.textContent = matchTotal > 0 ? `${matchCursor + 1}/${matchTotal}` : "";
  }

  function runSearch(query: string): void {
    const results = graph.search(query);
    matchTotal = results.length;
    matchCursor = -1;
    updateMatchCounter();
  }

  /** Exécute immédiatement une recherche débouncée en attente — pour qu'Entrée
   * (ou un bouton de navigation) juste après une frappe ne navigue pas sur des
   * résultats périmés d'avant la dernière touche. */
  function flushPendingSearch(): void {
    if (debounceHandle === undefined) return;
    clearTimeout(debounceHandle);
    debounceHandle = undefined;
    runSearch(searchInput?.value ?? "");
  }

  function goToNextMatch(): void {
    flushPendingSearch();
    const result = graph.nextMatch();
    if (result) matchCursor = matchTotal > 0 ? (matchCursor + 1) % matchTotal : -1;
    updateMatchCounter();
  }

  function goToPrevMatch(): void {
    flushPendingSearch();
    const result = graph.prevMatch();
    if (result) matchCursor = matchCursor <= 0 ? matchTotal - 1 : matchCursor - 1;
    updateMatchCounter();
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceHandle);
      const value = searchInput.value;
      debounceHandle = setTimeout(() => {
        debounceHandle = undefined;
        runSearch(value);
      }, SEARCH_DEBOUNCE_MS);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (event.shiftKey) goToPrevMatch();
      else goToNextMatch();
    });
  }

  nextMatchBtn?.addEventListener("click", goToNextMatch);
  prevMatchBtn?.addEventListener("click", goToPrevMatch);

  return {
    reset(): void {
      if (searchInput) searchInput.value = "";
      matchTotal = 0;
      matchCursor = -1;
      updateMatchCounter();
    },
    focus(): void {
      searchInput?.focus();
      searchInput?.select();
    },
  };
}
