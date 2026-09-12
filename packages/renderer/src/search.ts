import type { NodeId, SearchIndex, SearchResult } from "@defsquare/datagraph-core";

export interface SearchHooks {
  /**
   * The CURRENT search index, re-read on every query and not captured at
   * construction: `setData()` installs a new one, and a frozen index would answer
   * for the old graph. `undefined` for as long as the pipeline has not published
   * its own — `search()` then returns an empty result rather than being a silent
   * no-op.
   */
  getIndex(): SearchIndex | undefined;
  /** The visible nodes of the current view. Re-read on every repaint, never
   * memoized: visibility changes independently of the search (an expansion
   * elsewhere, a view toggle). */
  getActiveVisible(): ReadonlySet<NodeId>;
  /** The repaint of the top layer, the only place the search highlight gets
   * painted. It is what calls `visibleMatchIds()`/`currentMatchId()` back. */
  redrawOverlay(): void;
  /** Centers the view on a result, expanding the path leading to it if needed.
   * Asynchronous at the caller's, deliberately ignored here: `nextMatch()`
   * returns its result right away, the framing follows. */
  focus(id: NodeId): void;
}

export interface SearchController {
  /**
   * Queries the index, resets the `nextMatch`/`prevMatch` cursor to `-1` and repaints
   * the highlight. `query === ""` returns an empty set (that is `SearchIndex.search`'s
   * own behaviour), which clears highlight and state through the same code path — so
   * there is nothing to clear separately.
   */
  search(query: string): SearchResult[];
  /**
   * Shared by `nextMatch` (`direction: 1`) and `prevMatch` (`direction: -1`): advances
   * the circular cursor, centers on the result obtained (automatic expansion included)
   * and strengthens its highlight; returns `null` without moving the cursor when there
   * is no result at all.
   *
   * The `-1` sentinel (no current result) is handled apart rather than folded
   * into the generic modular computation `(cursor + direction + count) % count`:
   * that formula sees `-1` as "one notch before 0", so a step backwards from
   * there would land on `count - 2` and not on the last result — which is not
   * the intended behaviour ("the first `prevMatch` of a fresh search jumps to
   * the last match"). From `-1`, next goes to the first (0) and prev to the last
   * (`count - 1`); from any real position, the modular computation applies as
   * is.
   */
  step(direction: 1 | -1): SearchResult | null;
  /**
   * The ids of the results currently VISIBLE — the set the highlight is drawn on.
   * Recomputed on every repaint rather than memoized: visibility can change without the
   * search moving at all.
   */
  visibleMatchIds(): NodeId[];
  /** The id of the result under the cursor, or `null` — it is the one the
   * highlight paints stronger than the others. */
  currentMatchId(): NodeId | null;
  /**
   * Resets the search WITHOUT repainting: the only caller (`setData`) replaces the
   * whole state of the instance and finishes on a `rebuild()`, which already repaints
   * the top layer. Repainting here would do it twice, on a half-replaced graph for the
   * first one.
   */
  reset(): void;
}

/**
 * An instance's search controller: it OWNS the current results and the cursor that
 * walks them, and it is the only one to read them.
 *
 * This module knows neither Pixi, nor the graph, nor the layout: it turns queries into
 * results and a cursor into a current id, then hands control back to the caller through
 * callbacks — same shape as `drag.ts`, `hover.ts` and `focus.ts`, and that is what
 * makes it testable without a canvas or an instance.
 *
 * It imports NOTHING from `create.ts`, the index included: that one is produced by the
 * data pipeline and arrives through `getIndex()`. An import in that direction would
 * close a cycle, `create.ts` being the sole orchestration point.
 */
export function createSearchController(hooks: SearchHooks): SearchController {
  // The results of the last `search()`, and `step()`'s cursor into them (`-1` = no
  // current result, that is, just after a fresh search or before any search at
  // all).
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
