import {
  arrayTokenTextFor,
  type DataGraph,
  type Diagnostic,
  type GraphNode,
  type RefEdge,
} from "@defsquare/datagraph";
import { createBadge, createRefButton } from "@defsquare/datagraph-chrome";

/** Proof that the renderer's public "select" event is enough to build a detail
 * panel entirely outside the library: plain DOM, no library internals. */
export interface DetailPanel {
  render(node: GraphNode): void;
  renderDiagnostics(diagnostics: Diagnostic[], highlight?: string): void;
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
              ? `Broken reference: ${ref.targetType}#${ref.targetId}`
              : `Go to ${ref.targetType}#${ref.targetId}`,
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

  /**
   * The panel in DIAGNOSTICS mode: the same surface, the same primitive, a
   * different content. No second floating panel — a viewer whose chrome is this
   * spare cannot afford two overlapping surfaces, and the panel already IS the
   * place where the app explains a node.
   *
   * No modal state to manage either: `render` and `renderDiagnostics` write the
   * same nodes, so the last call wins, and a `select` following a diagnostic
   * click simply hands the panel back to the detail view.
   *
   * `highlight` is a `path`: the entry carrying it is marked `diag-current`.
   * `main.ts`'s `followRef` handler passes `edge.from` when the click ran into a
   * dangling reference — `edge.from` and the offending `dangling-ref`
   * diagnostic's `path` are both `holder.id` (`packages/core/src/build.ts`), so
   * the highlight lands on exactly the entry the click hit. The status-bar
   * link's `onDiagnosticsOpen` still passes nothing and renders the whole list
   * unhighlighted, browsing rather than pointing at one line. One rendering
   * path serves both: a second one would let the two callers' views of what
   * "the same panel" looks like drift apart.
   */
  function renderDiagnostics(diagnostics: Diagnostic[], highlight?: string): void {
    detailEl?.removeAttribute("hidden");
    emptyEl?.setAttribute("hidden", "");
    typeEl.setAttribute("hidden", "");
    pathEl?.setAttribute("hidden", "");
    labelEl?.removeAttribute("hidden");
    if (labelEl) labelEl.textContent = "Diagnostics";

    if (!rowsEl) return;
    rowsEl.replaceChildren(
      ...diagnostics.map((d) => {
        // `unresolved-reference` is the ONE code whose `path` is a config
        // declaration and not a node pointer (see `Diagnostic` in the core): it
        // has no node to go to, so its entry stays readable and inert rather
        // than offering a gesture that would land nowhere.
        const navigable = d.code !== "unresolved-reference";

        // A `dl` admits only `dt`, `dd` and `div` as children, and a `button`
        // admits only phrasing content: an entry is therefore a `div.row` — the
        // `dl`'s child, exactly like a detail row — holding the control, and its
        // three fields are spans. The previous shape (a `button` child of the
        // `dl`, filled with `dt`/`dd`) broke the description list at both ends.
        const row = document.createElement("div");
        row.className = "row diag-row";
        if (highlight !== undefined && d.path === highlight) row.classList.add("diag-current");

        // `.diag-body` carries the LAYOUT and is worn by every entry; `.diag-entry`
        // carries nothing but the button-ness. Splitting them is what keeps a list
        // mixing the two diagnostic kinds from showing two different shapes — the
        // navigable entries used to lose the divider and the columns that the
        // inert ones kept.
        const body = document.createElement(navigable ? "button" : "div");
        body.className = navigable ? "diag-body diag-entry" : "diag-body";

        const field = (className: string, text: string): HTMLSpanElement => {
          const el = document.createElement("span");
          el.className = className;
          el.textContent = text;
          return el;
        };
        body.append(field("diag-code", d.code), field("diag-message", d.message), field("diag-path", d.path));

        if (navigable) {
          const button = body as HTMLButtonElement;
          button.type = "button";
          button.title = `Go to ${d.path}`;
          button.addEventListener("click", () => {
            // Same gesture as the panel's reference buttons: select then frame.
            // Both are safe no-ops on an id the graph does not carry, which is
            // what makes the `navigable` test above a readability rule and not a
            // correctness one.
            graph.select(d.path);
            graph.focus(d.path);
          });
        }

        row.append(body);
        return row;
      }),
    );
  }

  // The close button hides ONLY the panel: the graph's selection stands, and
  // reselecting the same node reopens it.
  document.getElementById("detail-close")?.addEventListener("click", () => {
    detailEl?.setAttribute("hidden", "");
  });

  return { render, renderDiagnostics, clear };
}
