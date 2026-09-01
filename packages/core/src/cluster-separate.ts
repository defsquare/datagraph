import type { AggregateIndex } from "./aggregate.js"
import type { Rect } from "./layout.js"
import type { NodeId } from "./model.js"

/**
 * Seuil de comparaison des pénétrations. Une paire posée exactement à la marge
 * garde une pénétration résiduelle non nulle (1,84e-11 px mesuré, cf.
 * `separate.ts`) : comparée à zéro, elle repasse le test `> 0` et fait
 * « bouger » des picomètres jusqu'au plafond d'itérations. Sous cette épsilon,
 * elle est considérée à sa place, la passe converge et sort pour de bon. 1e-6
 * px est six ordres de grandeur sous le pixel, donc sans effet visible.
 *
 * Cette passe-ci a toujours comparé à une épsilon ; `separateOverlaps`
 * comparait à zéro et a été alignée dessus depuis (sa doc garde la mesure du
 * défaut et de sa correction). Ce commentaire décrivait encore l'état d'avant.
 */
const EPSILON = 1e-6

interface SuperCluster {
  /** Membres positionnés, dans un ordre stable. */
  members: NodeId[]
  /** Boîte englobante, déplacée en place par la relaxation. */
  box: Rect
  /** Coin haut-gauche d'origine, pour en déduire la translation totale. */
  originX: number
  originY: number
}

function boundingBox(positions: Map<NodeId, Rect>, members: Iterable<NodeId>): Rect {
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
 * Deux règles font toute la sûreté de la passe :
 *
 * 1. **Translation rigide.** Chaque carte encaisse la translation de son
 *    cluster, et une seule, donc la géométrie interne — les distances entre
 *    cartes, le travail de fcose et de la passe de séparation — traverse la
 *    passe intacte. Comme rien ne relance `separateOverlaps` derrière, c'est
 *    aussi ce qui garantit qu'aucun recouvrement de cartes n'apparaît ici.
 * 2. **Les agrégats qui partagent une entité fusionnent** en un seul
 *    super-cluster, par union-find, AVANT la relaxation. Une entité partagée
 *    est membre à part entière de chacun de ses agrégats : lui donner un
 *    déplacement à elle (la moyenne de ceux de ses agrégats, dans une version
 *    antérieure) la détache de ses co-membres dès qu'un TIERS pousse l'un des
 *    agrégats plus que l'autre — la rigidité tombe et des cartes se
 *    recouvrent. Fusionner est la formulation correcte : des agrégats tricotés
 *    par une entité commune ne peuvent pas être séparés sans déchirer cette
 *    carte, donc ils se déplacent ensemble. Leurs enveloppes continuent de se
 *    croiser, ce qui est le comportement voulu.
 *
 * Une entité hors de tout agrégat forme un cluster d'un seul : sans quoi elle
 * resterait posée à l'intérieur de l'enveloppe d'un voisin qui ne la contient
 * pas.
 *
 * Corollaire à garder en tête devant une sortie qui semble « ne rien faire » :
 * si TOUS les agrégats finissent transitivement reliés par un membre partagé
 * (union-find à une seule racine), il n'y a plus qu'un super-cluster, donc
 * rien à écarter — la passe est inerte, pas en panne. C'est exactement ce que
 * mesure `packages/core/README.md` (section « Aggregates ») sur le jeu de
 * démo une fois qu'il déclare deux racines d'agrégat partageant leurs
 * membres.
 */
export function separateClusters(
  positions: Map<NodeId, Rect>,
  aggregates: AggregateIndex,
  gap: number,
  iterations: number,
): void {
  if (positions.size < 2 || gap <= 0) return

  // 1. Les groupes de départ, dans un ordre stable : les agrégats d'abord
  //    (ordre de `aggregates`, qui suit la déclaration de la config), puis les
  //    entités hors de tout agrégat (ordre de `positions`, lui-même trié par
  //    id).
  const groups: NodeId[][] = []
  for (const aggregate of aggregates.aggregates.values()) {
    const members: NodeId[] = []
    for (const id of aggregate.memberIds) {
      if (positions.has(id)) members.push(id)
    }
    if (members.length > 0) groups.push(members)
  }
  for (const id of positions.keys()) {
    if ((aggregates.byNode.get(id)?.length ?? 0) > 0) continue
    groups.push([id])
  }
  if (groups.length < 2) return

  // 2. Union-find : deux groupes qui partagent une entité n'en font qu'un.
  //    La fusion est TRANSITIVE — A partage avec B, B avec C, donc les trois
  //    se déplacent ensemble.
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]!
    // Compression de chemin, sans effet sur le résultat mais sur le coût.
    while (parent[i] !== root) {
      const next = parent[i]!
      parent[i] = root
      i = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    // Toujours vers le plus petit indice : la fusion ne dépend pas de l'ordre
    // de découverte, donc le résultat reste déterministe.
    if (ra === rb) return
    if (ra < rb) parent[rb] = ra
    else parent[ra] = rb
  }

  const firstGroupOf = new Map<NodeId, number>()
  groups.forEach((members, index) => {
    for (const id of members) {
      const seen = firstGroupOf.get(id)
      if (seen === undefined) firstGroupOf.set(id, index)
      else union(seen, index)
    }
  })

  // 3. Matérialisation des super-clusters, dans l'ordre de leur plus petit
  //    groupe d'origine. Une entité n'appartient plus qu'à UN seul d'entre eux,
  //    donc sa translation est sans ambiguïté.
  const byRoot = new Map<number, SuperCluster>()
  const clusterOf = new Map<NodeId, SuperCluster>()
  groups.forEach((members, index) => {
    const root = find(index)
    let cluster = byRoot.get(root)
    if (!cluster) {
      cluster = { members: [], box: { x: 0, y: 0, width: 0, height: 0 }, originX: 0, originY: 0 }
      byRoot.set(root, cluster)
    }
    for (const id of members) {
      if (clusterOf.has(id)) continue // déjà compté via un autre groupe fusionné
      clusterOf.set(id, cluster)
      cluster.members.push(id)
    }
  })
  const clusters = [...byRoot.values()]
  if (clusters.length < 2) return
  for (const cluster of clusters) {
    cluster.box = boundingBox(positions, cluster.members)
    cluster.originX = cluster.box.x
    cluster.originY = cluster.box.y
  }

  // 4. Relaxation sur les boîtes. Maille de la grille : la plus grande boîte
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

  // 5. Report sur les cartes : une translation par carte, celle de son
  //    super-cluster, donc rigide pour tout le monde.
  for (const [id, cluster] of clusterOf) {
    const rect = positions.get(id)!
    rect.x += cluster.box.x - cluster.originX
    rect.y += cluster.box.y - cluster.originY
  }
}
