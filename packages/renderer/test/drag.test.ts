import { describe, it, expect } from "vitest";
import {
  Container,
  EventBoundary,
  extensions,
  FederatedContainer,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
} from "pixi.js";
import type { NodeId, Rect } from "@defsquare/data-graph-core";
import { attachDrag, TAP_THRESHOLD } from "../src/drag.js";
import {
  attachTap,
  createBackgroundHit,
  recomputeClusterCircle,
  translateCluster,
} from "../src/create.js";
import { drawClusterHitAreas } from "../src/draw.js";

/** Un `FederatedPointerEvent` minimal : `attachDrag` et `attachTap` ne lisent
 * que le bouton et la position globale. Fabriquer l'objet plutôt que de faire
 * tourner un vrai `EventSystem` garde ces tests sans canvas ni WebGL — c'est
 * déjà la ligne suivie par `camera.test.ts` pour les `WheelEvent`. */
function pointer(x: number, y: number, button = 0): FederatedPointerEvent {
  return { button, global: { x, y } } as unknown as FederatedPointerEvent;
}

/** Enregistre ce que les hooks reçoivent, pour asserter sur la SÉQUENCE des
 * appels et pas seulement sur leur nombre. */
function recorder(scale = 1) {
  const moves: [number, number][] = [];
  let starts = 0;
  let ends = 0;
  return {
    moves,
    get starts() {
      return starts;
    },
    get ends() {
      return ends;
    },
    hooks: {
      scale: () => scale,
      onStart: () => {
        starts++;
      },
      onMove: (dx: number, dy: number) => {
        moves.push([dx, dy]);
      },
      onEnd: () => {
        ends++;
      },
    },
  };
}

describe("attachDrag — seuil", () => {
  it("ne demarre pas sous le seuil", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(100, 100));
    target.emit("globalpointermove", pointer(102, 102)); // 2,83 px
    target.emit("pointerup", pointer(102, 102));

    expect(rec.starts).toBe(0);
    expect(rec.moves).toEqual([]);
    // `onEnd` non plus : rien n'a commencé, il n'y a rien à terminer, et un
    // appelant qui y remet le pan de la caméra en route le ferait pour un
    // simple clic.
    expect(rec.ends).toBe(0);
  });

  it("ne demarre pas EXACTEMENT au seuil", () => {
    // La complementarite avec `attachTap` tient a cette egalite stricte : le
    // tap ignore les gestes `> TAP_THRESHOLD`, le drag ne demarre qu'au-dela.
    // A 4 px pile, le geste doit rester un tap et un seul.
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(100, 100));
    target.emit("globalpointermove", pointer(100 + TAP_THRESHOLD, 100));

    expect(rec.starts).toBe(0);
  });

  it("demarre au-dela du seuil, une seule fois", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(100, 100));
    target.emit("globalpointermove", pointer(110, 100));
    target.emit("globalpointermove", pointer(120, 100));

    expect(rec.starts).toBe(1);
    expect(rec.moves).toEqual([
      // Le premier delta est mesure depuis le POINT DE PRESSION et non depuis
      // le seuil : la carte se retrouve exactement sous le curseur, sans le
      // retard de 4 px qu'un comptage a partir du franchissement laisserait.
      [10, 0],
      [10, 0],
    ]);
  });

  it("ignore un bouton autre que le gauche", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(100, 100, 2));
    target.emit("globalpointermove", pointer(200, 100));

    expect(rec.starts).toBe(0);
    expect(rec.moves).toEqual([]);
  });

  it("ignore un mouvement sans pression prealable", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("globalpointermove", pointer(200, 100));

    expect(rec.moves).toEqual([]);
  });
});

describe("attachDrag — conversion ecran vers monde", () => {
  it("divise les deltas par l'echelle de la camera", () => {
    // A 0,5, un pixel ecran vaut deux unites monde : sans la division, la carte
    // decrocherait du curseur des qu'on quitte le zoom 1.
    const target = new Container();
    const rec = recorder(0.5);
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(10, 0));
    target.emit("globalpointermove", pointer(10, 6));

    expect(rec.moves).toEqual([
      [20, 0],
      [0, 12],
    ]);
  });

  it("relit l'echelle a chaque mouvement", () => {
    // L'echelle est un hook et non une valeur figee a l'attache : un zoom en
    // cours de drag (molette d'une main, bouton de l'autre) doit changer la
    // conversion immediatement.
    const target = new Container();
    const moves: [number, number][] = [];
    let scale = 1;
    attachDrag(target, { scale: () => scale, onMove: (dx, dy) => moves.push([dx, dy]) });

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(10, 0));
    scale = 2;
    target.emit("globalpointermove", pointer(20, 0));

    expect(moves).toEqual([
      [10, 0],
      [5, 0],
    ]);
  });
});

