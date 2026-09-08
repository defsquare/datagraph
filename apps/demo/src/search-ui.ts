import type { DataGraph } from "@defsquare/data-graph";

// Search: debounced input, Enter/Shift+Enter navigation, ↑/↓ buttons and an
// "N/total" counter. `graph.search`/`nextMatch`/`prevMatch` do not expose the
// current index, so the counter redoes locally the arithmetic of the renderer's
// circular cursor (see `doStepMatch` in create.ts) — both start in sync (reset
// to -1 by every `search()`) and only move through the same next/prev calls, so
// they cannot diverge.

const SEARCH_DEBOUNCE_MS = 150;

export interface SearchUi {
  /** Resets input, counter and cursor — what `setData()` does on its side to the
   * renderer's search state. */
  reset(): void;
  /** Focuses the input and selects its content, on unfolding. */
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

  /** Runs a pending debounced search right away — so that Enter (or a navigation
   * button) pressed just after a keystroke does not navigate stale results from
   * before the last key. */
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
