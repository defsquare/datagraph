import type { AggregateIndex } from "./aggregate.js"
import { enclosingCircle } from "./hull.js"
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
  /** Centre de l'enveloppe, déplacé en place par la relaxation. */
  cx: number
  cy: number
  /** Rayon de l'enveloppe, marge comprise. Invariant : la passe ne fait que
   * translater, donc le rayon ne bouge jamais. */
  r: number
  /** Centre d'origine, pour en déduire la translation totale. */
  originX: number
  originY: number
}

/**
 * Écarte les **agrégats** les uns des autres, **en place**, jusqu'à laisser au
 * moins `gap` entre les bords de deux enveloppes voisines.
 *
 * L'enveloppe d'un cluster est le **cercle englobant minimal** de ses cartes,
 * rayon augmenté de `padding` — exactement la forme que le renderer peint
 * (`drawClusters`, `computeClusters`). C'est ce qui rend la passe honnête :
 * elle écarte la forme qu'on voit, pas une approximation. La version
 * précédente relaxait des boîtes englobantes axiales alors que le renderer
 * traçait une enveloppe convexe : les deux formes ne coïncidaient nulle part,
 * et le couloir mesuré n'était pas celui qu'on regardait.
 *
 * Deux cercles se poussent le long de la droite de leurs centres, chacun
 * encaissant la moitié du déplacement, jusqu'à ce que la distance entre centres
 * atteigne `r₁ + r₂ + gap`. C'est plus simple que la relaxation sur boîtes
 * qu'elle remplace : un seul axe de poussée, celui des centres, au lieu d'un
 * choix entre deux pénétrations axiales. Le reste ne change pas — voisinage par
 * grille de hachage, ordre d'itération stable donc déterminisme, sortie
 * anticipée sous `EPSILON`.
 *
 * Elle s'applique après `separateOverlaps` : celle-là garantit qu'aucune carte
 * n'en recouvre une autre, celle-ci ouvre les couloirs entre agrégats pour que
 * les enveloppes se lisent.
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
 *    carte, donc ils se déplacent ensemble.
 *
 *    **Cette garantie ne se déclenche plus.** Depuis que l'appartenance est
 *    une PARTITION stricte — `buildAggregates` arbitre les égalités de
 *    distance par l'ordre de déclaration du type de la racine —, aucune entité
 *    n'appartient à deux agrégats, donc l'union-find ne fusionne jamais rien
 *    et un super-cluster est toujours exactement un agrégat.
 *
 *    Ce n'est pas pour autant du code mort, et ce n'est pas non plus une
 *    fonctionnalité : c'est ce qui GARANTIT que la translation reste rigide.
 *    L'étape 5 ne tient que parce qu'une carte n'appartient qu'à un seul
 *    super-cluster, et c'est l'union-find qui l'assure — pas la règle
 *    d'appartenance, qui est un choix de produit et peut changer. Le
 *    supprimer laisserait un piège armé : la passe reprendrait alors
 *    silencieusement le défaut mesuré ci-dessus, sans qu'aucun test de la
 *    règle actuelle ne le voie. `cluster-separate.test.ts` continue de le
 *    couvrir, sur des index d'agrégats montés à la main.
 *
 * Une entité hors de tout agrégat forme un cluster d'un seul : sans quoi elle
 * resterait posée à l'intérieur de l'enveloppe d'un voisin qui ne la contient
 * pas.
 *
 * Corollaire, à ne PLUS invoquer devant une sortie qui semble « ne rien
 * faire » : quand tous les agrégats se retrouvaient transitivement reliés par
 * un membre partagé, il n'y avait qu'un super-cluster et la passe était inerte
 * — mesuré sur le jeu de la démo, 108 agrégats fondus en un bloc de 342 cartes
 * sur 350. C'était le symptôme du chevauchement, et il a disparu avec lui :
 * la même donnée donne aujourd'hui 116 super-clusters, le plus gros de 5
 * cartes. Voir `packages/core/README.md`, section « Aggregates ».
 */
export function separateClusters(
  positions: Map<NodeId, Rect>,
  aggregates: AggregateIndex,
  gap: number,
  iterations: number,
  padding: number,
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
  //    se déplacent ensemble. Ne se déclenche plus sous la règle
  //    d'appartenance actuelle ; c'est voulu, voir la doc ci-dessus.
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
      cluster = { members: [], cx: 0, cy: 0, r: 0, originX: 0, originY: 0 }
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
    const circle = enclosingCircle(
      cluster.members.map((id) => positions.get(id)!),
      padding,
    )
    cluster.cx = circle.cx
    cluster.cy = circle.cy
    cluster.r = circle.r
    cluster.originX = circle.cx
    cluster.originY = circle.cy
  }

  // 4. Relaxation sur les cercles. Maille de la grille : le plus grand diamètre
  //    augmenté de `gap`, donc toute paire trop proche — dont les centres sont
  //    à moins de `r₁ + r₂ + gap ≤ maille` — tombe dans des cellules adjacentes.
  let cell = 0
  for (const cluster of clusters) cell = Math.max(cell, 2 * cluster.r + gap)
  if (cell <= 0) return

  for (let pass = 0; pass < iterations; pass++) {
    const buckets = new Map<string, number[]>()
    clusters.forEach((cluster, index) => {
      const key = `${Math.floor(cluster.cx / cell)},${Math.floor(cluster.cy / cell)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index)
      else buckets.set(key, [index])
    })

    let moved = false
    const seen = new Set<string>()
    for (let index = 0; index < clusters.length; index++) {
      const a = clusters[index]!
      const cx = Math.floor(a.cx / cell)
      const cy = Math.floor(a.cy / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other === index) continue
            const pair = index < other ? `${index} ${other}` : `${other} ${index}`
            if (seen.has(pair)) continue
            seen.add(pair)

            const b = clusters[other]!
            const wanted = a.r + b.r + gap
            let vx = b.cx - a.cx
            let vy = b.cy - a.cy
            let distance = Math.hypot(vx, vy)
            if (wanted - distance <= EPSILON) continue

            moved = true
            if (distance <= EPSILON) {
              // Centres confondus : la direction de poussée est indéterminée.
              // On prend l'axe des x, arbitraire mais FIXE — un tirage, même
              // à graine, casserait le déterminisme au pixel de la vue.
              vx = 1
              vy = 0
              distance = 1
            }
            const push = (wanted - distance) / 2 / distance
            a.cx -= vx * push
            a.cy -= vy * push
            b.cx += vx * push
            b.cy += vy * push
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
    rect.x += cluster.cx - cluster.originX
    rect.y += cluster.cy - cluster.originY
  }
}
