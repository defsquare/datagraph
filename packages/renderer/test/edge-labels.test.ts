import { describe, it, expect } from "vitest";
import { Container, DOMAdapter, Graphics, Text } from "pixi.js";
import { buildGraph } from "@defsquare/data-graph-core";
import {
  anchorOnRect,
  drawEdgeLabels,
  edgeLabelPlacements,
  edgeLabelPosition,
  labelParamInView,
} from "../src/draw.js";
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

/**
 * Les textes portés par le conteneur. Une étiquette est un SOUS-CONTENEUR
 * (pilule + texte autour de son origine locale), ce qui permet à `create.ts` de
 * la reposer sans rien recréer : la lecture descend donc d'un niveau.
 */
function textsOf(view: Container): string[] {
  const out: string[] = [];
  for (const item of view.children) {
    for (const child of (item as Container).children ?? []) {
      if (child instanceof Text) out.push(child.text);
    }
  }
  return out;
}

/** Le chemin complet, tel que `create.ts` l'enchaîne : placements purs, puis rendu. */
function labelsOf(
  graph: Parameters<typeof edgeLabelPlacements>[0],
  positions: Parameters<typeof edgeLabelPlacements>[1],
  selectedId: Parameters<typeof edgeLabelPlacements>[2],
): Container {
  return drawEdgeLabels(edgeLabelPlacements(graph, positions, selectedId), theme, false);
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

  it("nomme le chemin complet depuis l'entité pour une référence directe", () => {
    // L'étiquette glisse avec le viewport et se lit souvent près de la CIBLE,
    // source hors cadre : `customerId` seul n'identifierait pas quelle commande.
    const view = labelsOf(shop, shopPositions, "/orders/0");
    expect(textsOf(view)).toEqual(["Order#o1.customerId"]);
  });

  it("nomme le CHEMIN INSTANCIÉ quand c'est l'entité déclarante qui est sélectionnée", () => {
    // Vue graphe : `/carts/0/lines/0` n'a pas de carte, la sélection est le
    // panier. L'indice `[0]` désigne l'élément exact, ce que `lines[*]` de la
    // config ne ferait pas.
    const positions = new Map([["/carts/0", CART], ["/products/0", PRODUCT]]);
    const view = labelsOf(cart, positions, "/carts/0");
    expect(textsOf(view)).toEqual(["Cart#k1.lines[0].productRef"]);
  });

  it("garde le chemin complet même quand c'est la carte du value object qui est sélectionnée", () => {
    // Le texte est UNIFORME quel que soit le nœud sélectionné : l'étiquette se
    // lit loin de la sélection (elle a pu glisser jusqu'à la cible), et le
    // lecteur n'a pas à se rappeler ce qu'il a sélectionné pour la comprendre.
    const positions = new Map([
      ["/carts/0", CART],
      ["/carts/0/lines/0", LINE],
      ["/products/0", PRODUCT],
    ]);
    const view = labelsOf(cart, positions, "/carts/0/lines/0");
    expect(textsOf(view)).toEqual(["Cart#k1.lines[0].productRef"]);
  });

  it("n'étiquette rien à la sélection de la CIBLE", () => {
    // Une arête entrante ne se lit pas depuis un champ de la carte sélectionnée :
    // il n'y a aucun chemin à nommer de ce côté-là.
    const view = labelsOf(shop, shopPositions, "/customers/0");
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien sans sélection", () => {
    const view = labelsOf(shop, shopPositions, null);
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien pour une référence CASSÉE", () => {
    // `/orders/1` pointe sur un client inexistant : aucun trait n'est tracé, et
    // une étiquette flottant sans trait ne désignerait rien.
    expect(shop.refEdges.find((e) => e.from === "/orders/1")?.dangling).toBe(true);
    const view = labelsOf(shop, shopPositions, "/orders/1");
    expect(view.children).toHaveLength(0);
  });

  it("n'étiquette rien quand la CIBLE est hors de l'écran", () => {
    // Même règle que le tracé : pas de trait, pas d'étiquette.
    const view = labelsOf(shop, new Map([["/orders/0", ORDER]]), "/orders/0");
    expect(view.children).toHaveLength(0);
  });

  it("pose l'étiquette sur le premier tiers du lien, dans une pilule", () => {
    // En FRACTION du lien et non à distance fixe du départ : à quelques pixels
    // de la carte, des arêtes voisines ne se sont pas encore écartées et leurs
    // étiquettes se recouvraient. Côté source toujours — au-delà de la moitié,
    // l'étiquette se lirait comme désignant la cible.
    const view = labelsOf(shop, shopPositions, "/orders/0");
    const item = view.children[0] as Container;
    // La pilule et le texte sont dessinés autour de l'origine LOCALE du
    // sous-conteneur ; c'est lui qui porte la position sur le lien.
    expect(item.children.find((c) => c instanceof Graphics)).toBeDefined();
    expect(item.children.find((c) => c instanceof Text)).toBeDefined();
    const start = anchorOnRect(ORDER, CUSTOMER.x + CUSTOMER.width / 2, CUSTOMER.y + CUSTOMER.height / 2);
    const end = anchorOnRect(CUSTOMER, ORDER.x + ORDER.width / 2, ORDER.y + ORDER.height / 2);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const toStart = Math.hypot(item.position.x - start.x, item.position.y - start.y);
    const toEnd = Math.hypot(item.position.x - end.x, item.position.y - end.y);
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
    const view = labelsOf(g, positions, "/carts/0");
    expect(view.children).toHaveLength(3);
    const xs = view.children.map((c) => c.position.x).sort((a, b) => a - b);
    // Trois fractions distinctes sur des liens de longueurs comparables : les
    // abscisses doivent s'écarter nettement, pas se recouvrir.
    expect(xs[1]! - xs[0]!).toBeGreaterThan(30);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(30);
  });
});

