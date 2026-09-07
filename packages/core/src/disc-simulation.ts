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
/** Diviseur de la portée qui donne la maille de la grille de collision. C'est
 * un réglage de COÛT et de rien d'autre — l'exhaustivité de l'énumération est
 * assurée quelle que soit sa valeur, la fenêtre étant recalculée depuis la
 * maille. Balayé : voir le tableau au-dessus de `collisionPass`. */
const CELL_DIVISOR = 3

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

// ─── LES TAMPONS DE LA PASSE, RÉUTILISÉS D'UN APPEL À L'AUTRE ───
//
// `collisionPass` est appelée des milliers de fois par mise en page — 400 par
// `simulate`, ~4 000 par `hardSeparation` sur l'audit réel. Ré-allouer ses
// tableaux à chaque appel faisait du ramasse-miettes le deuxième poste du profil
// NAVIGATEUR (~0,8 s sur ce jeu) ; sous Node, dont le GC jeune est nettement
// moins cher, le même changement ne se lit qu'à quelques pour cent. Ils vivent
// donc au module, ne grandissent que quand ils sont trop petits, et sont
// réinitialisés — pas réalloués — là où l'algorithme suppose des zéros.
//
// Le changement est BIT-IDENTIQUE, et c'est vérifiable : sur l'audit réel, les
// 6 251 positions produites sont exactement les mêmes avec et sans réutilisation.
// C'est le contrat qu'il faut préserver en touchant à ce bloc — un tampon dont
// la queue n'est pas remise à zéro le romprait silencieusement, d'où le test
// « deux mises en page successives ne se marchent pas dessus par les tampons ».
//
// HYPOTHÈSE, et c'est la seule qui rende ce partage sûr : le module est
// MONO-THREAD et NON RÉENTRANT. Aucune fonction d'ici n'est `async`, aucune
// boucle ne rend la main, et `layoutDiscs` est le seul point d'entrée : deux
// mises en page concurrentes se corrompraient mutuellement. Si le niveau 2 part
// un jour dans un worker, ou si une passe devient interruptible, c'est ce
// paragraphe qu'il faut relire avant de toucher au reste.

/** Grille CSR : cellule de chaque disque, bornes de cellules, curseur de
 * remplissage, indices groupés par cellule. */
let bufCellOf: Int32Array = new Int32Array(0)
let bufStarts: Int32Array = new Int32Array(0)
let bufCursor: Int32Array = new Int32Array(0)
let bufItems: Int32Array = new Int32Array(0)
/** Le plus grand rayon présent dans chaque cellule, et le seuil d'élagage par
 * anneau du disque en cours. Cf. la section « la portée par cellule » du doc de
 * `collisionPass`. */
let bufCellRMax: Float64Array = new Float64Array(0)
let bufRingThreshold: Float64Array = new Float64Array(0)

function growI32(buf: Int32Array, len: number): Int32Array {
  return buf.length >= len ? buf : new Int32Array(len)
}
function growF64(buf: Float64Array, len: number): Float64Array {
  return buf.length >= len ? buf : new Float64Array(len)
}

