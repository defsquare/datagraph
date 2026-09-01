import { describe, it, expect } from "vitest"
import type { Aggregate, AggregateIndex } from "../src/aggregate.js"
import { enclosingCircle } from "../src/hull.js"
import type { Rect } from "../src/layout.js"
import type { NodeId } from "../src/model.js"
import { separateClusters } from "../src/cluster-separate.js"

/** `hullPadding` par défaut de `createGraphLayoutEngine`. La passe reçoit la
 * MÊME marge que le tracé, donc la forme écartée ici est exactement celle que
 * le renderer peint. */
const PADDING = 18

/**
 * Un `AggregateIndex` monté à la main : ces tests portent sur la géométrie,
 * pas sur la règle d'appartenance (couverte par `aggregate.test.ts`). Le
 * premier membre listé sert de racine.
 *
 * Monter l'index à la main est ce qui permet d'exprimer un membre PARTAGÉ
 * entre deux agrégats — ce que `buildAggregates` ne produit plus depuis que
 * l'appartenance est une partition stricte. Les tests de partage ci-dessous
 * ne décrivent donc plus une sortie atteignable du cœur : ils pinnent la
 * GARANTIE de rigidité que porte l'union-find de la passe, aujourd'hui
 * inactive, et qui redeviendrait charnière si la règle d'appartenance était un
 * jour assouplie. Voir la documentation de `separateClusters`.
 */
function indexOf(spec: Record<string, NodeId[]>): AggregateIndex {
  const aggregates = new Map<string, Aggregate>()
  const byNode = new Map<NodeId, string[]>()
  for (const [id, members] of Object.entries(spec)) {
    aggregates.set(id, {
      id,
      rootId: members[0]!,
      rootType: id.split("#")[0]!,
      memberIds: new Set(members),
    })
    for (const member of members) byNode.set(member, [...(byNode.get(member) ?? []), id])
  }
  return { aggregates, byNode }
}

function rects(spec: Record<NodeId, [number, number]>): Map<NodeId, Rect> {
  const positions = new Map<NodeId, Rect>()
  for (const [id, [x, y]] of Object.entries(spec)) {
    positions.set(id, { x, y, width: 100, height: 40 })
  }
  return positions
}

