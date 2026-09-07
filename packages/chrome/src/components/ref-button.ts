import { element } from "../dom.js";

/**
 * Le bouton « suivre la référence », sur une ligne du panneau de détail.
 *
 * Le `title` porte la cible — c'est la seule chose que la flèche ne dit pas.
 * Désactivé, il reste présent : une référence cassée est une information, et le
 * masquer ferait disparaître la ligne fautive.
 */
export function createRefButton(o: { title: string; disabled?: boolean }): HTMLButtonElement {
  const button = element("button", "ref-btn");
  button.type = "button";
  button.textContent = "→";
  button.title = o.title;
  if (o.disabled) button.disabled = true;
  return button;
}
