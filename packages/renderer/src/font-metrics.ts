import type { NodeMetrics } from "@defsquare/data-graph-core";
import type { Theme } from "./theme.js";

// Échantillon représentatif du texte réellement affiché : minuscules,
// majuscules, chiffres et ponctuation, dans les proportions d'un identifiant
// ou d'un libellé de champ.
const SAMPLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-_#@/";

/**
 * Mesure l'avance moyenne réelle des quatre rôles typographiques via un
 * contexte 2D hors écran, et renvoie une copie de `base` avec les
 * `*CharWidth` corrigés.
 *
 * Le core ne peut pas faire cette mesure : il tourne en Node, sans DOM. Ses
 * constantes par défaut restent donc des approximations déterministes, et le
 * renderer les affine quand il en a les moyens. Sans contexte disponible
 * (Node, test, jsdom sans canvas), `base` est renvoyé inchangé.
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

  // Une seule mesure ratée invalide le lot : mélanger des avances mesurées et
  // approximées produirait des cartes incohérentes entre elles.
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