/**
 * UNE passe de collision disque-disque, sur les seules paires PROCHES, énumérées
 * par une grille uniforme reconstruite au début de la passe.
 *
 * Un seul corps pour les DEUX usages du moteur — la collision intégrée à la
 * simulation et la passe dure finale —, qui ne diffèrent que par trois
 * paramètres : les rayons (virtuels et gonflés pendant la simulation, réels
 * dans la passe dure), la garde (`0` pendant la simulation, `1e-6` dans la
 * passe dure, qui a besoin d'un seuil de convergence), et l'usage du retour.
 *
 * Rend la pire violation rencontrée, ou `0` si aucune paire n'a franchi la
 * garde.
 *
 * ─── POURQUOI UNE GRILLE ───
 *
 * Cette passe était la double boucle sur toutes les paires, appelée jusqu'à 400
 * fois par `simulate` et 5000 fois par `hardSeparation` : c'est le seul point
 * chaud du niveau 2, les ressorts et la gravité étant déjà linéaires. À 167
 * disques le O(k²) ne se voyait pas ; sur un audit d'archi réel — ~1 300
 * disques — la mise en page dépassait la minute. Voir l'en-tête de
 * `graph-layout.ts` pour les mesures avant/après.
 *
 * ─── LA PORTÉE, LA FENÊTRE, ET CE QUI REND L'ÉNUMÉRATION EXHAUSTIVE ───
 *
 * La PORTÉE d'un disque i, `r_i + r_max + gap`, majore le `min` de TOUTE paire
 * qui le contient — `r_max` étant le maximum du tableau de rayons EN COURS, donc
 * les rayons GONFLÉS quand `simulate` appelle et les vrais quand
 * `hardSeparation` appelle : le dimensionnement suit le contrat que la passe
 * applique, pas un autre. L'inégalité `min ≤ portée` tient au bit près et pas
 * seulement « en maths » : l'arrondi au plus proche est monotone, donc
 * `fl(radii[j]) ≤ fl(r_max)` entraîne `fl(radii[i] + radii[j] + gap) ≤
 * fl(radii[i] + r_max + gap)`.
 *
 * La fenêtre de i est alors `ceil(portée_i / cell)` anneaux autour de sa
 * cellule, et elle est exhaustive : une paire violante a `d < min − slack ≤ min
 * ≤ portée_i`, donc `|Δx| ≤ d ≤ portée_i`, donc les deux indices de cellule en x
 * — planchers de deux réels distants d'au plus `portée_i / cell` — diffèrent d'au
 * plus `ceil(portée_i / cell)`. Idem en y.
 *
 * ─── LA TAILLE DE CELLULE : UN COMPROMIS, ET IL A ÉTÉ MESURÉ ───
 *
 * `cell = (2·r_max + gap) / 3`, soit une fenêtre de 2 à 3 anneaux. Ni la
 * correction ni l'exhaustivité n'en dépendent — seulement le coût, et le coût a
 * deux termes qui tirent en sens inverse : une cellule plus fine visite plus de
 * cellules (la fenêtre couvre la même portée) mais examine moins de candidats
 * hors de portée. Le diviseur 3 est l'optimum mesuré, et il l'est sur les deux
 * régimes de rayons que le moteur rencontre, qui n'ont pas le même optimum
 * théorique — d'où le compromis (ms de `layout()` complet) :
 *
 *   diviseur                             1        2        3        4
 *   audit réel, 1 300 disques         10 205    8 045    5 940    6 434
 *     (rayons étalés : médiane 306 px, max 1 856 px)
 *   même audit sans groupes, 1 955     3 688    3 691    3 749    3 832
 *     (un disque par entité, rayons quasi uniformes)
 *
 * Le premier régime paie cher une cellule grossière — 16 disques par cellule,
 * ~144 candidats par disque —, le second n'y gagne que 1,7 %. Une cellule au
 * diamètre MOYEN plutôt qu'au max a aussi été mesurée : meilleure sur le premier
 * régime (6,4 s) mais nettement pire sur le second (6,1 s contre 3,7 s), parce
 * qu'une poignée de très grosses cartes y écrase la moyenne sans réduire la
 * portée. Le diviseur du max est le seul réglage qui ne perde sur aucun des deux.
 *
 * ─── LA PORTÉE PAR CELLULE : LE MÊME LEMME, MAIS LOCAL ───
 *
 * Le compromis ci-dessus laissait un trou, et c'était LE point chaud de l'audit
 * réel : `r_max` est un maximum GLOBAL, donc un seul disque géant allonge la
 * portée — et la fenêtre — de tous les autres. Mesuré sur ce jeu : `r_max` vaut
 * 1 856 px pour un rayon médian de 306 px, d'où `cell` = 1 291 px, 360 cellules
 * dont 285 occupées (4,6 disques par cellule), une fenêtre moyenne de 2,13
 * anneaux, et **112 candidats examinés par disque et par passe** — alors que la
 * portée VRAIE d'un disque médian face à un autre disque médian est 772 px, soit
 * moins d'un anneau. On parcourait la banlieue du géant pour tout le monde.
 *
 * La correction ne touche pas la fenêtre — qui reste dimensionnée sur `r_max`,
 * donc exhaustive — mais élague CELLULE PAR CELLULE à l'intérieur, avec
 * exactement le lemme ci-dessus où `r_max` est remplacé par `cellRMax[c]`, le
 * plus grand rayon effectivement présent dans la cellule `c` :
 *
 *   pour tout j de la cellule c, `radii[j] ≤ cellRMax[c]` par construction, donc
 *   (arrondi au plus proche monotone, même argument qu'au-dessus)
 *   `min_ij ≤ fl(radii[i] + cellRMax[c] + gap) =: portée_i,c`. Une paire violante
 *   (i, j) avec j dans c a donc `|Δx| ≤ d < min_ij ≤ portée_i,c`, donc les
 *   indices de cellule en x diffèrent d'au plus `ceil(portée_i,c / cell)` ; idem
 *   en y ; donc la distance d'anneau `R = max(|Δcx|, |Δcy|)` vérifie
 *   `R ≤ ceil(portée_i,c / cell)`.
 *
 * Contraposée : si `R > ceil(portée_i,c / cell)`, la cellule c ne peut contenir
 * aucun partenaire violant de i, et on peut sauter ses items sans regarder. Le
 * test est écrit sans division, sous la forme équivalente `portée_i,c <
 * (R − 1)·cell` — pour R entier, `ceil(x) ≥ R ⟺ x > R − 1` —, ce qui donne un
 * seuil par anneau précalculé une fois par disque i dans `bufRingThreshold` :
 * une comparaison et deux indexations par cellule visitée, contre la dizaine de
 * candidats qu'elle contient.
 *
 * `cellRMax` est rempli dans la MÊME boucle que la grille, depuis le tableau de
 * rayons EN COURS — gonflés quand `simulate` appelle, réels quand
 * `hardSeparation` appelle —, exactement comme `r_max` : le dimensionnement suit
 * toujours le contrat que la passe applique. Il n'emprunte rien à un ordre
 * extérieur (un max est commutatif, et l'ordre de remplissage est celui des
 * indices), donc le déterminisme est intact.
 *
 * MESURE (`layout()` complet, médiane de 3 runs, même machine, avant → après
 * élagage) — et il faut lire les DEUX lignes, comme pour le diviseur de maille :
 *
 *   audit réel avec groupes, 1 300 disques     6 096 ms → 4 224 ms   (−31 %)
 *     (rayons étalés : médiane 306 px, max 1 856 px)
 *   même audit sans groupes, 6 251 disques    21 416 ms → 21 626 ms  (+1 %)
 *     (un disque par entité, rayons quasi uniformes)
 *
 * Le second régime ne gagne rien, et c'est attendu : sans géant, `cellRMax[c]`
 * vaut à peu près `r_max` partout et rien ne s'élague jamais. Ce qu'il faut,
 * c'est qu'il ne PERDE pas — et une première version perdait 12 % sur lui, parce
 * qu'elle payait la comparaison d'élagage sur des cellules vides, qui sont
 * l'écrasante majorité quand la grille est creuse. D'où le test de vacuité placé
 * avant, dans le corps.
 *
 * Le tableau de balayage du diviseur ci-dessus a été mesuré AVANT cet élagage :
 * ses temps absolus ne valent plus, et son verdict (diviseur 3, max plutôt que
 * moyenne) n'a pas été re-balayé depuis — l'élagage change précisément l'arbitrage
 * qui l'avait fixé, donc c'est un balayage à refaire si la question se repose.
 *
 * CE QUE L'ÉLAGAGE NE PROMET PAS : la suite des poussées n'est PAS identique à
 * celle d'avant. À positions FIXES il ne retire que des candidats prouvés non
 * violants, mais les poussées déplacent les disques pendant la passe, si bien
 * qu'une cellule élaguée sur l'état indexé peut abriter un partenaire devenu
 * proche entre-temps. C'est le même phénomène que l'index périmé traité juste
 * en dessous, et il se règle par le même argument : seule la passe à
 * `worst === 0` conclut, et sur celle-là rien n'a bougé, donc l'élagage y est
 * exact. Les trajectoires diffèrent — l'enveloppe de l'audit réel grandit de
 * 2,5 % —, ce que les tests autorisent puisqu'ils assertent des propriétés.
 *
 * Corollaire pratique, parce qu'il se paie cher quand on l'oublie : `cellRMax`
 * DOIT être alimenté par le tableau `radii` de la passe en cours — gonflé sous
 * `simulate`, réel sous `hardSeparation`. Le prendre sur `Disc.r` marcherait
 * sous `hardSeparation`, où les deux coïncident, et sous-estimerait les rayons
 * gonflés de la simulation, cassant la majoration `radii[j] ≤ cellRMax[c]` sans
 * qu'aucun test puisse le voir — la simulation ne porte aucune garantie.
 *
 * ─── L'INDEX EST PÉRIMABLE, ET L'INVARIANT DE SORTIE RESTE PROUVÉ ───
 *
 * La grille est construite au début de la passe, mais les poussées déplacent les
 * disques PENDANT la passe : à partir de la première poussée, l'index décrit des
 * positions qui n'existent plus et l'énumération peut manquer une paire. C'est
 * acceptable pendant la convergence — la passe suivante reconstruit l'index et
 * la voit —, et ça ne change rien à la garantie de sortie :
 *
 *   une passe qui rend `worst === 0` n'a poussé AUCUNE paire (c'est la
 *   définition de `worst`), donc n'a déplacé aucun disque, donc son index est
 *   resté valide du premier au dernier candidat. Sur cette passe-là, et c'est la
 *   seule dont `hardSeparation` tire une conclusion, « aucune violation trouvée »
 *   est un énoncé EXACT sur les positions finales.
 *
 * L'exhaustivité à positions fixes n'est donc pas un détail de performance :
 * c'est l'hypothèse de cette preuve. Rétrécir la fenêtre « pour aller plus vite »
 * casserait l'invariant que les tests vérifient par force brute.
 *
 * ─── DÉTERMINISME ───
 *
 * L'index ne doit RIEN emprunter à un ordre venu de l'extérieur, sans quoi le
 * déterminisme au bit près tomberait. Il n'emprunte qu'aux indices du tableau et
 * aux positions, elles-mêmes déterministes : les cellules sont remplies en
 * parcourant `i` croissant (donc chaque cellule liste ses disques dans l'ordre
 * des indices), la boucle externe va en `i` croissant, la fenêtre est parcourue
 * dans un ordre de balayage fixe, et `j > i` fait que chaque paire est vue une
 * fois et une seule. Aucune Map, aucun Set, aucun ordre d'insertion. L'élagage
 * par cellule n'y touche pas : `cellRMax` est un maximum, donc indépendant de
 * l'ordre de remplissage, et le seuil par anneau ne dépend que de `radii[i]`,
 * `gap` et `cell`.
 *
 * Ce qui CHANGE par rapport à la double boucle : l'ordre des additions
 * flottantes n'est plus le même (une paire lointaine n'est plus évaluée du tout,
 * et les paires proches ne sont plus vues dans l'ordre lexicographique). Les
 * positions produites diffèrent donc dans les derniers bits de celles de
 * l'ancienne version — ce que les tests autorisent, parce qu'ils assertent des
 * PROPRIÉTÉS (invariant de séparation, déterminisme run-to-run, monotonie du
 * jitter) et non des valeurs de référence. Le prédicat de skip, lui, est
 * inchangé au bit près : même `Math.hypot`, même `min - slack`, aucune
 * comparaison au carré qui déplacerait la frontière de 1e-6.
 */
