import type { Container } from "pixi.js";
import type { NodeId, Rect } from "@defsquare/data-graph-core";

/**
 * Duration of the position transition triggered by an expansion or a collapse.
 *
 * 200 ms: long enough for the eye to FOLLOW a card from its old place to its new
 * one — that is the whole point of the animation, making it clear that the layout
 * reorganized itself rather than got replaced —, short enough that a run of
 * expansions does not turn into waiting. `HOVER_MS` (120 ms, in `hover.ts`) is
 * deliberately shorter: hover answers the pointer, the transition tells a
 * displacement.
 */
export const TRANSITION_MS = 200;

/**
 * The ease-out quad, `1 − (1 − t)²`, over `t ∈ [0, 1]`.
 *
 * SHARED with `hover.ts`, and that is the whole reason it is exported: the two
 * motions of the view — a card joining its new place, a card lighting up under
 * the pointer — must have the same grain, and two copies of the formula would
 * drift the moment either one got tuned. The curve leaves fast and lands
 * settled: the movement reads from its very first frame, and its end goes
 * unnoticed.
 *
 * `t = 1` yields exactly `1`: the bound is REACHED, not approached, and both
 * callers lean on that for their resting state (final position here, hover
 * intensity over there).
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * The minimum of Pixi's `Ticker` this module needs — same shape, and for the same
 * reason, as `HoverTicker` in `hover.ts`: typing it this way rather than as
 * `Ticker` lets a test drive the animation frame by frame without a canvas, and
 * `app.ticker` satisfies it as is.
 */
export interface AnimationTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

export interface PositionAnimatorHooks {
  /**
   * The ticker, resolved at EVERY use and not captured at construction — a real
   * constraint, not a style preference: `app.ticker` only exists once `app.init()`
   * has resolved, whereas the animator is built synchronously with the instance. A
   * captured ticker would be `undefined` there forever, and the first transition
   * would throw.
   *
   * Only called when there is actually something to register or to remove: nothing
   * before init can therefore reach it.
   */
  ticker(): AnimationTicker;
  /**
   * The caller's id → container table, READ at every animation and not copied over:
   * `create.ts` empties and refills it on every `rebuild()`, in place, and the
   * animator must see the containers of the latest rebuild — those are the ones it
   * is going to move.
   */
  nodeViews: ReadonlyMap<NodeId, Container>;
}

export interface PositionAnimator {
  /**
   * Animates every node present in both `prevPositions` and
   * `nextPositions` — that is, every node that SURVIVED the expansion or
   * the collapse — from its old rect towards the new one, in
   * `TRANSITION_MS`. Newly visible nodes and nodes about to disappear are
   * left where the preceding `rebuild()` put them (their final position,
   * or removed).
   *
   * Only one animation is ever in flight: starting one cancels the previous.
   */
  animate(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void;
  /**
   * Is a transition in flight?
   *
   * Exists for the incremental materialization of cards (`create.ts`): as
   * long as a transition is running, containers sit at INTERMEDIATE
   * positions, which say nothing about where they are going to land. Deciding
   * from them what to create or destroy would make a card vanish mid-flight,
   * or make one appear at its arrival position while its neighbours are still
   * sliding.
   */
  isRunning(): boolean;
  /**
   * Unregisters the callback of the running animation, if there is one.
   *
   * To be called BEFORE any rebuild liable to destroy the containers an in-flight
   * animation holds — failing which the next tick would write a `.position` on a
   * destroyed Container (whose `.position` is `null`, cf. `Container.destroy()`)
   * and would throw on every frame FOREVER, since the exception would land before
   * the tick's own `ticker.remove(tick)`.
   *
   * Has no effect when nothing is in flight: callers use it as an unconditional
   * return to rest.
   */
  cancel(): void;
}

/**
 * An instance's position animator: it owns the ONLY transition callback in
 * flight, and that uniqueness is its invariant.
 *
 * This module knows neither the model, nor the current view, nor the scene —
 * like `drag.ts` and `hover.ts`, it turns a pair of layouts into a
 * frame-by-frame displacement and leaves `create.ts` to decide WHEN that makes
 * sense (the graph view, for instance, animates nothing: see `animatePositions`
 * over there).
 */
export function createPositionAnimator(hooks: PositionAnimatorHooks): PositionAnimator {
  // The callback currently registered on the ticker, or `null`. Only one at a time:
  // two concurrent transitions would write the same `.position` in alternation.
  let activeTick: (() => void) | null = null;

  const cancel = (): void => {
    if (activeTick) {
      hooks.ticker().remove(activeTick);
      activeTick = null;
    }
  };

  return {
    cancel,

    isRunning(): boolean {
      return activeTick !== null;
    },

    animate(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
      cancel();

      // `nodeView`, and not `view`: that latter name designates the current view at the
      // caller's, and reusing it here would make the two unreadable together.
      const anims: { nodeView: Container; fromX: number; fromY: number; toX: number; toY: number }[] = [];
      for (const [id, nodeView] of hooks.nodeViews) {
        const from = prevPositions.get(id);
        const to = nextPositions.get(id);
        if (!from || !to) continue;
        if (from.x === to.x && from.y === to.y) continue;
        nodeView.position.set(from.x, from.y);
        anims.push({ nodeView, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      }
      if (anims.length === 0) return;

      const start = performance.now();
      const tick = (): void => {
        const t = Math.min(1, (performance.now() - start) / TRANSITION_MS);
        const eased = easeOutQuad(t);
        for (const a of anims) {
          // Liveness guard: a late tick (one that survived `cancel()`, e.g.
          // a re-entrant rebuild from a ticker callback) must skip
          // destroyed containers by itself rather than throw on a null
          // `.position`.
          if (a.nodeView.destroyed) continue;
          a.nodeView.position.set(a.fromX + (a.toX - a.fromX) * eased, a.fromY + (a.toY - a.fromY) * eased);
        }
        if (t >= 1) {
          hooks.ticker().remove(tick);
          // Compared rather than overwritten: another animation may have taken the slot in
          // the meantime, and setting it to `null` here would make that one uncancellable.
          if (activeTick === tick) activeTick = null;
        }
      };
      activeTick = tick;
      hooks.ticker().add(tick);
    },
  };
}
