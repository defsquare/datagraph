import type { Container } from "pixi.js";
import { easeOutQuad } from "./animate.js";

/**
 * Duration of both the rise and the fall of the hover.
 *
 * 120 ms, a little over half the expansion transition (`TRANSITION_MS`, 200
 * ms, in `animate.ts`): hover must read as a RESPONSE to the pointer, not as
 * an animation one watches. Below ~80 ms the effect turns back into a jump,
 * past ~200 ms the hand has already left the card while the effect is still
 * rising.
 */
export const HOVER_MS = 120;

/**
 * The minimum of Pixi's `Ticker` this module needs. Typing it by that shape rather than
 * by `Ticker` is what lets the tests drive the animation frame by frame without a
 * canvas — `app.ticker` satisfies it as is.
 */
export interface HoverTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

export interface HoverHooks {
  ticker: HoverTicker;
  /**
   * Receives the hover intensity, from 0 (at rest) to 1 (hovered), on every frame of
   * the animation — and one last time exactly on the bound reached, so that the caller
   * never has to guess the final state.
   */
  onFrame(intensity: number): void;
  /**
   * Re-read at EVERY pointer entry and not captured at attach time: what inhibits hover
   * (a drag in progress) starts and ends well after the wiring. An inhibited entry is
   * lost, not deferred — the pointer will come back.
   */
  isBlocked?(): boolean;
}

export interface HoverHandle {
  /**
   * Brings the intensity back to 0 immediately, publishing it one last time, and cuts
   * the animation in flight. It is the caller's way out when another gesture takes over
   * the same target (the start of a card drag): it does not have to undo by itself what
   * `onFrame` laid down, it asks for rest again through that same path. No effect if
   * the intensity was already zero.
   */
  cancel(): void;
}

/**
 * Wires a container so that it publishes an animated hover intensity: 0 → 1 when the
 * pointer enters, 1 → 0 when it leaves, in `HOVER_MS` and in `easeOutQuad` — literally
 * the curve of the expansion transition, borrowed from `animate.ts`, so that the two
 * motions of the view have the same grain.
 *
 * This module knows NEITHER the model nor the scene, exactly like `drag.ts`: it turns
 * two events into a value and hands it back to the caller, who decides alone what it
 * paints (a card's scale, an envelope's alpha). That is what makes it testable without
 * a canvas.
 *
 * A change of direction mid-animation RESTARTS FROM THE CURRENT VALUE and not from the
 * opposite bound: leaving halfway up comes back down from there. Restarting from 1
 * would produce a jolt at the precise moment the pointer leaves the card, that is,
 * right where the eye is still resting.
 *
 * The duration stays `HOVER_MS` whatever the distance to cover. A proportional duration
 * would be more "correct" physically, but over 120 ms the difference does not show, and
 * it would cost one more piece of state to hold.
 */
export function attachHover(target: Container, hooks: HoverHooks): HoverHandle {
  target.eventMode = "static";

  // The intensity PUBLISHED last: it, and not the elapsed time, is what the next change
  // of direction starts from.
  let current = 0;
  let from = 0;
  let to = 0;
  let start = 0;
  // The callback is registered on the ticker only during an animation, and only once:
  // two `pointerover` in a row (Pixi emits one per traversed sub-object) must not
  // double the pace.
  let running = false;

  const stop = (): void => {
    if (!running) return;
    running = false;
    hooks.ticker.remove(tick);
  };

  function tick(): void {
    // Liveness guard, as in `animate.ts`: a `rebuild()` destroys the containers without
    // any `pointerout` having gone through, and the caller would then write onto a null
    // `.position`. The exception would land BEFORE the ticker removal, so it would
    // repeat on every frame forever — hence the self-removal here rather than a plain
    // frame skip.
    if (target.destroyed) {
      stop();
      return;
    }
    const t = Math.min(1, (performance.now() - start) / HOVER_MS);
    // The SAME curve as the expansion transition, imported and not copied over: two
    // copies of the formula would drift at the first tuning of either, and the two
    // motions of the view would stop having the same grain.
    const eased = easeOutQuad(t);
    current = from + (to - from) * eased;
    hooks.onFrame(current);
    // `t >= 1` gives `current === to` exactly: the bound is reached, not approached,
    // and the caller can rely on it for its resting state.
    if (t >= 1) stop();
  }

  const animateTo = (target_: number): void => {
    from = current;
    to = target_;
    start = performance.now();
    if (running) return;
    running = true;
    hooks.ticker.add(tick);
  };

  target.on("pointerover", () => {
    if (hooks.isBlocked?.()) return;
    if (current === 1) return; // already at the high rest: nothing to animate
    animateTo(1);
  });

  target.on("pointerout", () => {
    // No `isBlocked` guard here: a departure must ALWAYS be able to return the target
    // to its rest, failing which a card hovered and then grabbed would stay lit. The
    // zero-intensity guard is enough to ignore the departure that follows an inhibited
    // entry.
    if (current === 0) return;
    animateTo(0);
  });

  return {
    cancel(): void {
      stop();
      if (current === 0) return;
      current = from = to = 0;
      // Published, and not merely reset to zero: the caller painted the hover, it is
      // through that same callback that it unpaints it.
      if (!target.destroyed) hooks.onFrame(0);
    },
  };
}
