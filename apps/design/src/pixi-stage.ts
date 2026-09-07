import { Application } from "pixi.js";

import type { Theme } from "@renderer/theme.ts";

/**
 * A Pixi stage of specimens: a fixed-size `Application`, placed in a DOM host,
 * over the theme's canvas background.
 *
 * What this helper carries is not the creation of an `Application` — three
 * lines — but the THREE traps of its lifecycle, which a view creating several of
 * them would otherwise pay once per stage:
 *
 *  1. `init()` is ASYNCHRONOUS. A view's unmount (a theme change is enough, the
 *     shell remounts everything) can land while an init is in flight: at that
 *     instant `app.renderer` does not exist yet, so the unmount's `destroy()`
 *     settles nothing and the WebGL context leaks. Here, when the init resumes,
 *     is where it can still be released.
 *  2. Screen density. Without `resolution`/`autoDensity`, the canvas is rendered
 *     at 1x then stretched by CSS, and a design system specimen would look
 *     blurry for a reason that has nothing to do with what it shows. Resolution
 *     is capped at 2: beyond that, we pay for pixels no one can tell apart.
 *  3. The SHAPE of the destroy options (see `destroy()` below). A view laying
 *     down several stages is the only case where it matters, and that is
 *     precisely the case this helper serves.
 *
 * Background `theme.surface.canvas` and not a DOM shell color: a specimen is
 * judged on the background the product draws it on, not on the page's.
 */
export interface StageOptions {
  width: number;
  height: number;
}

export interface PixiStage {
  app: Application;
  /**
   * Resolves once the canvas is initialized and inserted into its host. Rejects
   * if the init fails (WebGL off, context refused) — the caller then has a
   * reason to display where the specimen is missing, rather than an unhandled
   * rejection.
   *
   * ALSO resolves when the stage was destroyed in the meantime: it is
   * `isDestroyed()` that tells the two apart, not a rejection. An unmount is
   * not a failure, and routing it through the error path would display a
   * diagnostic on every theme change.
   */
  ready: Promise<void>;
  isDestroyed(): boolean;
  /** Idempotent, and safe during an in-flight init. */
  destroy(): void;
}

/**
 * The destroy options, and the `true` that must NOT be written in their place.
 *
 * `Application.destroy(rendererOptions, stageOptions)` accepts `true` as its
 * first argument, as a shorthand for "remove the canvas from the DOM". But Pixi
 * gives it a second effect, unsaid by the shorthand:
 * `AbstractRenderer.destroy` only calls `GlobalResourceRegistry.release()` —
 * which EMPTIES the `TexturePool`, GLOBAL to the page — if the option is
 * literally `true` or carries `releaseGlobalResources`.
 *
 * With a single stage, nobody notices. With several, destroying the first
 * throws away the textures the others still hold, and their own destruction
 * then throws inside `TexturePool.returnTexture` (the pool is empty, its uid
 * index is not). That exception travels through the view's cleanup up to the
 * shell's `unmount?.()`, which then ABANDONS its `render()`: the view is never
 * remounted, the screen stays on the previous theme, and `Application`
 * instances pile up. The object form removes the canvas without touching the
 * pool.
 */
const RENDERER_DESTROY = { removeView: true } as const;
const STAGE_DESTROY = { children: true } as const;

export function createPixiStage(
  host: HTMLElement,
  theme: Theme,
  options: StageOptions,
): PixiStage {
  const app = new Application();
  let destroyed = false;

  const ready = app
    .init({
      width: options.width,
      height: options.height,
      background: theme.surface.canvas,
      antialias: true,
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
      autoDensity: true,
    })
    .then(() => {
      // The only place where an unmount that landed during the init can still
      // be settled: `destroy()` saw `app.renderer` null and could do nothing.
      if (destroyed) {
        app.destroy(RENDERER_DESTROY, STAGE_DESTROY);
        return;
      }
      host.append(app.canvas);
    });

  return {
    app,
    ready,
    isDestroyed: () => destroyed,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (app.renderer) app.destroy(RENDERER_DESTROY, STAGE_DESTROY);
    },
  };
}

/**
 * Can this renderer rasterize `BitmapText`?
 *
 * Same guard as `create.ts`: under Pixi v8's software canvas renderer (neither
 * WebGL nor WebGPU available), `Graphics` show up but `BitmapText` stay empty.
 * Callers then pass `useBitmapText: false` to the drawing functions, which fall
 * back to `Text`.
 *
 * To be called only after `ready`: before that, `app.renderer` does not exist.
 */
export function supportsBitmapText(app: Application): boolean {
  return app.renderer.name !== "canvas";
}
