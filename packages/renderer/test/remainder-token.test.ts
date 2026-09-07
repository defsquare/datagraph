import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import { drawRemainderToken, REMAINDER_TOKEN_HEIGHT } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * Même substitution d'adaptateur DOM que `array-token.test.ts` : Pixi mesure la
 * hauteur des libellés via un canvas 2D absent du runtime Node, et ce que ces
 * tests observent — le libellé, la géométrie de la pilule — ne dépend pas de la
 * fidélité de cette mesure.
 */
class FakeCanvasContext {
  font = "";
  letterSpacing = "";
  measureText(text: string) {
    return { width: text.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
  }
}
const browserAdapter = DOMAdapter.get();
DOMAdapter.set({
  ...browserAdapter,
  createCanvas: (width?: number, height?: number) =>
    ({
      width: width ?? 0,
      height: height ?? 0,
      getContext: () => new FakeCanvasContext(),
    }) as never,
  getCanvasRenderingContext2D: () => FakeCanvasContext as never,
});

const theme = resolveTheme(undefined);
const metrics = DEFAULT_METRICS;

/** Tous les textes du jeton, à plat. */
function textsOf(view: Container): string[] {
  const out: string[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      if (child instanceof Text) out.push(child.text);
      if (child instanceof Container) walk(child);
    }
  };
  walk(view);
  return out;
}

/** La géométrie du fond, lue dans les instructions du Graphics — même lecture
 * que `array-token.test.ts` fait du chevron : c'est le tracé qu'on observe, pas
 * un rendu. */
function restRect(token: Container): { x: number; y: number; w: number; h: number } {
  const g = token.getChildByLabel("rest") as Graphics;
  const fill = (g.context.instructions as any[]).find((i) => i.action === "fill");
  const data = (fill.data.path.instructions as any[])[0].data as number[];
  return { x: data[0]!, y: data[1]!, w: data[2]!, h: data[3]! };
}

describe("jeton de reliquat", () => {
  it("porte un label repere, celui par lequel `create.ts` retrouve ses jetons", () => {
    const token = drawRemainderToken({ count: 47300, width: 260, theme, metrics });
    expect(token.label).toBe("remainder-token");
  });

  it("annonce le nombre d'enfants caches, pas le numero de page", () => {
    const token = drawRemainderToken({ count: 47300, width: 260, theme, metrics });
    expect(textsOf(token)).toContain("+ 47300");
  });

  it("prend la largeur qu'on lui donne — celle de la carte voisine qui l'ancre", () => {
    // Un jeton plus étroit ou plus large que la colonne de cartes se lirait
    // comme un objet d'une autre nature, alors qu'il tient la place des cartes
    // manquantes.
    const rect = restRect(drawRemainderToken({ count: 12, width: 187, theme, metrics }));
    expect(rect.w).toBe(187);
    expect(rect.h).toBe(REMAINDER_TOKEN_HEIGHT);
  });

  it("tient dans la bande qui separe deux cartes empilees", () => {
    // La mise en page ne réserve aucune place au jeton : au-delà de `NODE_GAP`
    // (24 px, `packages/core/src/structure-layout.ts`) il recouvre la carte
    // voisine ET lui vole ses clics, son calque étant au-dessus. L'écart que
    // `create.ts` ajoute doit encore tenir dans ce qui reste.
    expect(REMAINDER_TOKEN_HEIGHT).toBeLessThan(24);
  });

  it("se dessine en (0,0) dans son espace local, comme une carte", () => {
    // C'est l'appelant qui le place : `create.ts` calcule l'ancrage à partir des
    // positions, et un décalage interne le décalerait deux fois.
    const rect = restRect(drawRemainderToken({ count: 12, width: 187, theme, metrics }));
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it("tronque le libelle plutot que de deborder d'un jeton etroit", () => {
    // La largeur vient de la carte voisine et non du texte : sur une colonne
    // étroite, un libellé non tronqué sortirait de la pilule.
    const token = drawRemainderToken({ count: 1234567, width: 24, theme, metrics });
    const texts = textsOf(token);
    expect(texts).not.toContain("+ 1234567");
    expect(texts.every((t) => t.length < "+ 1234567".length)).toBe(true);
  });
});
