import { describe, it, expect, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import {
  Camera,
  classifyWheel,
  normalizeWheelDelta,
  zoomFactorFor,
  type WheelSignal,
} from "../src/camera.js";

/** A minimal `WheelEvent`: `classifyWheel` reads nothing but these fields. */
function wheel(partial: Partial<WheelSignal> = {}): WheelSignal {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...partial };
}

describe("normalizeWheelDelta", () => {
  it("leaves pixel mode unchanged", () => {
    expect(normalizeWheelDelta(120, 0)).toBe(120);
  });

  it("converts line mode to pixels", () => {
    // Firefox reports wheel notches in lines (deltaY = 3). Without this
    // conversion, one notch was worth 0.3% of zoom: the wheel was dead there.
    expect(normalizeWheelDelta(3, 1)).toBe(48);
  });

  it("converts page mode to pixels", () => {
    expect(normalizeWheelDelta(1, 2)).toBe(400);
  });

  it("preserves the sign", () => {
    expect(normalizeWheelDelta(-3, 1)).toBe(-48);
  });
});

describe("classifyWheel", () => {
  it("ctrlKey is a zoom, whatever else is set", () => {
    // macOS synthesizes a wheel + ctrlKey for the trackpad pinch, and Ctrl+wheel
    // is the universal browser convention.
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 2 }))).toBe("zoom");
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 2, deltaX: 5 }))).toBe("zoom");
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 100 }))).toBe("zoom");
  });

  it("metaKey is a zoom: Cmd+wheel on macOS", () => {
    expect(classifyWheel(wheel({ metaKey: true, deltaY: 100 }))).toBe("zoom");
    expect(classifyWheel(wheel({ metaKey: true, deltaY: 4, deltaX: 2 }))).toBe("zoom");
  });

  it("without a modifier, a trackpad swipe ALWAYS pans", () => {
    // The heart of the regression: a fast vertical two-finger swipe arrives with
    // deltaX quantized to 0 and a whole-number deltaY on the order of a wheel
    // notch. Any heuristic reading those three fields takes it for a wheel and
    // zooms in the middle of a navigation.
    expect(classifyWheel(wheel({ deltaY: 100 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: -120 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 8 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: -3, deltaX: 1 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 96.5 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 100, deltaX: 4 }))).toBe("pan");
  });

  it("without a modifier, a real wheel pans too, deltaMode included", () => {
    // Firefox reports notches in lines. It really is a wheel, but a bare wheel
    // pans: zoom demands an explicit modifier.
    expect(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 1, deltaMode: 2 }))).toBe("pan");
  });

  it("a null event does not zoom", () => {
    expect(classifyWheel(wheel())).toBe("pan");
  });
});

describe("zoomFactorFor", () => {
  it("stays fine-grained on the small deltas of a pinch", () => {
    // ~6% per frame: decisive at pinch cadence, without being twitchy.
    expect(zoomFactorFor(-5)).toBeCloseTo(Math.exp(0.06), 6);
  });

  it("caps a wheel notch at 1.22x, like the old dedicated gain", () => {
    // The cap exists so that no code has to recognize the wheel: a 100px notch
    // runs into it and gets back exactly its former feel.
    expect(zoomFactorFor(-100)).toBeCloseTo(1.2214, 4);
    expect(zoomFactorFor(-100)).toBeCloseTo(Math.exp(100 * 0.002), 6);
  });

  it("caps symmetrically in both directions", () => {
    expect(zoomFactorFor(100) * zoomFactorFor(-100)).toBeCloseTo(1, 6);
  });

  it("caps a Firefox notch converted to pixels too", () => {
    // Line deltaMode: 3 lines -> 48px, already well past the cap.
    expect(zoomFactorFor(-normalizeWheelDelta(3, 1))).toBeCloseTo(1.2214, 4);
  });

  it("changes nothing for a null delta", () => {
    expect(zoomFactorFor(0)).toBe(1);
  });
});

