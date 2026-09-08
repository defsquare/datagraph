import { describe, it, expect, vi, afterEach } from "vitest";
import { Container, type FederatedPointerEvent } from "pixi.js";
import { attachHover, HOVER_MS, type HoverTicker } from "../src/hover.js";

/** The event Pixi hands its hover listeners. Empty, and that is the point:
 * `attachHover` reads NOTHING from it — no button, no position, unlike
 * `attachDrag`. It only exists to satisfy `emit`'s signature. */
const EVENT = {} as unknown as FederatedPointerEvent;

/** A fake ticker in place of Pixi's: `attachHover` asks it for nothing but
 * calling a function once per frame, so driving it by hand is what makes the
 * animation observable step by step — and these tests canvas-free, the way
 * `drag.test.ts` fabricates its events rather than running an `EventSystem`. */
function ticker() {
  const fns = new Set<() => void>();
  return {
    /** The number of subscribers: this is what proves the self-removal, which
     * shows up in no intensity value. */
    get size() {
      return fns.size;
    },
    /** One frame. Copying the Set guards against a subscriber removing itself
     * during its own call — exactly what the end of an animation does. */
    frame() {
      for (const fn of [...fns]) fn();
    },
    hooks: {
      add: (fn: () => void) => {
        fns.add(fn);
      },
      remove: (fn: () => void) => {
        fns.delete(fn);
      },
    } satisfies HoverTicker,
  };
}

/** Time is driven by hand rather than through `vi.useFakeTimers`: the module
 * reads `performance.now()` like `animatePositions`, and nothing else. */
function clock() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    advance(ms: number) {
      now += ms;
    },
  };
}

/** Mounts a wired target and returns what it takes to play the whole scenario. */
function mount(isBlocked?: () => boolean) {
  const target = new Container();
  const tk = ticker();
  const frames: number[] = [];
  const handle = attachHover(target, {
    ticker: tk.hooks,
    onFrame: (t) => frames.push(t),
    ...(isBlocked ? { isBlocked } : {}),
  });
  return { target, tk, frames, handle, time: clock() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The value of the ease-out quad at half time: 1 − (1 − 0.5)² = 0.75. It is
 * spelled out in the tests because the CURVE is what we mean to hold — a linear
 * interpolation would give 0.5 and would pass every bounds assertion. */
const EASED_HALF = 0.75;

describe("attachHover — ramp up", () => {
  it("does nothing until the pointer has entered", () => {
    const { tk, frames } = mount();
    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);
  });

  it("climbs from 0 to 1 over the animation's duration", () => {
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    // The first frame lands at the same instant as the entry: the intensity is
    // still 0, and that is what guarantees no visual jump opens the effect.
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(0, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    // Exactly 1, not "close to 1": this is the value at the upper rest state, the
    // one a hovered card's compensated position depends on.
    expect(frames.at(-1)).toBe(1);
  });

  it("removes itself from the ticker once it reaches 1", () => {
    // Without this self-removal, every card never left would cost one callback
    // per frame forever.
    const { target, tk, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS);
    tk.frame();

    expect(tk.size).toBe(0);
  });

  it("registers only once even if the enter repeats", () => {
    const { target, tk } = mount();

    target.emit("pointerover", EVENT);
    target.emit("pointerover", EVENT);

    expect(tk.size).toBe(1);
  });

  it("switches the target to static", () => {
    // Without `eventMode`, Pixi emits no `pointerover` at all: the module sets up
    // what it depends on itself, rather than counting on `attachTap` or
    // `drawClusterHitAreas` having done it first.
    const { target } = mount();
    expect(target.eventMode).toBe("static");
  });
});

describe("attachHover — ramp down", () => {
  it("falls back to 0 when the pointer leaves", () => {
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS);
    tk.frame();
    expect(frames.at(-1)).toBe(1);

    target.emit("pointerout", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(1 - EASED_HALF, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBe(0);
    expect(tk.size).toBe(0);
  });

  it("restarts from the current value when the ramp up was not finished", () => {
    // The grazing hover, the most frequent case: leaving mid-ramp must come back
    // down from there. Restarting from 1 would jolt — the card would suddenly
    // grow at the very moment the pointer leaves it.
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    target.emit("pointerout", EVENT);
    tk.frame();
    // First frame of the descent, at the same instant as the exit: the value has
    // not budged.
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeLessThan(EASED_HALF);
    expect(frames.at(-1)).toBeGreaterThan(0);
  });

  it("restarts from the current value when the pointer comes back during the ramp down", () => {
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS);
    tk.frame();
    target.emit("pointerout", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    const partial = frames.at(-1)!;

    target.emit("pointerover", EVENT);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(partial, 6);
    time.advance(HOVER_MS);
    tk.frame();
    expect(frames.at(-1)).toBe(1);
  });

  it("restarts nothing on a leave while the intensity is already zero", () => {
    // A `pointerout` with no preceding `pointerover` really does happen: entry
    // inhibited by a drag, then release outside the card. Animating a descent
    // from 0 to 0 would cost nothing but a useless ticker subscription.
    const { target, tk, frames } = mount();

    target.emit("pointerout", EVENT);

    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);
  });
});

describe("attachHover — inhibition", () => {
  it("does not start when isBlocked is true", () => {
    // Hover during a move: the grabbed card follows the pointer, and growing it
    // at the same time would make it come off the cursor.
    let blocked = true;
    const { target, tk, frames } = mount(() => blocked);

    target.emit("pointerover", EVENT);
    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);

    // The predicate is re-read on EVERY entry, not captured at attach time: hover
    // must become possible again after the drag.
    blocked = false;
    target.emit("pointerover", EVENT);
    expect(tk.size).toBe(1);
  });
});

describe("attachHover — destroyed target", () => {
  it("removes itself from the ticker rather than throwing", () => {
    // A `rebuild()` destroys every card container without any `pointerout` ever
    // being delivered. Without this guard, the callback would throw every frame —
    // and forever, since the exception lands before its own removal.
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    const before = frames.length;

    target.destroy();
    expect(() => tk.frame()).not.toThrow();

    expect(tk.size).toBe(0);
    // No intensity published on a dead container: the caller would be writing to
    // a null `.position`.
    expect(frames.length).toBe(before);
  });
});

describe("attachHover — cancel", () => {
  it("brings the intensity back to 0, publishes that return to rest and stops the animation", () => {
    // This is what the start of a drag calls: the card must recover its exact
    // scale and position BEFORE the gesture starts moving it, and one single path
    // back to rest is worth more than two.
    const { target, tk, frames, handle, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();

    handle.cancel();

    // The return to rest published once, and nothing left running.
    expect(frames.at(-1)).toBe(0);
    expect(tk.size).toBe(0);

    // The animation does not restart on its own: time passing does not relight a
    // cancelled intensity.
    const after = frames.length;
    time.advance(HOVER_MS);
    tk.frame();
    expect(frames.length).toBe(after);
  });

  it("publishes nothing if the intensity was already zero", () => {
    // The drag's `onStart` calls `cancel()` without knowing whether the card was
    // hovered. Repainting rest onto a card already at rest would be useless at
    // best, and at worst a position overwrite in the middle of a gesture.
    const { handle, frames } = mount();
    handle.cancel();
    expect(frames).toEqual([]);
  });

  it("lets a later hover start again from zero", () => {
    const { target, tk, frames, handle, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    handle.cancel();

    target.emit("pointerover", EVENT);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(0, 6);
    time.advance(HOVER_MS);
    tk.frame();
    expect(frames.at(-1)).toBe(1);
  });
});
