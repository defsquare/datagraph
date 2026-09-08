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

/** A minimal `FederatedPointerEvent`: `attachDrag` and `attachTap` read nothing
 * but the button and the global position. Fabricating the object rather than
 * running a real `EventSystem` keeps these tests free of canvas and WebGL — the
 * line `camera.test.ts` already follows for `WheelEvent`. */
function pointer(x: number, y: number, button = 0): FederatedPointerEvent {
  return { button, global: { x, y } } as unknown as FederatedPointerEvent;
}

/** Records what the hooks receive, so as to assert on the SEQUENCE of calls and
 * not merely on their count. */
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
    target.emit("globalpointermove", pointer(102, 102)); // 2.83 px
    target.emit("pointerup", pointer(102, 102));

    expect(rec.starts).toBe(0);
    expect(rec.moves).toEqual([]);
    // No `onEnd` either: nothing started, so there is nothing to end, and a
    // caller that restarts camera panning there would do so for a plain click.
    expect(rec.ends).toBe(0);
  });

  it("ne demarre pas EXACTEMENT au seuil", () => {
    // Complementarity with `attachTap` rests on this strict equality: tap ignores
    // gestures `> TAP_THRESHOLD`, drag only starts beyond it. At exactly 4 px, the
    // gesture must stay a tap, and nothing but a tap.
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
      // The first delta is measured from the PRESS POINT and not from the
      // threshold: the card ends up exactly under the cursor, without the 4 px
      // lag that counting from the crossing would leave.
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
    // At 0.5, one screen pixel is worth two world units: without the division,
    // the card would come off the cursor as soon as you leave zoom 1.
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
    // The scale is a hook and not a value frozen at attach time: a zoom mid-drag
    // (wheel in one hand, button in the other) must change the conversion
    // immediately.
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
    // The contract on `create.ts`'s side: `onMove` mutates the current view's
    // `Rect` IN PLACE. This test checks the threshold + scale + mutation
    // composition, which is all the renderer adds on top.
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

    // 10 screen px at 0.5 => 20 world units; then 10 px more on Y.
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
    // The move after the release no longer displaces anything.
    expect(rec.moves).toEqual([[20, 0]]);
  });

  it("termine sur pointerupoutside", () => {
    // Releasing outside the card is the NORMAL case of a fast drag: the pointer
    // leaves the card before the card has caught up with it. Without this
    // listener, the drag would stay armed and the camera pan inhibited.
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
    // The value `attachTap` sets on cards: it is the one we must find again at
    // the end, not a `null` that would erase the hand cursor.
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
  /** Replays a full gesture on a target wired like a card of the view:
   * `attachTap` first, `attachDrag` on top, exactly as `rebuild()` does. Returns
   * what each of the two saw. */
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
    // Pixi synthesizes `pointertap` after the `pointerup` when press and release
    // land on the same target — after a drag included.
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
    // The two guards are independent — `attachTap` compares from ITS
    // `pointerdown`, `attachDrag` from its own — but they read the same
    // threshold, so their domains partition the real line exactly.
    expect(gesture(10, 0)).toEqual({ taps: 0, drags: 1 });
  });
});

