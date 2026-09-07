import { Application } from "pixi.js";

import type { Theme } from "@renderer/theme.ts";

/**
 * Une scène Pixi de spécimens : un `Application` de taille fixe, posé dans un
 * conteneur DOM, sur le fond de canevas du thème.
 *
 * Ce que cet utilitaire porte n'est pas la création d'un `Application` — trois
 * lignes — mais les DEUX pièges de son cycle de vie, qu'une vue qui en crée
 * plusieurs paierait autrement une fois par scène :
 *
 *  1. `init()` est ASYNCHRONE. Le démontage d'une vue (un changement de thème
 *     suffit, le shell remonte tout) peut tomber pendant qu'une init est en
 *     vol : à cet instant `app.renderer` n'existe pas encore, donc le
 *     `destroy()` du démontage ne solde rien et le contexte WebGL fuit. C'est
 *     ici, à la reprise de l'init, qu'on peut encore le libérer.
 *  2. La densité d'écran. Sans `resolution`/`autoDensity`, le canvas est rendu
 *     en 1x puis étiré par le CSS, et un spécimen de design system paraîtrait
 *     flou pour une raison qui n'a rien à voir avec ce qu'il montre. La
 *     résolution est plafonnée à 2 : au-delà, on paie des pixels que personne ne
 *     distingue.
 *  3. La FORME des options de destruction (voir `destroy()` plus bas). Une vue
 *     qui pose plusieurs scènes est le seul cas où elle compte, et c'est
 *     précisément le cas que cet utilitaire sert.
 *
 * Fond `theme.surface.canvas` et non une couleur du shell DOM : un spécimen se
 * juge sur le fond où le produit le dessine, pas sur celui de la page.
 */
export interface StageOptions {
  width: number;
  height: number;
}

export interface PixiStage {
  app: Application;
  /**
   * Résout quand le canvas est initialisé et inséré dans son hôte. Rejette si
   * l'init échoue (WebGL coupé, contexte refusé) — l'appelant a alors une raison
   * à afficher à l'endroit du spécimen manquant, plutôt qu'une rejection non
   * gérée.
   *
   * Résout AUSSI quand la scène a été détruite entre-temps : c'est
   * `isDestroyed()` qui distingue les deux, et non un rejet. Un démontage n'est
   * pas une panne, et le faire passer par le chemin d'erreur ferait afficher un
   * diagnostic à chaque changement de thème.
   */
  ready: Promise<void>;
  isDestroyed(): boolean;
  /** Idempotent, et sûr pendant une init en vol. */
  destroy(): void;
}

/**
 * Les options de destruction, et le `true` qu'il ne faut PAS écrire à leur
 * place.
 *
 * `Application.destroy(rendererOptions, stageOptions)` accepte `true` en
 * premier argument comme raccourci de « retire le canvas du DOM ». Mais Pixi lui
 * donne un second effet, non dit par le raccourci : `AbstractRenderer.destroy`
 * n'appelle `GlobalResourceRegistry.release()` — qui VIDE le `TexturePool`,
 * GLOBAL à la page — que si l'option vaut littéralement `true` ou porte
 * `releaseGlobalResources`.
 *
 * Avec une seule scène, personne ne le remarque. Avec plusieurs, détruire la
 * première jette les textures que les suivantes tiennent encore, et leur propre
 * destruction lève ensuite dans `TexturePool.returnTexture` (le pool est vide,
 * son index d'uid ne l'est pas). Cette exception traverse le cleanup de la vue
 * jusqu'au `unmount?.()` du shell, qui ABANDONNE alors son `render()` : la vue
 * n'est jamais remontée, l'écran reste sur le thème précédent et les
 * `Application` s'accumulent. La forme objet retire le canvas sans toucher au
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
      // Le seul endroit où un démontage tombé pendant l'init peut encore être
      // soldé : `destroy()` a vu `app.renderer` nul et n'a rien pu faire.
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
 * Ce renderer sait-il rastériser du `BitmapText` ?
 *
 * Même garde que `create.ts` : sous le renderer canvas logiciel de Pixi v8
 * (ni WebGL ni WebGPU disponibles), les `Graphics` s'affichent mais les
 * `BitmapText` restent vides. Les appelants passent alors `useBitmapText: false`
 * aux fonctions de dessin, qui replient sur `Text`.
 *
 * À n'appeler qu'après `ready` : avant, `app.renderer` n'existe pas.
 */
export function supportsBitmapText(app: Application): boolean {
  return app.renderer.name !== "canvas";
}
