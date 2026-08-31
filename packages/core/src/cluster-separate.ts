import type { AggregateIndex } from "./aggregate.js"
import type { Rect } from "./layout.js"
import type { NodeId } from "./model.js"

/**
 * Seuil de comparaison des pénétrations. `separateOverlaps` compare à zéro, et
 * sa sortie anticipée ne se déclenche donc JAMAIS : une paire posée exactement
 * à la marge garde une pénétration résiduelle de l'ordre de 1e-14, qui repasse
 * le test `> 0` et fait « bouger » des picomètres jusqu'au plafond
 * d'itérations (le défaut est documenté dans le commentaire de `DEFAULTS`,
 * `layout-graph.ts`). On ne le reproduit pas ici : sous cette épsilon, une
 * paire est considérée à sa place, la passe converge et sort pour de bon.
 * 1e-6 px est six ordres de grandeur sous le pixel, donc sans effet visible.
 */
const EPSILON = 1e-6

interface Cluster {
  /** Membres positionnés, dans l'ordre de `memberIds` puis de `positions`. */
  members: NodeId[]
  /** Boîte englobante, déplacée en place par la relaxation. */
  box: Rect
  /** Coin haut-gauche d'origine, pour en déduire la translation totale. */
  originX: number
  originY: number
}

function boundingBox(positions: Map<NodeId, Rect>, members: NodeId[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of members) {
    const rect = positions.get(id)!
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Écarte les **agrégats** les uns des autres, **en place**, jusqu'à laisser au
 * moins `gap` entre deux boîtes englobantes voisines.
 *
 * Même mécanique de relaxation que `separateOverlaps` — grille de hachage pour
 * le voisinage, poussée le long de l'axe de moindre pénétration, moitié du
 * déplacement pour chacun, ordre d'itération stable donc déterminisme — mais à
 * la granularité du CLUSTER et non de la carte. Elle s'applique après
 * `separateOverlaps` : celle-là garantit qu'aucune carte n'en recouvre une
 * autre, celle-ci ouvre les couloirs entre agrégats pour que les enveloppes se
 * lisent.
 *
 * Trois règles font toute la sûreté de la passe :
 *
 * 1. **Translation rigide.** Chaque membre encaisse la translation totale de
 *    son cluster, donc la géométrie interne d'un agrégat — les distances entre
 *    ses cartes, le travail de fcose et de la passe de séparation — est
 *    préservée EXACTEMENT, pas à une tolérance près.
 * 2. **Entité partagée : moyenne.** Une entité membre de plusieurs agrégats ne
 *    peut pas suivre deux clusters rigidement ; elle reçoit la MOYENNE des
 *    translations de ses clusters. Corollaire : deux agrégats qui partagent un
 *    membre s'interpénètrent par construction, les écarter n'aurait pas de
 *    sens (et la passe ne convergerait pas), donc ces paires-là sont exemptées.
 * 3. **Entité sans agrégat : cluster d'un seul.** Sans quoi elle resterait
 *    posée à l'intérieur de l'enveloppe d'un voisin qui ne la contient pas.
 */
export function separateClusters(
  positions: Map<NodeId, Rect>,
  aggregates: AggregateIndex,
  gap: number,
  iterations: number,
): void {
  if (positions.size < 2 || gap <= 0) return

  // 1. Les clusters, dans un ordre stable : les agrégats d'abord (ordre de
  //    `aggregates`, qui suit la déclaration de la config), puis les entités
  //    hors de tout agrégat (ordre de `positions`, lui-même trié par id).
  const clusters: Cluster[] = []
  for (const aggregate of aggregates.aggregates.values()) {
    const members: NodeId[] = []
    for (const id of aggregate.memberIds) {
      if (positions.has(id)) members.push(id)
    }
    if (members.length === 0) continue
    const box = boundingBox(positions, members)
    clusters.push({ members, box, originX: box.x, originY: box.y })
  }
  for (const [id, rect] of positions) {
    if ((aggregates.byNode.get(id)?.length ?? 0) > 0) continue
    const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    clusters.push({ members: [id], box, originX: box.x, originY: box.y })
  }
  if (clusters.length < 2) return

  // 2. Entité -> clusters qui la portent, d'où se déduisent les paires
  //    exemptées (celles qui partagent au moins un membre).
  const owners = new Map<NodeId, number[]>()
  clusters.forEach((cluster, index) => {
    for (const id of cluster.members) {
      const list = owners.get(id)
      if (list) list.push(index)
      else owners.set(id, [index])
    }
  })
  const shared = new Set<string>()
  for (const list of owners.values()) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        shared.add(a < b ? `${a} ${b}` : `${b} ${a}`)
      }
    }
  }

  // 3. Relaxation sur les boîtes. Maille de la grille : la plus grande boîte
  //    augmentée de `gap`, donc toute paire trop proche tombe dans des cellules
  //    adjacentes.
  let cell = 0
  for (const cluster of clusters) {
    cell = Math.max(cell, cluster.box.width + gap, cluster.box.height + gap)
  }
  if (cell <= 0) return

  for (let pass = 0; pass < iterations; pass++) {
    const buckets = new Map<string, number[]>()
    clusters.forEach((cluster, index) => {
      const b = cluster.box
      const key = `${Math.floor((b.x + b.width / 2) / cell)},${Math.floor((b.y + b.height / 2) / cell)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index)
      else buckets.set(key, [index])
    })

    let moved = false
    const seen = new Set<string>()
    for (let index = 0; index < clusters.length; index++) {
      const a = clusters[index]!.box
      const cx = Math.floor((a.x + a.width / 2) / cell)
      const cy = Math.floor((a.y + a.height / 2) / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other === index) continue
            const pair = index < other ? `${index} ${other}` : `${other} ${index}`
            if (seen.has(pair)) continue
            seen.add(pair)
            // Deux agrégats qui partagent une entité ne se séparent pas.
            if (shared.has(pair)) continue

            const b = clusters[other]!.box
            const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + gap
            const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + gap
            if (ox <= EPSILON || oy <= EPSILON) continue

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

  // 4. Report sur les cartes : translation rigide du cluster, moyennée pour une
  //    entité qui en a plusieurs.
  for (const [id, indices] of owners) {
    let sumX = 0
    let sumY = 0
    for (const index of indices) {
      const cluster = clusters[index]!
      sumX += cluster.box.x - cluster.originX
      sumY += cluster.box.y - cluster.originY
    }
    const rect = positions.get(id)!
    rect.x += sumX / indices.length
    rect.y += sumY / indices.length
  }
}
