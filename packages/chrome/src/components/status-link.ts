import { element } from "../dom.js";

/**
 * The status bar's link: a discreet button inside inert text.
 *
 * `pointer-events` is restored on it by the stylesheet, the status bar itself
 * being transparent to gestures so it does not eat the canvas's.
 *
 * Folded by default: it only appears once it has something to report.
 */
export function createStatusLink(o: { id?: string; label?: string } = {}): HTMLButtonElement {
  const link = element("button", "status-link", o.id);
  link.type = "button";
  if (o.label === undefined) link.setAttribute("hidden", "");
  else link.textContent = o.label;
  return link;
}
