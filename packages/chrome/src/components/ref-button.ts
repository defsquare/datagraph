import { element } from "../dom.js";

/**
 * The "follow the reference" button, on a row of the detail panel.
 *
 * The `title` carries the target — the one thing the arrow does not say.
 * Disabled, it stays present: a broken reference is information, and hiding it
 * would make the offending row disappear.
 */
export function createRefButton(o: { title: string; disabled?: boolean }): HTMLButtonElement {
  const button = element("button", "ref-btn");
  button.type = "button";
  button.textContent = "→";
  button.title = o.title;
  if (o.disabled) button.disabled = true;
  return button;
}