describe("attachDrag — la position suit le geste", () => {
  it("mute le rect de la carte dans la map de positions", () => {
    // Le contrat cote `create.ts` : `onMove` mute EN PLACE le `Rect` de la vue
    // courante. Ce test verifie la composition seuil + echelle + mutation, qui
    // est tout ce que le renderer ajoute par-dessus.
    const positions = new Map<NodeId, Rect>([["/a", { x: 100, y: 50, width: 200, height: 80 }]]);
    const target = new Container();
    attachDrag(target, {
      scale: () => 0.5,
      onMove: (dx, dy) => {
        const rect = positions.get("/a")!;
        rect.x += dx;
        rect.y += dy;
      },
    });

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(10, 10));
    target.emit("globalpointermove", pointer(10, 20));
    target.emit("pointerup", pointer(10, 20));

    // 10 px ecran a 0,5 => 20 unites monde ; puis 10 px de plus en Y.
    expect(positions.get("/a")).toEqual({ x: 120, y: 90, width: 200, height: 80 });
  });
});

describe("attachDrag — fin du geste", () => {
  it("termine sur pointerup", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(20, 0));
    target.emit("pointerup", pointer(20, 0));
    target.emit("globalpointermove", pointer(40, 0));

    expect(rec.ends).toBe(1);
    // Le mouvement d'apres le relachement ne deplace plus rien.
    expect(rec.moves).toEqual([[20, 0]]);
  });

  it("termine sur pointerupoutside", () => {
    // Relacher hors de la carte est le cas NORMAL d'un drag rapide : le
    // pointeur sort de la carte avant qu'elle ne l'ait rattrapee. Sans cet
    // ecouteur, le drag resterait arme et le pan de la camera inhibe.
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(20, 0));
    target.emit("pointerupoutside", pointer(400, 400));
    target.emit("globalpointermove", pointer(40, 0));

    expect(rec.ends).toBe(1);
    expect(rec.moves).toEqual([[20, 0]]);
  });

  it("un second geste redemarre proprement", () => {
    const target = new Container();
    const rec = recorder();
    attachDrag(target, rec.hooks);

    target.emit("pointerdown", pointer(0, 0));
    target.emit("globalpointermove", pointer(20, 0));
    target.emit("pointerup", pointer(20, 0));

    target.emit("pointerdown", pointer(100, 100));
    target.emit("globalpointermove", pointer(100, 130));
    target.emit("pointerup", pointer(100, 130));

    expect(rec.starts).toBe(2);
    expect(rec.ends).toBe(2);
    expect(rec.moves).toEqual([
      [20, 0],
      [0, 30],
    ]);
  });
});

describe("attachDrag — curseur", () => {
  it("passe en grabbing pendant le drag et restaure ensuite", () => {
    const target = new Container();
    // La valeur posee par `attachTap` sur les cartes : c'est elle qu'il faut
    // retrouver a la fin, pas un `null` qui effacerait le curseur main.
    target.cursor = "pointer";
    attachDrag(target, { scale: () => 1, onMove: () => {} });

    target.emit("pointerdown", pointer(0, 0));
    expect(target.cursor).toBe("pointer");
    target.emit("globalpointermove", pointer(20, 0));
    expect(target.cursor).toBe("grabbing");
    target.emit("pointerup", pointer(20, 0));
    expect(target.cursor).toBe("pointer");
  });
});

