/**
 * The chrome's icons, and their only source.
 *
 * They used to live inline in `apps/demo/index.html` — hence out of reach for
 * any other consumer — and were copied by hand into the playground's component
 * board. The two sets could only drift, with nothing to signal it. They now live
 * here, and nowhere else.
 *
 * All are drawn in a 16-unit square, in `currentColor`: the button carries the
 * colour, the icon does not decide it. None carries a title or a role — the
 * accessible name is on the enclosing button (see `createIconButton`), and an
 * icon naming itself would only duplicate it.
 */

export const ICON_NAMES = [
  "search",
  "fit",
  "tidy",
  "graph",
  "structure",
  "dots",
  "close",
  "up",
  "down",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS: Record<IconName, string> = {
  search: `
    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`,
  fit: `
    <path
      d="M2 5.5V3.2A1.2 1.2 0 0 1 3.2 2h2.3M10.5 2h2.3A1.2 1.2 0 0 1 14 3.2v2.3M14 10.5v2.3a1.2 1.2 0 0 1-1.2 1.2h-2.3M5.5 14H3.2A1.2 1.2 0 0 1 2 12.8v-2.3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <rect x="5.75" y="5.75" width="4.5" height="4.5" rx="1" fill="currentColor" opacity="0.35" />`,
  // "Tidy": blocks put back in a column, aligned on one edge — the icon states
  // the idea of the global relayout it triggers.
  tidy: `
    <line x1="2.5" y1="2" x2="2.5" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <rect x="5" y="3" width="8.5" height="2.6" rx="0.9" fill="currentColor" />
    <rect x="5" y="6.7" width="5.5" height="2.6" rx="0.9" fill="currentColor" opacity="0.55" />
    <rect x="5" y="10.4" width="7" height="2.6" rx="0.9" fill="currentColor" />`,
  graph: `
    <path d="M4.2 4.2 11.8 6M11.8 6 7 12.2M4.2 4.2 7 12.2" fill="none" stroke="currentColor" stroke-width="1.3" />
    <circle cx="4.2" cy="4.2" r="2" fill="currentColor" />
    <circle cx="11.8" cy="6" r="2" fill="currentColor" />
    <circle cx="7" cy="12.2" r="2" fill="currentColor" />`,
  structure: `
    <path d="M8 5.2v2.9M4 8.1h8M4 8.1v2.4M12 8.1v2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    <rect x="5.4" y="1.6" width="5.2" height="3.6" rx="1.1" fill="currentColor" />
    <rect x="1.4" y="10.8" width="5.2" height="3.6" rx="1.1" fill="currentColor" />
    <rect x="9.4" y="10.8" width="5.2" height="3.6" rx="1.1" fill="currentColor" />`,
  dots: `
    <circle cx="8" cy="3.4" r="1.25" fill="currentColor" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    <circle cx="8" cy="12.6" r="1.25" fill="currentColor" />`,
  close: `<path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`,
  up: `<path d="M4.5 9.5 8 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`,
  down: `<path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`,
};

/**
 * `innerHTML` over a frozen module literal: no outside data flows through here,
 * and it is by far the most readable way to keep the paths identical to the ones
 * they replace — rewriting them as `createElementNS` calls would make any future
 * comparison unreadable.
 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  svg.innerHTML = PATHS[name];
  return svg;
}
