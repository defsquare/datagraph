import type { Container } from "pixi.js";
import type { Rect } from "@defsquare/data-graph-core";

export interface Size {
  width: number;
  height: number;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 3;
// fitTo never enlarges past native size: blowing up a font atlas baked at its nominal
// size is exactly what made text look cottony on the first render. Wheel zoom, for its
// part, keeps MAX_SCALE.
const MAX_FIT_SCALE = 1;
const FIT_PADDING = 40;

// Conversions from `deltaMode` to pixels. Without them, one and the same gesture goes
// from "unusable" to "correct" depending on the browser: Firefox reports wheel notches
// in lines (deltaY = 3), Chrome converts them to ~100px itself. Everything else in the
// computation assumes pixels.
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

// Pinch and wheel do not send deltas on the same scale: a few pixels per frame
// for the former, a clean ~100px notch for the latter. Rather than guessing
// which of the two we are holding — precisely the bet that made trackpad
// swipes zoom — we take the gain that suits pinch and cap what a single event
// can do. A large delta therefore runs into the cap instead of being
// interpreted.
//
// exp(0.2) = 1.22x: exactly what a 100px wheel notch was worth under the old dedicated
// gain, so the wheel keeps its feel (three notches to double) without any code having
// to recognize it.
const ZOOM_GAIN = 0.012;
const MAX_ZOOM_STEP = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The only fields of `WheelEvent` the classification reads. */
export interface WheelSignal {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Brings a wheel delta back to pixels, whatever the `deltaMode`. */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

/**
 * The scale factor a single zoom event applies, for a vertical delta already brought
 * back to pixels. Capped: see `MAX_ZOOM_STEP`.
 */
export function zoomFactorFor(dyPx: number): number {
  return Math.exp(clamp(-dyPx * ZOOM_GAIN, -MAX_ZOOM_STEP, MAX_ZOOM_STEP));
}

/**
 * Decides whether a `wheel` event must zoom or pan.
 *
 * Only a modifier zooms. `ctrlKey` covers the two zoom gestures that matter: macOS
 * synthesizes it for the trackpad pinch, and Ctrl+wheel is the universal browser
 * convention. `metaKey` adds Cmd+wheel, the macOS reflex. Everything else — bare wheel
 * included — pans.
 *
 * There is deliberately NO heuristic on the deltas. The previous version
 * treated an event with whole-number deltas, purely vertical and of at least
 * 40px, as a wheel, hence as a zoom; but that is also the signature of a fast
 * trackpad swipe (Chrome quantizes the horizontal component of an
 * almost-vertical gesture to exactly 0, and inertia sends deltas well past the
 * threshold). Result: the view zoomed in the middle of a navigation. No field
 * of `WheelEvent` reliably separates wheel from trackpad, so we do not try:
 * zoom demands an explicit modifier, and the false positive becomes
 * structurally impossible.
 */
export function classifyWheel(event: WheelSignal): "zoom" | "pan" {
  return event.ctrlKey || event.metaKey ? "zoom" : "pan";
}

/** Do two intervals overlap, contact included? */
function spansOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax && bMin <= aMax;
}

/**
 * How far the view must travel, in WORLD units, for content that just appeared
 * to come into frame — or `null` when it must not travel at all.
 *
 * Two rules, and the first is the important one: if ANY of the targets already
 * shows, even partially, the camera does not move. Content appearing in frame is
 * its own feedback, and a view that jumps anyway is a view stolen from whoever
 * was reading it.
 *
 * When nothing shows, the displacement is the SMALLEST one that brings the
 * targets' bounding box `margin` inside the offending edge — not a centring. The
 * user asked to open something, not to be taken somewhere.
 *
 * Pure, and exported for that reason: the decision is proven in
 * `camera.test.ts`, the motion in the demo's e2e suite.
 */
export function revealPan(
  view: Rect,
  targets: readonly Rect[],
  margin: number,
): { dx: number; dy: number } | null {
  if (targets.length === 0) return null;

  const viewRight = view.x + view.width;
  const viewBottom = view.y + view.height;
  for (const t of targets) {
    if (
      spansOverlap(view.x, viewRight, t.x, t.x + t.width) &&
      spansOverlap(view.y, viewBottom, t.y, t.y + t.height)
    ) {
      return null;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of targets) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }

  // `margin` is clamped to half the span so a block larger than the viewport
  // still lands its NEAR edge in frame instead of overshooting past it.
  const axis = (
    boxMin: number,
    boxMax: number,
    viewMin: number,
    viewSize: number,
  ): number => {
    const m = Math.min(margin, viewSize / 2);
    if (boxMax < viewMin + m) return boxMax - (viewMin + m);
    if (boxMin > viewMin + viewSize - m) return boxMin - (viewMin + viewSize - m);
    return 0;
  };

  return {
    dx: axis(minX, maxX, view.x, view.width),
    dy: axis(minY, maxY, view.y, view.height),
  };
}

export interface CameraOptions {
  /**
   * Consulted at every movement to know whether the pan must be handed over to someone
   * else — in practice: a card is being dragged, and panning the canvas at the same
   * time would make the card flee from under the cursor.
   *
   * It is a predicate, re-read on every `pointermove`, and most definitely NOT
   * a test done once at `pointerdown`. The reason is an ordering we do not
   * control: the pan is wired onto the canvas's native DOM listeners, the card
   * drag onto Pixi's federated events, which are emitted from Pixi's own
   * native handler. Which of the two sees the `pointerdown` first depends on
   * the order the two were registered in, that is, on the construction order
   * in `create.ts` — an invisible dependency that an innocent rearrangement
   * would break. At MOVE time, the card drag is already armed whatever that
   * order.
   */
  isBlocked?: () => boolean;
}

/**
 * Owns pan/zoom for the world `stage` container: drag-to-pan via pointer
 * events, two-finger swipe and bare mouse wheel to pan, pinch and
 * Ctrl/Cmd+wheel to zoom centered on the cursor, and programmatic fit/center
 * helpers. Bounds scale to [0.02, 3].
 */
export class Camera {
  private readonly stage: Container;
  private readonly canvas: HTMLCanvasElement;
  private readonly isBlocked: (() => boolean) | undefined;
  private currentScale = 1;
  private dragging = false;
  private lastClientX = 0;
  private lastClientY = 0;
  /** The frame handle of a pan in flight, or `null`. */
  private panFrame: number | null = null;

