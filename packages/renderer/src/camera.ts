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

// Conversions de `deltaMode` vers des pixels. Sans elles, un même geste va de
// « inutilisable » à « correct » selon le navigateur : Firefox rapporte les
// crans de molette en lignes (deltaY = 3), Chrome les convertit lui-même en
// ~100px. Tout le reste du calcul suppose des pixels.
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

// Au-delà de ce pas, un événement purement vertical et entier est une molette
// et non un balayage trackpad. Le seuil est volontairement haut : se tromper
// vers le déplacement est bien moins désagréable que se tromper vers le zoom.
const MOUSE_WHEEL_MIN_STEP = 40;

// Gains distincts parce que pincement et molette n'envoient pas la même
// échelle de deltas. 0.002 donne ~1.22x par cran de 100px (trois crans pour
// doubler) ; 0.012 rend le pincement franc sans être nerveux.
const ZOOM_GAIN_WHEEL = 0.002;
const ZOOM_GAIN_PINCH = 0.012;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Les seuls champs de `WheelEvent` que la classification lit. */
export interface WheelSignal {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

/** Ramène un delta de molette en pixels, quel que soit le `deltaMode`. */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

/**
 * Décide si un événement `wheel` doit zoomer ou déplacer.
 *
 * `ctrlKey` est fiable à 100% : macOS le synthétise pour le pincement
 * trackpad, et Ctrl+molette est la convention navigateur universelle. Un
 * `deltaMode` non pixel l'est tout autant — seule une vraie molette en
 * produit. Le troisième cas est une heuristique : en mode pixel, une molette
 * arrive par pas francs, entiers et purement verticaux, là où un balayage
 * trackpad arrive en flux de petits deltas souvent fractionnaires et presque
 * toujours accompagnés d'une composante horizontale.
 *
 * L'heuristique n'est pas infaillible : un balayage très rapide, entier et
 * parfaitement vertical zoomera. C'est le compromis assumé du seuil.
 */
export function classifyWheel(event: WheelSignal): "zoom" | "pan" {
  if (event.ctrlKey) return "zoom";
  if (event.deltaMode !== 0) return "zoom";
  if (
    event.deltaX === 0 &&
    Number.isInteger(event.deltaY) &&
    Math.abs(event.deltaY) >= MOUSE_WHEEL_MIN_STEP
  ) {
    return "zoom";
  }
  return "pan";
}

export interface CameraOptions {
  /**
   * Consulté à chaque mouvement pour savoir si le déplacement doit être rendu
   * à quelqu'un d'autre — en pratique : une carte est en cours de déplacement,
   * et déplacer la toile en même temps ferait fuir la carte sous le curseur.
   *
   * C'est un prédicat, relu à chaque `pointermove`, et surtout PAS un test fait
   * une fois au `pointerdown`. La raison est un ordre qu'on ne contrôle pas :
   * le pan est câblé sur des écouteurs DOM natifs du canvas, le déplacement de
   * carte sur les événements fédérés de Pixi, qui sont émis depuis le
   * gestionnaire natif de Pixi lui-même. Qui voit le `pointerdown` en premier
   * dépend de l'ordre d'enregistrement des deux, c'est-à-dire de l'ordre de
   * construction dans `create.ts` — une dépendance invisible et qu'un
   * réarrangement innocent casserait. Au MOVE, le drag de carte est déjà armé
   * quel que soit cet ordre.
   */
  isBlocked?: () => boolean;
}

/**
 * Owns pan/zoom for the world `stage` container: drag-to-pan via pointer
 * events, two-finger swipe to pan, pinch and mouse wheel to zoom centered on
 * the cursor, and programmatic fit/center helpers. Bounds scale to [0.02, 3].
 */
export class Camera {
  private readonly stage: Container;
  private readonly canvas: HTMLCanvasElement;
  private readonly isBlocked: (() => boolean) | undefined;
  private currentScale = 1;
  private dragging = false;
  private lastClientX = 0;
  private lastClientY = 0;

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
   * Le rectangle du MONDE actuellement visible dans `viewport`, c'est-à-dire
   * l'inverse exact de la transformation que la caméra pose sur le stage
   * (`applyScaleAndCenter`, pan et zoom molette compris : tous n'écrivent que
   * `stage.scale` et `stage.position`).
   *
   * Existe pour ce qui doit se placer en coordonnées MONDE tout en tenant
   * compte de ce qu'on regarde — les étiquettes d'arêtes, qui glissent le long
   * de leur trait pour rester dans le cadre. Le calcul serait sinon refait
   * chez l'appelant à partir d'internes de la caméra qu'il n'a pas à connaître.
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
    if (this.isBlocked?.()) {
      // On mémorise quand même la position : sans ça, tout le chemin parcouru
      // pendant l'inhibition serait rattrapé d'un bond au premier mouvement
      // libre — la toile sauterait au relâchement de la carte.
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

    const gain = event.ctrlKey ? ZOOM_GAIN_PINCH : ZOOM_GAIN_WHEEL;
    const zoomFactor = Math.exp(-dy * gain);
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
