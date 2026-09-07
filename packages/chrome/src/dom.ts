/**
 * Le seul helper partagé par les fabriques : créer un élément, lui poser sa
 * classe et, si l'appelant en veut un, son id.
 *
 * Interne au paquet — `index.ts` ne le réexporte pas. Ce n'est pas une primitive
 * du chrome, seulement l'économie des trois mêmes lignes dans chaque composant.
 */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  id?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (id) node.id = id;
  return node;
}
