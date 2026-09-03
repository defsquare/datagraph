import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import { buildGraph } from "@defsquare/data-graph-core";
import { anchorOnRect, drawEdgeLabels } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";
import { shopData, shopConfig, cartData, cartConfig } from "./fixtures.js";

/**
 * Même substitution d'adaptateur DOM que `array-token.test.ts` : Pixi mesure la
 * hauteur des libellés via un canvas 2D absent du runtime Node, et ce que ces
 * tests observent — le TEXTE de chaque étiquette et le fait qu'il y en ait une —
 * ne dépend pas de la fidélité de cette mesure.
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

/** Les textes portés par le conteneur, à plat. */
function textsOf(view: Container): string[] {
  const out: string[] = [];
  for (const child of view.children) if (child instanceof Text) out.push(child.text);
  return out;
}

/**
 * L'étiquette est la moitié « divulgation progressive » du tracé : le départ
 * d'une arête de référence est toujours une carte, ce qui ne dit pas de quelle
 * LIGNE elle part. Sélectionner la source fait apparaître le chemin instancié.
 */
describe("drawEdgeLabels", () => {
  const shop = buildGraph(shopData, shopConfig);
  const ORDER = { x: 0, y: 0, width: 160, height: 60 };
  const CUSTOMER = { x: 600, y: 0, width: 160, height: 60 };
  const shopPositions = new Map([
    ["/orders/0", ORDER],
    ["/orders/1", { x: 0, y: 200, width: 160, height: 60 }],
    ["/customers/0", CUSTOMER],
  ]);

  const cart = buildGraph(cartData, cartConfig);
  const CART = { x: 0, y: 0, width: 200, height: 120 };
  const PRODUCT = { x: 600, y: 0, width: 160, height: 60 };
  const LINE = { x: 300, y: 200, width: 180, height: 100 };

  it("nomme le CHAMP quand la sélection porte elle-même la référence", () => {
    const view = drawEdgeLabels(shop, shopPositions, theme, "/orders/0", false);
    expect(textsOf(view)).toEqual(["customerId"]);
  });

  it("nomme le CHEMIN INSTANCIÉ quand c'est l'entité déclarante qui est sélectionnée", () => {
    // Vue graphe : `/carts/0/lines/0` n'a pas de carte, la sélection est le
    // panier. L'indice `[0]` désigne l'élément exact, ce que `lines[*]` de la
    // config ne ferait pas.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const view = drawEdgeLabels(cart, positions, theme, "/carts/0", false);
    expect(textsOf(view)).toEqual(["lines[0].productRef"]);
  });

  it("nomme le CHAMP seul quand c'est la carte du value object qui est sélectionnée", () => {
    // Vue structure dépliée : le chemin depuis la carte sélectionnée n'a plus
    // qu'un segment, le préfixer de son propre nom serait bavard.
    const positions = new Map([
      ["/carts/0", CART],
      ["/carts/0/lines/0", LINE],
      ["/products/0", PRODUCT],
    ]);
    const view = drawEdgeLabels(cart, positions, theme, "/carts/0/lines/0", false);
    expect(textsOf(view)).toEqual(["productRef"]);
  });

  it("n'étiquette rien à la sélection de la CIBLE", () => {
    // Une arête entrante ne se lit pas depuis un champ de la carte sélectionnée :
    // il n'y a aucun chemin à nommer de ce côté-là.
    const view = drawEdgeLabels(shop, shopPositions, theme, "/customers/0", false);
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien sans sélection", () => {
    const view = drawEdgeLabels(shop, shopPositions, theme, null, false);
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien pour une référence CASSÉE", () => {
    // `/orders/1` pointe sur un client inexistant : aucun trait n'est tracé, et
    // une étiquette flottant sans trait ne désignerait rien.
    expect(shop.refEdges.find((e) => e.from === "/orders/1")?.dangling).toBe(true);
    const view = drawEdgeLabels(shop, shopPositions, theme, "/orders/1", false);
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien quand la CIBLE est hors de l'écran", () => {
    // Même règle que le tracé : pas de trait, pas d'étiquette.
    const view = drawEdgeLabels(shop, new Map([["/orders/0", ORDER]]), theme, "/orders/0", false);
    expect(view.children).toHaveLength(0);
  });

  it("pose l'étiquette sur le premier tiers du lien, dans une pilule", () => {
    // En FRACTION du lien et non à distance fixe du départ : à quelques pixels
    // de la carte, des arêtes voisines ne se sont pas encore écartées et leurs
    // étiquettes se recouvraient. Côté source toujours — au-delà de la moitié,
    // l'étiquette se lirait comme désignant la cible.
    const view = drawEdgeLabels(shop, shopPositions, theme, "/orders/0", false);
    const pill = view.children.find((c) => c instanceof Graphics) as Graphics;
    const text = view.children.find((c) => c instanceof Text) as Text;
    expect(pill).toBeDefined();
    const start = anchorOnRect(ORDER, CUSTOMER.x + CUSTOMER.width / 2, CUSTOMER.y + CUSTOMER.height / 2);
    const end = anchorOnRect(CUSTOMER, ORDER.x + ORDER.width / 2, ORDER.y + ORDER.height / 2);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const toStart = Math.hypot(text.position.x - start.x, text.position.y - start.y);
    const toEnd = Math.hypot(text.position.x - end.x, text.position.y - end.y);
    expect(toStart).toBeGreaterThan(len * 0.2); // plus collée au départ
    expect(toStart).toBeLessThan(toEnd); // mais toujours côté source
  });

  it("étage les étiquettes d'une même source le long de leurs liens", () => {
    // Deux arêtes quasi parallèles gardent des étiquettes séparées : la
    // fraction croît d'un cran par étiquette. Trois références sortent du même
    // panier vers trois produits empilés — des liens presque parallèles, le cas
    // qui superposait les étiquettes à distance fixe du départ.
    const g = buildGraph(
      {
        carts: [{ id: "k1", lines: [{ productRef: "a" }, { productRef: "b" }, { productRef: "c" }] }],
        products: [{ id: "a" }, { id: "b" }, { id: "c" }],
      },
      cartConfig,
    );
    const positions = new Map([
      ["/carts/0", { x: 0, y: 0, width: 200, height: 140 }],
      ["/products/0", { x: 600, y: 0, width: 160, height: 60 }],
      ["/products/1", { x: 600, y: 80, width: 160, height: 60 }],
      ["/products/2", { x: 600, y: 160, width: 160, height: 60 }],
    ]);
    const view = drawEdgeLabels(g, positions, theme, "/carts/0", false);
    const texts = view.children.filter((c): c is Text => c instanceof Text);
    expect(texts.length).toBe(3);
    const xs = texts.map((t) => t.position.x).sort((a, b) => a - b);
    // Trois fractions distinctes sur des liens de longueurs comparables : les
    // abscisses doivent s'écarter nettement, pas se recouvrir.
    expect(xs[1]! - xs[0]!).toBeGreaterThan(30);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(30);
  });
});
