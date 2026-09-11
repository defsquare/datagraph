/**
 * WCAG 2.x contrast between two opaque colors.
 *
 * Lives beside the tokens it measures rather than in `index.ts`: it is a
 * measurement ON the tokens, not a token — the renderer has no use for it, and
 * `index.ts` stays pure data. Being in this package, rather than in the
 * playground that used to hold it, is what lets `test/contrast.test.ts` hold
 * the shell's ratios to a 4.5:1 floor instead of only ever being eyeballed in
 * a swatch. The playground still imports it (via `@tokens/contrast.ts`) to
 * show ratios live, so whoever touches a color immediately sees what they
 * break: an `ink.subtle` lightened by two notches stays pretty and becomes
 * illegible, and nothing in a swatch says so.
 *
 * Only `#rrggbb` is accepted — the format of every color in
 * `packages/tokens/src/index.ts`. The chrome's translucent values
 * (`rgb(… / 0.82)`) deliberately get no ratio: a contrast computed on an
 * uncomposited color would be a wrong number, hence worse than no number.
 */

const HEX = /^#([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  // An error rather than a silent fallback: an off-format token is a bug in the
  // source, and a ratio computed on a default black would hide it.
  if (!m) throw new Error(`contrastRatio expects a #rrggbb color, received "${hex}"`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Linearized sRGB component (WCAG 2.x, §relative luminance). */
function linear(component: number): number {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Contrast ratio, from 1 (identical) to 21 (black on white), rounded to two
 * decimals. Argument order has no bearing on the result — the formula always
 * puts the lighter one in the numerator — but the naming (foreground,
 * background) keeps the calls readable on the view side.
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = luminance(fgHex);
  const b = luminance(bgHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}
