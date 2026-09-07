import { element } from "../dom.js";

/**
 * The entity type badge, at the head of the detail panel.
 *
 * Folded as long as it has nothing to say: an empty badge would take a line and
 * announce a type that does not exist.
 */
export function createBadge(o: { id?: string; text?: string } = {}): HTMLSpanElement {
  const badge = element("span", "badge", o.id);
  if (o.text === undefined) badge.setAttribute("hidden", "");
  else badge.textContent = o.text;
  return badge;
}
