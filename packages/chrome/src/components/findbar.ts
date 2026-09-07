import { element } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/**
 * The unfolding search bar: a floating surface carrying the icon, the bare
 * field, the match counter and the two navigation chevrons.
 *
 * The field has neither border nor outline of its own: it is the BAR that reacts
 * to focus (`:focus-within`), so the whole reads as a single object.
 */
export interface FindbarOptions {
  id?: string;
  inputId?: string;
  counterId?: string;
  prevId?: string;
  nextId?: string;
}

export interface Findbar {
  root: HTMLDivElement;
  input: HTMLInputElement;
  counter: HTMLSpanElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
}

/** The five parts are returned rather than found by selector: the caller wires
 * them all, and a DOM query would make that wiring silently wrong the day the
 * internal structure changes. */
export function createFindbar(o: FindbarOptions = {}): Findbar {
  const root = element("div", "findbar float", o.id);
  // Folded: in the product, search only appears on a click on the magnifier.
  root.setAttribute("hidden", "");

  const input = element("input", "findbar-input", o.inputId);
  input.type = "search";
  input.placeholder = "Rechercher…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Rechercher");

  const counter = element("span", "findbar-counter", o.counterId);
  // The counter announces itself when it changes: it is the only search feedback
  // for anyone who cannot see the canvas.
  counter.setAttribute("aria-live", "polite");

  const prev = navButton("up", "Résultat précédent (Maj+Entrée)", "Résultat précédent", o.prevId);
  const next = navButton("down", "Résultat suivant (Entrée)", "Résultat suivant", o.nextId);

  root.append(icon("search", "findbar-icon"), input, counter, prev, next);
  return { root, input, counter, prev, next };
}

/** The `title` quotes the shortcut, the `aria-label` does not: read aloud, a
 * keyboard shortcut in the middle of a button's name does not help identify it. */
function navButton(
  name: IconName,
  title: string,
  ariaLabel: string,
  id?: string,
): HTMLButtonElement {
  const button = element("button", "findbar-nav", id);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", ariaLabel);
  button.append(icon(name));
  return button;
}
