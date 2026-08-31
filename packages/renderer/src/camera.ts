import type { Container } from "pixi.js";
import type { Rect } from "@defsquare/data-graph-core";

export interface Size {
  width: number;
  height: number;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 3;
// fitTo ne grossit jamais au-delà de la taille native : agrandir un atlas de
// police cuit à sa taille nominale est exactement ce qui rendait le texte
// cotonneux au premier rendu. Le zoom molette, lui, garde MAX_SCALE.
const MAX_FIT_SCALE = 1;
const FIT_PADDING = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Owns pan/zoom for the world `stage` container: drag-to-pan via pointer
 * events, wheel-to-zoom centered on the cursor, and programmatic
 * fit/center helpers. Bounds scale to [0.02, 3].
 */
export class Camera {
  private readonly stage: Container;
  private readonly canvas: HTMLCanvasElement;
  private currentScale = 1;
  private dragging = false;
  private lastClientX = 0;
  private lastClientY = 0;

  constructor(stage: Container, canvas: HTMLCanvasElement) {
    this.stage = stage;
    this.canvas = canvas;

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

  dispose(): void {
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
    if (event.button !== 0) return;
    this.dragging = true;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
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
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    const zoomFactor = Math.exp(-event.deltaY * 0.001);
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
