import type { NodeId } from "./model.js"
import type { Rect } from "./layout.js"

/**
 * Seuil de comparaison des pénétrations. Comparer à zéro empêchait la sortie
 * anticipée de se déclencher : une paire posée exactement à la marge garde une
 * pénétration résiduelle non nulle, qui repassait le test `> 0` et faisait
 * « bouger » des picomètres jusqu'au plafond d'itérations — mesuré à l'époque :
 * 3000 → 1,9 s, 10 000 → 6,3 s, 100 000 → 63,5 s, linéaire dans le plafond
 * (voir `DEFAULTS` dans `layout-graph.ts`, qui documentait ce défaut comme un
 * coût fixe assumé — c'est corrigé ici). Sous cette épsilon, une paire est
 * considérée à sa place, la passe converge et sort pour de bon. 1e-6 px est six
 * ordres de grandeur sous le pixel, donc sans effet visible.
 *
 * ORDRE DE GRANDEUR DE CE RÉSIDU, MESURÉ. Trois commentaires de ce dépôt
 * avançaient « 1e-13 » et « 1e-14 » sans mesure derrière. Relevé sur les 334
 * cartes de `bigShop(3000)`, en remettant la comparaison à zéro et en prenant
 * le maximum de `min(ox, oy)` sur les paires posées : **1,84e-11 px**. Les deux
 * chiffres cités sous-estimaient donc le résidu de deux à trois ordres de
 * grandeur — sans conséquence, puisque l'épsilon retenue est cinq ordres
 * au-dessus, mais autant que la note dise ce qui a été mesuré.
 *
 * CE QUE LA CORRECTION A RAPPORTÉ, sur ce même fixture (médiane de 3 essais,
 * machine de dev) : `layout()` complet 2619 ms → 1889 ms, soit −28 % ; la passe
 * de séparation seule 3000 passes (le plafond, jamais atteint autrement que
 * parce que la sortie ne se déclenchait pas) → sortie réelle à la passe 1999.
 * Ces deux tiers de passes-là étaient du VRAI travail : l'entrée n'était ni
 * facile ni « déjà séparée », contrairement à ce que disait la note d'origine.
 *
 * Ne PAS revenir à `<= 0` : ça réintroduit le plafond systématique. Cette
 * consigne est désormais tenue par un test — voir la valeur de retour.
 */
const EPSILON = 1e-6

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
 *
 * @returns le nombre de passes RÉELLEMENT effectuées — donc 1999 là où les
 * notes du dépôt parlent de « la passe 1998 », qui en est l'index. C'est la
 * seule chose qui
 * distingue une sortie anticipée qui fonctionne d'un plafond atteint
 * systématiquement, donc c'est ce qui rend la consigne ci-dessus (« ne pas
 * revenir à `<= 0` ») vérifiable par un test — `separate.test.ts` l'assert
 * strictement inférieur au plafond sur une pile dense. Un retour égal au
 * plafond sur une entrée résolue est la signature du défaut corrigé. Aucun
 * appelant n'a besoin de cette valeur ; elle existe pour être observable.
 */
export function separateOverlaps(
  positions: Map<NodeId, Rect>,
  margin: number,
  iterations: number,
): number {
  const ids = [...positions.keys()]
  if (ids.length < 2) return 0

  let cell = 0
  for (const rect of positions.values()) {
    cell = Math.max(cell, rect.width + margin, rect.height + margin)
  }
  if (cell <= 0) return 0

  let passes = 0
  for (let pass = 0; pass < iterations; pass++) {
    passes = pass + 1
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
  return passes
}
