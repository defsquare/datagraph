// Le PACKING INTRA-AGRÉGAT — le niveau 1 du moteur de la vue graphe, extrait
// de `graph-layout.ts` tel quel.
//
// C'est un sous-système FERMÉ, et c'est la raison du découpage : il ne connaît
// ni le `Graph`, ni les agrégats, ni les options du niveau 2. Il ne prend que
// des tailles de cartes, une adjacence `childrenOf` déjà triée et un `gap`, et
// rend des `Rect` locaux. Tout ce qu'il garantit — le non-recouvrement avec
// marge `gap`, par construction — se démontre sans rien savoir de l'appelant ;
// les preuves sont au-dessus de `packRadial` et de `packCluster`.
//
// Ce module n'est importé QUE par `graph-layout.ts`. Il ne figure ni dans le
// barrel `index.ts` ni dans les points d'entrée du package : il arrive dans le
// chunk paresseux `./graph-layout` par résolution, et les deux tests de pureté
// de bundle gardent cet invariant.
import type { NodeId } from "./model.js"
import type { Rect } from "./structure-layout.js"

/**
 * Rayon du disque englobant d'une carte : la demi-diagonale.
 *
 * C'est la pièce qui rend la géométrie des anneaux traitable. Une carte est un
 * rectangle axis-aligned posé à un angle quelconque autour d'un centre ; tester
 * le recouvrement de deux rectangles ainsi disposés demande de raisonner sur
 * quatre projections et deux positions angulaires. En les remplaçant par leurs
 * disques englobants, la condition devient une seule inégalité de distance,
 * indépendante de l'angle : deux cartes dont les disques sont disjoints d'au
 * moins `gap` sont disjointes d'au moins `gap`.
 *
 * C'est une condition SUFFISANTE, pas nécessaire — donc conservatrice. Ce
 * qu'elle coûte est borné et petit sur ces cartes : le disque déborde le
 * rectangle de `(diagonale − largeur) / 2`, soit 7,1 px pour une carte de
 * 340×100 et 4,6 px pour une de 140×49. Un test exact gagnerait ces quelques
 * pixels au prix d'une garantie qu'on ne saurait plus écrire en une ligne.
 */
function discRadiusOf(size: { width: number; height: number }): number {
  return Math.hypot(size.width, size.height) / 2
}

/**
 * Distance de référence de chaque membre à la racine, par BFS local sur les
 * références INTRA-agrégat.
 *
 * Le parcours remonte de la CIBLE vers la SOURCE, comme `buildAggregates` : une
 * commande pointe vers son client, donc elle est à distance 1 de lui. C'est ce
 * qui fait coïncider la distance d'anneau avec la distance d'appartenance qui a
 * formé le cluster. Les listes d'adjacence étant triées, la file est
 * déterministe et les égalités sont départagées par id.
 *
 * Les membres NON ATTEINTS ne figurent pas dans `dist`. Ils existent :
 * l'appartenance se calcule sur le graphe entier, la mise en page sur les
 * entités VISIBLES, donc un maillon intermédiaire masqué détache tout ce qui
 * pendait dessous. Ils sont rendus à part parce que les deux consommateurs les
 * traitent différemment — le placement radial leur donne un anneau
 * supplémentaire, le CRITÈRE de choix les ignore.
 */
function referenceDepths(
  memberIds: NodeId[],
  childrenOf: Map<NodeId, NodeId[]>,
): { dist: Map<NodeId, number>; parent: Map<NodeId, NodeId>; maxDist: number; orphans: NodeId[] } {
  const rootId = memberIds[0]!
  const memberSet = new Set(memberIds)
  const dist = new Map<NodeId, number>([[rootId, 0]])
  const parent = new Map<NodeId, NodeId>()
  const queue: NodeId[] = [rootId]
  let maxDist = 0

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const next = dist.get(current)! + 1
    for (const child of childrenOf.get(current) ?? []) {
      if (!memberSet.has(child) || dist.has(child)) continue
      dist.set(child, next)
      parent.set(child, current)
      queue.push(child)
      if (next > maxDist) maxDist = next
    }
  }

  const orphans: NodeId[] = []
  for (const id of memberIds) if (!dist.has(id)) orphans.push(id)
  return { dist, parent, maxDist, orphans }
}

/**
 * Packing en ÉTAGÈRES : lignes remplies de gauche à droite jusqu'à une largeur
 * cible en √(aire totale), chaque ligne centrée.
 *
 * Trivial, déterministe, dense — et non-recouvrant par construction, la marge
 * `gap` étant posée entre deux voisins de ligne comme entre deux lignes. Les
 * lignes sont CENTRÉES et non alignées à gauche : un bloc centré donne un
 * cercle englobant plus serré, donc un disque plus petit à écarter au niveau 2.
 *
 * La largeur cible en √(aire) vise un bloc à peu près carré ; `maxW` la borne
 * par le bas pour qu'une carte plus large que la cible ne parte jamais seule
 * sur une ligne débordante.
 *
 * C'est le mode le plus DENSE des deux, et c'est sa seule raison d'être ici :
 * il ne dit rien de la connectivité, et pose la racine en tête de la première
 * ligne, donc dans un coin. Voir `packCluster` pour savoir quand il l'emporte.
 */
