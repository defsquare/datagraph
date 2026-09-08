import type { Container, FederatedPointerEvent } from "pixi.js";

/**
 * Movement (in SCREEN pixels) tolerated between `pointerdown` and `pointertap` before a
 * gesture stops being a click.
 *
 * The constant lives HERE because it is the shared point of TWO gestures that
 * have to split the real line between them with neither gap nor overlap:
 * `attachTap` (in `create.ts`) ignores any gesture whose travel exceeds this
 * threshold, `attachDrag` only starts beyond it. Two copies of the value would,
 * at the first tuning of either, let a dead band appear (a gesture that is
 * neither tap nor drag) or a double band (a card being dragged AND selected by
 * the same gesture).
 */
export const TAP_THRESHOLD = 4;

export interface DragHooks {
  /**
   * The camera's current scale, re-read at EVERY movement and not captured at attach
   * time: it changes under the drag (wheel in one hand, button in the other), and a
   * frozen value would make the card come loose from the cursor.
   */
  scale(): number;
  /** Called once, when the threshold is crossed — not at `pointerdown`, where
   * we do not yet know whether the gesture is a click or a drag. */
  onStart?(): void;
  /** Deltas in WORLD units, already divided by the scale, and INCREMENTAL
   * (since the previous movement, or since the press point for the very
   * first one). */
  onMove(dxWorld: number, dyWorld: number): void;
  onEnd?(): void;
}

/**
 * Wires a container so that a held left click drags it, Cytoscape style: press, cross
 * `TAP_THRESHOLD` screen pixels, then follow the pointer until release.
 *
 * This module knows NEITHER the model nor the scene: all it does is turn a stream of
 * federated events into world deltas and hand them back to the caller. That is what
 * makes it testable without a canvas — and what leaves `create.ts` alone to decide what
 * a drag updates (positions, edges, envelopes), without this file having to know a
 * single one of them.
 *
 * `globalpointermove` and not `pointermove`: the pointer leaves the
 * card as soon as one moves faster than it follows, and a local
 * `pointermove` would let the gesture die at the first overshoot. Same
 * reason for `pointerupoutside`, which is the NORMAL way a fast drag
 * ends and not an edge case — without it, the drag would stay armed
 * after release (and, on `create.ts`'s side, the camera pan inhibited
 * forever).
 */
export function attachDrag(target: Container, hooks: DragHooks): void {
  target.eventMode = "static";

  // `pressed` without `dragging` is the state of a still-undecided gesture: the button
  // is down, the threshold not crossed, and this may still turn into a tap.
  let pressed = false;
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  // The cursor from before the drag, restored at the end: on cards it is `"pointer"`,
  // set by `attachTap`, and overwriting it with a hard-coded value would lose it at the
  // first drag.
  let restoreCursor: Container["cursor"];

  target.on("pointerdown", (event: FederatedPointerEvent) => {
    // Left button only, like the camera pan: the right button is reserved for the
    // host's context menu.
    if (event.button !== 0) return;
    pressed = true;
    dragging = false;
    downX = lastX = event.global.x;
    downY = lastY = event.global.y;
  });

  target.on("globalpointermove", (event: FederatedPointerEvent) => {
    if (!pressed) return;
    const x = event.global.x;
    const y = event.global.y;

    if (!dragging) {
      if (Math.hypot(x - downX, y - downY) <= TAP_THRESHOLD) return;
      dragging = true;
      restoreCursor = target.cursor;
      target.cursor = "grabbing";
      hooks.onStart?.();
      // `lastX/lastY` still hold the PRESS point: the first published delta therefore
      // covers the whole path travelled since it, threshold included. Counting from the
      // crossing instead would leave the card `TAP_THRESHOLD` px behind the cursor for
      // the rest of the gesture.
    }

    // A scale of zero or a non-finite one cannot come from `Camera` (bounded to [0.02,
    // 3]) but dividing by it would produce `Infinity`s that would contaminate the
    // layout positions irreversibly.
    const scale = hooks.scale();
    const divisor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    hooks.onMove((x - lastX) / divisor, (y - lastY) / divisor);
    lastX = x;
    lastY = y;
  });

  const end = (): void => {
    if (!pressed) return;
    pressed = false;
    // A gesture that never crossed the threshold started nothing: not calling
    // `onEnd` keeps the caller from undoing, on every plain click, a state it never
    // set.
    if (!dragging) return;
    dragging = false;
    target.cursor = restoreCursor;
    hooks.onEnd?.();
  };

  target.on("pointerup", end);
  target.on("pointerupoutside", end);
}
