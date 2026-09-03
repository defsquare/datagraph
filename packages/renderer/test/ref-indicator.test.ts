import { describe, it, expect } from "vitest";
import { DOMAdapter, Graphics, Text } from "pixi.js";
import { buildGraph, DEFAULT_METRICS, type DataGraphConfig } from "@defsquare/data-graph-core";
import { drawNode } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

/**
 * `drawNode` demande la hauteur de chaque libellé pour le centrer, et Pixi la
 * mesure via un canvas 2D — absent du runtime Node de vitest. On substitue donc
 * l'adaptateur DOM de Pixi par un canvas factice à avance FIXE : la mesure n'a
 * pas besoin d'être fidèle ici, seulement d'exister, puisque ce que les tests
 * observent est la teinte, la présence des Graphics de soulignement et la
 * longueur des chaînes TRONQUÉES — laquelle est calculée par `truncateToWidth`
 * à partir des métriques du thème, jamais du canvas.
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

/** Un identifiant assez long pour être tronqué dans une carte étroite : c'est
 * lui qui rend observable le budget de troncature de la valeur. */
const LONG_ID = "identifiant-de-client-extremement-long-pour-forcer-la-troncature";

const data = {
  customers: [{ id: LONG_ID, name: "Dupont" }],
  orders: [{ id: "o1", customerId: LONG_ID, total: 99.5 }],
};
const config: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
};

const graph = buildGraph(data, config);
const order = graph.nodes.get("/orders/0")!;
const rect = { x: 0, y: 0, width: 260, height: 140 };

/** Les index de ligne visés par les tests, retrouvés par NOM : l'ordre des
 * lignes appartient à `buildGraph`, pas à ce fichier. */
const REF_ROW = order.rows.findIndex((r) => r.key === "customerId");
const PLAIN_ROW = order.rows.findIndex((r) => r.key === "total");

function render(refFields?: ReadonlySet<string>, at = rect) {
  return refFields === undefined
    ? drawNode(order, at, theme, 0, false, "#123456", metrics, false, false)
    : drawNode(order, at, theme, 0, false, "#123456", metrics, false, false, refFields);
}

/** La signature observable d'une carte : le type de chaque enfant, son texte et
 * sa couleur. Deux rendus identiques à cette signature près sont, pour ce
 * fichier, le même rendu. */
function signature(container: ReturnType<typeof drawNode>): string[] {
  return container.children.map((child) => {
    if (child instanceof Text) return `Text:${child.text}:${String(child.style.fill)}`;
    return "Graphics";
  });
}

function textsOf(container: ReturnType<typeof drawNode>): Text[] {
  return container.children.filter((c): c is Text => c instanceof Text);
}

/** Les VALEURS de la carte : seul le rôle `value` est composé en mono, ce qui
 * les sépare des clés, de l'en-tête et de la pastille sans dépendre de l'ordre
 * des enfants. */
function valueTexts(container: ReturnType<typeof drawNode>): Text[] {
  return textsOf(container).filter((t) => t.style.fontFamily === theme.fonts.mono);
}

/** La valeur affichée pour la ligne `customerId` — la seule des trois qui soit
 * assez longue pour être tronquée. */
function refValueText(container: ReturnType<typeof drawNode>): Text {
  const found = valueTexts(container).find((t) => t.text !== "o1" && t.text !== "99.5");
  expect(found).toBeDefined();
  return found!;
}

function underlineOf(container: ReturnType<typeof drawNode>, index: number): Graphics | null {
  return container.getChildByLabel(`ref-underline:${index}`) as Graphics | null;
}

function underlines(container: ReturnType<typeof drawNode>): Graphics[] {
  return container.children.filter(
    (c): c is Graphics => c instanceof Graphics && c.label.startsWith("ref-underline:"),
  );
}

/** Les deux extrémités du trait de soulignement, lues dans le contexte du
 * Graphics : un souligné est un `moveTo`/`lineTo` unique suivi d'un `stroke`. */
function segmentOf(g: Graphics): { x1: number; y1: number; x2: number; y2: number } {
  const instructions = g.context.instructions as any[];
  expect(instructions).toHaveLength(1);
  expect(instructions[0].action).toBe("stroke");
  const path = instructions[0].data.path.instructions as any[];
  expect(path.map((p) => p.action)).toEqual(["moveTo", "lineTo"]);
  return {
    x1: path[0].data[0],
    y1: path[0].data[1],
    x2: path[1].data[0],
    y2: path[1].data[1],
  };
}