describe("attachDrag et attachTap sont complementaires", () => {
  /** Rejoue un geste complet sur une cible cablee comme une carte de la vue :
   * `attachTap` d'abord, `attachDrag` par-dessus, exactement comme `rebuild()`.
   * Retourne ce que chacun des deux a vu. */
  function gesture(dx: number, dy: number): { taps: number; drags: number } {
    const target = new Container();
    let taps = 0;
    let drags = 0;
    attachTap(target, () => {
      taps++;
    });
    attachDrag(target, { scale: () => 1, onStart: () => drags++, onMove: () => {} });

    target.emit("pointerdown", pointer(100, 100));
    target.emit("globalpointermove", pointer(100 + dx, 100 + dy));
    target.emit("pointerup", pointer(100 + dx, 100 + dy));
    // Pixi synthetise `pointertap` apres le `pointerup` quand la pression et le
    // relachement tombent sur la meme cible — y compris apres un drag.
    target.emit("pointertap", pointer(100 + dx, 100 + dy));
    return { taps, drags };
  }

  it("un geste immobile est un tap et rien d'autre", () => {
    expect(gesture(0, 0)).toEqual({ taps: 1, drags: 0 });
  });

  it("un geste sous le seuil reste un tap", () => {
    expect(gesture(3, 0)).toEqual({ taps: 1, drags: 0 });
  });

  it("un geste au-dela du seuil est un drag et n'est plus un tap", () => {
    // Les deux gardes sont independantes — `attachTap` compare depuis SON
    // `pointerdown`, `attachDrag` depuis le sien — mais elles lisent le meme
    // seuil, donc leurs domaines se partagent exactement la droite reelle.
    expect(gesture(10, 0)).toEqual({ taps: 0, drags: 1 });
  });
});

describe("recomputeClusterCircle", () => {
  const PADDING = 18;

  /** Trois cartes en triangle, dans un agregat. */
  function scene(): { positions: Map<NodeId, Rect>; members: NodeId[] } {
    return {
      positions: new Map<NodeId, Rect>([
        ["/a", { x: 0, y: 0, width: 100, height: 40 }],
        ["/b", { x: 200, y: 0, width: 100, height: 40 }],
        ["/c", { x: 100, y: 200, width: 100, height: 40 }],
      ]),
      members: ["/a", "/b", "/c"],
    };
  }

  /** Le contrat que l'enveloppe doit tenir a tout instant : contenir les quatre
   * coins de chaque carte membre, marge comprise. C'est ce que le moteur
   * garantit a la sortie du layout, et donc ce que le deplacement d'une carte
   * ne doit pas casser. */
  function encloses(circle: { cx: number; cy: number; r: number }, rects: Rect[]): boolean {
    return rects.every((rect) =>
      [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x + rect.width, rect.y + rect.height],
        [rect.x, rect.y + rect.height],
      ].every(([x, y]) => Math.hypot(x! - circle.cx, y! - circle.cy) <= circle.r + 1e-6),
    );
  }

  it("englobe toujours tous les membres apres le deplacement de l'un d'eux", () => {
    const { positions, members } = scene();
    const cluster = { cx: 0, cy: 0, r: 0 };
    recomputeClusterCircle(cluster, members, positions, PADDING);
    const before = { ...cluster };

    // On tire /b loin vers la droite : le cercle doit suivre, en centre comme
    // en rayon.
    positions.get("/b")!.x += 600;
    recomputeClusterCircle(cluster, members, positions, PADDING);

    expect(encloses(cluster, [...positions.values()])).toBe(true);
    expect(cluster.r).toBeGreaterThan(before.r);
    expect(cluster.cx).toBeGreaterThan(before.cx);
  });

  it("se resserre quand la carte revient", () => {
    // Le pendant du test precedent : un cercle qui ne ferait que croitre
    // laisserait une aureole vide autour de l'agregat des qu'on ramene la carte.
    const { positions, members } = scene();
    const cluster = { cx: 0, cy: 0, r: 0 };
    recomputeClusterCircle(cluster, members, positions, PADDING);
    const tight = cluster.r;

    positions.get("/b")!.x += 600;
    recomputeClusterCircle(cluster, members, positions, PADDING);
    positions.get("/b")!.x -= 600;
    recomputeClusterCircle(cluster, members, positions, PADDING);

    expect(cluster.r).toBeCloseTo(tight, 6);
  });

  it("mute l'objet en place plutot que d'en rendre un nouveau", () => {
    // `ClusterShape` est partage avec `graphLayout.clusters` : c'est la mutation
    // qui fait que `clustersFor()` repeint la bonne forme au mouvement suivant.
    const { positions, members } = scene();
    const cluster = { cx: 1, cy: 2, r: 3 };
    const returned = recomputeClusterCircle(cluster, members, positions, PADDING);
    expect(returned).toBeUndefined();
    expect(cluster.r).not.toBe(3);
  });

  it("ignore les membres sans position", () => {
    // Un membre non visible n'a pas de rect : il ne doit ni gonfler l'enveloppe
    // ni la faire tomber sur des NaN.
    const { positions } = scene();
    const cluster = { cx: 0, cy: 0, r: 0 };
    recomputeClusterCircle(cluster, ["/a", "/b", "/c", "/absent"], positions, PADDING);
    expect(Number.isFinite(cluster.r)).toBe(true);
    expect(encloses(cluster, [...positions.values()])).toBe(true);
  });

  it("applique la marge", () => {
    const positions = new Map<NodeId, Rect>([["/a", { x: 0, y: 0, width: 100, height: 0 }]]);
    const cluster = { cx: 0, cy: 0, r: 0 };
    recomputeClusterCircle(cluster, ["/a"], positions, PADDING);
    // Cercle circonscrit d'un segment de 100 : rayon 50, plus la marge.
    expect(cluster.r).toBeCloseTo(50 + PADDING, 6);
  });
});

