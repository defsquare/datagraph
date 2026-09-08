import {
  arrayTokenTextFor,
  type DataGraph,
  type GraphNode,
  type RefEdge,
} from "@defsquare/data-graph";
import { createBadge, createRefButton } from "@defsquare/data-graph-chrome";

/** Proof that the renderer's public "select" event is enough to build a detail
 * panel entirely outside the library: plain DOM, no library internals. */
export interface DetailPanel {
  render(node: GraphNode): void;
  clear(): void;
}

export function createDetailPanel(graph: DataGraph): DetailPanel {
  const detailEl = document.getElementById("detail");
  const emptyEl = document.getElementById("selection-empty");
  // The badge is a shared primitive: it is built here and inserted in place
  // rather than written into `index.html`, where it would be out of reach of the
  // design system catalogue.
  const typeEl = createBadge({ id: "selection-type" });
  emptyEl?.after(typeEl);
  const labelEl = document.getElementById("selection-label");
  const pathEl = document.getElementById("selection-path");
  const rowsEl = document.getElementById("selection-rows");

  /** The node's outgoing reference edges, indexed by source field — this is what
   * lets the panel put a "follow" button on the right rows, without knowing any
   * library internals. */
  function outgoingRefs(nodeId: string): Map<string, RefEdge> {
    const map = new Map<string, RefEdge>();
    for (const edge of graph.refEdges(nodeId)) map.set(edge.field, edge);
    return map;
  }

  function clear(): void {
    // The panel sits on top of the canvas: with no selection it has nothing to
    // say and disappears entirely rather than occupying the corner with a void.
    detailEl?.setAttribute("hidden", "");
    emptyEl?.removeAttribute("hidden");
    for (const el of [typeEl, labelEl, pathEl]) el?.setAttribute("hidden", "");
    rowsEl?.replaceChildren();
  }

  function render(node: GraphNode): void {
    detailEl?.removeAttribute("hidden");
    emptyEl?.setAttribute("hidden", "");
    for (const el of [labelEl, pathEl]) el?.removeAttribute("hidden");

    if (node.kind === "entity") {
      typeEl.textContent = node.entityType.toUpperCase();
      typeEl.removeAttribute("hidden");
    } else {
      typeEl.setAttribute("hidden", "");
    }
    if (labelEl) labelEl.textContent = node.label;
    if (pathEl) pathEl.textContent = node.path.length > 0 ? `/${node.path.join("/")}` : "/";

    if (!rowsEl) return;
    const refs = outgoingRefs(node.id);
    rowsEl.replaceChildren(
      ...node.rows.flatMap((row) => {
        const wrapper = document.createElement("div");
        wrapper.className = "row";

        const dt = document.createElement("dt");
        dt.textContent = row.key;
        const dd = document.createElement("dd");
        // An array row carries an ITEM COUNT, not a value from the document:
        // printing it as is would give "tags 3", which reads as the field's
        // value. The panel therefore reuses the card's wording.
        dd.textContent =
          row.valueType === "array" ? `[ ${arrayTokenTextFor(row.value)} ]` : String(row.value);
        wrapper.append(dt, dd);

        const ref = refs.get(row.key);
        if (ref) {
          const broken = ref.to === null || ref.dangling;
          const btn = createRefButton({
            title: broken
              ? `Référence cassée : ${ref.targetType}#${ref.targetId}`
              : `Aller à ${ref.targetType}#${ref.targetId}`,
            disabled: broken,
          });
          if (!broken) {
            btn.addEventListener("click", () => {
              graph.select(ref.to!);
              graph.focus(ref.to!);
            });
          }
          wrapper.append(btn);
        }
        return [wrapper];
      }),
    );
  }

  // The close button hides ONLY the panel: the graph's selection stands, and
  // reselecting the same node reopens it.
  document.getElementById("detail-close")?.addEventListener("click", () => {
    detailEl?.setAttribute("hidden", "");
  });

  return { render, clear };
}
