import type { NodeId, RefEdge } from "@defsquare/data-graph-core";

/**
 * The opacity of a card or an edge with NO link to the selection.
 *
 * 0.25: low enough for the selection's neighbourhood to stand out at a glance in
 * the middle of hundreds of cards, high enough that the rest of the layout stays
 * readable — dimming is a reading guide, not a mask. Dimmed cards do stay
 * clickable, by the way: alpha changes nothing to Pixi's hit-testing, which is
 * geometric.
 *
 * The constant lives HERE, in a module nothing else pulls in, because it is shared by
 * the three parts of the effect: the cards (`applyFocusDim`, in `create.ts`), the
 * edges and the aggregate envelopes (`drawEdges` and `drawClusters`, in `draw.ts`).
 * Putting it in either of the two would force the other to import it — and `draw.ts`
 * importing `create.ts` would close a cycle, since `create.ts` already imports
 * `draw.ts`.
 *
 * The SAME factor everywhere, and not a per-layer setting: that is what makes the
 * dimming read as a single retreat of the backdrop rather than as three effects that
 * merely look alike. On an envelope it MULTIPLIES alphas that are already very low
 * (0.08 for the fill), which makes it practically disappear — and that is intended: a
 * translucent disc stays visible through its outline, and dimming it halfway would
 * leave the eye snagging on it.
 */
export const DIM_ALPHA = 0.25;

/**
 * The set of nodes to keep at full opacity around `focusId`: itself, BOTH ends of its
 * references (incoming as well as outgoing), its containment parent and its direct
 * children.
 *
 * Returning `null` means "no focus", and reads differently from the empty set: empty
 * would say "nobody is linked", hence "dim everything", whereas in that case nothing at
 * all must be dimmed. The caller handles both cases with a single expression (`keep ===
 * null || keep.has(id)`), which makes the absence of a selection impossible to confuse
 * with an isolated selection.
 *
 * The neighbourhood stops at DISTANCE 1. Following the chains further would grow the
 * set until it covered most of the graph, and a dimming that no longer tells anything
 * apart is of no use.
 *
 * BARE data as input — an array of edges, a parent, some children — rather than the
 * `Graph` and a `NodeId`: the function needs nothing else, and sticking to that makes
 * it testable without building a graph. `to === null` (broken reference) is ignored:
 * there is nobody at the far end.
 *
 * The SOURCE end of a reference is its declaring entity (`fromEntity`) and not the node
 * carrying the row: the neighbourhood is reasoned about between cards of the graph
 * view, where a value object does not exist as a card and where it really is the entity
 * that is "linked" to the target.
 */
export function relatedIds(
  refEdges: readonly RefEdge[],
  focusId: NodeId | null,
  parentId: NodeId | null,
  childIds: readonly NodeId[],
): Set<NodeId> | null {
  if (focusId === null) return null;
  const keep = new Set<NodeId>([focusId]);
  if (parentId !== null) keep.add(parentId);
  for (const childId of childIds) keep.add(childId);
  for (const edge of refEdges) {
    if (edge.to === null) continue;
    if (edge.fromEntity === focusId) keep.add(edge.to);
    else if (edge.to === focusId) keep.add(edge.fromEntity);
  }
  return keep;
}

/**
 * The set of nodes to keep at full opacity around a selected AGGREGATE: all of its
 * members, plus any outside card that has a reference with one of them, in either
 * direction.
 *
 * It is the counterpart of `relatedIds` for the graph view's other
 * selection unit, and it obeys the same distance-1 rule — except that the
 * "distance" is counted from the whole BLOCK and not from a card. The
 * aggregate being what the view shows as an object, the dimming must
 * answer the question one asks by pointing at it: "who talks to this
 * block?"
 *
 * No `null` return, unlike `relatedIds`: this is only called when an aggregate IS
 * selected. The absence of a selection stays carried by the caller, which then has no
 * reason to call.
 *
 * Same BARE data as input: edges and a set of ids, not the aggregate index nor the
 * graph. `to === null` (broken reference) is ignored — there is nobody at the far end,
 * hence nobody to keep full, and a broken reference is no longer traced in edge space
 * anyway: it signals itself on its source card.
 */
export function clusterRelatedIds(
  refEdges: readonly RefEdge[],
  memberIds: ReadonlySet<NodeId>,
): Set<NodeId> {
  const keep = new Set<NodeId>(memberIds);
  for (const edge of refEdges) {
    if (edge.to === null) continue;
    // `fromEntity` for the same reason as in `relatedIds`: the members of an aggregate
    // are entities, and a reference carried by a value object speaks on behalf of its
    // own.
    if (memberIds.has(edge.fromEntity)) keep.add(edge.to);
    else if (memberIds.has(edge.to)) keep.add(edge.fromEntity);
  }
  return keep;
}

/**
 * Should the envelope of an aggregate whose members are `memberIds` be dimmed?
 *
 * Yes iff NO member is in the set to keep full. The rule is the cards'
 * one, raised a notch: the envelope is the container, it recedes when
 * everything it holds has receded — and a single linked member is enough
 * to keep it full, because it is then the only thing showing WHERE that
 * member lives. The selected envelope falls into this case without
 * having to be handled apart: its members are, by construction, in the
 * set.
 *
 * `keep === null` (no selection) returns `false`: nothing to dim, as for cards and
 * edges. Same expression as at the other readers', so that the absence of a selection
 * cannot be confused with a selection whose set happens to be empty.
 */
export function clusterDimmed(
  keep: ReadonlySet<NodeId> | null,
  memberIds: Iterable<NodeId>,
): boolean {
  if (keep === null) return false;
  for (const id of memberIds) if (keep.has(id)) return false;
  return true;
}