describe("translateCluster", () => {
  function scene(): { positions: Map<NodeId, Rect>; members: NodeId[] } {
    return {
      positions: new Map<NodeId, Rect>([
        ["/a", { x: 0, y: 0, width: 100, height: 40 }],
        ["/b", { x: 200, y: 0, width: 100, height: 40 }],
      ]),
      members: ["/a", "/b"],
    };
  }

  it("translate le cercle et toutes ses cartes du meme delta", () => {
    // RIGIDE : le geste deplace l'agregat en bloc, il ne le deforme pas. Le
    // rayon est donc intact, et il n'y a rien a recalculer — a la difference du
    // deplacement d'une carte seule, qui rebat l'enveloppe.
    const { positions, members } = scene();
    const cluster = { cx: 150, cy: 20, r: 180 };

    translateCluster(cluster, members, positions, 30, -10);

    expect(cluster).toEqual({ cx: 180, cy: 10, r: 180 });
    expect(positions.get("/a")).toEqual({ x: 30, y: -10, width: 100, height: 40 });
    expect(positions.get("/b")).toEqual({ x: 230, y: -10, width: 100, height: 40 });
  });

  it("se cumule d'un mouvement a l'autre", () => {
    const { positions, members } = scene();
    const cluster = { cx: 150, cy: 20, r: 180 };

    translateCluster(cluster, members, positions, 10, 0);
    translateCluster(cluster, members, positions, 5, 5);

    expect(cluster.cx).toBe(165);
    expect(cluster.cy).toBe(25);
    expect(positions.get("/a")).toMatchObject({ x: 15, y: 5 });
  });

  it("ignore un membre sans position", () => {
    // Un membre non visible n'a pas de rect : il ne doit pas faire tomber le
    // geste, et il n'y a rien a translater pour lui.
    const { positions } = scene();
    const cluster = { cx: 150, cy: 20, r: 180 };

    expect(() => translateCluster(cluster, ["/a", "/absent"], positions, 10, 10)).not.toThrow();
    expect(positions.get("/a")).toMatchObject({ x: 10, y: 10 });
    expect(positions.size).toBe(2);
  });

  it("mute en place plutot que de rendre un nouvel objet", () => {
    const { positions, members } = scene();
    const cluster = { cx: 0, cy: 0, r: 5 };
    const rect = positions.get("/a")!;
    expect(translateCluster(cluster, members, positions, 1, 1)).toBeUndefined();
    expect(positions.get("/a")).toBe(rect);
  });
});