function packShelf(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
): Map<NodeId, Rect> {
  let totalArea = 0
  let maxW = 0
  for (const id of memberIds) {
    const s = sizes.get(id)!
    totalArea += (s.width + gap) * (s.height + gap)
    if (s.width > maxW) maxW = s.width
  }
  const targetW = Math.max(maxW, Math.sqrt(totalArea))

  const rows: { ids: NodeId[]; width: number; height: number }[] = []
  let current: { ids: NodeId[]; width: number; height: number } = { ids: [], width: 0, height: 0 }
  for (const id of memberIds) {
    const s = sizes.get(id)!
    const w = s.width + (current.ids.length > 0 ? gap : 0)
    if (current.ids.length > 0 && current.width + w > targetW) {
      rows.push(current)
      current = { ids: [], width: 0, height: 0 }
    }
    current.ids.push(id)
    current.width += current.ids.length > 1 ? s.width + gap : s.width
    current.height = Math.max(current.height, s.height)
  }
  if (current.ids.length > 0) rows.push(current)

  const blockW = Math.max(...rows.map((r) => r.width))
  const local = new Map<NodeId, Rect>()
  let y = 0
  for (const row of rows) {
    let x = (blockW - row.width) / 2
    for (const id of row.ids) {
      const s = sizes.get(id)!
      local.set(id, { x, y, width: s.width, height: s.height })
      x += s.width + gap
    }
    y += row.height + gap
  }
  return local
}

/**
 * Placement RADIAL : la racine au centre, les autres membres sur des anneaux
 * concentriques, un anneau par distance de référence à la racine.
 *
 * Ce qu'il corrige, mesuré sur `deepAggregate()` — 41 cartes, quatre niveaux de
 * profondeur — contre le packing en étagères : la racine sortait **40e sur 41**
 * par proximité au centre de son propre disque, à 597,7 px de ce centre, et une
 * référence intra-agrégat mesurait 591,4 px en moyenne. Le tri par id posait la
 * racine en tête de la première ligne, c'est-à-dire dans un COIN du bloc — le
 * point le plus éloigné du centre du cercle englobant. En radial : racine 1re,
 * à 16,4 px du centre, référence moyenne 363,0 px et max 976,3 → 488,1 px.
 *
 * ── LA GARANTIE ────────────────────────────────────────────────────────────
 *
 * Non-recouvrement avec marge `gap`, par construction, en deux conditions
 * indépendantes. On raisonne sur les disques englobants (`discRadiusOf`), donc
 * sur des distances de centre à centre.
 *
 * **1. Entre deux cartes d'un même anneau.** Une carte de disque ρ posée à la
 * distance R du centre se voit allouer la largeur angulaire
 *
 *     α = 2·asin((ρ + gap/2) / R)
 *
 * qui est exactement l'angle sous lequel on voit, depuis le centre, un disque
 * de rayon `ρ + gap/2` centré à la distance R. Deux cartes consécutives i et j
 * sont posées à un écart angulaire d'au moins `α_i/2 + α_j/2`. Leur distance
 * de centre à centre est la corde `2R·sin(Δθ/2)`, et
 *
 *     2R·sin((x + y)/2)  ≥  R·sin x + R·sin y     avec x = asin(a/R), y = asin(b/R)
 *
 * parce que `sin x + sin y = 2·sin((x+y)/2)·cos((x−y)/2)` et que le cosinus
 * vaut au plus 1. Le membre de droite vaut `a + b = ρ_i + ρ_j + gap`. La corde
 * est donc toujours au moins égale à la somme des rayons plus la marge. C'est
 * cette identité trigonométrique, et rien d'autre, qui porte la garantie
 * intra-anneau — elle vaut pour toute paire, pas seulement pour des voisines,
 * puisque l'écart angulaire ne fait que croître entre non-voisines.
 *
 * La condition de bouclage est donc `Σα_i ≤ 2π` : c'est elle qui garantit que
 * la DERNIÈRE carte et la PREMIÈRE, qui se rejoignent par l'autre côté, sont
 * elles aussi assez écartées.
 *
 * **2. Entre deux cartes d'anneaux différents.** Le rayon d'un anneau est posé
 * à `R_k = R_{k−1} + ρmax_{k−1} + ρmax_k + gap`. Deux cartes d'anneaux
 * différents sont donc distantes d'au moins `R_k − R_{k−1}` (le pire cas est
 * l'alignement radial), soit au moins `ρ_i + ρ_j + gap`. Les anneaux non
 * consécutifs le sont a fortiori, R croissant.
 *
 * ── SCISSION D'UN ANNEAU ───────────────────────────────────────────────────
 *
 * Un anneau de N cartes ne « déborde » jamais au sens où il échouerait : on
 * pourrait toujours grossir R jusqu'à ce que `Σα ≤ 2π`. Mais ce R croît
 * linéairement en N, alors que le scinder en deux demi-anneaux fait croître
 * deux rayons de N/2 chacun — et deux anneaux séparés par une hauteur de carte
 * coûtent bien moins que le double du rayon. On remplit donc l'anneau
 * GLOUTONNEMENT au rayon minimal autorisé par la condition 2, et ce qui ne
 * tient pas part sur un anneau suivant, à la MÊME distance logique. Les
 * sous-anneaux se comportent en tout point comme des anneaux pour la condition
 * 2, donc la garantie traverse la scission sans changement.
 *
 * Le remplissage se termine toujours : `α ≤ π` pour toute carte (l'`asin` est
 * borné par π/2), donc au moins une carte tient sur chaque sous-anneau.
 *
 * ── ORDRE ──────────────────────────────────────────────────────────────────
 *
 * À l'intérieur d'un anneau, les cartes sont ordonnées par ANGLE DU PARENT puis
 * par id : un enfant se pose près de son parent, ce qui est ce qui raccourcit
 * les chaînes de références. Les ORPHELINS (voir `referenceDepths`) forment un
 * anneau supplémentaire au-delà du dernier ; ils n'ont pas de parent, retombent
 * sur l'angle 0, et leur id tranche.
 */
