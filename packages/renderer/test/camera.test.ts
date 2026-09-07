import { describe, it, expect, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import {
  Camera,
  classifyWheel,
  normalizeWheelDelta,
  zoomFactorFor,
  type WheelSignal,
} from "../src/camera.js";

/** Un `WheelEvent` minimal : `classifyWheel` ne lit que ces champs. */
function wheel(partial: Partial<WheelSignal> = {}): WheelSignal {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...partial };
}

describe("normalizeWheelDelta", () => {
  it("laisse le mode pixel inchange", () => {
    expect(normalizeWheelDelta(120, 0)).toBe(120);
  });

  it("convertit le mode ligne en pixels", () => {
    // Firefox rapporte les crans de molette en lignes (deltaY = 3). Sans cette
    // conversion, un cran valait 0.3% de zoom : la molette y etait morte.
    expect(normalizeWheelDelta(3, 1)).toBe(48);
  });

  it("convertit le mode page en pixels", () => {
    expect(normalizeWheelDelta(1, 2)).toBe(400);
  });

  it("preserve le signe", () => {
    expect(normalizeWheelDelta(-3, 1)).toBe(-48);
  });
});

describe("classifyWheel", () => {
  it("ctrlKey est un zoom, quel que soit le reste", () => {
    // macOS synthetise un wheel + ctrlKey pour le pincement trackpad, et
    // Ctrl+molette est la convention navigateur universelle.
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 2 }))).toBe("zoom");
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 2, deltaX: 5 }))).toBe("zoom");
    expect(classifyWheel(wheel({ ctrlKey: true, deltaY: 100 }))).toBe("zoom");
  });

  it("metaKey est un zoom : Cmd+molette sur macOS", () => {
    expect(classifyWheel(wheel({ metaKey: true, deltaY: 100 }))).toBe("zoom");
    expect(classifyWheel(wheel({ metaKey: true, deltaY: 4, deltaX: 2 }))).toBe("zoom");
  });

  it("sans modificateur, un balayage trackpad se deplace TOUJOURS", () => {
    // Le coeur de la regression : un swipe deux doigts vertical et rapide
    // arrive avec deltaX quantifie a 0 et un deltaY entier de l'ordre du cran
    // de molette. Toute heuristique qui lit ces trois champs le prend pour une
    // molette et zoome au milieu d'une navigation.
    expect(classifyWheel(wheel({ deltaY: 100 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: -120 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 8 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: -3, deltaX: 1 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 96.5 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 100, deltaX: 4 }))).toBe("pan");
  });

  it("sans modificateur, une vraie molette se deplace aussi, deltaMode compris", () => {
    // Firefox rapporte les crans en lignes. C'est bien une molette, mais la
    // molette nue deplace : le zoom demande un modificateur explicite.
    expect(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: 1, deltaMode: 2 }))).toBe("pan");
  });

  it("un evenement nul ne zoome pas", () => {
    expect(classifyWheel(wheel())).toBe("pan");
  });
});

describe("zoomFactorFor", () => {
  it("est fin sur les petits deltas du pincement", () => {
    // ~6% par image : franc a la cadence d'un pincement, sans etre nerveux.
    expect(zoomFactorFor(-5)).toBeCloseTo(Math.exp(0.06), 6);
  });

  it("plafonne un cran de molette a 1.22x, comme l'ancien gain dedie", () => {
    // Le plafond existe pour qu'aucun code n'ait a reconnaitre la molette : un
    // cran de 100px bute dessus et retrouve exactement son toucher d'avant.
    expect(zoomFactorFor(-100)).toBeCloseTo(1.2214, 4);
    expect(zoomFactorFor(-100)).toBeCloseTo(Math.exp(100 * 0.002), 6);
  });

  it("plafonne symetriquement dans les deux sens", () => {
    expect(zoomFactorFor(100) * zoomFactorFor(-100)).toBeCloseTo(1, 6);
  });

  it("plafonne aussi un cran Firefox converti en pixels", () => {
    // deltaMode ligne : 3 lignes -> 48px, deja bien au-dela du plafond.
    expect(zoomFactorFor(-normalizeWheelDelta(3, 1))).toBeCloseTo(1.2214, 4);
  });

  it("ne change rien pour un delta nul", () => {
    expect(zoomFactorFor(0)).toBe(1);
  });
});

/** Le pan est cable sur des ecouteurs DOM natifs (canvas + window) : on les
 * capture au lieu de faire tourner un vrai navigateur, comme
 * `classifyWheel` est teste sur un `WheelEvent` fabrique. */
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

describe("Camera — inhibition du pan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deplace la toile quand rien ne bloque", () => {
    const { stage, down, move } = mountCamera(() => false);
    down(100, 100);
    move(150, 120);
    expect(stage.position.x).toBe(50);
    expect(stage.position.y).toBe(20);
  });

  it("ne deplace rien pendant qu'une carte est deplacee", () => {
    // Le meme geste, avec un drag de carte en cours : la toile doit rester
    // immobile, sans quoi la carte fuirait sous le curseur au double de la
    // vitesse du pointeur.
    let blocked = false;
    const { stage, down, move } = mountCamera(() => blocked);
    down(100, 100);
    move(150, 100);
    blocked = true;
    move(300, 100);
    move(400, 100);
    expect(stage.position.x).toBe(50);
  });

  it("ne rattrape pas le chemin parcouru pendant l'inhibition", () => {
    // La garde est au MOVE et non au DOWN : le pan reprend donc en cours de
    // geste, et il doit repartir de la DERNIERE position vue, pas de celle
    // d'avant l'inhibition — sinon la toile saute au relachement de la carte.
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
 * Ce que la camera montre du MONDE, pour ce qui doit se placer en coordonnees
 * monde tout en tenant compte de ce qu'on regarde — les etiquettes d'aretes,
 * qui glissent le long de leur trait pour rester dans le cadre.
 */
describe("Camera — worldViewport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const VIEWPORT = { width: 800, height: 600 };

  it("est l'inverse exact de centerOn : le rect vise y est centre", () => {
    const { camera } = mountCamera();
    const rect = { x: 1000, y: 500, width: 200, height: 100 };
    camera.centerOn(rect, VIEWPORT, 2);
    const world = camera.worldViewport(VIEWPORT);

    // Le rect tient entierement dedans...
    expect(world.x).toBeLessThan(rect.x);
    expect(world.y).toBeLessThan(rect.y);
    expect(world.x + world.width).toBeGreaterThan(rect.x + rect.width);
    expect(world.y + world.height).toBeGreaterThan(rect.y + rect.height);
    // ...et centre : les deux centres coincident.
    expect(world.x + world.width / 2).toBeCloseTo(rect.x + rect.width / 2, 6);
    expect(world.y + world.height / 2).toBeCloseTo(rect.y + rect.height / 2, 6);
    // La taille du monde vu est celle de l'ecran divisee par l'echelle.
    expect(world.width).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(world.height).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it("suit le pan : deplacer la toile deplace le monde vu en sens inverse", () => {
    const { camera, down, move } = mountCamera();
    camera.centerOn({ x: 0, y: 0, width: 0, height: 0 }, VIEWPORT, 1);
    const before = camera.worldViewport(VIEWPORT);
    down(100, 100);
    move(150, 100); // la toile va vers la droite, donc le regard vers la gauche
    const after = camera.worldViewport(VIEWPORT);
    expect(after.x).toBeCloseTo(before.x - 50, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
