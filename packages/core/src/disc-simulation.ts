// Le NIVEAU 2 du moteur de la vue graphe — l'écartement des disques —, extrait
// de `graph-layout.ts` tel quel.
//
// Comme le packing du niveau 1, c'est un sous-système fermé, et c'est ce qui
// justifie le module : il ne connaît ni le `Graph`, ni les agrégats, ni les
// `Rect`. Son univers est une liste de disques `{ id, r, x, y }` et une liste
// de paires d'ids à rapprocher. Ce qu'il rend est la position de chaque disque,
// écrite EN PLACE sur les objets passés — l'appelant y raccroche ce qu'il veut
// (voir `LocalCluster` dans `graph-layout.ts`).
//
// L'`id` sert à deux choses, et à rien d'autre : identifier une paire de
// ressorts, et alimenter `hashOf`, qui est toute la source de pseudo-aléa du
// moteur. C'est pourquoi elle vit ici et pas dans `graph-pack.ts`, qui n'en a
// aucun besoin — le packing est entièrement déterminé par les tailles et
// l'adjacence.
//
// Ce module n'est importé QUE par `graph-layout.ts`. Il ne figure ni dans le
// barrel `index.ts` ni dans les points d'entrée du package : il arrive dans le
// chunk paresseux `./graph-layout` par résolution, et les deux tests de pureté
// de bundle gardent cet invariant.

/** Hachage FNV-1a de l'id — le MÊME que celui du moteur retiré, et pour la
 * même raison : c'est toute la source d'« aléa » du moteur. Aucun `Math.random`
 * ni `Date.now` n'intervient nulle part ici, sans quoi le déterminisme au bit
 * près, asserté par les tests, tomberait. */
function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Les trois constantes de la simulation, sorties du corps de la boucle où elles
// étaient écrites en dur. Elles ne sont pas réglables : ce sont les trois
// premières du balayage documenté dans `TWO_LEVEL_LAYOUT_DEFAULTS`
// (`graph-layout.ts`), qui les confirme et donne les tableaux de mesure. La
// quatrième, `simIterations`, EST réglable et arrive par les options.

/** Force de ressort. Minimum exact sur le fixture dense du balayage : au-delà,
 * les ressorts tirent si fort que la passe dure les contredit et que les
 * références RALLONGENT. */
const SPRING_FORCE = 0.15
/** Dénominateur du plafond de poids `min(1, w/N)` — le N=2 du balayage. */
const WEIGHT_CAP_DIVISOR = 2
/** Gravité vers l'origine, par unité d'`alpha`. */
const GRAVITY = 0.02
/** Plafond de passes dures. Relevé de 1000 à 5000 au portage : voir la
 * justification mesurée au-dessus de `hardSeparation`. */
const MAX_HARD_PASSES = 5000

/**
 * Un disque du niveau 2. `x`/`y` sont écrits en place par `layoutDiscs` ;
 * `id` et `r` sont des entrées et ne sont jamais modifiés.
 */
export interface Disc {
  id: string
  r: number
  x: number
  y: number
}

export interface DiscSimulationOptions {
  clusterGap: number
  simIterations: number
  jitter: number
}

/** Un ressort agrégé : deux INDICES dans le tableau de disques, et un poids. */
interface Spring {
  a: number
  b: number
  w: number
}

/**
 * Amorçage déterministe sur un disque proportionné à l'aire totale des
 * disques — même idée que le `seedPosition` du moteur retiré, mais à la
 * granularité de l'agrégat et non de la carte.
 */
function seedDiscs(discs: Disc[], clusterGap: number): void {
  let discArea = 0
  for (const c of discs) discArea += (2 * c.r + clusterGap) ** 2
  const seedRadius = Math.sqrt(discArea) * 0.75
  for (const c of discs) {
    const h = hashOf(c.id)
    const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI
    const rr = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * seedRadius
    c.x = rr * Math.cos(angle)
    c.y = rr * Math.sin(angle)
  }
}

/**
 * Arêtes inter-disques agrégées : une seule par paire, de poids le nombre de
 * références qui la traversent. Les paires dont les deux bouts sont le MÊME
 * disque sont ignorées — elles ne peuvent rien tirer, le disque étant rigide, et
 * le placement radial les a déjà consommées au niveau 1.
 *
 * `pairs` arrive dans l'ordre de la source, et c'est volontairement le seul
 * ordre qui entre ici : le tri par clé plus bas l'efface.
 */