describe("drag d'une enveloppe", () => {
  /** Reproduit le cablage de `rebuild()` : le container de saisie porte le
   * drag, `onMove` translate le cluster puis recale la position du container.
   * C'est la composition qu'on veut prouver — seuil, echelle, translation
   * rigide et cible de saisie qui suit. */
  function mount(scale: number) {
    const positions = new Map<NodeId, Rect>([
      ["/a", { x: 0, y: 0, width: 100, height: 40 }],
      ["/b", { x: 200, y: 0, width: 100, height: 40 }],
    ]);
    const cluster = { cx: 150, cy: 20, r: 180 };
    const { container } = drawClusterHitAreas([cluster])[0]!;
    attachDrag(container, {
      scale: () => scale,
      onMove: (dx, dy) => {
        translateCluster(cluster, ["/a", "/b"], positions, dx, dy);
        container.position.set(cluster.cx, cluster.cy);
      },
    });
    return { positions, cluster, container };
  }

  it("deplace le bloc et sa cible de saisie", () => {
    const { positions, cluster, container } = mount(0.5);

    container.emit("pointerdown", pointer(0, 0));
    container.emit("globalpointermove", pointer(10, 0));
    container.emit("pointerup", pointer(10, 0));

    // 10 px ecran a 0,5 => 20 unites monde, pour le cercle comme pour ses
    // cartes.
    expect(cluster.cx).toBe(170);
    expect(cluster.r).toBe(180);
    expect(positions.get("/a")).toMatchObject({ x: 20, y: 0 });
    expect(positions.get("/b")).toMatchObject({ x: 220, y: 0 });
    // La zone de saisie a suivi : le geste suivant part du bon endroit.
    expect(container.position.x).toBe(170);
    expect(container.position.y).toBe(20);
  });

  it("un tap sous le seuil ne bouge rien", () => {
    const { positions, cluster, container } = mount(1);

    container.emit("pointerdown", pointer(100, 100));
    container.emit("globalpointermove", pointer(103, 100));
    container.emit("pointerup", pointer(103, 100));

    expect(cluster).toEqual({ cx: 150, cy: 20, r: 180 });
    expect(positions.get("/a")).toMatchObject({ x: 0, y: 0 });
  });
});

/**
 * Le tap sur une enveloppe, qui SÉLECTIONNE l'agrégat. C'est le même partage que
 * sur les cartes — `attachTap` en deçà du seuil, `attachDrag` au-delà —, monté
 * ici sur la cible de saisie d'une enveloppe. Ce qu'on veut tenir : les deux
 * câblages ne se marchent pas dessus, et le déplacement ne sélectionne jamais en
 * passant.
 */
describe("tap sur une enveloppe", () => {
  /** Reproduit le câblage de `redrawClusterHitAreas()` : drag, puis tap, puis
   * le curseur de saisie reposé — c'est cet ordre qui est testé plus bas. */
  function mount() {
    let selections = 0;
    let moves = 0;
    const { container } = drawClusterHitAreas([{ cx: 0, cy: 0, r: 100 }])[0]!;
    attachDrag(container, {
      scale: () => 1,
      onMove: () => {
        moves++;
      },
    });
    attachTap(container, () => {
      selections++;
    });
    container.cursor = "grab";
    return {
      container,
      get selections() {
        return selections;
      },
      get moves() {
        return moves;
      },
    };
  }

  it("selectionne l'agregat sur un clic net", () => {
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("pointertap", pointer(50, 50));
    expect(m.selections).toBe(1);
    expect(m.moves).toBe(0);
  });

  it("tolere le geste EXACTEMENT au seuil", () => {
    // Même égalité stricte que partout ailleurs : à 4 px pile, c'est encore un
    // tap, et `attachDrag` n'a rien démarré.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(50 + TAP_THRESHOLD, 50));
    m.container.emit("pointertap", pointer(50 + TAP_THRESHOLD, 50));
    expect(m.selections).toBe(1);
    expect(m.moves).toBe(0);
  });

  it("ne selectionne pas quand le geste est devenu un deplacement", () => {
    // Sans le seuil partagé, déplacer un agrégat le sélectionnerait aussi au
    // relâchement — deux gestes pour le prix d'un.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(50 + TAP_THRESHOLD + 1, 50));
    m.container.emit("pointerup", pointer(50 + TAP_THRESHOLD + 1, 50));
    m.container.emit("pointertap", pointer(50 + TAP_THRESHOLD + 1, 50));
    expect(m.moves).toBeGreaterThan(0);
    expect(m.selections).toBe(0);
  });

  it("garde la main ouverte malgre attachTap", () => {
    // `attachTap` pose `"pointer"` : le câblage la repose en `"grab"` juste
    // après, parce que le geste dominant du disque reste la saisie. L'ordre est
    // ce qui le rend vrai, d'où ce test.
    expect(mount().container.cursor).toBe("grab");
  });

  it("restaure la main ouverte apres un deplacement", () => {
    // `attachDrag` capture le curseur au franchissement du seuil : il doit donc
    // retrouver `"grab"` et pas le `"pointer"` d'`attachTap`.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(80, 50));
    expect(m.container.cursor).toBe("grabbing");
    m.container.emit("pointerup", pointer(80, 50));
    expect(m.container.cursor).toBe("grab");
  });
});

