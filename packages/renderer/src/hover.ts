import type { Container } from "pixi.js";

/**
 * Durée de la montée comme de la descente du survol.
 *
 * 120 ms, soit un peu plus de la moitié de la transition de dépliage
 * (`TRANSITION_MS`, 200 ms) : le survol doit se lire comme une RÉPONSE au
 * pointeur, pas comme une animation qu'on regarde. En dessous de ~80 ms l'effet
 * redevient un saut, au-delà de ~200 ms la main a déjà quitté la carte que
 * l'effet monte encore.
 */
export const HOVER_MS = 120;

/**
 * Le minimum du `Ticker` de Pixi dont ce module a besoin. Le typer par cette
 * forme plutôt que par `Ticker` est ce qui laisse les tests piloter l'animation
 * image par image sans canvas — `app.ticker` la satisfait tel quel.
 */
export interface HoverTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

export interface HoverHooks {
  ticker: HoverTicker;
  /**
   * Reçoit l'intensité du survol, de 0 (au repos) à 1 (survolé), à chaque image
   * de l'animation — et une dernière fois exactement sur la borne atteinte, pour
   * que l'appelant n'ait jamais à deviner l'état final.
   */
  onFrame(intensity: number): void;
  /**
   * Relu à CHAQUE entrée du pointeur et non capturé à l'attache : ce qui inhibe
   * le survol (un déplacement en cours) commence et finit bien après le câblage.
   * Une entrée inhibée est perdue, pas différée — le pointeur repassera.
   */
  isBlocked?(): boolean;
}

export interface HoverHandle {
  /**
   * Ramène l'intensité à 0 immédiatement, en la publiant une dernière fois, et
   * coupe l'animation en vol. C'est la voie de sortie de l'appelant quand un
   * autre geste prend la main sur la même cible (le début d'un déplacement de
   * carte) : il n'a pas à défaire lui-même ce que `onFrame` a posé, il redemande
   * le repos par le même chemin. Sans effet si l'intensité était déjà nulle.
   */
  cancel(): void;
}

/**
 * Câble un container pour qu'il publie une intensité de survol animée : 0 → 1 à
 * l'entrée du pointeur, 1 → 0 à sa sortie, en `HOVER_MS` et en ease-out quad —
 * la même courbe que la transition de dépliage, pour que les deux mouvements de
 * la vue aient le même grain.
 *
 * Ce module ne connaît NI le modèle ni la scène, exactement comme `drag.ts` : il
 * traduit deux événements en une valeur et la remet à l'appelant, qui décide
 * seul de ce qu'elle peint (l'échelle d'une carte, l'alpha d'une enveloppe).
 * C'est ce qui le rend testable sans canvas.
 *
 * Un changement de sens en cours d'animation REPART DE LA VALEUR COURANTE et
 * non de la borne opposée : sortir à mi-montée redescend depuis là. Repartir de
 * 1 produirait un à-coup au moment précis où le pointeur quitte la carte, c'est
 *-à-dire là où l'œil est encore posé dessus.
 *
 * La durée reste `HOVER_MS` quelle que soit la distance à parcourir. Une durée
 * proportionnelle serait plus « juste » physiquement, mais sur 120 ms la
 * différence ne se voit pas, et elle coûterait un état de plus à tenir.
 */
export function attachHover(target: Container, hooks: HoverHooks): HoverHandle {
  target.eventMode = "static";

  // L'intensité PUBLIÉE en dernier : c'est elle, et non le temps écoulé, qui
  // sert de point de départ au prochain changement de sens.
  let current = 0;
  let from = 0;
  let to = 0;
  let start = 0;
  // Le rappel n'est inscrit au ticker que pendant une animation, et une seule
  // fois : deux `pointerover` d'affilée (Pixi en émet un par sous-objet
  // traversé) ne doivent pas doubler la cadence.
  let running = false;

  const stop = (): void => {
    if (!running) return;
    running = false;
    hooks.ticker.remove(tick);
  };

  function tick(): void {
    // Garde de vivacité, comme dans `animatePositions` : un `rebuild()` détruit
    // les containers sans qu'aucun `pointerout` ne soit passé, et l'appelant
    // écrirait alors sur une `.position` nulle. L'exception tomberait AVANT le
    // retrait du ticker, donc elle se répéterait à chaque image pour toujours —
    // d'où l'auto-retrait ici plutôt qu'un simple saut d'image.
    if (target.destroyed) {
      stop();
      return;
    }
    const t = Math.min(1, (performance.now() - start) / HOVER_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease-out quad
    current = from + (to - from) * eased;
    hooks.onFrame(current);
    // `t >= 1` donne `current === to` exactement : la borne est atteinte, pas
    // approchée, et l'appelant peut s'y fier pour son état de repos.
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
    if (current === 1) return; // déjà au repos haut : rien à animer
    animateTo(1);
  });

  target.on("pointerout", () => {
    // Pas de garde `isBlocked` ici : une sortie doit TOUJOURS pouvoir rendre la
    // cible à son repos, sans quoi une carte survolée puis saisie resterait
    // allumée. La garde d'intensité nulle suffit à ignorer la sortie qui suit
    // une entrée inhibée.
    if (current === 0) return;
    animateTo(0);
  });

  return {
    cancel(): void {
      stop();
      if (current === 0) return;
      current = from = to = 0;
      // Publié, et pas seulement remis à zéro : l'appelant a peint le survol,
      // c'est par ce même rappel qu'il le dépeint.
      if (!target.destroyed) hooks.onFrame(0);
    },
  };
}
