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

/**
 * Attend que les polices web dont `theme` a besoin aient fini de charger (ou
 * `timeoutMs`, au premier des deux) avant de rendre la main. Sans DOM (Node,
 * test) ou sans `document.fonts`, résout immédiatement — il n'y a rien à
 * attendre. Le timeout borne l'attente : un service de polices lent ou
 * indisponible ne doit jamais bloquer indéfiniment l'initialisation.
 *
 * `document.fonts.ready` seul ne suffit PAS : il ne règle que les
 * chargements déjà déclenchés par la page. Une famille déclarée en
 * `@font-face` mais qu'aucun nœud DOM rendu n'utilise encore n'est jamais
 * requise — `ready` se résout alors immédiatement et `measureFontMetrics`
 * mesure la pile de repli, silencieusement (c'est exactement le bug que
 * `fontsReady` existe pour empêcher). On force donc explicitement, via
 * `document.fonts.load()`, le chargement de chacun des quatre rôles
 * typographiques du thème ; un rejet de `load()` (police introuvable,
 * réseau) est toléré pour qu'une seule police manquante n'empoisonne pas le
 * lot.
 *
 * Le `Promise.all` des `load()` PUIS `ready` doivent courir ENSEMBLE contre
 * le timeout, dans un seul `Promise.race` — pas le timeout après eux. Un
 * `load()` dont la promesse ne se règle jamais (fetch de police bloqué,
 * connexion en rade) ferait sinon pendre le `Promise.all` indéfiniment, le
 * `race` ne serait jamais atteint, et l'initialisation de `createDataGraph`
 * bloquerait pour toujours — pire que l'absence de `load()` d'avant, qui
 * était toujours bornée par le timeout. C'est le piège que cette forme évite.
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
