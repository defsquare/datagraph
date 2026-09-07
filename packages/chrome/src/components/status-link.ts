import { element } from "../dom.js";

/**
 * Le lien de la barre d'état : un bouton discret dans du texte inerte.
 *
 * `pointer-events` y est rétabli par la feuille, la barre d'état étant elle-même
 * transparente aux gestes pour ne pas manger ceux du canvas.
 *
 * Replié par défaut : il n'apparaît que lorsqu'il a quelque chose à signaler.
 */
export function createStatusLink(o: { id?: string; label?: string } = {}): HTMLButtonElement {
  const link = element("button", "status-link", o.id);
  link.type = "button";
  if (o.label === undefined) link.setAttribute("hidden", "");
  else link.textContent = o.label;
  return link;
}