  constructor(stage: Container, canvas: HTMLCanvasElement, options: CameraOptions = {}) {
    this.stage = stage;
    this.canvas = canvas;
    this.isBlocked = options.isBlocked;

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  /** Scales+positions the stage so `bounds` fits entirely within `viewport`, centered. */
  fitTo(bounds: Rect, viewport: Size): void {
    const availableW = Math.max(1, viewport.width - FIT_PADDING * 2);
    const availableH = Math.max(1, viewport.height - FIT_PADDING * 2);
    let scale = Math.min(availableW / Math.max(bounds.width, 1), availableH / Math.max(bounds.height, 1));
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    scale = clamp(scale, MIN_SCALE, MAX_FIT_SCALE);
    this.applyScaleAndCenter(bounds, viewport, scale);
  }

  /** Scales+positions the stage so `rect` is centered in `viewport`, at `scale` (or the current scale). */
  centerOn(rect: Rect, viewport: Size, scale?: number): void {
    const s = clamp(scale ?? this.currentScale, MIN_SCALE, MAX_SCALE);
    this.applyScaleAndCenter(rect, viewport, s);
  }

  scale(): number {
    return this.currentScale;
  }

  /**
   * The WORLD rectangle currently visible in `viewport`, that is, the exact inverse of
   * the transform the camera lays onto the stage (`applyScaleAndCenter`, pan and wheel
   * zoom included: none of them writes anything but `stage.scale` and
   * `stage.position`).
   *
   * Exists for whatever has to place itself in WORLD coordinates while accounting for
   * what is being looked at — edge labels, which slide along their stroke to stay in
   * frame. The computation would otherwise be redone at the caller's, out of camera
   * internals it has no business knowing.
   */
  worldViewport(viewport: Size): Rect {
    const s = this.currentScale;
    return {
      x: -this.stage.position.x / s,
      y: -this.stage.position.y / s,
      width: viewport.width / s,
      height: viewport.height / s,
    };
  }

  /**
   * Slides the view by a WORLD translation, animated.
   *
   * A pan and nothing else: the scale is untouched. Zooming out to show what
   * appeared would change the reading of everything else on screen to report one
   * local event.
   *
   * Any user gesture cancels it — a camera that keeps travelling under a hand
   * already moving it is a camera fighting its user.
   */
  panByWorld(dx: number, dy: number, durationMs: number): void {
    this.cancelPan();
    if (dx === 0 && dy === 0) return;
    const startX = this.stage.position.x;
    const startY = this.stage.position.y;
    // Screen displacement is the world one scaled: the stage moves opposite the
    // view, hence the minus.
    const toX = startX - dx * this.currentScale;
    const toY = startY - dy * this.currentScale;
    const start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t);
      this.stage.position.set(startX + (toX - startX) * eased, startY + (toY - startY) * eased);
      if (t >= 1) {
        this.panFrame = null;
        return;
      }
      this.panFrame = requestAnimationFrame(step);
    };
    this.panFrame = requestAnimationFrame(step);
  }

  private cancelPan(): void {
    if (this.panFrame !== null) {
      cancelAnimationFrame(this.panFrame);
      this.panFrame = null;
    }
  }

  dispose(): void {
    this.cancelPan();
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
  }

  private applyScaleAndCenter(rect: Rect, viewport: Size, scale: number): void {
    this.currentScale = scale;
    this.stage.scale.set(scale);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    this.stage.position.set(viewport.width / 2 - cx * scale, viewport.height / 2 - cy * scale);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.cancelPan();
    if (event.button !== 0) return;
    this.dragging = true;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    if (this.isBlocked?.()) {
      // We record the position anyway: without that, the whole path travelled during
      // the inhibition would be caught up in one jump at the first free movement — the
      // canvas would leap the moment the card is released.
      this.lastClientX = event.clientX;
      this.lastClientY = event.clientY;
      return;
    }
    const dx = event.clientX - this.lastClientX;
    const dy = event.clientY - this.lastClientY;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    this.stage.position.set(this.stage.position.x + dx, this.stage.position.y + dy);
  };

  private readonly handlePointerUp = (): void => {
    this.dragging = false;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    this.cancelPan();
    event.preventDefault();

    const dx = normalizeWheelDelta(event.deltaX, event.deltaMode);
    const dy = normalizeWheelDelta(event.deltaY, event.deltaMode);

    if (classifyWheel(event) === "pan") {
      this.stage.position.set(this.stage.position.x - dx, this.stage.position.y - dy);
      return;
    }

    const bounds = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    const zoomFactor = zoomFactorFor(dy);
    const nextScale = clamp(this.currentScale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (nextScale === this.currentScale) return;

    // Keep the point under the cursor stationary on screen while zooming.
    const worldX = (pointerX - this.stage.position.x) / this.currentScale;
    const worldY = (pointerY - this.stage.position.y) / this.currentScale;

    this.currentScale = nextScale;
    this.stage.scale.set(nextScale);
    this.stage.position.set(pointerX - worldX * nextScale, pointerY - worldY * nextScale);
  };
}