function packRadial(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  depths: ReturnType<typeof referenceDepths>,
): Map<NodeId, Rect> {
  const local = new Map<NodeId, Rect>()
  const rootId = memberIds[0]!

  const rectFor = (id: NodeId, cx: number, cy: number) => {
    const s = sizes.get(id)!
    local.set(id, { x: cx - s.width / 2, y: cy - s.height / 2, width: s.width, height: s.height })
  }

  rectFor(rootId, 0, 0)
  if (memberIds.length === 1) return local

  const { dist, parent, orphans } = depths
  let maxDist = depths.maxDist
  if (orphans.length > 0) {
    maxDist++
    for (const id of orphans) dist.set(id, maxDist)
  }

  const rings: NodeId[][] = Array.from({ length: maxDist + 1 }, () => [])
  for (const id of memberIds) {
    if (id !== rootId) rings[dist.get(id)!]!.push(id)
  }

  const angleOf = new Map<NodeId, number>([[rootId, 0]])
  let prevR = 0
  let prevMaxRho = discRadiusOf(sizes.get(rootId)!)

  for (let k = 1; k <= maxDist; k++) {
    const pending = rings[k]!.slice().sort((a, b) => {
      const pa = angleOf.get(parent.get(a) ?? rootId) ?? 0
      const pb = angleOf.get(parent.get(b) ?? rootId) ?? 0
      return pa !== pb ? pa - pb : a < b ? -1 : 1
    })

    let from = 0
    while (from < pending.length) {
      // ρmax est pris sur tout ce qui RESTE à poser, et non sur ce qui tiendra
      // sur ce sous-anneau : il faut R pour savoir ce qui tient, et ρmax pour
      // savoir R. Prendre le max du reste est le choix conservateur, donc sûr.
      let maxRho = 0
      for (let i = from; i < pending.length; i++) {
        maxRho = Math.max(maxRho, discRadiusOf(sizes.get(pending[i]!)!))
      }
      const R = prevR + prevMaxRho + maxRho + gap

      const widths: number[] = []
      let sum = 0
      let to = from
      while (to < pending.length) {
        const rho = discRadiusOf(sizes.get(pending[to]!)!)
        const a = 2 * Math.asin(Math.min(1, (rho + gap / 2) / R))
        if (to > from && sum + a > 2 * Math.PI) break
        widths.push(a)
        sum += a
        to++
      }

      // Le jeu restant est réparti également entre les N intervalles (les N−1
      // internes plus celui du bouclage) : les cartes s'étalent au lieu de se
      // tasser sur un arc en laissant un trou. Ça ne fait qu'AUGMENTER les
      // écarts, donc la garantie est intacte.
      const n = to - from
      const slack = (2 * Math.PI - sum) / n

      // Rotation rigide de tout le sous-anneau pour que sa première carte se
      // pose à l'angle de son parent. Rigide, donc sans effet sur la garantie.
      const firstParent = parent.get(pending[from]!)
      const offset = (firstParent !== undefined ? (angleOf.get(firstParent) ?? 0) : 0) - widths[0]! / 2

      let theta = offset
      let placedMaxRho = 0
      for (let i = from; i < to; i++) {
        const id = pending[i]!
        const a = widths[i - from]!
        theta += i === from ? a / 2 : a / 2 + slack
        angleOf.set(id, theta)
        rectFor(id, R * Math.cos(theta), R * Math.sin(theta))
        theta += a / 2
        placedMaxRho = Math.max(placedMaxRho, discRadiusOf(sizes.get(id)!))
      }

      prevR = R
      prevMaxRho = placedMaxRho
      from = to
    }
  }

  return local
}

