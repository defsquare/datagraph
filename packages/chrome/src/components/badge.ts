import { element } from "../dom.js";

/**
 * La pastille de type d'entité, en tête du panneau de détail.
 *
 * Repliée tant qu'elle n'a rien à dire : une pastille vide occuperait une ligne
 * et signalerait un type qui n'existe pas.
 */
export function createBadge(o: { id?: string; text?: string } = {}): HTMLSpanElement {
  const badge = element("span", "badge", o.id);
  if (o.text === undefined) badge.setAttribute("hidden", "");
  else badge.textContent = o.text;
  return badge;
}
