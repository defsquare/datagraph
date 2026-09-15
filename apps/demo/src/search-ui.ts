import type { DataGraph } from "@defsquare/datagraph";

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

export interface SearchUiHooks {
  /** Called whenever the field goes from empty to filled or back. The search UI
   * owns the input; the chrome owns the button that has to reflect it, and
   * neither reaches into the other's DOM. */
  onQueryChange(hasQuery: boolean): void;
}

export function createSearchUi(graph: DataGraph, hooks: SearchUiHooks): SearchUi {
  const searchInput = document.getElementById("search") as HTMLInputElement | null;
  const matchCounterEl = document.getElementById("match-counter");
  const prevMatchBtn = document.getElementById("prev-match");
  const nextMatchBtn = document.getElementById("next-match");

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let matchTotal = 0;
  let matchCursor = -1;

  /**
   * Three resting states, and the distinction between the last two is the point:
   * an empty field has nothing to report, whereas a query that matches nothing
   * must SAY it — that silence was read as "the search did not run".
   */
  function updateMatchCounter(): void {
    if (!matchCounterEl) return;
    if (matchTotal > 0) {
      matchCounterEl.textContent = `${matchCursor + 1}/${matchTotal}`;
      return;
    }
    matchCounterEl.textContent = (searchInput?.value ?? "") === "" ? "" : "0 results";
  }

  /**
   * Runs the query. `landOnFirst` is what tells apart the two callers instead of
   * having them recurse into each other: the debounce timer passes `true` — a
   * settled, user-driven search should LAND on the first result, the resting
   * state of every standard findbar (without it the counter read "0/3" and the
   * camera had not moved, so a search that had worked looked like one that had
   * not). `flushPendingSearch` passes `false`: it runs inside `goToNextMatch`/
   * `goToPrevMatch`, only to make the results current before ITS caller's own
   * single step — landing here too would turn one keypress into two steps.
   */
  function runSearch(query: string, landOnFirst: boolean): void {
    const results = graph.search(query);
    matchTotal = results.length;
    matchCursor = -1;
    if (landOnFirst && matchTotal > 0) {
      goToNextMatch();
      return;
    }
    updateMatchCounter();
  }

  /** Runs a pending debounced search right away — so that Enter (or a navigation
   * button) pressed just after a keystroke does not navigate stale results from
   * before the last key. Never lands on a match itself (`landOnFirst: false`):
   * it exists to make `goToNextMatch`/`goToPrevMatch`'s own step land on current
   * results, not to take a step of its own ahead of them. */
  function flushPendingSearch(): void {
    if (debounceHandle === undefined) return;
    clearTimeout(debounceHandle);
    debounceHandle = undefined;
    runSearch(searchInput?.value ?? "", false);
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
      hooks.onQueryChange(value !== "");
      debounceHandle = setTimeout(() => {
        debounceHandle = undefined;
        runSearch(value, true);
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
      hooks.onQueryChange(false);
      updateMatchCounter();
    },
    focus(): void {
      searchInput?.focus();
      searchInput?.select();
    },
  };
}