function collisionPass(discs: Disc[], radii: number[], gap: number, slack: number): number {
  const n = discs.length
  if (n < 2) return 0

  let rMax = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const r = radii[i]!
    if (r > rMax) rMax = r
    const c = discs[i]!
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }

  // La portée du PIRE disque. Nulle ⇒ tous les rayons ET le gap sont nuls, donc
  // `min` vaut 0 pour toute paire et `d ≥ 0 ≥ min − slack` : aucune paire ne peut
  // franchir la garde. Rendre 0 sans rien parcourir est alors le résultat EXACT,
  // pas un court-circuit défensif — et c'est aussi ce qui garantit `cell > 0`,
  // donc une grille de dimensions finies.
  const maxReach = 2 * rMax + gap
  if (!(maxReach > 0)) return 0

  // Le diviseur 3 : l'optimum mesuré sur les deux régimes de rayons, cf. le
  // tableau dans le doc ci-dessus.
  let cell = maxReach / CELL_DIVISOR

  const spanX = maxX - minX
  const spanY = maxY - minY
  let nx = Math.floor(spanX / cell) + 1
  let ny = Math.floor(spanY / cell) + 1
  // Borne mémoire : la grille reste en O(k) cellules. Elle ne devrait mordre que
  // sur des rayons très hétérogènes avec un gap nul — l'amorçage tient dans un
  // disque proportionné à l'aire totale et la gravité rapatrie —, mais un jeu
  // très étalé allouerait sinon un tableau sans rapport avec le nombre de
  // disques. AGRANDIR la cellule est toujours sûr : le nombre d'anneaux étant
  // recalculé DEPUIS la cellule finale, la fenêtre couvre toujours la portée ;
  // une cellule plus grosse ne fait qu'ajouter des candidats, jamais en perdre.
  if (nx * ny > 4 * n) {
    cell *= Math.sqrt((nx * ny) / (4 * n))
    nx = Math.floor(spanX / cell) + 1
    ny = Math.floor(spanY / cell) + 1
  }

  // Grille en CSR : `starts` donne le début de chaque cellule dans `items`, qui
  // liste les indices de disques regroupés par cellule. Deux tableaux plats
  // plutôt qu'une Map de listes — c'est le même parcours, sans allocation par
  // cellule ni ordre d'insertion à discuter.
  //
  // Les tableaux sont les tampons persistants du module (cf. leur bloc de doc).
  // `starts` et `cellRMax` sont accumulés sur place, donc remis à zéro sur la
  // tranche utile — l'algorithme ne lit jamais au-delà, et 0 est bien le neutre
  // des deux (un compteur, et un max de rayons tous ≥ 0). `cellOf` et `items`
  // sont intégralement réécrits, `cursor` est recopié depuis `starts` : aucun
  // résidu de la passe précédente n'y est lisible.
  const cells = nx * ny
  const cellOf = (bufCellOf = growI32(bufCellOf, n))
  const starts = (bufStarts = growI32(bufStarts, cells + 1))
  const cellRMax = (bufCellRMax = growF64(bufCellRMax, cells))
  starts.fill(0, 0, cells + 1)
  cellRMax.fill(0, 0, cells)
  for (let i = 0; i < n; i++) {
    const c = discs[i]!
    // Le clamp ne devrait jamais mordre (`minX ≤ x ≤ maxX` par construction) ;
    // il couvre l'arrondi de la division.
    let cx = Math.floor((c.x - minX) / cell)
    if (cx < 0) cx = 0
    else if (cx >= nx) cx = nx - 1
    let cy = Math.floor((c.y - minY) / cell)
    if (cy < 0) cy = 0
    else if (cy >= ny) cy = ny - 1
    const k = cy * nx + cx
    cellOf[i] = k
    starts[k + 1]!++
    // Le max des rayons EN COURS de la cellule : c'est lui qui remplacera
    // `rMax` dans le seuil d'élagage, donc il doit venir du même tableau que la
    // passe applique. Un max est commutatif : l'ordre de remplissage ne se lit
    // pas dans le résultat.
    if (radii[i]! > cellRMax[k]!) cellRMax[k] = radii[i]!
  }
  for (let k = 0; k < cells; k++) starts[k + 1]! += starts[k]!
  const cursor = (bufCursor = growI32(bufCursor, cells))
  for (let k = 0; k < cells; k++) cursor[k] = starts[k]!
  const items = (bufItems = growI32(bufItems, n))
  // `i` croissant : chaque cellule liste donc ses disques par indice croissant.
  for (let i = 0; i < n; i++) items[cursor[cellOf[i]!]!++] = i

  // Le seuil d'élagage par anneau, précalculé une fois par disque i : la cellule
  // à distance d'anneau R est sautable dès que le plus gros rayon qu'elle abrite
  // vérifie `cellRMax < (R − 1)·cell − (r_i + gap)`, c'est-à-dire dès que la
  // portée locale `r_i + cellRMax + gap` tombe sous `(R − 1)·cell`. Les anneaux
  // 0 et 1 donnent un seuil négatif, donc ne sont jamais élagués — normal, ce
  // sont les voisines immédiates.
  const ringThreshold = (bufRingThreshold = growF64(bufRingThreshold, (nx > ny ? nx : ny) + 2))

  let worst = 0
  for (let i = 0; i < n; i++) {
    const a = discs[i]!
    const k = cellOf[i]!
    const cx = k % nx
    const cy = (k - cx) / nx
    // La fenêtre du disque i : assez d'anneaux pour couvrir `r_i + r_max + gap`,
    // qui majore `min` pour TOUT partenaire j. Deux réels distants d'au plus t
    // ont des planchers distants d'au plus `ceil(t)` — d'où le nombre d'anneaux.
    // C'est cette fenêtre qui porte l'exhaustivité ; l'élagage plus bas ne fait
    // que rejouer le même lemme cellule par cellule, jamais la rétrécir.
    const rings = Math.ceil((radii[i]! + rMax + gap) / cell)
    const localReach = radii[i]! + gap
    for (let R = 0; R <= rings; R++) ringThreshold[R] = (R - 1) * cell - localReach
    const gx0 = cx - rings > 0 ? cx - rings : 0
    const gx1 = cx + rings < nx ? cx + rings : nx - 1
    const gy0 = cy - rings > 0 ? cy - rings : 0
    const gy1 = cy + rings < ny ? cy + rings : ny - 1
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = gy * nx
      const ry = gy > cy ? gy - cy : cy - gy
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = row + gx
        const end = starts[c + 1]!
        let p = starts[c]!
        // Cellule vide : rien à élaguer ni à examiner. Ce test vient AVANT
        // l'élagage et ce n'est pas cosmétique — sur un jeu aux rayons quasi
        // uniformes la grille est creuse (≈ 0,25 disque par cellule, cf. la
        // borne mémoire plus haut), donc l'écrasante majorité des cellules
        // visitées sont vides et payer l'élagage dessus coûtait plus cher que
        // ce qu'il rapporte — mesuré à +12 % sur ce régime avant ce
        // réordonnancement.
        if (p === end) continue
        const rx = gx > cx ? gx - cx : cx - gx
        // L'élagage local. Une comparaison par cellule PEUPLÉE contre les
        // quelques disques qu'elle contient : c'est ce qui empêche un unique
        // disque géant de faire payer sa banlieue à tout le monde.
        if (cellRMax[c]! < ringThreshold[rx > ry ? rx : ry]!) continue
        for (; p < end; p++) {
          const j = items[p]!
          // Chaque paire une seule fois, et jamais un disque contre lui-même.
          if (j <= i) continue
          const b = discs[j]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const min = radii[i]! + radii[j]! + gap
          // Rejet par la boîte englobante AVANT le `hypot`, qui coûte à lui seul
          // l'essentiel de la passe. Ce n'est pas une approximation du prédicat :
          // `hypot(dx, dy) ≥ |dx|` pour toute implémentation fidèlement arrondie
          // (la valeur exacte majore `|dx|`, qui est représentable, et l'arrondi
          // au plus proche est monotone), donc `|dx| ≥ min` entraîne
          // `d ≥ min ≥ min − slack` : la paire aurait été sautée de toute façon,
          // et la suite des poussées est identique au bit près.
          if (dx >= min || dx <= -min || dy >= min || dy <= -min) continue
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
 *    (résidu 9,988e-7), pour 3,6 s au lieu de 2,4 s à cette échelle-là.
 *
 * CE QUE COÛTE UNE PASSE, DEPUIS LA GRILLE. Le nombre de passes est à peu près
 * inchangé — c'est une propriété de la géométrie, pas de l'énumération —, mais
 * leur prix ne l'est pas : sur l'audit réel à 1 300 disques, la convergence
 * demande 3 942 passes en 3,3 s avec la grille contre 4 241 passes en 51,6 s
 * avec la double boucle, et 4 003 passes depuis l'élagage par cellule. Les
 * écarts de comptage sont du même ordre que le bruit des trajectoires
 * flottantes, qui diffèrent de toute façon d'une version à l'autre.
 *
 * LE PLAFOND, LUI, EST DEVENU ATTEIGNABLE, et c'est un résultat de mesure, pas
 * une hypothèse : le nombre de passes croît à peu près linéairement avec le
 * nombre de disques (538 à 167, 1 722 à 500, 3 942 à 1 300), donc le plafond de
 * 5000 est saturé quelque part au-dessus de ~1 700 disques. Vérifié sur le même
 * audit sans groupes — un disque par entité, soit 6 251 disques : la boucle sort
 * sur le plafond et laisse un résidu de **4,27 px**, sept ordres de grandeur
 * au-dessus du contrat. À cette échelle-là, `dist ≥ r₁ + r₂ + clusterGap` n'est
 * donc PLUS un invariant de sortie. Ce n'est pas la grille qui l'a cassé — la
 * double boucle rendait le même verdict, en 23 minutes au lieu de 21 s, ce qui
 * est précisément pourquoi personne ne l'avait mesuré. Relever le plafond
 * suffirait, au prix d'un temps qui suit ; ça n'a pas été tranché ici, la
 * question posée étant l'énumération et non le budget de convergence.
 *
 * UNE PISTE ESSAYÉE ET RETIRÉE, pour qu'elle ne soit pas retentée à l'aveugle :
 * n'examiner, d'une passe à l'autre, que les paires dont un bout a été poussé par
 * la précédente (alternance de passes incrémentales et de passes complètes de
 * confirmation). Le raisonnement est juste — une paire saine ne redevient
 * violante que si un de ses bouts a bougé — mais la mesure le vide de son
 * intérêt : sur un empilement dense sous relaxation globale, le jeu « sale » ne
 * se vide jamais (~1 291 disques sur 1 300 pendant 90 % des passes de l'audit
 * réel), et l'alternance coûtait alors 1,6 % de candidats de PLUS, pour un gain
 * plafonné à 12 % sur les régimes de rayons homogènes. Retiré : le levier du
 * point chaud n'était pas là mais dans la portée par cellule, cf. `collisionPass`.
 *
 * La boucle ci-dessous ne sort donc que sur `worst === 0`, et c'est cette passe-là
 * — celle qui n'a rien poussé, donc dont l'index et l'élagage sont restés exacts
 * de bout en bout — qui porte tout l'invariant.
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
