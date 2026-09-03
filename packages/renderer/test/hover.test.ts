import { describe, it, expect, vi, afterEach } from "vitest";
import { Container, type FederatedPointerEvent } from "pixi.js";
import { attachHover, HOVER_MS, type HoverTicker } from "../src/hover.js";

/** L'événement que Pixi passe à ses écouteurs de survol. Vide, et c'est le
 * point : `attachHover` n'en lit RIEN — ni bouton ni position, contrairement à
 * `attachDrag`. Il n'est là que pour satisfaire la signature de `emit`. */
const EVENT = {} as unknown as FederatedPointerEvent;

/** Un ticker factice à la place de celui de Pixi : `attachHover` ne lui demande
 * que d'appeler une fonction par image, donc le tenir à la main est ce qui
 * rend l'animation observable pas à pas — et ces tests sans canvas, comme
 * `drag.test.ts` fabrique ses événements plutôt que de faire tourner un
 * `EventSystem`. */
function ticker() {
  const fns = new Set<() => void>();
  return {
    /** Le nombre d'inscrits : c'est par lui qu'on prouve l'auto-retrait, qui ne
     * se voit sur aucune valeur d'intensité. */
    get size() {
      return fns.size;
    },
    /** Une image. La copie du Set protège de l'inscrit qui se retire pendant
     * son propre appel — exactement ce que fait la fin d'animation. */
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

/** Le temps est piloté à la main plutôt que par des `vi.useFakeTimers` : le
 * module lit `performance.now()` comme `animatePositions`, et rien d'autre. */
function clock() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    advance(ms: number) {
      now += ms;
    },
  };
}

/** Monte une cible câblée et retourne de quoi jouer le scénario complet. */
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

/** La valeur de l'ease-out quad à mi-course : 1 − (1 − 0,5)² = 0,75. Elle est
 * écrite en clair dans les tests parce que c'est la COURBE qu'on veut tenir —
 * une interpolation linéaire donnerait 0,5 et passerait toutes les assertions
 * de bornes. */
const EASED_HALF = 0.75;

describe("attachHover — montée", () => {
  it("ne fait rien tant que le pointeur n'est pas entré", () => {
    const { tk, frames } = mount();
    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);
  });

  it("monte de 0 à 1 sur la durée de l'animation", () => {
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    // La première image tombe au même instant que l'entrée : l'intensité vaut
    // encore 0, et c'est ce qui garantit qu'aucun saut visuel n'ouvre l'effet.
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(0, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    // Exactement 1, et pas « près de 1 » : c'est la valeur au repos haut, celle
    // dont dépend la position compensée d'une carte survolée.
    expect(frames.at(-1)).toBe(1);
  });

  it("se retire du ticker une fois arrivé à 1", () => {
    // Sans cet auto-retrait, chaque carte jamais quittée coûterait un rappel
    // par image pour toujours.
    const { target, tk, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS);
    tk.frame();

    expect(tk.size).toBe(0);
  });

  it("ne s'inscrit qu'une fois même si l'entrée se répète", () => {
    const { target, tk } = mount();

    target.emit("pointerover", EVENT);
    target.emit("pointerover", EVENT);

    expect(tk.size).toBe(1);
  });

  it("passe la cible en static", () => {
    // Sans `eventMode`, Pixi n'émet aucun `pointerover` : le module pose
    // lui-même ce dont il dépend, plutôt que de compter sur `attachTap` ou
    // `drawClusterHitAreas` de l'avoir fait avant lui.
    const { target } = mount();
    expect(target.eventMode).toBe("static");
  });
});