/** Pan is wired onto native DOM listeners (canvas + window): we capture them
 * instead of running a real browser, the same way `classifyWheel` is tested on
 * a fabricated `WheelEvent`. */
function mountCamera(isBlocked: () => boolean = () => false) {
  const handlers = new Map<string, (event: unknown) => void>();
  const record =
    (scope: string) =>
    (type: string, handler: (event: unknown) => void): void => {
      handlers.set(`${scope}:${type}`, handler);
    };
  const canvas = {
    addEventListener: record("canvas"),
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal("window", { addEventListener: record("window"), removeEventListener: () => {} });

  const stage = new Container();
  const camera = new Camera(stage, canvas, { isBlocked });
  return {
    stage,
    camera,
    down: (clientX: number, clientY: number) =>
      handlers.get("canvas:pointerdown")!({ button: 0, clientX, clientY }),
    move: (clientX: number, clientY: number) => handlers.get("window:pointermove")!({ clientX, clientY }),
  };
}

describe("Camera — pan inhibition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pans the canvas when nothing blocks it", () => {
    const { stage, down, move } = mountCamera(() => false);
    down(100, 100);
    move(150, 120);
    expect(stage.position.x).toBe(50);
    expect(stage.position.y).toBe(20);
  });

  it("pans nothing while a card is being dragged", () => {
    // The same gesture, with a card drag under way: the canvas must stay still,
    // otherwise the card would flee under the cursor at twice the pointer's
    // speed.
    let blocked = false;
    const { stage, down, move } = mountCamera(() => blocked);
    down(100, 100);
    move(150, 100);
    blocked = true;
    move(300, 100);
    move(400, 100);
    expect(stage.position.x).toBe(50);
  });

  it("does not catch up on the distance covered while inhibited", () => {
    // The guard is at MOVE, not at DOWN: pan therefore resumes mid-gesture, and
    // it must restart from the LAST position seen, not from the one before the
    // inhibition — otherwise the canvas jumps when the card is released.
    let blocked = true;
    const { stage, down, move } = mountCamera(() => blocked);
    down(100, 100);
    move(300, 100);
    blocked = false;
    move(310, 100);
    expect(stage.position.x).toBe(10);
  });
});

/**
 * What the camera shows of the WORLD, for whatever has to place itself in world
 * coordinates while accounting for what is being looked at — edge labels, which
 * slide along their stroke to stay in frame.
 */
describe("Camera — worldViewport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const VIEWPORT = { width: 800, height: 600 };

  it("is the exact inverse of centerOn: the target rect ends up centered", () => {
    const { camera } = mountCamera();
    const rect = { x: 1000, y: 500, width: 200, height: 100 };
    camera.centerOn(rect, VIEWPORT, 2);
    const world = camera.worldViewport(VIEWPORT);

    // The rect fits entirely inside...
    expect(world.x).toBeLessThan(rect.x);
    expect(world.y).toBeLessThan(rect.y);
    expect(world.x + world.width).toBeGreaterThan(rect.x + rect.width);
    expect(world.y + world.height).toBeGreaterThan(rect.y + rect.height);
    // ...and centered: the two centers coincide.
    expect(world.x + world.width / 2).toBeCloseTo(rect.x + rect.width / 2, 6);
    expect(world.y + world.height / 2).toBeCloseTo(rect.y + rect.height / 2, 6);
    // The size of the world in view is the screen's, divided by the scale.
    expect(world.width).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(world.height).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it("follows the pan: moving the canvas moves the viewed world the other way", () => {
    const { camera, down, move } = mountCamera();
    camera.centerOn({ x: 0, y: 0, width: 0, height: 0 }, VIEWPORT, 1);
    const before = camera.worldViewport(VIEWPORT);
    down(100, 100);
    move(150, 100); // the canvas goes right, so the gaze goes left
    const after = camera.worldViewport(VIEWPORT);
    expect(after.x).toBeCloseTo(before.x - 50, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