/**
 * Aiguillage entre les deux modes de placement, par cluster.
 *
 * ── LE CRITÈRE : LA PROFONDEUR, PAS LE CARDINAL ────────────────────────────
 *
 * Radial si et seulement si **au moins un membre est à distance de référence
 * ≥ 2 de la racine**. Étagères sinon.
 *
 * Ce que fait le radial, c'est ENCODER LA PROFONDEUR DE RÉFÉRENCE EN DISTANCE
 * AU CENTRE. À profondeur ≤ 1, il n'y a rien à encoder : tous les non-racines
 * sont à la même distance, ils se retrouvent sur un unique anneau, et la
 * structure lue par l'œil ne dit rien de plus que « ces cartes appartiennent à
 * cette racine » — ce que l'enveloppe disait déjà. Le radial n'y apporte que
 * son coût.
 *
 * Et ce coût est mesuré. Le radial est moins dense partout, parce qu'un anneau
 * paie un diamètre de carte de rayon même s'il ne porte qu'une carte. Rayon du
 * disque, étagères → radial : 2 cartes 162 → 209 px (×1,29), 3 cartes 225 → 335
 * (×1,49), 5 cartes sur un anneau 258 → 371 (×1,44). Répercuté sur les jeux
 * réels, en radial partout : remplissage 12,3 → 7,8 % sur `bigShop(3000)` et
 * 15,1 → 10,9 % sur celui de la démo — pour zéro gain, leurs agrégats étant
 * tous plats.
 *
 * Le critère ne mentionne AUCUNE taille, et c'est délibéré. Un seuil par
 * cardinal aurait été ajusté aux fixtures : celui qui annulait le coût sur les
 * jeux du dépôt valait exactement leur taille maximale d'agrégat (5), ce qui
 * n'est pas une raison mais une coïncidence qu'on aurait gravée. Le critère de
 * profondeur, lui, est ajusté à la RAISON D'ÊTRE du radial, et se prononce sans
 * rien savoir du nombre de cartes.
 *
 * ── LES ORPHELINS SONT EXCLUS DU CRITÈRE ───────────────────────────────────
 *
 * Un membre non atteint par le BFS local (maillon intermédiaire masqué, voir
 * `referenceDepths`) reçoit en radial un anneau SYNTHÉTIQUE au-delà du dernier.
 * Cet anneau-là ne doit pas déclencher le radial : il ne traduit aucune
 * profondeur de référence, seulement une absence d'information. Sans cette
 * exclusion, un agrégat parfaitement plat dont une carte serait détachée
 * basculerait en radial et en paierait le prix pour rien. Le critère lit donc
 * `depths.dist`, qui ne contient que les membres réellement atteints.
 *
 * ── CE QUE LES DEUX MODES PARTAGENT ────────────────────────────────────────
 *
 * La même signature, et la même garantie : non-recouvrement avec marge `gap`
 * par construction. Chacun l'obtient à sa manière — les étagères par des lignes
 * et des colonnes séparées de `gap`, le radial par la géométrie des cordes
 * démontrée au-dessus de `packRadial` —, et le reste du moteur n'a pas à savoir
 * lequel a répondu.
 */
export function packCluster(
  memberIds: NodeId[],
  sizes: Map<NodeId, { width: number; height: number }>,
  gap: number,
  /** Membres du cluster référençant la clé — l'adjacence inverse, triée. */
  childrenOf: Map<NodeId, NodeId[]>,
): Map<NodeId, Rect> {
  if (memberIds.length === 1) {
    // Une seule carte : les deux modes donnent le même résultat au recentrage
    // près, et le BFS n'aurait rien à parcourir.
    const s = sizes.get(memberIds[0]!)!
    return new Map([[memberIds[0]!, { x: 0, y: 0, width: s.width, height: s.height }]])
  }

  const depths = referenceDepths(memberIds, childrenOf)
  let deep = false
  for (const d of depths.dist.values()) {
    if (d >= 2) {
      deep = true
      break
    }
  }
  return deep ? packRadial(memberIds, sizes, gap, depths) : packShelf(memberIds, sizes, gap)
}

