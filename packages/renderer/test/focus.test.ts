import { describe, it, expect } from "vitest";
import type { NodeId, RefEdge } from "@defsquare/datagraph-core";
import { clusterDimmed, clusterRelatedIds, DIM_ALPHA, relatedIds } from "../src/focus.js";

/** A bare reference edge: `relatedIds` reads nothing but `fromEntity`, `to` and
 * `dangling`, and building the object by hand keeps these tests independent of
 * the graph construction pipeline.
 *
 * `fromEntity` defaults to `from`, which is the invariant of any reference
 * declared without navigation: these cases therefore describe the unchanged
 * behavior, and lifting is tested separately, by pulling the two apart
 * explicitly. */
function ref(
  from: NodeId,
  to: NodeId | null,
  dangling = to === null,
  fromEntity: NodeId = from,
): RefEdge {
  return {
    kind: "ref",
    from,
    fromEntity,
    to,
    field: "someId",
    targetType: "T",
    targetId: "x",
    dangling,
  };
}

describe("relatedIds", () => {
  it("returns null when nothing is focused", () => {
    // `null` and not the empty set: the two read differently when applied. An
    // empty set would say "nobody is related", hence "dim everything"; `null`
    // says "no focus", hence "dim nothing".
    expect(relatedIds([ref("a", "b")], null, "p", ["c"])).toBeNull();
  });

  it("always holds the focused node itself", () => {
    expect(relatedIds([], "a", null, [])).toEqual(new Set(["a"]));
  });

  it("holds the targets of the outgoing references", () => {
    const edges = [ref("a", "b"), ref("a", "c")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b", "c"]));
  });

  it("holds the sources of the incoming references", () => {
    // A reference is DIRECTED, but the link it establishes is not: a card
    // pointing at the selection is as related to it as the one it points to.
    const edges = [ref("x", "a"), ref("y", "a")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "x", "y"]));
  });

  it("holds the parent and the direct children", () => {
    expect(relatedIds([], "a", "p", ["c1", "c2"])).toEqual(new Set(["a", "p", "c1", "c2"]));
  });

  it("ignores a dangling reference of the focused node", () => {
    // `to === null` is not a neighbor: there is nobody at the far end. Without
    // this guard, `null` would enter the set and match no card in it — harmless
    // but wrong.
    const keep = relatedIds([ref("a", null)], "a", null, []);
    expect(keep).toEqual(new Set(["a"]));
    expect(keep?.has(null as unknown as NodeId)).toBe(false);
  });

  it("leaves unrelated nodes out", () => {
    const edges = [ref("a", "b"), ref("x", "y")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b"]));
  });

  it("does not pull in a grandchild, only the direct children", () => {
    // The neighborhood is at DISTANCE 1: past that, dimming would no longer
    // single anything out, which is all we ask of it.
    expect(relatedIds([], "a", null, ["c"])).toEqual(new Set(["a", "c"]));
  });

  it("reads a reference's source end on its ENTITY, not on the value object", () => {
    // The reference is carried by `a/lines/0`, but it is declared by `a`: in
    // graph view `a/lines/0` has no card, and selecting `a` must keep at full
    // opacity the card its own line references.
    const edges = [ref("a/lines/0", "b", false, "a")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b"]));
    // And symmetrically from the target: `a` is what is related, not the line.
    expect(relatedIds(edges, "b", null, [])).toEqual(new Set(["b", "a"]));
  });
});

describe("clusterRelatedIds", () => {
  it("holds every member, even one with no reference at all", () => {
    // The aggregate is the designated unit: an isolated member belongs to it as
    // much as its root does, and dimming it would contradict the envelope drawn
    // around it.
    expect(clusterRelatedIds([], new Set(["m1", "m2"]))).toEqual(new Set(["m1", "m2"]));
  });

  it("holds an outside node targeted BY a member", () => {
    const keep = clusterRelatedIds([ref("m1", "out")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("holds an outside node that points AT a member", () => {
    // Same symmetry as for a card: a reference is directed, the link it
    // establishes is not.
    const keep = clusterRelatedIds([ref("out", "m1")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("ignores a dangling reference leaving a member", () => {
    // `to === null` designates nobody: nothing at the far end to keep full.
    const keep = clusterRelatedIds([ref("m1", null)], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1"]));
    expect(keep.has(null as unknown as NodeId)).toBe(false);
  });

  it("leaves out a node linked to nothing in the aggregate", () => {
    const edges = [ref("m1", "out"), ref("x", "y")];
    expect(clusterRelatedIds(edges, new Set(["m1"]))).toEqual(new Set(["m1", "out"]));
  });

  it("does not follow a second hop out of the aggregate", () => {
    // Distance 1 from the BLOCK, not from each neighbor: without that bound, the
    // set would end up covering most of the graph.
    const edges = [ref("m1", "out"), ref("out", "far")];
    expect(clusterRelatedIds(edges, new Set(["m1"]))).toEqual(new Set(["m1", "out"]));
  });

  it("counts a hoisted reference for its member entity", () => {
    // The aggregate's member is `m1`; the line `m1/lines/0` is not one and could
    // never be — membership only knows entities.
    const keep = clusterRelatedIds([ref("m1/lines/0", "out", false, "m1")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("does not mutate the member set it is given", () => {
    // The set we receive is the aggregate index's own (`Aggregate.memberIds`),
    // shared by all its readers: adding the neighbors to it would grow the
    // aggregate on every selection.
    const members = new Set(["m1"]);
    clusterRelatedIds([ref("m1", "out")], members);
    expect(members).toEqual(new Set(["m1"]));
  });

  it("returns the empty set for an aggregate with no members", () => {
    // No `null` returned here, unlike `relatedIds`: the absence of a selection is
    // the caller's business, and it then does not call at all. An empty set
    // therefore says "dim everything", which is correct.
    expect(clusterRelatedIds([ref("a", "b")], new Set())).toEqual(new Set());
  });
});

describe("clusterDimmed", () => {
  it("dims nothing without a selection", () => {
    // Same reading of `null` as everywhere else: "no focus", hence "dim nothing"
    // — and most definitely not "nobody is related".
    expect(clusterDimmed(null, ["m1", "m2"])).toBe(false);
  });

  it("keeps an envelope full when one of its members is related to the selection", () => {
    // ONE related member is enough: the envelope is then the only thing showing
    // where that member lives.
    expect(clusterDimmed(new Set(["m2"]), ["m1", "m2", "m3"])).toBe(false);
  });

  it("dims an envelope none of whose members is related", () => {
    expect(clusterDimmed(new Set(["x", "y"]), ["m1", "m2"])).toBe(true);
  });

  it("keeps the SELECTED envelope full without a special case", () => {
    // `clusterRelatedIds` starts from the members: they are therefore all in the
    // keep set, and the general rule is enough to leave the designated aggregate
    // undimmed.
    const members = new Set(["m1", "m2"]);
    const keep = clusterRelatedIds([ref("m1", "out")], members);
    expect(clusterDimmed(keep, members)).toBe(false);
  });

  it("dims an envelope with no members at all when a selection is active", () => {
    // Nothing in there to keep full: the empty set never meets the keep set. The
    // case should not exist (an aggregate has at least its root), but it must not
    // read as "no selection".
    expect(clusterDimmed(new Set(["a"]), [])).toBe(true);
    expect(clusterDimmed(null, [])).toBe(false);
  });

  it("accepts a Set of members as well as an array", () => {
    // The real caller passes `Aggregate.memberIds`, which is a Set; the tests
    // above pass arrays. Both must decide the same way.
    expect(clusterDimmed(new Set(["m1"]), new Set(["m1"]))).toBe(false);
    expect(clusterDimmed(new Set(["m1"]), new Set(["m2"]))).toBe(true);
  });
});

describe("DIM_ALPHA", () => {
  it("is a legible-but-clearly-receding opacity", () => {
    expect(DIM_ALPHA).toBeGreaterThan(0);
    expect(DIM_ALPHA).toBeLessThan(1);
  });
});
