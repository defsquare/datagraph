import type { NodeId } from "./model.js"
import type { Rect } from "./layout.js"

/**
 * Écarte les rectangles qui se chevauchent, **en place**, par relaxation : à
 * chaque passe, toute paire en collision est repoussée le long de son axe de
 * moindre pénétration, chaque carte encaissant la moitié du déplacement.
 *
 * Cette passe est indispensable et n'est pas un réglage fin : une force
 * converge vers un compromis attraction/répulsion, jamais vers une contrainte
 * dure de non-recouvrement. Aucun calibrage de longueur d'arête ne la remplace.
 *
 * Le voisinage est trouvé via une grille de hachage dont la maille vaut la plus
 * grande carte, donc toute paire en collision tombe dans des cellules
 * adjacentes : on reste linéaire au lieu de comparer les n² paires.
 *
 * Déterministe : aucun aléa, ordre d'itération stable (celui d'insertion de la
 * Map). Sort dès qu'une passe ne bouge plus rien.
 */
export function separateOverlaps(
  positions: Map<NodeId, Rect>,
  margin: number,
  iterations: number,
): void {
  const ids = [...positions.keys()]
  if (ids.length < 2) return

  let cell = 0
  for (const rect of positions.values()) {
    cell = Math.max(cell, rect.width + margin, rect.height + margin)
  }
  if (cell <= 0) return

  for (let pass = 0; pass < iterations; pass++) {
    const buckets = new Map<string, NodeId[]>()
    for (const id of ids) {
      const r = positions.get(id)!
      const key = `${Math.floor((r.x + r.width / 2) / cell)},${Math.floor((r.y + r.height / 2) / cell)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(id)
      else buckets.set(key, [id])
    }

    let moved = false
    const seen = new Set<string>()
    for (const id of ids) {
      const a = positions.get(id)!
      const cx = Math.floor((a.x + a.width / 2) / cell)
      const cy = Math.floor((a.y + a.height / 2) / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other === id) continue
            const pair = id < other ? `${id} ${other}` : `${other} ${id}`
            if (seen.has(pair)) continue
            seen.add(pair)

            const b = positions.get(other)!
            const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
            const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
            if (ox <= 0 || oy <= 0) continue

            moved = true
            if (ox < oy) {
              const push = (ox / 2) * (a.x + a.width / 2 <= b.x + b.width / 2 ? -1 : 1)
              a.x += push
              b.x -= push
            } else {
              const push = (oy / 2) * (a.y + a.height / 2 <= b.y + b.height / 2 ? -1 : 1)
              a.y += push
              b.y -= push
            }
          }
        }
      }
    }
    if (!moved) break
  }
}
