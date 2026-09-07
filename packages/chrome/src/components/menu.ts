import { element } from "../dom.js";

/**
 * The chrome's dropdown menu, and its entries.
 *
 * The panel does not carry its anchoring: `position`, `top` and `left` say WHERE
 * the application places it, and that is layout. It only carries what makes it a
 * menu — minimum width, inner padding, opening.
 */
export interface MenuOptions {
  id?: string;
  /** The id of the button that opens the menu: it is what names it. */
  labelledBy?: string;
}

export function createMenu(o: MenuOptions = {}, ...items: Node[]): HTMLDivElement {
  const menu = element("div", "menu float", o.id);
  menu.setAttribute("role", "menu");
  if (o.labelledBy) menu.setAttribute("aria-labelledby", o.labelledBy);
  // Folded: a menu only opens on demand.
  menu.setAttribute("hidden", "");
  menu.append(...items);
  return menu;
}

/** An entry: text alone, across the full width of the panel. No icon by design —
 * the application rewrites its `textContent` to reflect the current state, which
 * an icon child would not survive. */
export function createMenuItem(o: { label: string; id?: string }): HTMLButtonElement {
  const item = element("button", "menu-item", o.id);
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = o.label;
  return item;
}