function centreOf(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function distanceBetween(a: Rect, b: Rect): number {
  const p = centreOf(a)
  const q = centreOf(b)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

/** Distances intra-agrégat, une par paire, dans un ordre stable. */
function intraDistances(positions: Map<NodeId, Rect>, members: NodeId[]): number[] {
  const out: number[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      out.push(distanceBetween(positions.get(members[i]!)!, positions.get(members[j]!)!))
    }
  }
  return out
}

/**
 * Rigidité : chaque carte d'un cluster encaisse la MÊME translation, donc les
 * distances intra-agrégat traversent la passe inchangées.
 *
 * À l'arrondi de cette translation près, et pas au bit près. La poussée se fait
 * le long de la droite des centres, donc ses deux composantes sont quelconques :
 * `(x₁ + d) − (x₂ + d)` ne redonne pas exactement `x₁ − x₂`. Écart maximal
 * MESURÉ sur les fixtures de ce fichier : **2,84e-14 px** — quatorze ordres de
 * grandeur sous le pixel.
 *
 * `twoTangledClusters` tombe sur 0 px, et il faut savoir POURQUOI pour ne pas
 * en tirer une règle. Ce n'est PAS parce que la poussée y serait axiale : elle
 * vaut (−239,20063806701862 ; −34,1715197238598), mesurée. C'est un accident
 * d'arrondi de ses coordonnées — les membres d'un même cluster y partagent leur
 * x, donc les écarts en x restent nuls, et ce `dy`-là laisse par chance les
 * écarts en y exacts. Le même fixture décalé de quelques dixièmes de pixel
 * redonne 2,84e-14. Il n'existe pas de classe d'entrées où l'exactitude est
 * garantie ; c'est bien `1e-9` qui est le contrat.
 */
function expectRigid(after: number[], before: number[]): void {
  expect(after).toHaveLength(before.length)
  for (let i = 0; i < before.length; i++) {
    expect(Math.abs(after[i]! - before[i]!)).toBeLessThan(1e-9)
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return px > 1e-9 && py > 1e-9
}

/** L'enveloppe d'un cluster : le cercle que le renderer peindra pour lui. */
function circleOf(positions: Map<NodeId, Rect>, members: Iterable<NodeId>, padding = PADDING) {
  const boxes: Rect[] = []
  for (const id of members) {
    const rect = positions.get(id)
    if (rect) boxes.push(rect)
  }
  return enclosingCircle(boxes, padding)
}

/** Écart bord à bord entre deux enveloppes : négatif si elles se recouvrent. */
function circleGap(
  a: { cx: number; cy: number; r: number },
  b: { cx: number; cy: number; r: number },
): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r
}

/** Deux agrégats de trois cartes, posés l'un sur l'autre : leurs enveloppes se
 * recouvrent franchement, sans qu'aucune carte n'en recouvre une autre. C'est
 * exactement l'entrée que la passe doit ouvrir. */
function twoTangledClusters() {
  const positions = rects({
    "a/0": [0, 0],
    "a/1": [0, 60],
    "a/2": [0, 120],
    "b/0": [140, 20],
    "b/1": [140, 80],
    "b/2": [140, 140],
  })
  const aggregates = indexOf({
    "A#a": ["a/0", "a/1", "a/2"],
    "B#b": ["b/0", "b/1", "b/2"],
  })
  return { positions, aggregates }
}

describe("separateClusters", () => {
  it("preserves intra-cluster geometry — rigid translation", () => {
    const { positions, aggregates } = twoTangledClusters()
    const beforeA = intraDistances(positions, ["a/0", "a/1", "a/2"])
    const beforeB = intraDistances(positions, ["b/0", "b/1", "b/2"])

    separateClusters(positions, aggregates, 400, 3000, PADDING)

    // Égalité bit à bit sur CE fixture-ci. C'est un accident d'arrondi de ses
    // coordonnées, pas une propriété de la passe (la poussée y est oblique —
    // voir `expectRigid` pour le vecteur mesuré et la contre-mesure). Gardée
    // comme canari : si elle tombe alors qu'`expectRigid` passe partout
    // ailleurs, c'est que le calcul de la poussée a bougé sans que le contrat
    // soit rompu — relire le vecteur avant de conclure à une régression.
    expect(intraDistances(positions, ["a/0", "a/1", "a/2"])).toEqual(beforeA)
    expect(intraDistances(positions, ["b/0", "b/1", "b/2"])).toEqual(beforeB)
  })

  it("increases the mean inter-cluster distance materially", () => {
    const { positions, aggregates } = twoTangledClusters()
    const membersA = ["a/0", "a/1", "a/2"]
    const membersB = ["b/0", "b/1", "b/2"]
    const meanCross = (p: Map<NodeId, Rect>) => {
      let sum = 0
      let n = 0
      for (const a of membersA) {
        for (const b of membersB) {
          sum += distanceBetween(p.get(a)!, p.get(b)!)
          n++
        }
      }
      return sum / n
    }

    const before = meanCross(positions)
    separateClusters(positions, aggregates, 400, 3000, PADDING)
    const after = meanCross(positions)

    // Mesuré sur ce fixture, gap = 400, padding = 18 : 156,44 px avant,
    // 628,42 px après (×4,02). Les deux chiffres sont ceux de l'exécution, pas
    // une cible. L'écart monte par rapport à la relaxation sur boîtes qu'on
    // remplace (505,14 px mesurés alors) : un cercle circonscrit est plus large
    // que la boîte qu'il enferme, et c'est bord à bord de CERCLE qu'on ouvre
    // `gap`.
    expect(before).toBeCloseTo(156.44, 1)
    expect(after).toBeCloseTo(628.42, 1)
    expect(after).toBeGreaterThan(before * 2)
  })

  it("stays rigid when a THIRD cluster pushes an aggregate that shares a member", () => {
    // Le cas que les fixtures à deux clusters ne peuvent pas voir. A et B
    // partagent s/0 ; c/0, hors de tout agrégat, mord l'enveloppe de A et la
    // pousse. Si A et B encaissent alors des déplacements différents et que
    // s/0 en prend la moyenne, s/0 se détache de ses co-membres : la
    // translation n'est plus rigide, et des cartes peuvent se recouvrir — ce
    // que plus rien ne rattrape, `separateOverlaps` étant déjà passée.
    const positions = rects({
      "a/0": [0, 0],
      "a/1": [0, 60],
      "s/0": [0, 120],
      "b/0": [200, 120],
      "b/1": [200, 180],
      "c/0": [40, 20],
    })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1", "s/0"], "B#b": ["b/0", "b/1", "s/0"] })
    const beforeA = intraDistances(positions, ["a/0", "a/1", "s/0"])
    const beforeB = intraDistances(positions, ["b/0", "b/1", "s/0"])

    separateClusters(positions, aggregates, 200, 3000, PADDING)

    // Mesuré avec la règle de la moyenne : a/0 et a/1 bougeaient de +125,00 px
    // quand s/0 n'en prenait que +67,50 ; les distances intra-A passaient de
    // 120 à 62,50 px et de 60 à 2,50 px, et une paire de cartes se retrouvait
    // en recouvrement. La fusion en super-cluster supprime le cas.
    expectRigid(intraDistances(positions, ["a/0", "a/1", "s/0"]), beforeA)
    expectRigid(intraDistances(positions, ["b/0", "b/1", "s/0"]), beforeB)

    const all = [...positions.values()]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i]!, all[j]!)).toBe(false)
      }
    }
  })

  it("leaves two aggregates that share a member exactly where they are", () => {
    // Garantie inactive sous la règle actuelle (voir `indexOf`), pinnée ici.
    // Une entité partagée serait membre à part entière de ses deux agrégats :
    // les écarter la déchirerait. La passe les fusionne donc en un
    // super-cluster — et ici ce bloc est tout le graphe, donc il n'y a plus
    // rien à écarter.
    const positions = rects({ "a/0": [0, 0], "s/0": [120, 0], "b/0": [240, 0] })
    const aggregates = indexOf({ "A#a": ["a/0", "s/0"], "B#b": ["b/0", "s/0"] })
    const before = new Map([...positions].map(([id, r]) => [id, { ...r }]))

    separateClusters(positions, aggregates, 400, 3000, PADDING)

    for (const [id, rect] of before) expect(positions.get(id)).toEqual(rect)
  })

  it("treats an entity outside every aggregate as its own cluster", () => {
    // Sans ça, une entité isolée resterait posée à l'intérieur de l'enveloppe
    // d'un agrégat voisin, qui ne la contient pourtant pas.
    const positions = rects({ "a/0": [0, 0], "a/1": [0, 60], "lone/0": [40, 20] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"] })

    separateClusters(positions, aggregates, 200, 3000, PADDING)

    const envelope = circleOf(positions, ["a/0", "a/1"])
    const lone = circleOf(positions, ["lone/0"])
    expect(circleGap(envelope, lone)).toBeGreaterThanOrEqual(200 - 1e-6)
  })

  it("keeps cards non-overlapping", () => {
    const { positions, aggregates } = twoTangledClusters()
    separateClusters(positions, aggregates, 400, 3000, PADDING)
    const all = [...positions.values()]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i]!, all[j]!)).toBe(false)
      }
    }
  })

  it("opens at least `gap` between two cluster envelopes", () => {
    const { positions, aggregates } = twoTangledClusters()
    separateClusters(positions, aggregates, 400, 3000, PADDING)
    const circleA = circleOf(positions, ["a/0", "a/1", "a/2"])
    const circleB = circleOf(positions, ["b/0", "b/1", "b/2"])
    expect(circleGap(circleA, circleB)).toBeGreaterThanOrEqual(400 - 1e-6)
  })

  it("honours `padding`: the gap is opened between the PAINTED circles", () => {
    // La forme écartée est celle que le renderer peint, marge comprise. Avec
    // une marge nulle la passe ouvrirait `gap` entre des cercles plus petits
    // que ceux tracés, et le couloir visible serait `gap - 2 × padding`.
    const withPadding = twoTangledClusters()
    separateClusters(withPadding.positions, withPadding.aggregates, 400, 3000, PADDING)
    const withoutPadding = twoTangledClusters()
    separateClusters(withoutPadding.positions, withoutPadding.aggregates, 400, 3000, 0)

    // Distance entre les centres — le centre d'un cercle englobant ne dépend
    // pas de la marge, seul son rayon en dépend.
    const spread = (p: Map<NodeId, Rect>) => {
      const a = circleOf(p, ["a/0", "a/1", "a/2"], 0)
      const b = circleOf(p, ["b/0", "b/1", "b/2"], 0)
      return Math.hypot(a.cx - b.cx, a.cy - b.cy)
    }

    // Deux fois la marge de plus entre les centres, exactement.
    expect(spread(withPadding.positions) - spread(withoutPadding.positions)).toBeCloseTo(
      2 * PADDING,
      6,
    )
  })

  it("is deterministic across two runs", () => {
    const first = twoTangledClusters()
    const second = twoTangledClusters()
    separateClusters(first.positions, first.aggregates, 400, 3000, PADDING)
    separateClusters(second.positions, second.aggregates, 400, 3000, PADDING)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
  })

  it("separates two clusters stacked at the very same centre", () => {
    // Cercles concentriques : la direction de poussée est indéterminée. La
    // passe doit choisir un axe fixe plutôt que diviser par zéro.
    const positions = rects({ "a/0": [0, 0], "b/0": [0, 0] })
    const aggregates = indexOf({ "A#a": ["a/0"], "B#b": ["b/0"] })

    separateClusters(positions, aggregates, 200, 3000, PADDING)

    expect(circleGap(circleOf(positions, ["a/0"]), circleOf(positions, ["b/0"]))).toBeGreaterThanOrEqual(
      200 - 1e-6,
    )
  })
})

