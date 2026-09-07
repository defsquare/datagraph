import { element } from "../dom.js";

/**
 * The cluster: the chrome's tight grouping of buttons.
 *
 * It IS a floating surface — chrome buttons never appear bare over the canvas,
 * and their hover tint composes onto the glass.
 */
export function createCluster(...children: Node[]): HTMLDivElement {
  const cluster = element("div", "cluster float");
  cluster.append(...children);
  return cluster;
}

/** The rule separating two families of commands inside a cluster. Decorative: it
 * has nothing to announce, the grouping reads from the spacing. */
export function createClusterSeparator(): HTMLSpanElement {
  const sep = element("span", "cluster-sep");
  sep.setAttribute("aria-hidden", "true");
  return sep;
}
