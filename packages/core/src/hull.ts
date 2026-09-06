import type { Rect } from "./structure-layout.js"

export interface Circle {
  cx: number
  cy: number
  r: number
}

interface Point {
  x: number
  y: number
}

/**
 * Tolérance de l'appartenance au cercle. Un point de support est, par
 * construction, exactement sur le bord ; sans marge, l'arrondi flottant le
 * rejetterait à l'itération suivante et relancerait une recherche déjà faite.
 */
const EPSILON = 1e-9

function contains(c: Circle, p: Point): boolean {
  const dx = p.x - c.cx
  const dy = p.y - c.cy
  const bound = c.r + EPSILON
  return dx * dx + dy * dy <= bound * bound
}

/** Cercle de diamètre `[a, b]`. */
function fromTwo(a: Point, b: Point): Circle {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(a.x - b.x, a.y - b.y) / 2,
  }
}

/**
 * Cercle circonscrit à trois points. S'ils sont colinéaires il n'en existe
 * pas : le plus grand des trois cercles sur diamètre les contient tous les
 * trois et fait l'affaire.
 */
function fromThree(a: Point, b: Point, c: Point): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < EPSILON) {
    let best = fromTwo(a, b)
    for (const candidate of [fromTwo(a, c), fromTwo(b, c)]) {
      if (candidate.r > best.r) best = candidate
    }
    return best
  }
  const aa = a.x * a.x + a.y * a.y
  const bb = b.x * b.x + b.y * b.y
  const cc = c.x * c.x + c.y * c.y
  const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d
  const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) }
}

/**
 * Algorithme de Welzl, dans sa forme itérative à trois boucles imbriquées : on
 * ajoute les points un à un, et dès qu'un point sort du cercle courant on
 * refait la recherche en le forçant sur le bord (puis deux points sur le bord,
 * puis trois — un cercle minimal est déterminé par deux ou trois points de
 * support).
 *
 * **L'entrée n'est PAS mélangée**, et c'est délibéré. La borne linéaire en
 * espérance de Welzl repose sur une permutation aléatoire des points ; sans
 * elle, le pire cas est cubique. Mais ce dépôt exige un déterminisme au BIT
 * (voir l'amorçage FNV-1a de `graph-layout.ts` et les tests de déterminisme
 * de la mise en page), et un mélange — même à graine fixe — est une pièce mobile
 * de plus sur ce chemin. Les tailles en jeu rendent l'arbitrage facile : un
 * cluster est ici un agrégat, soit 4 points pour le cas courant (une seule
 * carte) et 20 pour le plus gros mesuré sur le jeu de la démo (5 cartes).
 *
 * « Il cesserait de l'être sur des agrégats de plusieurs centaines de cartes »,
 * disait cette note sans l'avoir mesuré. C'est maintenant chiffré, et c'est
 * juste — avec une nuance qui compte depuis que le placement intra-agrégat est
 * RADIAL (`graph-layout.ts`). Le radial pose les cartes SUR DES CERCLES,
 * donc une grande part des coins se retrouve près du bord du cercle englobant :
 * c'est le cas adverse de Welzl non mélangé, celui qui force le plus de
 * reconstructions du jeu de support. Mesuré, par appel, étagères → radial :
 *
 *    41 cartes (164 coins)    0,0187 → 0,0352 ms
 *    66 cartes (264 coins)    0,0261 → 0,0686 ms
 *   157 cartes (628 coins)    0,0673 → 0,2834 ms
 *   297 cartes (1188 coins)   0,2158 → 1,6732 ms
 *
 * La croissance est bien superlinéaire sous radial (×7,2 en cartes → ×48 en
 * temps), donc l'avertissement tient et arrive plus tôt qu'avant. Mais
 * l'ARBITRAGE ne change pas : à l'échelle visée — 60 cartes dans le plus gros
 * agrégat de test — c'est 0,07 ms par appel, et même à 297 cartes ces 1,7 ms
 * pèsent 21 % d'un layout de 7,8 ms, très loin derrière la simulation O(k²) du
 * niveau 2 (169 ms à 167 disques). Rien ici ne justifie d'introduire un mélange,
 * donc l'ordre reste fixe. Ce qui justifierait de rouvrir la question : un
 * agrégat unique de plusieurs centaines de cartes dans un jeu réel.
 */
function welzl(points: Point[]): Circle {
  let circle: Circle = { cx: points[0]!.x, cy: points[0]!.y, r: 0 }
  for (let i = 1; i < points.length; i++) {
    if (contains(circle, points[i]!)) continue
    circle = { cx: points[i]!.x, cy: points[i]!.y, r: 0 }
    for (let j = 0; j < i; j++) {
      if (contains(circle, points[j]!)) continue
      circle = fromTwo(points[i]!, points[j]!)
      for (let k = 0; k < j; k++) {
        if (contains(circle, points[k]!)) continue
        circle = fromThree(points[i]!, points[j]!, points[k]!)
      }
    }
  }
  return circle
}

/**
 * Cercle englobant **minimal** des coins des rectangles, son rayon augmenté de
 * `padding`.
 *
 * Gonfler le rayon en sortie plutôt que les rectangles en entrée est ici exact
 * — contrairement au cas polygonal — parce que dilater un cercle de `padding`
 * revient exactement à ajouter `padding` à son rayon : la marge est la même
 * dans toutes les directions, sans bissectrice ni coin rentrant à traiter.
 *
 * Cas dégénérés : entrée vide (cercle nul à l'origine), un seul rectangle (son
 * cercle circonscrit), rectangles identiques empilés (idem), centres
 * colinéaires (cf. `fromThree`), rectangle de taille nulle (un point).
 */
export function enclosingCircle(rects: Rect[], padding: number): Circle {
  if (rects.length === 0) return { cx: 0, cy: 0, r: 0 }

  const points: Point[] = []
  for (const r of rects) {
    const right = r.x + r.width
    const bottom = r.y + r.height
    points.push({ x: r.x, y: r.y }, { x: right, y: r.y }, { x: right, y: bottom }, { x: r.x, y: bottom })
  }

  const circle = welzl(points)
  return { cx: circle.cx, cy: circle.cy, r: circle.r + padding }
}
