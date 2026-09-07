import { element } from "../dom.js";

/**
 * La grappe : le regroupement serré de boutons du chrome.
 *
 * Elle EST une surface flottante — les boutons du chrome n'apparaissent jamais
 * à nu sur le canvas, et leur teinte de survol se compose sur le verre.
 */
export function createCluster(...children: Node[]): HTMLDivElement {
  const cluster = element("div", "cluster float");
  cluster.append(...children);
  return cluster;
}

/** Le trait qui sépare deux familles de commandes dans une grappe. Décoratif :
 * il n'a rien à annoncer, le groupement se lit à l'espacement. */
export function createClusterSeparator(): HTMLSpanElement {
  const sep = element("span", "cluster-sep");
  sep.setAttribute("aria-hidden", "true");
  return sep;
}