/**
 * Le tap sur le FOND de la toile, qui désélectionne. Deux mécanismes se
 * partagent le même vide et le même bouton : le pan de la caméra (écouteurs DOM
 * natifs) et ce tap-ci (événements fédérés Pixi). Ce qui les départage est le
 * seuil de `TAP_THRESHOLD`, exactement comme entre `attachTap` et `attachDrag`.
 */
describe("tap sur le fond de la toile", () => {
  /** Même minimalisme que `pointer` ci-dessus, plus la CIBLE : c'est elle qui
   * distingue un tap sur le vide d'un tap remonté depuis une carte. */
  function tap(x: number, y: number, target: Container): FederatedPointerEvent {
    return { button: 0, global: { x, y }, target } as unknown as FederatedPointerEvent;
  }

  function mount() {
    let taps = 0;
    const background = createBackgroundHit(new Rectangle(0, 0, 800, 600), () => {
      taps++;
    });
    return {
      background,
      get taps() {
        return taps;
      },
    };
  }

  it("desélectionne sur un vrai tap du vide", () => {
    const m = mount();
    m.background.emit("pointerdown", tap(400, 300, m.background));
    m.background.emit("pointertap", tap(400, 300, m.background));
    expect(m.taps).toBe(1);
  });

  it("ne desélectionne pas quand le geste a depasse le seuil", () => {
    // C'est un pan de la toile : il finit lui aussi par un `pointertap` sur le
    // fond, et sans le seuil chaque déplacement de la vue viderait la
    // sélection.
    const m = mount();
    m.background.emit("pointerdown", tap(400, 300, m.background));
    m.background.emit("pointertap", tap(400 + TAP_THRESHOLD + 1, 300, m.background));
    expect(m.taps).toBe(0);
  });

  it("tolere le geste EXACTEMENT au seuil", () => {
    // Même égalité stricte que `attachTap` : à 4 px pile, c'est encore un tap.
    const m = mount();
    m.background.emit("pointerdown", tap(400, 300, m.background));
    m.background.emit("pointertap", tap(400 + TAP_THRESHOLD, 300, m.background));
    expect(m.taps).toBe(1);
  });

  it("ignore un tap remonte depuis une carte", () => {
    // Le `pointertap` d'une carte remonte jusqu'au fond ; sans le test de
    // cible, tout clic désélectionnerait juste après avoir sélectionné.
    const m = mount();
    const card = new Container();
    m.background.emit("pointerdown", tap(400, 300, card));
    m.background.emit("pointertap", tap(400, 300, card));
    expect(m.taps).toBe(0);
  });

  it("n'est atteint par le hit-testing que sur le vide", () => {
    // La raison d'être du calque dédié : le hit-testing de Pixi HÉRITE le mode
    // d'événement en descendant. Un `app.stage` passé en `"static"` rendrait
    // interactif le moindre Graphics décoratif, qui avalerait alors le clic de
    // la carte qu'il recouvre. Ce test monte exactement cette scène — un
    // surlignage plein écran AU-DESSUS d'une carte — et vérifie les deux
    // réponses : la carte sous le décor, le fond sur le vide.
    // Pixi n'installe la couche d'événements fédérés sur `Container` que via
    // son extension de navigateur, absente sous l'environnement Node de
    // vitest : sans ce mixin, `hitTestRecursive` échoue sur un
    // `isInteractive` inexistant. On monte donc la MÊME couche que celle qui
    // tourne dans le navigateur, plutôt que d'en simuler une.
    extensions.mixin(Container, FederatedContainer);

    const stage = new Container();
    stage.addChild(createBackgroundHit(new Rectangle(0, 0, 800, 600), () => {}));
    const background = stage.children[0]!;

    const world = new Container();
    const card = new Container();
    card.eventMode = "static";
    card.hitArea = new Rectangle(100, 100, 200, 60);
    const decoration = new Graphics().rect(0, 0, 800, 600).fill("#ffffff");
    world.addChild(card, decoration);
    stage.addChild(world);

    const boundary = new EventBoundary(stage);
    expect(boundary.hitTest(150, 120)).toBe(card);
    expect(boundary.hitTest(600, 500)).toBe(background);
  });
});
