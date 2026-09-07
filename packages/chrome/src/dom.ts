/**
 * The only helper shared by the factories: create an element, set its class and,
 * if the caller wants one, its id.
 *
 * Internal to the package — `index.ts` does not re-export it. It is not a chrome
 * primitive, only the three same lines saved in every component.
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
