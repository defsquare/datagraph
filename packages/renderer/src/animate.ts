import type { Container } from "pixi.js";
import type { NodeId, Rect } from "@defsquare/data-graph-core";

/**
 * Durée de la transition de position déclenchée par un dépliage ou un repliage.
 *
 * 200 ms : assez long pour que l'œil SUIVE une carte de son ancienne place à sa
 * nouvelle — c'est tout l'intérêt de l'animation, faire comprendre que la mise
 * en page s'est réorganisée plutôt que remplacée —, assez court pour qu'un
 * enchaînement de dépliages ne se transforme pas en attente. `HOVER_MS`
 * (120 ms, dans `hover.ts`) est délibérément plus court : le survol répond au
 * pointeur, la transition raconte un déplacement.
 */
export const TRANSITION_MS = 200;

/**
 * L'ease-out quad, `1 − (1 − t)²`, sur `t ∈ [0, 1]`.
 *
 * PARTAGÉE avec `hover.ts`, et c'est la raison d'être de l'export : les deux
 * mouvements de la vue — une carte qui rejoint sa nouvelle place, une carte qui
 * s'allume sous le pointeur — doivent avoir le même grain, et deux copies de la
 * formule dériveraient au premier réglage de l'une. La courbe part vite et
 * finit posée : le mouvement se lit dès sa première image, et sa fin ne se
 * remarque pas.
 *
 * `t = 1` rend exactement `1` : la borne est ATTEINTE, pas approchée, et les
 * deux appelants s'appuient dessus pour leur état de repos (position finale ici,
 * intensité de survol là-bas).
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Le minimum du `Ticker` de Pixi dont ce module a besoin — même forme, et pour
 * la même raison, que `HoverTicker` dans `hover.ts` : la typer ainsi plutôt
 * qu'en `Ticker` laisse un test piloter l'animation image par image sans canvas,
 * et `app.ticker` la satisfait tel quel.
 */
export interface AnimationTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

export interface PositionAnimatorHooks {
  /**
   * Le ticker, résolu à CHAQUE usage et non capturé à la construction — c'est
   * une contrainte réelle, pas une préférence de style : `app.ticker` n'existe
   * qu'une fois `app.init()` résolu, alors que l'animateur est construit de
   * façon synchrone avec l'instance. Un ticker capturé y vaudrait `undefined`
   * pour toujours, et la première transition lèverait.
   *
   * N'est appelé que lorsqu'il y a effectivement quelque chose à inscrire ou à
   * retirer : rien avant l'init ne peut donc le solliciter.
   */
  ticker(): AnimationTicker;
  /**
   * La table id → container de l'appelant, LUE à chaque animation et non
   * recopiée : `create.ts` la vide et la re-remplit à chaque `rebuild()`, en
   * place, et l'animateur doit voir les containers du dernier rebuild — ce sont
   * eux qu'il va déplacer.
   */
  nodeViews: ReadonlyMap<NodeId, Container>;
}

export interface PositionAnimator {
  /**
   * Anime chaque nœud présent à la fois dans `prevPositions` et dans
   * `nextPositions` — c'est-à-dire chaque nœud qui a SURVÉCU au dépliage ou au
   * repliage — de son ancien rect vers le nouveau, en `TRANSITION_MS`. Les
   * nœuds nouvellement visibles ou sur le point de disparaître sont laissés là
   * où le `rebuild()` qui précède les a mis (leur position finale, ou retirés).
   *
   * Une seule animation est jamais en vol : en démarrer une annule la
   * précédente.
   */
  animate(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void;
  /**
   * Désinscrit le rappel de l'animation en cours, s'il y en a une.
   *
   * À appeler AVANT toute reconstruction susceptible de détruire les containers
   * qu'une animation en vol tient — sans quoi le tick suivant écrirait une
   * `.position` sur un Container détruit (dont `.position` est `null`, cf.
   * `Container.destroy()`) et lèverait à chaque image POUR TOUJOURS, puisque
   * l'exception tomberait avant le `ticker.remove(tick)` du tick lui-même.
   *
   * Sans effet quand rien n'est en vol : les appelants s'en servent comme d'une
   * mise au repos inconditionnelle.
   */
  cancel(): void;
}

/**
 * L'animateur de positions d'une instance : il possède le SEUL rappel de
 * transition en vol, et c'est cette unicité qui est son invariant.
 *
 * Ce module ne connaît ni le modèle, ni la vue courante, ni la scène — comme
 * `drag.ts` et `hover.ts`, il traduit une paire de mises en page en un
 * déplacement image par image et laisse `create.ts` décider QUAND cela a un
 * sens (la vue graphe, par exemple, n'anime rien : voir `animatePositions`
 * là-bas).
 */
export function createPositionAnimator(hooks: PositionAnimatorHooks): PositionAnimator {
  // Le rappel actuellement inscrit au ticker, ou `null`. Un seul à la fois :
  // deux transitions concurrentes écriraient la même `.position` en alternance.
  let activeTick: (() => void) | null = null;

  const cancel = (): void => {
    if (activeTick) {
      hooks.ticker().remove(activeTick);
      activeTick = null;
    }
  };

  return {
    cancel,

    animate(prevPositions: Map<NodeId, Rect>, nextPositions: Map<NodeId, Rect>): void {
      cancel();

      // `nodeView`, et non `view` : ce dernier nom désigne la vue courante chez
      // l'appelant, et le réemployer ici rendrait les deux illisibles ensemble.
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
          // Garde de vivacité : un tick retardataire (survivant malgré
          // `cancel()`, p.ex. une reconstruction ré-entrante depuis un rappel de
          // ticker) doit sauter de lui-même les containers détruits plutôt que
          // de lever sur une `.position` nulle.
          if (a.nodeView.destroyed) continue;
          a.nodeView.position.set(a.fromX + (a.toX - a.fromX) * eased, a.fromY + (a.toY - a.fromY) * eased);
        }
        if (t >= 1) {
          hooks.ticker().remove(tick);
          // Comparé plutôt qu'écrasé : une autre animation a pu prendre la place
          // entre-temps, et la mettre à `null` ici la rendrait inannulable.
          if (activeTick === tick) activeTick = null;
        }
      };
      activeTick = tick;
      hooks.ticker().add(tick);
    },
  };
}
