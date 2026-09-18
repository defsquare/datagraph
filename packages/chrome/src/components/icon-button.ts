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
  icon: IconName;
  label: string;
  id?: string;
  small?: boolean;
  controls?: string;
  expanded?: boolean;
  /** Renders `aria-pressed`, for a button that is one option of a group — the
   * pressed one being the active option. Unlike `disabled` and `aria-busy`, the
   * INITIAL pressed state is a construction-time fact: a group is built with one
   * of its buttons already active, and a button announcing none would be wrong
   * from the first paint. The application moves it afterwards. */
  pressed?: boolean;
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
  if (o.pressed !== undefined) button.setAttribute("aria-pressed", String(o.pressed));

  button.append(icon(o.icon));
  return button;
}