describe("separateClusters — entrées dégénérées", () => {
  it("no aggregate at all: every entity is its own cluster", () => {
    const positions = rects({ "x/0": [0, 0], "x/1": [20, 10] })
    separateClusters(positions, { aggregates: new Map(), byNode: new Map() }, 200, 3000, PADDING)
    expect(
      circleGap(circleOf(positions, ["x/0"]), circleOf(positions, ["x/1"])),
    ).toBeGreaterThanOrEqual(200 - 1e-6)
  })

  it("a single aggregate covering everything: nothing moves", () => {
    const positions = rects({ "a/0": [0, 0], "a/1": [10, 10] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"] })
    const before = new Map([...positions].map(([id, r]) => [id, { ...r }]))
    separateClusters(positions, aggregates, 400, 3000, PADDING)
    for (const [id, rect] of before) expect(positions.get(id)).toEqual(rect)
  })

  it("merges transitively: A shares with B, B with C, so all three move as one", () => {
    // La fusion suit les composantes connexes du graphe « partage un membre ».
    // A—s1—B—s2—C : rien ne sépare A de C directement, mais B les relie, donc
    // les trois forment un seul bloc. Ici ce bloc est tout le graphe, donc la
    // passe n'a plus rien à écarter et ne bouge rien — c'est le comportement
    // correct : aucune translation rigide ne peut séparer ces agrégats sans
    // déchirer s1 ou s2.
    const positions = rects({ "a/0": [0, 0], "s/1": [20, 0], "b/0": [40, 0], "s/2": [60, 0], "c/0": [80, 0] })
    const aggregates = indexOf({
      "A#a": ["a/0", "s/1"],
      "B#b": ["b/0", "s/1", "s/2"],
      "C#c": ["c/0", "s/2"],
    })
    const before = new Map([...positions].map(([id, r]) => [id, { ...r }]))

    separateClusters(positions, aggregates, 400, 3000, PADDING)

    for (const [id, rect] of before) expect(positions.get(id)).toEqual(rect)
  })

  it("a single-member aggregate is separated like any other cluster", () => {
    const positions = rects({ "a/0": [0, 0], "b/0": [20, 10] })
    const aggregates = indexOf({ "A#a": ["a/0"], "B#b": ["b/0"] })
    separateClusters(positions, aggregates, 200, 3000, PADDING)
    expect(
      circleGap(circleOf(positions, ["a/0"]), circleOf(positions, ["b/0"])),
    ).toBeGreaterThanOrEqual(200 - 1e-6)
  })

  it("an empty position map is a no-op", () => {
    const positions = new Map<NodeId, Rect>()
    separateClusters(positions, { aggregates: new Map(), byNode: new Map() }, 400, 3000, PADDING)
    expect(positions.size).toBe(0)
  })

  it("an aggregate whose members are all unpositioned is skipped", () => {
    const positions = rects({ "b/0": [0, 0] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"], "B#b": ["b/0"] })
    expect(() => separateClusters(positions, aggregates, 400, 3000, PADDING)).not.toThrow()
    expect(positions.get("b/0")).toEqual({ x: 0, y: 0, width: 100, height: 40 })
  })
})
