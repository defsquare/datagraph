import type { Rect } from "./layout.js"

export interface Point {
  x: number
  y: number
}

/**
 * Enveloppe convexe des coins des rectangles, chacun préalablement **gonflé**
 * de `padding`.
 *
 * Gonfler les rectangles en entrée plutôt que décaler le polygone en sortie
 * évite tout calcul d'offset de polygone (bissectrices, coins rentrants,
 * auto-intersections) tout en restant exact : l'enveloppe convexe d'un ensemble
 * de boîtes gonflées contient l'enveloppe des boîtes d'origine dilatée d'au
 * moins `padding` dans chaque direction axiale.
 *
 * Balayage de Andrew (monotone chain), O(n log n). Les points colinéaires sont
 * éliminés (`cross <= 0`), donc trois cartes alignées produisent bien un
 * quadrilatère et non un polygone à points redondants.
 */
export function paddedHull(rects: Rect[], padding: number): Point[] {
  if (rects.length === 0) return []

  const points: Point[] = []
  for (const r of rects) {
    const left = r.x - padding
    const top = r.y - padding
    const right = r.x + r.width + padding
    const bottom = r.y + r.height + padding
    points.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom })
  }

  points.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))

  // Doublons exacts retirés : ils feraient produire au balayage des arêtes de
  // longueur nulle (cas des cartes empilées à l'identique).
  const unique: Point[] = []
  for (const p of points) {
    const last = unique[unique.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    unique.push(p)
  }
  if (unique.length < 3) return unique

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Le dernier point de chaque chaîne est le premier de l'autre.
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
