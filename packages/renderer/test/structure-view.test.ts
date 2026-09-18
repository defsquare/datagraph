import { describe, it, expect } from "vitest";
import {
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type Graph,
  type NodeId,
  type Rect,
} from "@defsquare/datagraph-core";
import { createStructureViewController } from "../src/structure-view.js";
import { shopData, shopConfig } from "./fixtures.js";

/**
 * The structure view's controller, WITHOUT Pixi and without an instance — the
 * same regime as `tree-view.test.ts` and `graph-view.test.ts`. What the e2e suite
 * can only prove through a canvas (`structure-scale`, `tidy`, `reveal-camera`,
 * `array-token`) is settled here on bare values.
 *
 * The ELK is the in-process one: no `elkFactory` is injected, which is exactly
 * the path the renderer falls back to when the host supplies no worker URL.
 */

/** A published controller, ready to be folded. */
async function published(data: unknown = shopData, config: DataGraphConfig = shopConfig) {
  const source = buildGraph(data, config);
  const view = createStructureViewController();
  view.publish(await view.compute(source, config, DEFAULT_METRICS));
  return { source, view };
}

/** The host's generation guard; `false` means "nothing superseded us". */
const fresh = (): boolean => false;

/** The ids the view owes a rect: everything visible except the elided nodes,
 * which are rows inside a card and never a card of their own. */
function drawnIds(view: { visible(): Set<NodeId>; graph(): Graph | undefined }): NodeId[] {
  const graph = view.graph()!;
  return [...view.visible()].filter((id) => graph.nodes.get(id)?.elided === false);
}

/** A detached copy of the positions: the controller mutates its layout in place,
 * so a live map would follow the gesture we are comparing against. */
function snapshot(positions: Map<NodeId, Rect>): Map<NodeId, Rect> {
  return new Map([...positions].map(([id, r]) => [id, { ...r }]));
}

/** 150 customers, hence two pages of card children (`PAGE_SIZE` is 100): the one
 * shape `shopData` cannot produce, and the only one a remainder token exists for. */
