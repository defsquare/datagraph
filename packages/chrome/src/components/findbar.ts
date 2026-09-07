import { element } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/**
 * La recherche dépliante : une surface flottante qui porte l'icône, le champ nu,
 * le compteur de résultats et les deux chevrons de navigation.
 *
 * Le champ n'a ni bordure ni contour propres : c'est la BARRE qui réagit au
 * focus (`:focus-within`), pour que l'ensemble se lise comme un seul objet.
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

/** Les cinq parties sont retournées plutôt que retrouvées par sélecteur :
 * l'appelant les câble toutes, et une requête sur le DOM rendrait ce câblage
 * silencieusement faux le jour où la structure interne change. */
export function createFindbar(o: FindbarOptions = {}): Findbar {
  const root = element("div", "findbar float", o.id);
  // Repliée : dans le produit, la recherche n'apparaît qu'au clic sur la loupe.
  root.setAttribute("hidden", "");

  const input = element("input", "findbar-input", o.inputId);
  input.type = "search";
  input.placeholder = "Rechercher…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Rechercher");

  const counter = element("span", "findbar-counter", o.counterId);
  // Le compteur s'annonce quand il change : c'est le seul retour de recherche
  // pour qui ne voit pas le canvas.
  counter.setAttribute("aria-live", "polite");

  const prev = navButton("up", "Résultat précédent (Maj+Entrée)", "Résultat précédent", o.prevId);
  const next = navButton("down", "Résultat suivant (Entrée)", "Résultat suivant", o.nextId);

  root.append(icon("search", "findbar-icon"), input, counter, prev, next);
  return { root, input, counter, prev, next };
}

/** Le `title` cite le raccourci, l'`aria-label` non : lu à voix haute, un
 * raccourci clavier au milieu du nom d'un bouton n'aide pas à le désigner. */
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
