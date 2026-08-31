import { describe, it, expect } from "vitest";
import { classifyWheel, normalizeWheelDelta, type WheelSignal } from "../src/camera.js";

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
