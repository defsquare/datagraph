import { describe, it, expect } from "vitest";
import {
  buildGraph,
  DEFAULT_METRICS,
  type DataGraphConfig,
  type Graph,
  type NodeId,
} from "@defsquare/datagraph-core";
import { createTreeViewController } from "../src/tree-view.js";

/**
 * The tree view's controller, WITHOUT Pixi and without an instance — the same
 * regime as `graph-view.test.ts`, and the reason both controllers are data
 * machines: what the e2e suite can only prove through a canvas is settled here on
 * bare values.
 *
 * A normalised document in miniature: two groups, three infractions claimed by
 * foreign key. It is `apps/demo/fixtures/sanctions.json`'s shape, small enough to
 * write every expected count out in full.
 */
const data = {
  groupes: [{ id: "G1", label: "Rencontre" }, { id: "G2", label: "Discipline" }],
  infractions: [
    { id: "I1", groupeId: "G1", code: "1.1" },
    { id: "I2", groupeId: "G1", code: "1.2" },
    { id: "I3", groupeId: "G2", code: "2.1" },
  ],
};

const config: DataGraphConfig = {
  ids: { Groupe: "$.groupes[*].id", Infraction: "$.infractions[*].id" },
  refs: [{ from: "$.infractions[*].groupeId", to: "$.groupes[*].id" }],
  groups: ["Groupe"],
};

/** A published controller, ready to be folded. `stale` is the host's generation
 * guard; `false` means "nothing superseded us". */
async function published() {
  const source = buildGraph(data, config);
  const view = createTreeViewController();
  view.publish(await view.compute(source, config, DEFAULT_METRICS));
  return { source, view };
}

const fresh = (): boolean => false;

/** The ids the view owes a rect: everything visible except the synthetic root and
 * the elided nodes, which are rows inside a card and never a card of their own.
 * Comparing that set to the positions map is what catches a layout left with
 * holes — the defect a collapse that dropped rects in place used to leave. */
function drawnIds(view: { visible(): Set<NodeId>; graph(): Graph | undefined }): NodeId[] {
  const graph = view.graph()!;
  return [...view.visible()].filter(
    (id) => id !== graph.rootId && graph.nodes.get(id)?.elided === false,
  );
}

describe("createTreeViewController", () => {
  it("publishes nothing until `publish` is called", async () => {
    const source = buildGraph(data, config);
    const view = createTreeViewController();
    const state = await view.compute(source, config, DEFAULT_METRICS);
    // `compute` never publishes: that split is what lets the host slot its
    // generation guard between the two (ADR-0024).
    expect(view.graph()).toBeUndefined();
    expect(view.positions()).toBeUndefined();
    view.publish(state);
    expect(view.graph()).toBeDefined();
  });

  it("opens fully expanded and draws no card for its synthetic root", async () => {
    const { source, view } = await published();
    // Every entity is visible — the tree lifts the entity boundary — plus the
    // synthetic root, which stays in the model for the collapse state and the
    // search index.
    expect(view.visible().size).toBe(6);
    expect(view.visible()).toContain(source.rootId);
    // ...and has no rect, so nothing can draw it: the host materialises cards
    // from the positions.
    expect(view.positions()!.has(source.rootId)).toBe(false);
    expect(view.positions()!.size).toBe(5);
  });

  it("drops the references it turned into parent links", async () => {
    const { source, view } = await published();
    // The three `groupeId` references ARE the tree's hierarchy: drawing them as
    // well would lay a dashed overlay exactly on top of every containment stroke.
    expect(source.refEdges).toHaveLength(3);
    expect(view.refEdgesToDraw()).toHaveLength(0);
  });

  it("lays the whole tree out again on a collapse, leaving no hole", async () => {
    const { view } = await published();
    const step = await view.collapse("/groupes/0", fresh);
    expect(step).not.toBeNull();
    // G1's two infractions vanish, and the tree is laid out again around the gap
    // they leave: every surviving card has a rect, and only the surviving cards
    // do. Dropping the subtree's rects in place would leave the rest spread over
    // the width the tree had before, which `fit()` would then frame as emptiness.
    expect(view.positions()!.has("/infractions/0")).toBe(false);
    expect(view.positions()!.has("/infractions/1")).toBe(false);
    expect(view.positions()!.has("/groupes/0")).toBe(true);
    expect([...view.positions()!.keys()].sort()).toEqual(drawnIds(view).sort());
    expect(step!.prevPositions.has("/infractions/0")).toBe(true);
    expect(step!.revealed).toEqual([]);
  });

  it("rolls a collapse back when the host says it was superseded", async () => {
    const { view } = await published();
    const before = view.positions()!;
    // Same rule as `expand`, now that a collapse awaits a global layout too.
    expect(await view.collapse("/groupes/0", () => true)).toBeNull();
    expect(view.isExpanded("/groupes/0")).toBe(true);
    expect(view.positions()).toBe(before);
  });

  it("lays the whole tree out again on an expand, and names what appeared", async () => {
    const { view } = await published();
    await view.collapse("/groupes/0", fresh);
    const step = await view.expand("/groupes/0", fresh);
    expect(step!.revealed.sort()).toEqual(["/infractions/0", "/infractions/1"]);
    expect(view.positions()!.has("/infractions/0")).toBe(true);
  });

  it("rolls its own mutation back when the host says it was superseded", async () => {
    const { view } = await published();
    await view.collapse("/groupes/0", fresh);
    const before = view.positions()!;
    // The host's guard turns true during the layout: the view must undo what it
    // mutated and publish nothing, or the collapse state gets ahead of the
    // positions and declares visible cards no rect carries.
    expect(await view.expand("/groupes/0", () => true)).toBeNull();
    expect(view.isExpanded("/groupes/0")).toBe(false);
    expect(view.positions()).toBe(before);
  });

  it("opens the path down to a hidden node, and does nothing when there is none", async () => {
    const { view } = await published();
    await view.collapse("/groupes/1", fresh);
    expect(view.visible().has("/infractions/2")).toBe(false);
    const step = await view.revealPathTo("/infractions/2", fresh);
    expect(step!.revealed).toContain("/infractions/2");
    // Already visible: nothing to open, hence no step and no layout paid for.
    expect(await view.revealPathTo("/infractions/2", fresh)).toBeNull();
  });

  it("has nothing to tidy: it never lays out incrementally", async () => {
    const { view } = await published();
    expect(await view.tidy(fresh)).toBeNull();
  });
});
