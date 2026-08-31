import { BitmapFont, BitmapFontManager } from "pixi.js";
import type { Theme } from "./theme.js";

export type TextRole = "header" | "badge" | "key" | "value";

export const TEXT_ROLES: readonly TextRole[] = ["header", "badge", "key", "value"];

// Résolution 2 : le texte reste net jusqu'à 2x de zoom au lieu de baver dès
// que la caméra dépasse 1x.
const FONT_RESOLUTION = 2;

/** Tout ce dont dépend l'apparence d'un atlas cuit. */
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
    // `letterSpacing` est cuit dans l'atlas, il fait donc partie de son
    // identité : deux thèmes qui ne diffèrent que par `tracking` ne peuvent
    // pas partager un atlas.
    letterSpacing: (s.tracking ?? 0) * s.size,
  };
}

export function specKey(spec: FontSpec): string {
  return `${spec.fontFamily}|${spec.fontSize}|${spec.fontWeight}|${spec.letterSpacing}`;
}

/** Hash court et stable, pour que le nom d'atlas reste lisible au débogage. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Nom de l'atlas d'un rôle, fonction **pure** du thème.
 *
 * C'est ce qui permet à `drawNode` de retrouver l'atlas sans qu'on lui passe
 * quoi que ce soit : il dérive le même nom que celui que le bail a installé.
 * Auparavant le nom était fixe par rôle (`dg-header`…), si bien que deux
 * instances aux typographies différentes s'écrasaient mutuellement les atlas
 * à chaque rebuild.
 */
export function fontNameFor(theme: Theme, role: TextRole): string {
  return `dg-${role}-${hash(specKey(fontSpecFor(theme, role)))}`;
}

export interface FontHooks {
  install: (name: string, spec: FontSpec) => void;
  uninstall: (name: string) => void;
}

/** Un porteur d'atlas : une instance de DataGraph, typiquement. */
export interface FontLease {
  /** Installe (ou réutilise) les atlas dont `theme` a besoin, et libère ceux
   * que ce bail portait et n'utilise plus. Idempotent. */
  sync(theme: Theme): void;
  /** Libère tous les atlas de ce bail. Idempotent. */
  dispose(): void;
}

export interface FontRegistry {
  lease(): FontLease;
}

/**
 * Registre d'atlas à comptage de références.
 *
 * Les atlas de Pixi sont enregistrés globalement par nom : ils sont donc
 * forcément partagés entre instances, et seul un comptage de références
 * permet de savoir quand désinstaller sans couper l'herbe sous le pied d'une
 * autre instance. Sans ce comptage, `destroy()` ne pouvait rien libérer du
 * tout et la mémoire de texture fuyait à chaque montage/démontage.
 *
 * Les hooks sont injectables pour que la logique de comptage soit testable
 * sans canvas ni WebGL.
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
      // Rôle -> nom d'atlas actuellement porté par CE bail.
      const held = new Map<TextRole, string>();

      return {
        sync(theme: Theme): void {
          for (const role of TEXT_ROLES) {
            const name = fontNameFor(theme, role);
            const previous = held.get(role);
            if (previous === name) continue;
            retain(name, fontSpecFor(theme, role));
            held.set(role, name);
            // Libéré APRÈS avoir retenu le nouveau : si les deux partagent le
            // même nom, on ne veut pas tomber à zéro et désinstaller un atlas
            // qu'on est en train de réutiliser.
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

/** Le registre adossé à Pixi, partagé par toutes les instances du processus. */
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