describe("drawNode — indicateur de valeur référençante", () => {
  it("rend exactement comme avant sans champs de référence", () => {
    // Garde de non-régression : le paramètre est optionnel, et l'omettre ou
    // passer un ensemble VIDE doit donner le rendu d'avant la fonctionnalité,
    // à l'enfant près.
    const implicit = render();
    const empty = render(new Set());
    expect(signature(empty)).toEqual(signature(implicit));
    // Aucune valeur n'y porte la couleur des arêtes de référence.
    for (const t of textsOf(implicit)) expect(t.style.fill).not.toBe(theme.edge.ref);
    expect(underlines(implicit)).toHaveLength(0);
  });

  it("teinte la valeur d'une ligne référençante dans la couleur de l'arête", () => {
    const g = render(new Set(["customerId"]));
    expect(refValueText(g).style.fill).toBe(theme.edge.ref);
    // Les autres valeurs ne bougent pas : seule la ligne nommée est concernée.
    const total = textsOf(g).find((t) => t.text === "99.5");
    expect(total?.style.fill).toBe(theme.ink.primary);
  });

  it("ne change RIEN à la troncature ni à l'alignement de la valeur", () => {
    // L'indicateur au repos est une teinte, et une teinte n'occupe pas de
    // place : le budget de la valeur doit rester celui d'une ligne ordinaire.
    // C'est la régression qu'avait introduite l'icône, qui rognait la droite de
    // la ligne et faisait tronquer la valeur plus court dès qu'elle devenait
    // navigable.
    const plain = refValueText(render());
    const tinted = refValueText(render(new Set(["customerId"])));
    expect(plain.text.length).toBeGreaterThan(1);
    expect(tinted.text).toBe(plain.text);
    expect(tinted.x).toBe(plain.x);
    expect(tinted.y).toBe(plain.y);
  });

  it("prépare un souligné CACHÉ sous la valeur de chaque ligne référençante", () => {
    const g = render(new Set(["customerId"]));
    const underline = underlineOf(g, REF_ROW);
    expect(underline).toBeInstanceOf(Graphics);
    // Caché par défaut : `drawNode` prépare le visuel, c'est `create.ts` qui
    // décide quand il se montre. Un souligné visible au repos ferait de la
    // carte entière un tapis de liens.
    expect(underline!.visible).toBe(false);
    // Le compte suit les LIGNES, pas la simple présence d'un ensemble non vide.
    expect(underlines(g)).toHaveLength(1);
    expect(underlines(render(new Set(["customerId", "total"])))).toHaveLength(2);
    expect(underlines(render(new Set(["inexistant"])))).toHaveLength(0);
  });

  it("aligne le souligné sur la valeur qu'il souligne, juste en dessous", () => {
    const g = render(new Set(["customerId"]));
    const value = refValueText(g);
    const seg = segmentOf(underlineOf(g, REF_ROW)!);
    const contentRight = rect.width - metrics.paddingX;
    // Exactement la largeur du texte, jusqu'au bord droit du contenu : le
    // souligné doit se lire comme appartenant à la valeur, pas à la ligne.
    expect(seg.x1).toBe(Math.round(contentRight - value.width));
    expect(seg.x2).toBe(contentRight);
    // Horizontal, et sous la ligne de base du texte.
    expect(seg.y1).toBe(seg.y2);
    expect(seg.y1).toBeGreaterThan(value.y + value.height - 1);
  });

  it("ne prépare aucun souligné pour une ligne non référençante", () => {
    const g = render(new Set(["customerId"]));
    expect(underlineOf(g, PLAIN_ROW)).toBeNull();
  });

  it("ne prépare aucun souligné quand la valeur est tronquée à vide", () => {
    // Carte trop étroite pour afficher la moindre valeur : il n'y a alors rien
    // à souligner, et un trait seul ne désignerait plus rien.
    const narrow = { x: 0, y: 0, width: 40, height: 140 };
    const g = render(new Set(["customerId"]), narrow);
    expect(valueTexts(g)).toHaveLength(0);
    expect(underlines(g)).toHaveLength(0);
  });

  it("ne touche à rien hors du LOD 0", () => {
    // LOD 1 et 2 n'affichent aucune ligne : il n'y a pas de valeur à teinter,
    // donc pas de souligné non plus.
    for (const lod of [1, 2] as const) {
      const plain = drawNode(order, rect, theme, lod, false, "#123456", metrics, false, false);
      const tinted = drawNode(
        order,
        rect,
        theme,
        lod,
        false,
        "#123456",
        metrics,
        false,
        false,
        new Set(["customerId"]),
      );
      expect(signature(tinted)).toEqual(signature(plain));
      expect(underlines(tinted)).toHaveLength(0);
    }
  });
});
