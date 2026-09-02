import { describe, it, expect, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import { Camera, classifyWheel, normalizeWheelDelta, type WheelSignal } from "../src/camera.js";

/** Un `WheelEvent` minimal : `classifyWheel` ne lit que ces quatre champs. */
function wheel(partial: Partial<WheelSignal> = {}): WheelSignal {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...partial };
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
  });

  it("un deltaMode non pixel est une vraie molette, donc un zoom", () => {
    expect(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("zoom");
    expect(classifyWheel(wheel({ deltaY: 1, deltaMode: 2 }))).toBe("zoom");
  });

  it("un pas franc, entier et purement vertical est une molette, donc un zoom", () => {
    // Chrome synthetise ~100px par cran de molette.
    expect(classifyWheel(wheel({ deltaY: 100 }))).toBe("zoom");
    expect(classifyWheel(wheel({ deltaY: -120 }))).toBe("zoom");
  });

  it("un balayage trackpad se deplace : deltas petits", () => {
    expect(classifyWheel(wheel({ deltaY: 8 }))).toBe("pan");
    expect(classifyWheel(wheel({ deltaY: -3, deltaX: 1 }))).toBe("pan");
  });

  it("un balayage trackpad se deplace : deltas fractionnaires meme s'ils sont gros", () => {
    expect(classifyWheel(wheel({ deltaY: 96.5 }))).toBe("pan");
  });

  it("un balayage trackpad se deplace : composante horizontale meme si deltaY est gros", () => {
    expect(classifyWheel(wheel({ deltaY: 100, deltaX: 4 }))).toBe("pan");
  });

  it("un evenement nul ne zoome pas", () => {
    expect(classifyWheel(wheel())).toBe("pan");
  });
});

describe("Camera — inhibition du pan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Le pan est cable sur des ecouteurs DOM natifs (canvas + window) : on les
   * capture au lieu de faire tourner un vrai navigateur, comme
   * `classifyWheel` est teste sur un `WheelEvent` fabrique. */
  function mountCamera(isBlocked: () => boolean) {
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
