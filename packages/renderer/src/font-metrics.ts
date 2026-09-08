import type { NodeMetrics } from "@defsquare/data-graph-core";
import type { Theme } from "./theme.js";

// Sample representative of the text actually displayed: lowercase and uppercase
// letters, digits and punctuation, in roughly the proportions they occur in an
// identifier or a field label.
const SAMPLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-_#@/";

/**
 * Measures the real average character advance of each of the four typographic roles
 * through an offscreen 2D context, and returns a copy of `base` with its `*CharWidth`
 * fields corrected.
 *
 * The core cannot take that measurement: it runs in Node, without a DOM. Its default
 * constants therefore remain deterministic approximations, and the renderer refines
 * them when it has the means to. With no context available (Node, test, jsdom without a
 * canvas), `base` is returned unchanged.
 */
export function measureFontMetrics(theme: Theme, base: NodeMetrics): NodeMetrics {
  const ctx = createContext();
  if (!ctx) return { ...base };

  const advance = (role: "header" | "badge" | "key" | "value"): number => {
    const s = theme.typography[role];
    const family = s.family === "body" ? theme.fonts.body : theme.fonts.mono;
    ctx.font = `${s.weight} ${s.size}px ${family}`;
    const width = ctx.measureText(SAMPLE).width;
    if (!Number.isFinite(width) || width <= 0) return NaN;
    return width / SAMPLE.length + (s.tracking ?? 0) * s.size;
  };

  const header = advance("header");
  const badge = advance("badge");
  const key = advance("key");
  const value = advance("value");

  // A single failed measurement invalidates the batch: mixing measured and approximated
  // advances would produce cards inconsistent with one another.
  if (![header, badge, key, value].every((n) => Number.isFinite(n) && n > 0)) return { ...base };

  return {
    ...base,
    headerCharWidth: header,
    badgeCharWidth: badge,
    keyCharWidth: key,
    valueCharWidth: value,
  };
}

function createContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}

/**
 * Waits until the web fonts `theme` needs have finished loading (or for `timeoutMs`,
 * whichever comes first) before handing back control. Without a DOM (Node, test) or
 * without `document.fonts`, resolves immediately — there is nothing to wait for. The
 * timeout bounds the wait: a slow or unavailable font service must never block
 * initialization indefinitely.
 *
 * `document.fonts.ready` alone is NOT enough: it only settles the loads the
 * page has already triggered. A family declared in `@font-face` but that no
 * rendered DOM node uses yet is never requested — `ready` then resolves
 * immediately and `measureFontMetrics` measures the fallback stack, silently
 * (which is exactly the bug `fontsReady` exists to prevent). So we
 * explicitly force, through `document.fonts.load()`, the loading of each of
 * the theme's four typographic roles; a rejection from `load()` (font not
 * found, network) is tolerated so that one missing font does not poison the
 * batch.
 *
 * The `Promise.all` of the `load()`s AND THEN `ready` must run TOGETHER
 * against the timeout, in a single `Promise.race` — not the timeout after
 * them. A `load()` whose promise never settles (blocked font fetch, dead
 * connection) would otherwise leave the `Promise.all` hanging forever,
 * the `race` would never be reached, and `createDataGraph`'s
 * initialization would block forever — worse than the earlier absence of
 * `load()`, which was always bounded by the timeout. That is the trap
 * this shape avoids.
 */
export async function fontsReady(theme: Theme, timeoutMs: number): Promise<void> {
  const fonts = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!fonts?.ready) return;

  const roles: (keyof Theme["typography"])[] = ["header", "badge", "key", "value"];
  const warm = Promise.all(
    roles.map((role) => {
      const s = theme.typography[role];
      const family = s.family === "body" ? theme.fonts.body : theme.fonts.mono;
      return fonts.load(`${s.weight} ${s.size}px ${family}`).catch(() => undefined);
    }),
  ).then(() => fonts.ready);

  await Promise.race([warm, new Promise((r) => setTimeout(r, timeoutMs))]);
}