/**
 * Les étiquettes GLISSENT le long de leur lien pour rester dans le cadre, comme
 * le nom d'une route sur une carte : on sélectionne la source, on suit le lien,
 * on zoome près de la CIBLE, et l'étiquette a suivi — elle dit de quelle
 * référence il s'agit sans qu'on ait à remonter jusqu'à la source.
 */
describe("labelParamInView", () => {
  const START = { x: 0, y: 0 };
  const END = { x: 1000, y: 0 };
  const BASE = 0.38;
  const MARGIN = 48;

  it("ne bouge RIEN quand toute l'arête est visible", () => {
    // C'est l'invariant qui rend le glissement invisible au repos : tant que le
    // lien tient à l'écran, l'étiquette reste à sa fraction de base. La marge
    // elle-même n'a pas le droit de la déplacer.
    const view = { x: -100, y: -100, width: 1200, height: 200 };
    expect(labelParamInView(START, END, BASE, view, MARGIN)).toBe(BASE);
  });

  it("suit le viewport quand il est serré sur la CIBLE", () => {
    // Le cas qui motive toute la fonctionnalité : zoomé sur la cible, un trait
    // arrive sans dire lequel. L'étiquette vient sur le tronçon visible.
    const view = { x: 800, y: -50, width: 200, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    expect(t).toBeGreaterThan(0.8);
    expect(t).toBeLessThanOrEqual(1);
  });

  it("reste en deçà du bord quand le viewport est serré sur la SOURCE", () => {
    // Symétrique : le tronçon visible s'arrête à t1, et l'étiquette doit rester
    // à une marge du bord, sinon la pilule sort à moitié du cadre.
    const view = { x: -50, y: -50, width: 350, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    // Visible sur [0, 0.3] : l'étiquette recule jusqu'à 0.3 − 48/1000.
    expect(t).toBeCloseTo(0.3 - MARGIN / 1000, 6);
  });

  it("rend la fraction de base quand le lien ne croise PAS le cadre", () => {
    // Rien de visible à annoter : la position de repos est le seul choix qui
    // ne raconte pas d'histoire.
    const view = { x: 0, y: 500, width: 200, height: 100 };
    expect(labelParamInView(START, END, BASE, view, MARGIN)).toBe(BASE);
  });

  it("rend la fraction de base pour un segment de longueur nulle", () => {
    // Deux cartes confondues : il n'y a pas de paramétrage à couper.
    const view = { x: -100, y: -100, width: 200, height: 200 };
    expect(labelParamInView(START, START, BASE, view, MARGIN)).toBe(BASE);
  });

  it("se pose au MILIEU quand le tronçon visible est plus court que deux marges", () => {
    // Aucune position n'honore les deux marges à la fois ; le milieu est le
    // moins mauvais compromis, et surtout il reste DANS le tronçon visible.
    const view = { x: 500, y: -50, width: 60, height: 100 };
    const t = labelParamInView(START, END, BASE, view, MARGIN);
    expect(t).toBeCloseTo(0.53, 6); // milieu de [0.5, 0.56]
  });

  it("place l'étiquette sur le lien, du bon côté du trait", () => {
    // `edgeLabelPosition` est le pont entre la fraction et le point : ce que
    // `create.ts` réutilise pour reposer sans recréer un seul `Text`.
    const at = edgeLabelPosition(START, END, 0.5);
    expect(at.x).toBeCloseTo(500, 6);
    expect(at.y).toBeCloseTo(10, 6); // le décalage perpendiculaire, constant
  });
});
