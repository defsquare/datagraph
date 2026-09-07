import { describe, it, expect } from "vitest";
import { buildGraph, type NodeId, type Rect } from "@defsquare/data-graph-core";
import { cardFate, cardWindowsFor, inflateRect, rectContains, rectsOverlap } from "../src/create.js";
import { drawEdgeHitAreas } from "../src/draw.js";
import { shopData, shopConfig } from "./fixtures.js";

/**
 * La politique du culling à la création, testée là où elle vit : en donnée
 * pure. Aucun test du renderer ne monte `createDataGraph` (pas de DOM, pas de
 * WebGL sous vitest), et c'est précisément pourquoi `cardFate` existe en
 * fonction séparée — la décision se prouve ici, l'exécution (`syncCards`) n'en
 * est plus que la boucle. Le bout non prouvable ici, « la caméra qui saute sur
 * une carte la trouve dessinée à l'arrivée », est couvert de bout en bout par
 * `apps/demo/e2e/culling.spec.ts`.
 */

/** Le rectangle monde visible du scénario : 1000×1000 à l'origine. Toutes les
 * fenêtres en dérivent, donc les distances ci-dessous se lisent en écrans. */
const VIEW: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
const windows = cardWindowsFor(VIEW);

/** Une carte de 100×100 posée en (x, y). */
function card(x: number, y: number): Rect {
  return { x, y, width: 100, height: 100 };
}

const FRESH = { materialized: false, pinned: false, budgetLeft: true };
const DRAWN = { materialized: true, pinned: false, budgetLeft: false };

describe("inflateRect", () => {
  it("ne touche à rien à marge nulle", () => {
    expect(inflateRect(VIEW, 0)).toEqual(VIEW);
  });

  it("triple chaque dimension à marge 1, en restant centré", () => {
    expect(inflateRect(VIEW, 1)).toEqual({ x: -1000, y: -1000, width: 3000, height: 3000 });
  });
});

describe("rectsOverlap", () => {
  it("compte le contact par un bord", () => {
    // Une carte posée exactement sur le bord doit être dessinée : l'exclure la
    // ferait clignoter au pixel près.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("est faux dès qu'il y a un vide", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("exige les DEUX axes", () => {
    // Chevauchement horizontal parfait, mais très loin verticalement.
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 500, width: 10, height: 10 })).toBe(false);
  });
});

describe("rectContains", () => {
  it("accepte l'égalité et le contact intérieur", () => {
    expect(rectContains(VIEW, VIEW)).toBe(true);
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1000, height: 10 })).toBe(true);
  });

  it("refuse un débordement, même d'un pixel", () => {
    expect(rectContains(VIEW, { x: 0, y: 0, width: 1001, height: 10 })).toBe(false);
    expect(rectContains(VIEW, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("cardFate — création", () => {
  it("crée sans condition ce qui est à l'écran", () => {
    // Budget épuisé compris : la fenêtre à peindre est un CONTRAT visuel, la
    // rogner ferait apparaître des trous.
    expect(cardFate(card(400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("crée ce qui est juste hors cadre, dans la marge de peinture", () => {
    // La marge de 15 % absorbe l'image de retard entre la caméra et nous : une
    // carte qui entre par le bord ne doit pas apparaître une image trop tard.
    expect(cardFate(card(-100, 400), windows, { ...FRESH, budgetLeft: false })).toBe("create");
  });

  it("crée le voisinage quand le budget de l'image le permet", () => {
    // À un demi-écran hors cadre : du confort, pas du contrat.
    expect(cardFate(card(1400, 400), windows, FRESH)).toBe("create");
  });

  it("DIFFÈRE ce même voisinage quand le budget est épuisé", () => {
    expect(cardFate(card(1400, 400), windows, { ...FRESH, budgetLeft: false })).toBe("defer");
  });

  it("ne fabrique rien au-delà du voisinage", () => {
    // Trois écrans plus loin : c'est exactement le travail que le culling
    // supprime — 6 251 cartes créées pour quelques dizaines regardées.
    expect(cardFate(card(4000, 4000), windows, FRESH)).toBe("none");
  });

  it("crée tout quand il n'y a pas de caméra", () => {
    // Repli exact sur le comportement d'avant le culling : sans caméra, aucune
    // fenêtre n'a de sens.
    const none = cardWindowsFor(null);
    expect(cardFate(card(999_999, 999_999), none, { ...FRESH, budgetLeft: false })).toBe("create");
  });
});

describe("cardFate — recyclage", () => {
  it("garde ce qui est à l'écran", () => {
    expect(cardFate(card(400, 400), windows, DRAWN)).toBe("none");
  });

  it("garde le voisinage large : l'hystérésis empêche le clignotement", () => {
    // Deux écrans hors cadre — au-delà de la fenêtre de préchargement, donc
    // une carte que le passage ne recréerait pas, mais qu'il ne détruit pas non
    // plus. Sans cet écart, un aller-retour de caméra détruirait et recréerait
    // les mêmes cartes à chaque image.
    expect(cardFate(card(2500, 400), windows, DRAWN)).toBe("none");
  });

  it("recycle ce qui est sorti largement", () => {
    expect(cardFate(card(4000, 4000), windows, DRAWN)).toBe("reclaim");
  });

  it("ne recycle JAMAIS une carte épinglée", () => {
    // La sélection et le geste en cours passent tous deux par `pinned` : la
    // carte sélectionnée doit rester dessinée où qu'elle aille, et détruire
    // celle qu'un drag tient tuerait les écouteurs du geste.
    expect(cardFate(card(4000, 4000), windows, { ...DRAWN, pinned: true })).toBe("none");
  });

  it("ne recycle rien quand il n'y a pas de caméra", () => {
    expect(cardFate(card(999_999, 999_999), cardWindowsFor(null), DRAWN)).toBe("none");
  });
});

/**
 * Le second calque cullé, et le plus cher de la scène : `drawEdgeHitAreas`
 * produit un Graphics INTERACTIF par référence résolue — des dizaines de
 * milliers sur un vrai jeu de données, tous poussés dans la passe de rendu et
 * dans le hit-testing alors qu'on ne peut viser que ceux à l'écran.
 */
describe("drawEdgeHitAreas — fenêtre", () => {
  const graph = buildGraph(shopData, shopConfig);
  // La seule référence résolue du fixture : /orders/0 → /customers/0, ici en
  // pile verticale, donc un segment de (80, 60) à (80, 300).
  const positions = new Map<NodeId, Rect>([
    ["/orders/0", { x: 0, y: 0, width: 160, height: 60 }],
    ["/customers/0", { x: 0, y: 300, width: 160, height: 60 }],
  ]);

  it("produit tout sans fenêtre — le comportement d'origine", () => {
    expect(drawEdgeHitAreas(graph, positions)).toHaveLength(1);
    expect(drawEdgeHitAreas(graph, positions, null)).toHaveLength(1);
  });

  it("garde une arête dont un bout est dans la fenêtre", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 0, width: 200, height: 100 })).toHaveLength(1);
  });

  it("garde une arête qui ne fait que TRAVERSER la fenêtre", () => {
    // Aucun bout dedans, mais le trait la coupe : l'écarter laisserait un trait
    // visible et inerte en travers de l'écran.
    expect(drawEdgeHitAreas(graph, positions, { x: 0, y: 150, width: 200, height: 20 })).toHaveLength(1);
  });

  it("écarte une arête entièrement hors de la fenêtre", () => {
    expect(drawEdgeHitAreas(graph, positions, { x: 5000, y: 5000, width: 100, height: 100 })).toHaveLength(0);
  });
});