const pagedData = {
  customers: Array.from({ length: 150 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}` })),
};
const pagedConfig: DataGraphConfig = { ids: { Customer: "$.customers[*].id" } };

describe("createStructureViewController", () => {
  it("publishes nothing until `publish` is called", async () => {
    const source = buildGraph(shopData, shopConfig);
    const view = createStructureViewController();
    const state = await view.compute(source, shopConfig, DEFAULT_METRICS);
    expect(view.graph()).toBeUndefined();
    expect(view.positions()).toBeUndefined();
    expect(view.searchIndex()).toBeUndefined();
    view.publish(state);
    expect(view.graph()).toBe(source);
    expect(view.searchIndex()).toBeDefined();
  });

  it("lays out exactly the visible drawn nodes, and draws every reference", async () => {
    const { source, view } = await published();
    expect([...view.positions()!.keys()].sort()).toEqual(drawnIds(view).sort());
    // This view consumes no reference into its hierarchy: the JSON's own nesting
    // is the hierarchy.
    expect(view.refEdgesToDraw()).toBe(source.refEdges);
    expect(view.policy(0).flow).toBe("right");
  });

  it("expands a node and names what appeared", async () => {
    const { view } = await published();
    await view.collapse("/customers/0", fresh);
    expect(view.visible().has("/customers/0/address")).toBe(false);

    const step = await view.expand("/customers/0", fresh);
    expect(step!.revealed).toEqual(["/customers/0/address"]);
    expect(view.positions()!.has("/customers/0/address")).toBe(true);
    // The anchor keeps its place and the subtree opens BESIDE it: that is the
    // incremental engine's contract, and the reason a fold is cheap here.
    const anchor = step!.prevPositions.get("/customers/0")!;
    expect(view.positions()!.get("/customers/0")).toEqual(anchor);
    expect(view.positions()!.get("/customers/0/address")!.x).toBeGreaterThan(
      anchor.x + anchor.width,
    );
  });

  it("rolls its own mutation back when the host says it was superseded", async () => {
    const { view } = await published();
    await view.collapse("/customers/0", fresh);
    const before = snapshot(view.positions()!);

    expect(await view.expand("/customers/0", () => true)).toBeNull();
    expect(view.isExpanded("/customers/0")).toBe(false);
    expect(view.positions()).toEqual(before);
  });

  it("undoes the expansion's delta on a collapse", async () => {
    const { view } = await published();
    await view.collapse("/customers/0", fresh);
    const before = snapshot(view.positions()!);

    await view.expand("/customers/0", fresh);
    const step = await view.collapse("/customers/0", fresh);

    expect(step!.revealed).toEqual([]);
    expect(view.positions()!.size).toBe(before.size);
    for (const [id, rect] of before) {
      expect(view.positions()!.get(id)!.y).toBeCloseTo(rect.y, 5);
    }
  });

  it("reveals a page of card children, and places the token of the rest in the column", async () => {
    const { view } = await published(pagedData, pagedConfig);
    // The first page only: the initial expansion buys 100 of the 150 cards.
    expect(view.positions()!.has("/customers/99")).toBe(true);
    expect(view.positions()!.has("/customers/100")).toBe(false);

    const [token] = view.remainderTokens();
    expect(token).toMatchObject({ parentId: "/customers", page: 1, count: 50 });
    // The column's placement: same x as the card it hooks onto, below it.
    const anchor = view.positions()!.get("/customers/99")!;
    expect(token!.x).toBe(anchor.x);
    expect(token!.width).toBe(anchor.width);
    expect(token!.y).toBeGreaterThan(anchor.y + anchor.height);

    const step = await view.reveal("/customers", 1, fresh);
    expect(step!.revealed).toContain("/customers/149");
    expect(view.positions()!.has("/customers/100")).toBe(true);
    expect(view.remainderTokens()).toEqual([]);
    // Nothing to reveal twice.
    expect(await view.reveal("/customers", 1, fresh)).toBeNull();
  });

  it("rolls a reveal back when the host says it was superseded", async () => {
    const { view } = await published(pagedData, pagedConfig);
    const before = snapshot(view.positions()!);
    expect(await view.reveal("/customers", 1, () => true)).toBeNull();
    expect(view.visible().has("/customers/100")).toBe(false);
    expect(view.positions()).toEqual(before);
  });

  it("opens every ancestor on the path down to a hidden node", async () => {
    const { view } = await published();
    await view.collapse("/orders/0/lines", fresh);
    await view.collapse("/orders/0", fresh);
    expect(view.visible().has("/orders/0/lines/0")).toBe(false);

    const step = await view.revealPathTo("/orders/0/lines/0", fresh);
    expect(step!.revealed).toContain("/orders/0/lines/0");
    expect(view.isExpanded("/orders/0")).toBe(true);
    expect(view.isExpanded("/orders/0/lines")).toBe(true);
    expect(view.positions()!.has("/orders/0/lines/0")).toBe(true);
    // Already visible: nothing left to open.
    expect(await view.revealPathTo("/orders/0/lines/0", fresh)).toBeNull();
  });

  it("repairs the incremental drift on a tidy, and publishes nothing when superseded", async () => {
    const { view } = await published();
    await view.collapse("/customers/0", fresh);
    await view.expand("/customers/0", fresh);

    expect(await view.tidy(() => true)).toBeNull();

    const before = snapshot(view.positions()!);
    const step = await view.tidy(fresh);
    expect(step!.revealed).toEqual([]);
    expect(step!.prevPositions).toEqual(before);
    // A GLOBAL arrangement: every drawn node placed, none left over.
    expect([...view.positions()!.keys()].sort()).toEqual(drawnIds(view).sort());
  });
});