function aggregateSprings(discs: Disc[], pairs: Iterable<readonly [string, string]>): Spring[] {
  const edgeWeight = new Map<string, Spring>()
  const index = new Map<string, number>()
  discs.forEach((c, i) => index.set(c.id, i))
  for (const [ca, cb] of pairs) {
    if (ca === cb) continue
    const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca]
    const key = `${lo} ${hi}`
    const found = edgeWeight.get(key)
    if (found) found.w++
    else edgeWeight.set(key, { a: index.get(lo)!, b: index.get(hi)!, w: 1 })
  }
  // Tri par clé : l'ordre d'itération d'une Map suit l'insertion, donc l'ordre
  // des paires reçues. Il est stable en pratique, mais l'addition flottante
  // n'étant pas associative, on ne s'en remet pas à lui.
  return [...edgeWeight.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, v]) => v)
}

/**
 * GONFLEMENT VIRTUEL — le bruit déterministe qui casse le pavage.
 *
 * Le problème : la gravité et la collision, sur des disques de MÊME rayon,
 * convergent vers l'empilement hexagonal, qui est l'optimum de densité de
 * cercles égaux. Sur `bigShop(3000)` — 167 agrégats identiques, aucune arête
 * entre eux — le résultat est un pavage quasi hexagonal parfaitement
 * régulier, et ça se lit comme une grille plutôt que comme un graphe. La
 * signature chiffrée de cette régularité : l'écart au plus proche voisin
 * entre disques a un écart-type de **0,00 px**, tout le monde exactement à
 * `clusterGap`.
 *
 * Le mécanisme : chaque cluster se voit attribuer un rayon GONFLÉ, `r +
 * jitter_i`, avec `jitter_i` tiré du hachage de son id — donc stable d'une
 * exécution à l'autre, et sans rapport avec sa position d'amorçage (le
 * hachage porte un suffixe distinct, sans quoi les deux tirages seraient
 * corrélés). La SIMULATION SEULE travaille avec ce rayon gonflé.
 *
 * Trois propriétés, dans l'ordre d'importance :
 *
 * 1. **Les garanties sont rigoureusement inchangées.** La passe dure finale
 *    utilise le VRAI rayon et le vrai `clusterGap` ; c'est elle, et elle
 *    seule, qui porte l'invariant de sortie. Un jitter arbitrairement grand
 *    ne pourrait pas produire un recouvrement, seulement un layout plus
 *    aéré.
 * 2. **La forme peinte n'est jamais gonflée.** `jitter` n'entre ni dans
 *    `LocalCluster.r`, ni dans le cercle englobant, ni dans `ClusterShape` :
 *    la forme dessinée reste exactement la forme minimale des cartes.
 * 3. **C'est la variance qui casse le pavage**, pas un déplacement. Les
 *    voisins se posent à un écart réparti dans
 *    `[clusterGap, clusterGap + jitter_i + jitter_j]` au lieu de tous tomber
 *    sur `clusterGap` : les disques ne peuvent plus former un réseau
 *    régulier puisqu'ils ne demandent plus tous la même place.
 *
 * C'est l'UNIQUE source de bruit du moteur. Aucun angle, aucune position, ni
 * aucune constante n'est perturbée ailleurs, et il n'y a toujours ni
 * `Math.random` ni `Date.now` : le déterminisme au bit près reste testé.
 */
function virtualRadii(discs: Disc[], jitter: number): number[] {
  return discs.map((c) => {
    if (jitter <= 0) return c.r
    // Suffixe `:jitter` : décorrèle ce tirage de celui de l'amorçage, qui
    // hache le même id juste au-dessus.
    return c.r + (hashOf(`${c.id}:jitter`) / 0xffffffff) * jitter
  })
}