describe("recomputeClusterCircle", () => {
  const PADDING = 18;

  /** Three cards in a triangle, inside one aggregate. */
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

  /** The contract the envelope must hold at all times: contain all four corners
   * of every member card, padding included. This is what the engine guarantees on
   * the way out of layout, and therefore what moving a card must not break. */
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

    // We pull /b far to the right: the circle must follow, in center as in
    // radius.
    positions.get("/b")!.x += 600;
    recomputeClusterCircle(cluster, members, positions, PADDING);

    expect(encloses(cluster, [...positions.values()])).toBe(true);
    expect(cluster.r).toBeGreaterThan(before.r);
    expect(cluster.cx).toBeGreaterThan(before.cx);
  });

  it("se resserre quand la carte revient", () => {
    // The counterpart of the previous test: a circle that only ever grew would
    // leave an empty halo around the aggregate as soon as the card comes back.
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
    // `ClusterShape` is shared with `graphLayout.clusters`: the mutation is what
    // makes `clustersFor()` repaint the right shape on the next move.
    const { positions, members } = scene();
    const cluster = { cx: 1, cy: 2, r: 3 };
    const returned = recomputeClusterCircle(cluster, members, positions, PADDING);
    expect(returned).toBeUndefined();
    expect(cluster.r).not.toBe(3);
  });

  it("ignore les membres sans position", () => {
    // A member that is not visible has no rect: it must neither inflate the
    // envelope nor collapse it into NaNs.
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
    // Circle circumscribed around a 100-long segment: radius 50, plus the padding.
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
    // RIGID: the gesture moves the aggregate as a block, it does not deform it.
    // The radius is therefore intact, and there is nothing to recompute — unlike
    // moving a single card, which reshapes the envelope.
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
    // A member that is not visible has no rect: it must not bring the gesture
    // down, and there is nothing to translate for it.
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
  /** Reproduces `rebuild()`'s wiring: the grab container carries the drag,
   * `onMove` translates the cluster then realigns the container's position. This
   * composition is what we want to prove — threshold, scale, rigid translation
   * and a grab target that follows. */
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

    // 10 screen px at 0.5 => 20 world units, for the circle as for its cards.
    expect(cluster.cx).toBe(170);
    expect(cluster.r).toBe(180);
    expect(positions.get("/a")).toMatchObject({ x: 20, y: 0 });
    expect(positions.get("/b")).toMatchObject({ x: 220, y: 0 });
    // The grab area followed: the next gesture starts from the right place.
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
 * The tap on an envelope, which SELECTS the aggregate. It is the same split as on
 * cards — `attachTap` below the threshold, `attachDrag` beyond it — mounted here
 * on an envelope's grab target. What we want to hold: the two wirings do not step
 * on each other, and moving never selects along the way.
 */
describe("tap sur une enveloppe", () => {
  /** Reproduces `redrawClusterHitAreas()`'s wiring: drag, then tap, then the grab
   * cursor set back — that order is what gets tested below. */
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
    // Same strict equality as everywhere else: at exactly 4 px it is still a tap,
    // and `attachDrag` has started nothing.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(50 + TAP_THRESHOLD, 50));
    m.container.emit("pointertap", pointer(50 + TAP_THRESHOLD, 50));
    expect(m.selections).toBe(1);
    expect(m.moves).toBe(0);
  });

  it("ne selectionne pas quand le geste est devenu un deplacement", () => {
    // Without the shared threshold, moving an aggregate would also select it on
    // release — two gestures for the price of one.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(50 + TAP_THRESHOLD + 1, 50));
    m.container.emit("pointerup", pointer(50 + TAP_THRESHOLD + 1, 50));
    m.container.emit("pointertap", pointer(50 + TAP_THRESHOLD + 1, 50));
    expect(m.moves).toBeGreaterThan(0);
    expect(m.selections).toBe(0);
  });

  it("garde la main ouverte malgre attachTap", () => {
    // `attachTap` sets `"pointer"`: the wiring puts it back to `"grab"` right
    // after, because the disc's dominant gesture remains the grab. The ordering is
    // what makes that true, hence this test.
    expect(mount().container.cursor).toBe("grab");
  });

  it("restaure la main ouverte apres un deplacement", () => {
    // `attachDrag` captures the cursor when the threshold is crossed: it must
    // therefore find `"grab"` again, and not `attachTap`'s `"pointer"`.
    const m = mount();
    m.container.emit("pointerdown", pointer(50, 50));
    m.container.emit("globalpointermove", pointer(80, 50));
    expect(m.container.cursor).toBe("grabbing");
    m.container.emit("pointerup", pointer(80, 50));
    expect(m.container.cursor).toBe("grab");
  });
});

/**
 * The tap on the canvas BACKGROUND, which deselects. Two mechanisms share the
 * same void and the same button: the camera pan (native DOM listeners) and this
 * tap (Pixi federated events). What separates them is `TAP_THRESHOLD`, exactly as
 * between `attachTap` and `attachDrag`.
 */
describe("tap sur le fond de la toile", () => {
  /** Same minimalism as `pointer` above, plus the TARGET: that is what separates
   * a tap on the void from a tap bubbled up from a card. */
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
    // This is a canvas pan: it too ends with a `pointertap` on the background, and
    // without the threshold every move of the view would clear the selection.
    const m = mount();
    m.background.emit("pointerdown", tap(400, 300, m.background));
    m.background.emit("pointertap", tap(400 + TAP_THRESHOLD + 1, 300, m.background));
    expect(m.taps).toBe(0);
  });

  it("tolere le geste EXACTEMENT au seuil", () => {
    // Same strict equality as `attachTap`: at exactly 4 px it is still a tap.
    const m = mount();
    m.background.emit("pointerdown", tap(400, 300, m.background));
    m.background.emit("pointertap", tap(400 + TAP_THRESHOLD, 300, m.background));
    expect(m.taps).toBe(1);
  });

  it("ignore un tap remonte depuis une carte", () => {
    // A card's `pointertap` bubbles all the way to the background; without the
    // target check, every click would deselect right after selecting.
    const m = mount();
    const card = new Container();
    m.background.emit("pointerdown", tap(400, 300, card));
    m.background.emit("pointertap", tap(400, 300, card));
    expect(m.taps).toBe(0);
  });

  it("n'est atteint par le hit-testing que sur le vide", () => {
    // The dedicated layer's reason for being: Pixi's hit-testing INHERITS the
    // event mode on the way down. An `app.stage` switched to `"static"` would make
    // the least decorative Graphics interactive, and it would then swallow the
    // click of the card it covers. This test mounts exactly that scene — a
    // full-screen highlight ABOVE a card — and checks both answers: the card under
    // the decoration, the background on the void.
    // Pixi installs the federated event layer on `Container` only through its
    // browser extension, absent under vitest's Node environment: without this
    // mixin, `hitTestRecursive` fails on a nonexistent `isInteractive`. So we
    // mount the SAME layer as the one running in the browser, rather than
    // simulating one.
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
