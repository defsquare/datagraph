import { element } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/**
 * Le bouton d'icône : l'unique commande du chrome.
 *
 * Il produit du DOM inerte. `disabled` et `aria-busy` ne sont pas des options,
 * et ne doivent pas l'être : ce sont des états d'EXÉCUTION, que l'application
 * pose et retire au fil de ce qu'elle fait — les prendre en argument ici
 * suggérerait qu'ils se décident à la construction.
 */
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