/**
 * UNE passe de collision disque-disque sur toutes les paires, en O(k²).
 *
 * Un seul corps pour les DEUX usages du moteur — la collision intégrée à la
 * simulation et la passe dure finale —, qui ne diffèrent que par trois
 * paramètres : les rayons (virtuels et gonflés pendant la simulation, réels
 * dans la passe dure), la garde (`0` pendant la simulation, `1e-6` dans la
 * passe dure, qui a besoin d'un seuil de convergence), et l'usage du retour.
 *
 * L'ordre des opérations flottantes est celui des deux boucles d'origine, à
 * l'identique : `radii[i] + radii[j] + gap` a les mêmes opérandes dans le même
 * ordre que `simR[i] + simR[j] + gap` comme que `a.r + b.r + gap` (l'appelant
 * passe alors le tableau des vrais rayons), et `min - slack` avec `slack = 0`
 * vaut exactement `min` en IEEE-754. Le calcul de `worst`, que la simulation
 * ignore, n'écrit rien qui entre dans une position.
 *
 * Rend la pire violation rencontrée, ou `0` si aucune paire n'a franchi la
 * garde.
 */
function collisionPass(discs: Disc[], radii: number[], gap: number, slack: number): number {
  let worst = 0
  for (let i = 0; i < discs.length; i++) {
    const a = discs[i]!
    for (let j = i + 1; j < discs.length; j++) {
      const b = discs[j]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const min = radii[i]! + radii[j]! + gap
      const d = Math.hypot(dx, dy)
      if (d >= min - slack) continue
      // Deux centres confondus : la direction de poussée est indéterminée.
      // On la tire des ids plutôt que de diviser par zéro — l'ancien
      // `separateClusters`, retiré du dépôt, réglait le même cas avec un axe
      // fixe.
      const ux = d > 1e-9 ? dx / d : Math.cos((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
      const uy = d > 1e-9 ? dy / d : Math.sin((hashOf(a.id + b.id) / 0xffffffff) * 2 * Math.PI)
      const push = (min - d) / 2
      if (min - d > worst) worst = min - d
      a.x -= ux * push
      a.y -= uy * push
      b.x += ux * push
      b.y += uy * push
    }
  }
  return worst
}

/**
 * Ressorts + gravité + collision disque-disque, sur k disques.
 * `alpha` décroît linéairement : recuit simple, les grands déplacements en
 * début de simulation, les ajustements à la fin.
 */
function simulate(
  discs: Disc[],
  springs: Spring[],
  simR: number[],
  iterations: number,
  clusterGap: number,
): void {
  const I = iterations
  for (let it = 0; it < I; it++) {
    const alpha = 1 - it / I

    for (const s of springs) {
      const a = discs[s.a]!
      const b = discs[s.b]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      // Longueur idéale = la position de repos autorisée par la contrainte de
      // collision. Un ressort ne demande donc jamais l'impossible.
      const ideal = simR[s.a]! + simR[s.b]! + clusterGap
      // Poids PLAFONNÉ : dix références entre deux agrégats ne doivent pas
      // tirer dix fois plus fort qu'une seule, sinon une paire très couplée
      // écrase le reste du graphe.
      const k = Math.min(1, s.w / WEIGHT_CAP_DIVISOR)
      const f = ((d - ideal) / d) * SPRING_FORCE * alpha * k
      a.x += dx * f
      a.y += dy * f
      b.x -= dx * f
      b.y -= dy * f
    }

    // Gravité vers l'origine : sans elle, les composantes disjointes (167
    // agrégats sans aucune arête entre eux, cf. bigShop) n'auraient aucune
    // raison de se rapprocher et la bbox exploserait.
    const g = GRAVITY * alpha
    for (const c of discs) {
      c.x -= c.x * g
      c.y -= c.y * g
    }

    collisionPass(discs, simR, clusterGap, 0)
  }
}

/**
 * Passe dure finale. La collision intégrée à la simulation n'est qu'une
 * force parmi d'autres : ressorts et gravité peuvent la contredire à
 * l'itération suivante. Cette passe-ci ne fait QUE séparer, jusqu'à
 * convergence, ce qui fait de dist ≥ r₁ + r₂ + `clusterGap` un invariant de
 * sortie et non un espoir de convergence. C'est elle qui porte la garantie
 * que les tests assertent, et elle prime délibérément sur la longueur des
 * ressorts.
 *
 * DEUX ÉCARTS AVEC LA SONDE, les seuls du portage, tous deux MESURÉS.
 *
 * 1. La sonde sortait sur `worst < 1e-3` alors que sa garde de collision
 *    ignore les paires à moins de `1e-6` du but : la boucle s'arrêtait donc
 *    trois ordres de grandeur AVANT ce que sa propre garde considère comme
 *    séparé, et l'invariant réel valait `clusterGap − 1e-3`, pas
 *    `clusterGap − 1e-6`. Mesuré sur bigShop(3000) — 167 disques : sortie à
 *    la passe 338, résidu 9,301e-4 ; à `clusterGap: 400`, passe 424, résidu
 *    6,617e-4. Ce n'est pas du bruit flottant, c'est le seuil qui parle.
 *
 *    La sortie se fait donc ici sur `worst === 0`, c'est-à-dire « plus AUCUNE
 *    paire ne franchit la garde » — le seul seuil qui rende l'invariant de
 *    sortie égal à celui que la garde applique. Résidus alors mesurés :
 *    9,987e-7 à 167 disques, 9,758e-7 à 34, 4,914e-7 sur `shopData` — tous
 *    sous 1e-6, qui est bien le contrat que les tests assertent.
 *
 *    Ce que ça coûte : 338 → 538 passes à 167 disques, soit `layout()`
 *    complet de 157 à 194 ms — **+24 %**, et c'est le seul chiffre de ce
 *    paragraphe qui compare deux mesures prises ici, sur la même machine. Les
 *    143 ms et 1 624 ms cités en tête de `graph-layout.ts` sont ceux de la
 *    sonde, sur la sienne : le facteur d'accélération reste d'un ordre de
 *    grandeur, mais on ne le recalcule pas en divisant des mesures de machines
 *    différentes. Le surcoût achète un invariant qui n'est plus approximatif.
 *
 * 2. Le plafond passe de 1000 à 5000 passes. À 167 disques il n'est pas un
 *    coût — la sortie anticipée se déclenche à 538, soit 11 % du plafond, et
 *    le compteur ne l'atteint sur AUCUNE entrée du dépôt. Mais il n'était pas
 *    non plus une simple sécurité : mesuré sur bigShop(9000) — 1 000 cartes,
 *    500 disques —, la convergence demande 1 722 passes, donc un plafond de
 *    1000 la coupe en route et laisse un résidu de 2,925e-3, cent fois
 *    au-dessus du seuil. Autrement dit l'« invariant de sortie » cessait
 *    silencieusement d'en être un au-delà de ~200 disques. Avec 5000 il tient
 *    (résidu 9,988e-7), pour 3,6 s au lieu de 2,4 s à cette échelle-là — un
 *    cardinal qu'aucun jeu du dépôt n'atteint et où l'O(k²) de la simulation
 *    est de toute façon le vrai problème (voir la réserve en tête de
 *    `graph-layout.ts`).
 */
function hardSeparation(discs: Disc[], clusterGap: number): void {
  const realR = discs.map((c) => c.r)
  for (let pass = 0; pass < MAX_HARD_PASSES; pass++) {
    const worst = collisionPass(discs, realR, clusterGap, 1e-6)
    // `worst` ne prend que des violations franchissant la garde, donc il vaut
    // soit exactement 0 (converge), soit plus de 1e-6. Comparer à 0 est ici
    // exact, pas fragile : ce n'est pas une somme flottante qu'on espère
    // nulle, c'est un compteur qui n'a jamais été affecté.
    if (worst === 0) break
  }
}

/**
 * Le niveau 2 en entier : amorçage, ressorts, simulation, passe dure finale.
 *
 * `discs` est modifié EN PLACE (`x`/`y` seuls). `pairs` est la liste, dans un
 * ordre quelconque, des paires d'ids reliées par une référence — une paire par
 * référence, les doublons étant ce qui donne son poids au ressort.
 *
 * En sortie, `dist ≥ r_i + r_j + clusterGap` pour toute paire de disques est un
 * INVARIANT, pas un espoir de convergence : voir `hardSeparation`.
 */
export function layoutDiscs(
  discs: Disc[],
  pairs: Iterable<readonly [string, string]>,
  o: DiscSimulationOptions,
): void {
  seedDiscs(discs, o.clusterGap)
  const springs = aggregateSprings(discs, pairs)
  const simR = virtualRadii(discs, o.jitter)
  simulate(discs, springs, simR, o.simIterations, o.clusterGap)
  hardSeparation(discs, o.clusterGap)
}