describe("attachHover — descente", () => {
  it("redescend à 0 à la sortie du pointeur", () => {
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

  it("repart de la valeur courante quand la montée n'était pas finie", () => {
    // Le cas du survol rasant, qui est le plus fréquent : sortir à mi-montée
    // doit redescendre depuis là. Repartir de 1 ferait un à-coup — la carte
    // grossirait d'un coup au moment même où le pointeur la quitte.
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    target.emit("pointerout", EVENT);
    tk.frame();
    // Première image de la descente, au même instant que la sortie : la valeur
    // n'a pas bougé d'un pouce.
    expect(frames.at(-1)).toBeCloseTo(EASED_HALF, 6);

    time.advance(HOVER_MS / 2);
    tk.frame();
    expect(frames.at(-1)).toBeLessThan(EASED_HALF);
    expect(frames.at(-1)).toBeGreaterThan(0);
  });

  it("repart de la valeur courante quand le pointeur revient pendant la descente", () => {
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

  it("ne relance rien sur une sortie alors que l'intensité est déjà nulle", () => {
    // Un `pointerout` sans `pointerover` précédent arrive pour de bon : entrée
    // inhibée par un drag, puis relâchement hors de la carte. Animer une
    // descente de 0 vers 0 ne coûterait qu'une inscription inutile au ticker.
    const { target, tk, frames } = mount();

    target.emit("pointerout", EVENT);

    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);
  });
});

describe("attachHover — inhibition", () => {
  it("ne démarre pas quand isBlocked est vrai", () => {
    // Le survol pendant un déplacement : la carte saisie suit le pointeur, la
    // grossir en même temps la ferait décrocher de lui.
    let blocked = true;
    const { target, tk, frames } = mount(() => blocked);

    target.emit("pointerover", EVENT);
    expect(tk.size).toBe(0);
    expect(frames).toEqual([]);

    // Le prédicat est relu à CHAQUE entrée et non capturé à l'attache : le
    // survol d'après le drag doit redevenir possible.
    blocked = false;
    target.emit("pointerover", EVENT);
    expect(tk.size).toBe(1);
  });
});

describe("attachHover — cible détruite", () => {
  it("s'auto-retire du ticker plutôt que de lancer", () => {
    // Un `rebuild()` détruit tous les containers de cartes sans qu'aucun
    // `pointerout` ne soit passé. Sans cette garde, le rappel lancerait à
    // chaque image — et pour toujours, puisque l'exception tombe avant son
    // propre retrait.
    const { target, tk, frames, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();
    const before = frames.length;

    target.destroy();
    expect(() => tk.frame()).not.toThrow();

    expect(tk.size).toBe(0);
    // Aucune intensité publiée sur un container mort : l'appelant écrirait sur
    // une `.position` nulle.
    expect(frames.length).toBe(before);
  });
});

describe("attachHover — cancel", () => {
  it("ramène l'intensité à 0, publie ce retour au repos et coupe l'animation", () => {
    // C'est ce que le début d'un drag appelle : la carte doit retrouver son
    // échelle et sa position exactes AVANT que le geste ne commence à la
    // suivre, et une seule voie de retour au repos vaut mieux que deux.
    const { target, tk, frames, handle, time } = mount();

    target.emit("pointerover", EVENT);
    time.advance(HOVER_MS / 2);
    tk.frame();

    handle.cancel();

    // Retour au repos publié une fois, et plus rien qui tourne.
    expect(frames.at(-1)).toBe(0);
    expect(tk.size).toBe(0);

    // L'animation ne reprend pas d'elle-même : le temps qui passe ne rallume
    // pas une intensité annulée.
    const after = frames.length;
    time.advance(HOVER_MS);
    tk.frame();
    expect(frames.length).toBe(after);
  });

  it("ne publie rien si l'intensité était déjà nulle", () => {
    // `onStart` de drag appelle `cancel()` sans savoir si la carte était
    // survolée. Repeindre le repos sur une carte déjà au repos serait au mieux
    // inutile, au pire un écrasement de position pendant un geste.
    const { handle, frames } = mount();
    handle.cancel();
    expect(frames).toEqual([]);
  });

  it("laisse un survol ultérieur repartir de zéro", () => {
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
