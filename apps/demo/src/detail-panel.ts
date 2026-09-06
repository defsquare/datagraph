import {
  arrayTokenTextFor,
  type DataGraph,
  type GraphNode,
  type RefEdge,
} from "@defsquare/data-graph";

/** Preuve que l'événement public « select » du renderer suffit à construire un
 * panneau de détail entièrement hors de la bibliothèque : du DOM nu, aucun
 * interne de la lib. */
export interface DetailPanel {
  render(node: GraphNode): void;
  clear(): void;
}

export function createDetailPanel(graph: DataGraph): DetailPanel {
  const detailEl = document.getElementById("detail");
  const typeEl = document.getElementById("selection-type");
  const emptyEl = document.getElementById("selection-empty");
  const labelEl = document.getElementById("selection-label");
  const pathEl = document.getElementById("selection-path");
  const rowsEl = document.getElementById("selection-rows");

  /** Les arêtes de référence sortantes du nœud, indexées par champ source —
   * c'est ce qui permet au panneau d'afficher un bouton « suivre » sur les
   * bonnes lignes, sans connaître les internes de la lib. */
  function outgoingRefs(nodeId: string): Map<string, RefEdge> {
    const map = new Map<string, RefEdge>();
    for (const edge of graph.refEdges(nodeId)) map.set(edge.field, edge);
    return map;
  }

  function clear(): void {
    // Le panneau est en surimpression du canvas : sans sélection il n'a rien à
    // dire et disparaît entièrement plutôt que d'occuper le coin avec un vide.
    detailEl?.setAttribute("hidden", "");
    emptyEl?.removeAttribute("hidden");
    for (const el of [typeEl, labelEl, pathEl]) el?.setAttribute("hidden", "");
    rowsEl?.replaceChildren();
  }

  function render(node: GraphNode): void {
    detailEl?.removeAttribute("hidden");
    emptyEl?.setAttribute("hidden", "");
    for (const el of [labelEl, pathEl]) el?.removeAttribute("hidden");

    if (typeEl) {
      if (node.kind === "entity") {
        typeEl.textContent = node.entityType.toUpperCase();
        typeEl.removeAttribute("hidden");
      } else {
        typeEl.setAttribute("hidden", "");
      }
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
        // Une ligne-tableau porte un NOMBRE D'ÉLÉMENTS, pas une valeur du
        // document : l'afficher tel quel donnerait « tags 3 », qu'on lirait comme
        // la valeur du champ. Le panneau reprend donc la formulation de la carte.
        dd.textContent =
          row.valueType === "array" ? `[ ${arrayTokenTextFor(row.value)} ]` : String(row.value);
        wrapper.append(dt, dd);

        const ref = refs.get(row.key);
        if (ref) {
          const btn = document.createElement("button");
          btn.className = "ref-btn";
          btn.textContent = "→";
          if (ref.to === null || ref.dangling) {
            btn.disabled = true;
            btn.title = `Référence cassée : ${ref.targetType}#${ref.targetId}`;
          } else {
            btn.title = `Aller à ${ref.targetType}#${ref.targetId}`;
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

  // La croix ne masque QUE le panneau : la sélection reste celle du graphe, et
  // resélectionner le même nœud le rouvre.
  document.getElementById("detail-close")?.addEventListener("click", () => {
    detailEl?.setAttribute("hidden", "");
  });

  return { render, clear };
}
