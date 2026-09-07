/**
 * Les primitives du chrome, partagées par `apps/demo` et `apps/design`.
 *
 * Une primitive par module sous `components/`, chacune avec sa feuille à côté.
 * Cet index est leur seule façade : les consommateurs importent d'ici, jamais
 * d'un module de composant — ce qui laisse libre de scinder ou renommer un
 * fichier sans toucher à ce qu'ils écrivent.
 *
 * La feuille n'est pas réexportée ici — elle s'importe par le sous-chemin
 * `@defsquare/data-graph-chrome/chrome.css`, et APRÈS les variables du paquet
 * de tokens dont elle dépend.
 */
export * from "./icons.js";

export * from "./components/badge.js";
export * from "./components/cluster.js";
export * from "./components/findbar.js";
export * from "./components/icon-button.js";
export * from "./components/menu.js";
export * from "./components/ref-button.js";
export * from "./components/status-link.js";
