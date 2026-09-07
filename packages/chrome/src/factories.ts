import { icon, type IconName } from "./icons.js";

/**
 * Les fabriques des primitives du chrome.
 *
 * Elles produisent du DOM **inerte** : aucun écouteur, aucune gestion
 * d'ouverture, aucun état. Le comportement appartient à l'application — la
 * politique d'Échap de la démo (un seul niveau à la fois, `preventDefault` pour
 * que le champ de recherche ne se vide pas en silence) est une décision sur
 * SES deux panneaux, pas une propriété d'une primitive. Le catalogue, lui,
 * n'a besoin d'aucun comportement : il montre les états, il ne les joue pas.
 * Voir `docs/adr/0029-chrome-primitives-shared-package.md`.
 *
 * Toutes acceptent un `id` : les instances de la démo sont désignées par id,
 * par son câblage TypeScript comme par ses tests de bout en bout. Une fabrique
 * qui en générerait un à sa guise casserait les deux.
 */

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  id?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (id) node.id = id;
  return node;
}

// --- Bouton d'icône.

export interface IconButtonOptions {
  /** Un tableau rend une icône par nom, classée `icon-<nom>` : c'est ainsi
   * qu'un bouton porte l'état courant ET l'état cible, la feuille de
   * l'application en masquant une (cf. `#toggle-view` dans la démo). */
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
  // Les deux : `title` sert l'infobulle à la souris, `aria-label` donne au
  // bouton un nom accessible qu'aucun texte enfant ne porte.
  button.title = o.label;
  button.setAttribute("aria-label", o.label);
  if (o.controls) button.setAttribute("aria-controls", o.controls);
  if (o.expanded !== undefined) button.setAttribute("aria-expanded", String(o.expanded));

  const names = typeof o.icon === "string" ? [o.icon] : o.icon;
  for (const name of names) {
    // La classe n'est posée que s'il y a plusieurs icônes : c'est elle qui
    // permet d'en masquer une, et un bouton à icône unique n'a rien à masquer.
    button.append(icon(name, names.length > 1 ? `icon-${name}` : undefined));
  }
  return button;
}

// --- Grappe.

/** La grappe EST une surface flottante : les boutons du chrome n'apparaissent
 * jamais à nu sur le canvas, et leur teinte de survol se compose sur le verre. */
export function createCluster(...children: Node[]): HTMLDivElement {
  const cluster = element("div", "cluster float");
  cluster.append(...children);
  return cluster;
}

export function createClusterSeparator(): HTMLSpanElement {
  const sep = element("span", "cluster-sep");
  sep.setAttribute("aria-hidden", "true");
  return sep;
}

// --- Recherche dépliante.

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

// --- Menu.

export interface MenuOptions {
  id?: string;
  /** L'id du bouton qui ouvre le menu : c'est lui qui le nomme. */
  labelledBy?: string;
}

export function createMenu(o: MenuOptions = {}, ...items: Node[]): HTMLDivElement {
  const menu = element("div", "menu float", o.id);
  menu.setAttribute("role", "menu");
  if (o.labelledBy) menu.setAttribute("aria-labelledby", o.labelledBy);
  menu.setAttribute("hidden", "");
  menu.append(...items);
  return menu;
}

export function createMenuItem(o: { label: string; id?: string }): HTMLButtonElement {
  const item = element("button", "menu-item", o.id);
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = o.label;
  return item;
}

// --- Pastille d'entité.

/** Repliée tant qu'elle n'a rien à dire : une pastille vide occuperait une
 * ligne et signalerait un type qui n'existe pas. */
export function createBadge(o: { id?: string; text?: string } = {}): HTMLSpanElement {
  const badge = element("span", "badge", o.id);
  if (o.text === undefined) badge.setAttribute("hidden", "");
  else badge.textContent = o.text;
  return badge;
}

// --- Lien de la barre d'état.

export function createStatusLink(o: { id?: string; label?: string } = {}): HTMLButtonElement {
  const link = element("button", "status-link", o.id);
  link.type = "button";
  if (o.label === undefined) link.setAttribute("hidden", "");
  else link.textContent = o.label;
  return link;
}

// --- Bouton « suivre la référence ».

/** Le `title` porte la cible — c'est la seule chose que la flèche ne dit pas.
 * Désactivé, il reste présent : une référence cassée est une information, la
 * masquer ferait disparaître la ligne fautive. */
export function createRefButton(o: { title: string; disabled?: boolean }): HTMLButtonElement {
  const button = element("button", "ref-btn");
  button.type = "button";
  button.textContent = "→";
  button.title = o.title;
  if (o.disabled) button.disabled = true;
  return button;
}
