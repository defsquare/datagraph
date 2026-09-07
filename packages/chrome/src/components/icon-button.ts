import { element } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/**
 * The icon button: the chrome's only command.
 *
 * It produces inert DOM. `disabled` and `aria-busy` are not options, and must
 * not be: they are RUNTIME states, which the application sets and clears as it
 * goes — taking them as arguments here would suggest they are decided at
 * construction time.
 */
export interface IconButtonOptions {
  /** An array renders one icon per name, classed `icon-<name>`: this is how a
   * button carries both the current state AND the target one, the application's
   * stylesheet hiding one of them (see `#toggle-view` in the demo). */
  icon: IconName | readonly IconName[];
  label: string;
  id?: string;
  small?: boolean;
  controls?: string;
  expanded?: boolean;
}

export function createIconButton(o: IconButtonOptions): HTMLButtonElement {
  const button = element("button", o.small ? "ibtn ibtn-sm" : "ibtn", o.id);
  button.type = "button";
  // Both: `title` serves the mouse tooltip, `aria-label` gives the button an
  // accessible name that no child text carries.
  button.title = o.label;
  button.setAttribute("aria-label", o.label);
  if (o.controls) button.setAttribute("aria-controls", o.controls);
  if (o.expanded !== undefined) button.setAttribute("aria-expanded", String(o.expanded));

  const names = typeof o.icon === "string" ? [o.icon] : o.icon;
  for (const name of names) {
    // The class is only set when there are several icons: it is what allows one
    // to be hidden, and a single-icon button has nothing to hide.
    button.append(icon(name, names.length > 1 ? `icon-${name}` : undefined));
  }
  return button;
}
