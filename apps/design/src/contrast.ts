/**
 * Contraste WCAG 2.x entre deux couleurs opaques.
 *
 * Le playground affiche des ratios pour que celui qui touche une couleur voie
 * immédiatement ce qu'il casse : un `ink.subtle` éclairci de deux crans reste
 * joli et devient illisible, et rien dans un swatch ne le dit. Le calcul vit
 * ici plutôt que dans le paquet de tokens parce que c'est une mesure SUR les
 * tokens, pas un token : le renderer n'en a aucun usage.
 *
 * Seul `#rrggbb` est accepté — c'est le format de toutes les couleurs de
 * `packages/tokens/src/index.ts`. Les valeurs translucides du chrome
 * (`rgb(… / 0.82)`) n'ont volontairement pas de ratio : un contraste sur une
 * couleur non composée serait un chiffre faux, donc pire que pas de chiffre.
 */

const HEX = /^#([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  // Erreur plutôt que repli silencieux : un token hors format est un bug de la
  // source, et un ratio calculé sur du noir par défaut le masquerait.
  if (!m) throw new Error(`contrastRatio attend une couleur #rrggbb, reçu « ${hex} »`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Composante sRGB linéarisée (WCAG 2.x, §relative luminance). */
function linear(component: number): number {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Ratio de contraste, de 1 (identiques) à 21 (noir sur blanc), arrondi à deux
 * décimales. L'ordre des arguments n'a pas d'influence sur le résultat — la
 * formule met toujours la plus claire au numérateur — mais le nommage
 * (avant-plan, arrière-plan) garde les appels lisibles côté vue.
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = luminance(fgHex);
  const b = luminance(bgHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}
