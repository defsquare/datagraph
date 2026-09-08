import { BitmapFont, BitmapFontManager } from "pixi.js";
import type { Theme } from "./theme.js";

export type TextRole = "header" | "badge" | "key" | "value";

export const TEXT_ROLES: readonly TextRole[] = ["header", "badge", "key", "value"];

// Resolution 2: text stays crisp up to 2x zoom instead of smearing as soon as the
// camera goes past 1x.
const FONT_RESOLUTION = 2;

/** Everything a baked atlas's appearance depends on. */
export interface FontSpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}

export function fontSpecFor(theme: Theme, role: TextRole): FontSpec {
  const s = theme.typography[role];
  return {
    fontFamily: s.family === "body" ? theme.fonts.body : theme.fonts.mono,
    fontSize: s.size,
    fontWeight: s.weight,
    // `letterSpacing` is baked into the atlas, so it is part of its
    // identity: two themes that differ only by `tracking` cannot share an
    // atlas.
    letterSpacing: (s.tracking ?? 0) * s.size,
  };
}

export function specKey(spec: FontSpec): string {
  return `${spec.fontFamily}|${spec.fontSize}|${spec.fontWeight}|${spec.letterSpacing}`;
}

/** Short, stable hash, so the atlas name stays readable while debugging. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Atlas name for a role, a **pure** function of the theme.
 *
 * That is what lets `drawNode` find the atlas back without being
 * handed anything: it derives the same name the lease installed. The
 * name used to be fixed per role (`dg-header`…), so two instances with
 * different typographies would overwrite each other's atlases on every
 * rebuild.
 */
export function fontNameFor(theme: Theme, role: TextRole): string {
  return `dg-${role}-${hash(specKey(fontSpecFor(theme, role)))}`;
}

export interface FontHooks {
  install: (name: string, spec: FontSpec) => void;
  uninstall: (name: string) => void;
}

/** An atlas holder: a DataGraph instance, typically. */
export interface FontLease {
  /** Installs (or reuses) the atlases `theme` needs, and releases those this
   * lease held and no longer uses. Idempotent. */
  sync(theme: Theme): void;
  /** Releases every atlas of this lease. Idempotent. */
  dispose(): void;
}

export interface FontRegistry {
  lease(): FontLease;
}

/**
 * Reference-counted atlas registry.
 *
 * Pixi's atlases are registered globally by name: they are therefore necessarily
 * shared between instances, and only reference counting can tell when to uninstall
 * without pulling the rug out from under another instance. Without that counting,
 * `destroy()` could not release anything at all and texture memory leaked on every
 * mount/unmount.
 *
 * The hooks are injectable so the counting logic stays testable without a canvas or
 * WebGL.
 */
export function createFontRegistry(hooks: FontHooks): FontRegistry {
  const entries = new Map<string, { name: string; refs: number }>();

  function retain(name: string, spec: FontSpec): void {
    const entry = entries.get(name);
    if (entry) {
      entry.refs += 1;
      return;
    }
    hooks.install(name, spec);
    entries.set(name, { name, refs: 1 });
  }

  function release(name: string): void {
    const entry = entries.get(name);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    hooks.uninstall(name);
    entries.delete(name);
  }

  return {
    lease(): FontLease {
      // Role -> atlas name currently held by THIS lease.
      const held = new Map<TextRole, string>();

      return {
        sync(theme: Theme): void {
          for (const role of TEXT_ROLES) {
            const name = fontNameFor(theme, role);
            const previous = held.get(role);
            if (previous === name) continue;
            retain(name, fontSpecFor(theme, role));
            held.set(role, name);
            // Released AFTER retaining the new one: if both share the same name, we do
            // not want to drop to zero and uninstall an atlas we are in the middle of
            // reusing.
            if (previous) release(previous);
          }
        },

        dispose(): void {
          for (const name of held.values()) release(name);
          held.clear();
        },
      };
    },
  };
}

/** The Pixi-backed registry, shared by every instance in the process. */
export const pixiFontRegistry: FontRegistry = createFontRegistry({
  install(name, spec) {
    BitmapFont.install({
      name,
      style: {
        fontFamily: spec.fontFamily,
        fontSize: spec.fontSize,
        fontWeight: String(spec.fontWeight) as never,
        letterSpacing: spec.letterSpacing,
        fill: "#ffffff",
      },
      chars: BitmapFontManager.ASCII,
      resolution: FONT_RESOLUTION,
      dynamicFill: true,
    });
  },
  uninstall(name) {
    BitmapFont.uninstall(name);
  },
});
