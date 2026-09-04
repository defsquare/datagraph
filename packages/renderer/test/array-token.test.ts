import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import {
  arrayTokenTextFor,
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
} from "@defsquare/data-graph-core";
import { drawNode } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * Même substitution d'adaptateur DOM que `ref-indicator.test.ts` : Pixi mesure
 * la hauteur des libellés via un canvas 2D absent du runtime Node, et ce que ces
 * tests observent — la présence du jeton, son chevron, l'absence de clé — ne
 * dépend pas de la fidélité de cette mesure.
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
const rect = { x: 0, y: 0, width: 260, height: 140 };

const config: DataGraphConfig = {
  ids: { Product: "$.products[*].id" },
};
const graph = buildGraph(
  { products: [{ id: "p1", tags: ["mecanique", "USB-C", "RGB"] }] },
  config,
);
const product = graph.nodes.get("/products/0")!;
const TAGS_ROW = product.rows.findIndex((r) => r.key === "tags");
const TAGS_ID = "/products/0/tags";

/** Les textes rendus par la carte, à plat — le jeton monte ses enfants dans un
 * sous-conteneur, donc une lecture à un seul niveau les manquerait. */
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

function tokenOf(view: Container): Container | null {
  return view.getChildByLabel(`array-token:${TAGS_ROW}`) as Container | null;
}

describe("jeton d'une ligne-tableau", () => {
  it("rend le compte d'elements, pas la valeur brute", () => {
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    expect(textsOf(view)).toContain(arrayTokenTextFor(3));
    // « 3 » nu serait le rendu qu'on obtiendrait en traitant la ligne comme une
    // ligne scalaire ordinaire.
    expect(textsOf(view)).not.toContain("3");
  });

  it("monte le jeton dans un conteneur repere par label", () => {
    // C'est ce label qui permet à `create.ts` d'animer le survol sans redessiner
    // la carte ni recalculer sa geometrie.
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    expect(tokenOf(view)).not.toBeNull();
  });

  it("prepare un trace de survol CACHE plutot qu'une couleur recalculee", () => {
    const view = drawNode(product, rect, theme, 0, false, "#000", metrics, false, false);
    const hover = tokenOf(view)!.getChildByLabel("hover")!;
    expect(hover.visible).toBe(false);
  });

  it("oriente le chevron selon l'etat de pli du TABLEAU, pas de la carte", () => {
    const collapsed = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined,
      new Set<string>(),
    );
    const expanded = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined,
      new Set([TAGS_ID]),
    );
    // Le chevron replie « ▸ » est plus haut que large, le deplie « ▾ » l'inverse.
    // On lit les sommets du triangle dans le contexte du Graphics, comme le fait
    // `segmentOf` dans `ref-indicator.test.ts` : la geometrie du trace est ce que
    // ces tests observent, pas un rendu.
    const shapeOf = (v: Container): { w: number; h: number } => {
      const g = tokenOf(v)!.getChildByLabel("chevron") as Graphics;
      const instructions = g.context.instructions as any[];
      expect(instructions.map((i) => i.action)).toEqual(["fill"]);
      const points = (instructions[0].data.path.instructions as any[]).map((p) => p.data);
      const xs = points.map((p) => p[0] as number);
      const ys = points.map((p) => p[1] as number);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const c = shapeOf(collapsed);
    const e = shapeOf(expanded);
    expect(c.h).toBeGreaterThan(c.w);
    expect(e.w).toBeGreaterThan(e.h);
  });

  it("n'affiche aucun chevron quand la vue ne plie rien", () => {
    // `null` est ce que `create.ts` passe en vue graphe : le jeton reste lisible
    // mais n'annonce plus un geste qui n'aurait aucun effet.
    const view = drawNode(
      product, rect, theme, 0, false, "#000", metrics, false, false, undefined, undefined, null,
    );
    expect(tokenOf(view)!.getChildByLabel("chevron")).toBeNull();
    expect(textsOf(view)).toContain(arrayTokenTextFor(3));
  });
});

describe("ligne a valeur seule", () => {
  it("dessine la valeur sans sa cle", () => {
    // L'element scalaire d'un tableau porte `tags[0]` en en-tete : repeter
    // `$value` en cle n'apprendrait rien, et `measureNode` ne lui reserve donc
    // aucune largeur de cle.
    const element = graph.nodes.get("/products/0/tags/0")!;
    const view = drawNode(element, rect, theme, 0, false, "#000", metrics, false, false);
    const texts = textsOf(view);
    expect(texts).toContain("mecanique");
    expect(texts).not.toContain("$value");
  });
});
