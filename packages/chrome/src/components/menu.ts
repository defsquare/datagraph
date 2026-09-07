import { element } from "../dom.js";

/**
 * Le menu déroulant du chrome, et ses entrées.
 *
 * Le panneau ne porte pas son ancrage : `position`, `top` et `left` disent OÙ
 * l'application le pose, et c'est de la mise en place. Il n'emporte que ce qui
 * fait de lui un menu — largeur minimale, marge intérieure, ouverture.
 */
export interface MenuOptions {
  id?: string;
  /** L'id du bouton qui ouvre le menu : c'est lui qui le nomme. */
  labelledBy?: string;
}

export function createMenu(o: MenuOptions = {}, ...items: Node[]): HTMLDivElement {
  const menu = element("div", "menu float", o.id);
  menu.setAttribute("role", "menu");
  if (o.labelledBy) menu.setAttribute("aria-labelledby", o.labelledBy);
  // Replié : un menu ne s'ouvre qu'à la demande.
  menu.setAttribute("hidden", "");
  menu.append(...items);
  return menu;
}

/** Une entrée : du texte seul, sur toute la largeur du panneau. Pas d'icône par
 * construction — l'application réécrit son `textContent` pour refléter l'état
 * courant, ce qu'un enfant icône ne survivrait pas. */
export function createMenuItem(o: { label: string; id?: string }): HTMLButtonElement {
  const item = element("button", "menu-item", o.id);
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = o.label;
  return item;
}
