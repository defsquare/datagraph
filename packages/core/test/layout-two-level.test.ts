import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates, type AggregateIndex } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { enclosingCircle } from "../src/hull.js"
import type { Rect } from "../src/layout.js"
import type { GraphLayoutResult } from "../src/layout-two-level.js"
import type { NodeId } from "../src/model.js"
import { createTwoLevelLayoutEngine } from "../src/layout-two-level.js"
import {
  shopData,
  shopConfig,
  bigShop,
  twoRootsData,
  twoRootsConfig,
  deepAggregate,
  deepAggregateConfig,
} from "./fixtures.js"
import type { Graph } from "../src/model.js"

/** La config de `fixtures.ts` ne déclare pas d'agrégats ; le bench de la sonde
 * lui ajoute `aggregates: ["Customer"]`, et c'est cette config-là qui a produit
 * les mesures du doc. On la reprend telle quelle. */
const config = { ...shopConfig, aggregates: ["Customer"] }

/** Les trois défauts de `createTwoLevelLayoutEngine`, redits ici : un test qui
 * lirait les constantes du moteur ne vérifierait plus rien. */
const PADDING = 18
const CARD_GAP = 16
const CLUSTER_GAP = 160

function setupOn(data: unknown, cfg: DataGraphConfig = config) {
  const graph = buildGraph(data, cfg)
  const aggregates = buildAggregates(graph, validateConfig(cfg))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

const setup = () => setupOn(shopData)

type Disk = { id: string; cx: number; cy: number; r: number }

/**
 * TOUS les disques du niveau 2, pas seulement les enveloppes peintes : les
 * agrégats, plus un disque singleton par entité hors agrégat.
 *
 * C'est la seule façon de tester la vraie garantie. Le moteur écarte des
 * disques dont seuls certains ressortent en `clusters` — un singleton est un
 * disque à part entière pendant la simulation (sans quoi il atterrirait dans
 * l'enveloppe d'un voisin) mais n'a rien à peindre. N'asserter que sur
 * `result.clusters` laisserait donc la moitié de l'invariant hors du test.
 */
function disksOf(result: GraphLayoutResult, aggregates: AggregateIndex, padding = PADDING): Disk[] {
  const disks: Disk[] = result.clusters.map((c) => ({
    id: c.aggregateId,
    cx: c.cx,
    cy: c.cy,
    r: c.r,
  }))
  for (const [id, rect] of result.positions) {
    const owner = aggregates.byNode.get(id)
    if (owner && owner.length > 0) continue
    const circle = enclosingCircle([rect], padding)
    disks.push({ id, cx: circle.cx, cy: circle.cy, r: circle.r })
  }
  return disks
}

/** Écart bord à bord entre deux disques : négatif s'ils se recouvrent. Prend
 * n'importe quelle forme circulaire, `ClusterShape` comprise. */
function diskGap(a: { cx: number; cy: number; r: number }, b: { cx: number; cy: number; r: number }): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r
}

function cornersOf(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ]
}

/** Pénétrations d'une paire de rects sur chaque axe. Négatives quand les rects
 * sont disjoints selon cet axe : `-px` est alors l'écart horizontal. */
function penetrations(a: Rect, b: Rect) {
  return {
    px: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    py: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Le layout à l'échelle, calculé UNE fois pour les six assertions qui
 * l'exercent. 334 cartes, 167 agrégats — le fixture du calibrage de
 * `clusterGap` et celui du tableau A de la sonde. Le moteur y coûte ~143 ms
 * mesurés, donc ce partage est du confort, pas une nécessité de budget ; il
 * évite surtout que six tests mesurent six fois la même chose.
 */
let atScaleCache: Promise<{ result: GraphLayoutResult; aggregates: AggregateIndex }> | null = null
function atScale() {
  if (!atScaleCache) {
    atScaleCache = (async () => {
      const { graph, aggregates, visible } = setupOn(bigShop(3000))
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      return { result, aggregates }
    })()
  }
  return atScaleCache
}

describe("createTwoLevelLayoutEngine", () => {
  it("positions entities only — no root, no array, no object node", async () => {
    const { graph, aggregates, visible } = setup()
    // Racine et nœud tableau ajoutés à `visible` pour que le filtre
    // `kind !== "entity"` soit réellement exercé : sans eux, `visible` ne
    // contient que des entités et le filtre ne rejette jamais rien.
    const visibleWithStructural = new Set([...visible, graph.rootId, "/customers"])
    const result = await createTwoLevelLayoutEngine().layout(
      graph,
      aggregates,
      visibleWithStructural,
    )
    for (const id of result.positions.keys()) {
      expect(graph.nodes.get(id)?.kind).toBe("entity")
    }
    expect(result.positions.has("/")).toBe(false)
    expect(result.positions.has("/customers")).toBe(false)
  })

  it("places every visible entity", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(visible.size)
  })

  it("normalise la bbox à l'origine", async () => {
    const { result } = await atScale()
    let minX = Infinity
    let minY = Infinity
    for (const rect of result.positions.values()) {
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
    }
    expect(minX).toBe(0)
    expect(minY).toBe(0)
  })
})

describe("déterminisme", () => {
  // Au BIT près, pas au pixel : le moteur n'a aucune source d'aléa (amorçage
  // FNV-1a sur les ids, itérations en ordre trié), donc deux exécutions
  // parcourent exactement la même suite d'opérations flottantes. Une égalité
  // approchée masquerait l'introduction d'un `Math.random` ou d'une itération
  // dépendante de l'ordre d'insertion d'une Map.
  it("rend des positions identiques au bit près sur la même entrée", async () => {
    const { graph, aggregates, visible } = setup()
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("reste déterministe quand la simulation travaille pour de vrai", async () => {
    // shopData ne compte que trois disques : la simulation n'y a presque rien
    // à faire et le déterminisme y est trop facile. Ici, plusieurs dizaines de
    // disques passent par 400 itérations de ressorts, de gravité et de
    // collisions avant la passe dure.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const first = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const second = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
    expect(first.clusters).toEqual(second.clusters)
  })

  it("ne dépend pas de l'ordre d'itération de `visible`", async () => {
    // `visible` est un Set : son ordre d'itération suit l'insertion. Le tri des
    // ids dans le moteur est ce qui rend ce détail sans effet — le retirer
    // ferait passer les deux tests ci-dessus (qui reconstruisent le Set à
    // l'identique) mais casserait celui-ci.
    const { graph, aggregates, visible } = setup()
    const reversed = new Set([...visible].reverse())
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, reversed)
    expect([...a.positions.entries()].sort()).toEqual([...b.positions.entries()].sort())
  })
})

describe("garanties de séparation, à l'échelle", () => {
  it(
    "ne laisse aucune paire de cartes en recouvrement",
    async () => {
      const { result } = await atScale()
      const rects = [...result.positions.values()]
      expect(rects.length).toBeGreaterThan(300)

      // Comptage plutôt qu'un `expect` par paire : 334 cartes font 55 611
      // paires, et un échec doit dire COMBIEN de paires fautent, pas seulement
      // la première.
      let overlapping = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          if (px > 1e-6 && py > 1e-6) overlapping++
        }
      }
      expect(overlapping).toBe(0)
    },
    30_000,
  )

  it(
    "laisse au moins cardGap entre deux cartes d'un même agrégat",
    async () => {
      // La tolérance est 1e-9 et pas 0 : la marge est exacte dans le repère
      // LOCAL du packing, puis chaque carte encaisse la translation de son
      // disque et la normalisation de la bbox. `(x₁ + d) − (x₂ + d)` ne redonne
      // pas exactement `x₁ − x₂` — la sonde a mesuré des paires à
      // 16 px − 10⁻¹² sur le jeu de la démo, trois ordres de grandeur sous
      // cette tolérance. C'est le même contrat qu'`expectRigid` dans
      // `separateClusters`, retiré avec la passe, pour la même raison.
      //
      // L'assertion porte sur TOUTES les paires, pas seulement les
      // intra-agrégat : deux cartes d'agrégats différents sont séparées par
      // `clusterGap` bord à bord de disque (160 px), donc a fortiori par
      // `cardGap`. Une régression du packing comme une régression de la
      // séparation des disques tombent ici.
      const { result, aggregates } = await atScale()
      const entries = [...result.positions.entries()]

      let tooClose = 0
      let intraTooClose = 0
      let worst = Infinity
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [idA, a] = entries[i]!
          const [idB, b] = entries[j]!
          const { px, py } = penetrations(a, b)
          if (px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9) {
            tooClose++
            const sameAggregate =
              aggregates.byNode.get(idA)?.[0] !== undefined &&
              aggregates.byNode.get(idA)?.[0] === aggregates.byNode.get(idB)?.[0]
            if (sameAggregate) intraTooClose++
          }
          worst = Math.min(worst, Math.max(-px, -py))
        }
      }
      expect(intraTooClose).toBe(0)
      expect(tooClose).toBe(0)

      // Le minimum est atteint, et à `cardGap` EXACTEMENT : le packing pose la
      // marge, il ne la dépasse pas « par sécurité ».
      //
      // Cette assertion a fait un aller-retour qui vaut d'être consigné. Le
      // placement radial l'avait cassée — sa garantie s'écrit sur les disques
      // englobants, une condition suffisante et non nécessaire, qui ajoute un
      // surcoût constant de 28,62 px —, et elle avait été remplacée par une
      // borne plus le chiffre mesuré (44,62 px). L'aiguillage par profondeur la
      // rétablit dans sa forme d'origine : tous les agrégats de `bigShop` sont
      // PLATS (profondeur 1), donc packés en étagères, où la marge est posée
      // sur un axe entre deux rectangles alignés et vaut exactement `cardGap`.
      //
      // La version « borne + surcoût » n'est pas perdue : elle a déménagé sur
      // le chemin qui l'exerce, dans « inclut le cardGap demandé », qui tourne
      // désormais sur un agrégat profond.
      expect(worst).toBeCloseTo(CARD_GAP, 6)
    },
    30_000,
  )

  it(
    "ne laisse aucune paire de disques en recouvrement, et ouvre clusterGap entre chacune",
    async () => {
      // 167 agrégats de 2 cartes, aucune référence inter-agrégat : c'est le
      // fixture où la simulation n'a QUE la gravité et les collisions pour
      // travailler, donc celui qui exerce le plus la passe dure finale.
      const { result, aggregates } = await atScale()
      expect(result.clusters.length).toBeGreaterThan(150)

      const disks = disksOf(result, aggregates)
      let overlapping = 0
      let tooClose = 0
      let worst = Infinity
      for (let i = 0; i < disks.length; i++) {
        for (let j = i + 1; j < disks.length; j++) {
          const gap = diskGap(disks[i]!, disks[j]!)
          if (gap < -1e-6) overlapping++
          if (gap < CLUSTER_GAP - 1e-6) tooClose++
          worst = Math.min(worst, gap)
        }
      }
      expect(overlapping).toBe(0)
      // L'écart n'est pas seulement « non négatif » : c'est bien `clusterGap`
      // qui est un invariant de sortie, garanti par la passe dure finale et non
      // par la convergence de la simulation.
      //
      // 1e-6 est le seuil de la garde de collision, donc le contrat exact du
      // moteur — et cette assertion est ce qui a forcé le resserrement du
      // critère de sortie de cette passe : avec celui de la sonde (`< 1e-3`),
      // 176 des 13 861 paires tombaient ici, résidu maximal 9,301e-4. Ce
      // n'était pas du bruit flottant mais le seuil lui-même. Voir la
      // documentation de la passe dans `layout-two-level.ts`. Résidu maximal
      // mesuré après resserrement sur ce fixture : 9,987e-7.
      expect(tooClose).toBe(0)
      expect(worst).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
    },
    30_000,
  )

  it(
    "enferme la racine et chaque membre dans l'enveloppe de son agrégat",
    async () => {
      const { result, aggregates } = await atScale()
      let checked = 0
      for (const cluster of result.clusters) {
        const aggregate = aggregates.aggregates.get(cluster.aggregateId)!
        // La racine est un membre à part entière (voir `Aggregate.memberIds`),
        // mais c'est elle que le packing pose en PREMIER : si l'ordre de
        // packing et l'ordre de calcul du cercle divergeaient un jour, c'est
        // elle qui sortirait la première.
        expect(aggregate.memberIds.has(cluster.rootId)).toBe(true)
        const rootRect = result.positions.get(cluster.rootId)!
        for (const corner of cornersOf(rootRect)) {
          expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeLessThanOrEqual(
            cluster.r + 1e-6,
          )
        }
        for (const memberId of aggregate.memberIds) {
          const rect = result.positions.get(memberId)
          if (!rect) continue
          for (const corner of cornersOf(rect)) {
            expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeLessThanOrEqual(
              cluster.r + 1e-6,
            )
          }
          checked++
        }
      }
      expect(checked).toBeGreaterThan(300)
    },
    30_000,
  )

  it(
    "émet l'enveloppe des seuls vrais agrégats, et c'est le cercle réellement écarté",
    async () => {
      const { result, aggregates } = await atScale()
      // Un `single:` qui fuirait en `clusters` ferait peindre une enveloppe
      // autour d'une carte isolée — le pendant du `__agg:` que
      // le test du moteur retiré interdisait dans `positions`.
      for (const cluster of result.clusters) {
        expect(cluster.aggregateId.startsWith("single:")).toBe(false)
        expect(aggregates.aggregates.has(cluster.aggregateId)).toBe(true)
      }
      expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(
        [...aggregates.aggregates.keys()].sort(),
      )

      // Le disque émis n'est pas recalculé après coup à partir des positions :
      // c'est celui que la simulation a écarté, translaté avec ses cartes. Il
      // doit donc coïncider avec le cercle englobant minimal de ces cartes — si
      // les deux divergeaient, le renderer peindrait une forme différente de
      // celle qui a été séparée.
      for (const cluster of result.clusters) {
        const rects: Rect[] = []
        for (const memberId of aggregates.aggregates.get(cluster.aggregateId)!.memberIds) {
          const rect = result.positions.get(memberId)
          if (rect) rects.push(rect)
        }
        const recomputed = enclosingCircle(rects, PADDING)
        expect(recomputed.cx).toBeCloseTo(cluster.cx, 6)
        expect(recomputed.cy).toBeCloseTo(cluster.cy, 6)
        expect(recomputed.r).toBeCloseTo(cluster.r, 6)
      }
    },
    30_000,
  )
})

describe("options", () => {
  it("laisse exactement hullPadding entre le coin le plus éloigné et le bord de l'enveloppe", async () => {
    // « Au moins » ne suffirait pas : le cercle est MINIMAL, donc le coin le
    // plus éloigné est sur le cercle non matelassé, à `hullPadding` exactement
    // du bord.
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine({ hullPadding: 40 }).layout(
      graph,
      aggregates,
      visible,
    )
    for (const cluster of result.clusters) {
      let farthest = 0
      for (const memberId of aggregates.aggregates.get(cluster.aggregateId)!.memberIds) {
        const rect = result.positions.get(memberId)
        if (!rect) continue
        for (const corner of cornersOf(rect)) {
          farthest = Math.max(farthest, Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy))
        }
      }
      expect(cluster.r - farthest).toBeCloseTo(40, 6)
    }
  })

  it("ouvre le clusterGap demandé, pas celui par défaut", async () => {
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const result = await createTwoLevelLayoutEngine({ clusterGap: 400 }).layout(
      graph,
      aggregates,
      visible,
    )
    const disks = disksOf(result, aggregates)
    let worst = Infinity
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) worst = Math.min(worst, diskGap(disks[i]!, disks[j]!))
    }
    expect(worst).toBeGreaterThanOrEqual(400 - 1e-6)
  })

  it("inclut le cardGap demandé dans le packing en étagères, EXACTEMENT", async () => {
    // Chemin ÉTAGÈRES : `bigShop` n'a que des agrégats plats. Customer#c0 y
    // tient deux cartes, la racine et sa commande, posées l'une sous l'autre et
    // séparées d'exactement `cardGap`.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const result = await createTwoLevelLayoutEngine({ cardGap: 64 }).layout(
      graph,
      aggregates,
      visible,
    )
    const members = [...aggregates.aggregates.get("Customer#c0")!.memberIds]
    expect(members).toHaveLength(2)
    const { px, py } = penetrations(
      result.positions.get(members[0]!)!,
      result.positions.get(members[1]!)!,
    )
    expect(Math.max(-px, -py)).toBeCloseTo(64, 6)
  })

  it("inclut le cardGap demandé dans le placement radial, ADDITIVEMENT", async () => {
    // Chemin RADIAL, celui qui ne peut PAS atteindre l'égalité exacte : sa
    // garantie s'écrit sur les disques englobants des cartes, une condition
    // suffisante et non nécessaire, qui ajoute un surcoût géométrique.
    //
    // La propriété qui compte reste testable, et sous une forme plus forte que
    // l'égalité : `cardGap` entre ADDITIVEMENT dans le placement. Augmenter la
    // marge demandée de 48 px déplace l'écart obtenu d'exactement 48 px — le
    // surcoût ne se met pas à l'échelle avec elle. Un moteur qui n'utiliserait
    // `cardGap` qu'à moitié, ou qui le multiplierait par un facteur, échouerait
    // ici alors qu'il passerait une simple borne inférieure.
    //
    // Le fixture doit être PROFOND pour emprunter ce chemin — c'est tout
    // l'objet de l'aiguillage. `deepAggregate(1, 1, 0)` donne la plus petite
    // forme profonde possible : racine ← commande ← ligne, une carte par
    // anneau, donc une géométrie où l'écart minimal est celui de deux anneaux
    // consécutifs, exactement `ρ₁ + ρ₂ + cardGap` par construction.
    const { graph, aggregates, visible } = setupOn(deepAggregate(1, 1, 0), deepAggregateConfig)
    const members = [...aggregates.aggregates.get("Customer#c0")!.memberIds]
    expect(members).toHaveLength(3)

    const minSeparationWith = async (cardGap: number) => {
      const result = await createTwoLevelLayoutEngine({ cardGap }).layout(graph, aggregates, visible)
      const rects = members.map((id) => result.positions.get(id)!)
      let worst = Infinity
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          worst = Math.min(worst, Math.max(-px, -py))
        }
      }
      return worst
    }

    const small = await minSeparationWith(16)
    const large = await minSeparationWith(64)

    // Chaque écart dépasse la marge demandée — la garantie — et l'excédent est
    // le MÊME des deux côtés : c'est le surcoût du critère par disques.
    expect(small).toBeGreaterThanOrEqual(16 - 1e-9)
    expect(large).toBeGreaterThanOrEqual(64 - 1e-9)
    expect(large - small).toBeCloseTo(64 - 16, 6)
    expect(small - 16).toBeCloseTo(large - 64, 6)
    // Et le surcoût est bien réel, sinon ce test ne dirait rien de plus que le
    // précédent : il vaut 45,5 px sur ces cartes-là.
    expect(small - 16).toBeGreaterThan(1)
  })
})

describe("placement radial intra-agrégat", () => {
  /**
   * Distance de référence à la racine, RECALCULÉE ICI à partir du graphe.
   *
   * Le moteur fait le même BFS pour construire ses anneaux ; le refaire dans le
   * test est ce qui rend les assertions ci-dessous indépendantes. Comparer les
   * anneaux du moteur à ses propres anneaux ne vérifierait rien.
   *
   * Sens de parcours : de la cible vers la source, comme `buildAggregates`.
   */
  function refDistances(graph: Graph, rootId: NodeId, members: Set<NodeId>): Map<NodeId, number> {
    const incoming = new Map<NodeId, NodeId[]>()
    for (const edge of graph.refEdges) {
      if (edge.to === null || edge.dangling) continue
      if (!members.has(edge.from) || !members.has(edge.to)) continue
      const list = incoming.get(edge.to)
      if (list) list.push(edge.from)
      else incoming.set(edge.to, [edge.from])
    }
    const dist = new Map<NodeId, number>([[rootId, 0]])
    const queue = [rootId]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!
      for (const source of incoming.get(current) ?? []) {
        if (dist.has(source)) continue
        dist.set(source, dist.get(current)! + 1)
        queue.push(source)
      }
    }
    return dist
  }

  async function deepSetup(orders?: number, lines?: number, serials?: number) {
    const data = deepAggregate(orders, lines, serials)
    const { graph, aggregates, visible } = setupOn(data, deepAggregateConfig)
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const aggregate = aggregates.aggregates.get("Customer#c0")!
    const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
    const dist = refDistances(graph, aggregate.rootId, aggregate.memberIds)
    const radiusOf = (id: NodeId) => {
      const r = result.positions.get(id)!
      return Math.hypot(r.x + r.width / 2 - shape.cx, r.y + r.height / 2 - shape.cy)
    }
    return { graph, aggregates, visible, result, aggregate, shape, dist, radiusOf }
  }

  it("le fixture produit bien un gros agrégat profond", async () => {
    // Garde anti-test-creux : si `deepAggregate` cessait de produire de la
    // profondeur, toutes les assertions radiales ci-dessous passeraient sans
    // rien exercer — un agrégat plat les vérifie trivialement.
    const { aggregate, dist } = await deepSetup()
    expect(aggregate.memberIds.size).toBe(41)
    expect(Math.max(...dist.values())).toBe(3)
    const perRing = [0, 1, 2, 3].map((d) => [...dist.values()].filter((x) => x === d).length)
    expect(perRing).toEqual([1, 4, 12, 24])
  })

  it("la racine est la carte la plus proche du centre de son enveloppe", async () => {
    // C'est le défaut que le radial corrige, et il était spectaculaire : sous
    // le packing en étagères la racine sortait **40e sur 41**, à 597,7 px du
    // centre de son propre disque, parce que le tri par id la posait en tête de
    // la première ligne, c'est-à-dire dans un coin du bloc.
    const { aggregate, radiusOf } = await deepSetup()
    const ranked = [...aggregate.memberIds]
      .map((id) => ({ id, r: radiusOf(id) }))
      .sort((a, b) => a.r - b.r)
    expect(ranked[0]!.id).toBe(aggregate.rootId)
    // Et pas seulement première ex aequo : nettement plus proche que la
    // suivante. Mesuré : 16,4 px contre 291,6 px.
    expect(ranked[0]!.r).toBeLessThan(ranked[1]!.r / 2)
  })

  it("la distance au centre croît avec la distance de référence", async () => {
    // La propriété qui définit le placement radial. Assertée sur la MOYENNE par
    // anneau et non carte par carte : le centre du cercle englobant n'est pas
    // exactement le centre de la racine (il est calculé sur les coins de toutes
    // les cartes), donc deux cartes du même anneau n'ont pas exactement le même
    // rayon, et une carte d'un anneau peut dépasser une carte du suivant de
    // quelques pixels sans que la structure en anneaux soit en cause.
    const { aggregate, dist, radiusOf } = await deepSetup()
    const sums = new Map<number, { total: number; n: number }>()
    for (const id of aggregate.memberIds) {
      const d = dist.get(id)!
      const acc = sums.get(d) ?? { total: 0, n: 0 }
      acc.total += radiusOf(id)
      acc.n++
      sums.set(d, acc)
    }
    const means = [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.total / v.n)
    expect(means).toHaveLength(4)
    for (let i = 1; i < means.length; i++) {
      expect(means[i]!).toBeGreaterThan(means[i - 1]!)
    }
    // Strictement croissant ne suffirait pas : un écart d'un pixel passerait.
    // Chaque anneau doit s'éloigner d'au moins une demi-carte.
    for (let i = 1; i < means.length; i++) {
      expect(means[i]! - means[i - 1]!).toBeGreaterThan(70)
    }
  })

  it("tient ses garanties sur le gros agrégat, y compris à 66 cartes", async () => {
    // Les garanties à l'échelle du dépôt sont vérifiées sur `bigShop`, dont
    // TOUS les agrégats font 2 cartes : le placement radial n'y pose jamais
    // qu'un seul anneau d'une seule carte. Rien là-dedans n'exerce le calcul de
    // circonférence, la scission d'un anneau trop plein, ni l'empilement de
    // plusieurs anneaux. C'est ce que ce test-ci couvre.
    for (const [o, l, s] of [
      [4, 3, 2], // 41 cartes, 3 anneaux
      [5, 3, 3], // 66 cartes, dont un anneau de 45 — celui qui doit se scinder
    ] as [number, number, number][]) {
      const { result, aggregate, shape } = await deepSetup(o, l, s)
      const rects = [...result.positions.values()]

      let overlapping = 0
      let tooClose = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const { px, py } = penetrations(rects[i]!, rects[j]!)
          if (px > 1e-6 && py > 1e-6) overlapping++
          if (px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9) tooClose++
        }
      }
      expect(overlapping).toBe(0)
      expect(tooClose).toBe(0)

      // Toutes les cartes tiennent dans l'enveloppe peinte.
      for (const id of aggregate.memberIds) {
        for (const corner of cornersOf(result.positions.get(id)!)) {
          expect(Math.hypot(corner.x - shape.cx, corner.y - shape.cy)).toBeLessThanOrEqual(
            shape.r + 1e-6,
          )
        }
      }
    }
  }, 30_000)

  it("reste déterministe au bit près sur un agrégat profond", async () => {
    // Le radial ajoute un BFS, un tri par angle de parent et une trigonométrie
    // dont l'ordre des opérations doit être reproductible. Le déterminisme
    // asserté ailleurs sur `bigShop` n'exerce rien de tout ça : un anneau d'une
    // carte n'a ni tri ni bouclage.
    const data = deepAggregate()
    const first = setupOn(data, deepAggregateConfig)
    const second = setupOn(data, deepAggregateConfig)
    const a = await createTwoLevelLayoutEngine().layout(first.graph, first.aggregates, first.visible)
    const b = await createTwoLevelLayoutEngine().layout(
      second.graph,
      second.aggregates,
      second.visible,
    )
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("choisit le mode par la PROFONDEUR, pas par le nombre de cartes", async () => {
    // Le critère : radial si et seulement si un membre est à distance de
    // référence ≥ 2 de la racine. Les deux cas ci-dessous ont le MÊME nombre de
    // cartes (5) et des profondeurs différentes — c'est ce qui fait qu'un test
    // sur le cardinal ne pourrait pas les distinguer, et que celui-ci le peut.
    //
    // Signature observable de chaque mode : en radial la racine est au centre
    // de son disque ; en étagères elle est en tête de la première ligne, donc
    // dans un coin, loin du centre. On mesure le rang de la racine par
    // proximité au centre plutôt que d'inspecter l'interne.
    const rootRankIn = async (data: unknown) => {
      const { graph, aggregates, visible } = setupOn(data, deepAggregateConfig)
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      const aggregate = aggregates.aggregates.get("Customer#c0")!
      const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
      const ranked = [...aggregate.memberIds]
        .map((id) => {
          const r = result.positions.get(id)!
          return { id, d: Math.hypot(r.x + r.width / 2 - shape.cx, r.y + r.height / 2 - shape.cy) }
        })
        .sort((a, b) => a.d - b.d)
      return { rank: ranked.findIndex((x) => x.id === aggregate.rootId) + 1, r: shape.r, n: ranked.length }
    }

    // PLAT : 4 commandes sous la racine, profondeur 1. Rien à encoder en
    // distance au centre, donc étagères — et la racine finit dans un coin.
    const flat = await rootRankIn(deepAggregate(4, 0, 0))
    expect(flat.n).toBe(5)
    expect(flat.rank).toBeGreaterThan(1)

    // PROFOND : 2 commandes, 1 ligne chacune, profondeur 2. Même cardinal,
    // mode différent — la racine passe au centre.
    const deep = await rootRankIn(deepAggregate(2, 1, 0))
    expect(deep.n).toBe(5)
    expect(deep.rank).toBe(1)

    // Et le prix du radial est visible sur ce couple : à cardinal égal, le
    // disque profond est nettement plus gros. Mesuré : 258 px contre 602.
    expect(deep.r).toBeGreaterThan(flat.r * 1.5)
  })

  it("un orphelin ne fait pas basculer un agrégat plat en radial", async () => {
    // Un membre non atteint par le BFS local — ici parce que le maillon
    // intermédiaire est MASQUÉ — reçoit en radial un anneau synthétique
    // au-delà du dernier. Cet anneau ne traduit aucune profondeur de
    // référence, seulement une absence d'information, donc il ne doit PAS
    // déclencher le radial. Sans l'exclusion des orphelins du critère, cet
    // agrégat-ci basculerait et paierait le prix du radial pour rien.
    //
    // Montage : `deepAggregate(2, 1, 0)` est profond (racine ← commande ←
    // ligne). En retirant les deux COMMANDES de `visible`, les deux lignes
    // deviennent orphelines et ce qui reste — racine + 2 lignes — est plat.
    const data = deepAggregate(2, 1, 0)
    const { graph, aggregates } = setupOn(data, deepAggregateConfig)
    const visible = new Set(
      [...graph.nodes.values()]
        .filter((n) => n.kind === "entity" && !n.id.startsWith("/orders/"))
        .map((n) => n.id),
    )
    expect(visible.size).toBe(3)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(3)

    const shape = result.clusters.find((c) => c.aggregateId === "Customer#c0")!
    const rootRect = result.positions.get("/customers/0")!
    const rootDistance = Math.hypot(
      rootRect.x + rootRect.width / 2 - shape.cx,
      rootRect.y + rootRect.height / 2 - shape.cy,
    )

    // Signature des étagères : la racine n'est pas au centre. Si le critère
    // comptait les orphelins, elle y serait, et ce disque serait bien plus gros.
    expect(rootDistance).toBeGreaterThan(20)

    // Les garanties tiennent quand même sur ce chemin dégénéré.
    const rects = [...result.positions.values()]
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const { px, py } = penetrations(rects[i]!, rects[j]!)
        expect(px + CARD_GAP > 1e-9 && py + CARD_GAP > 1e-9).toBe(false)
      }
    }
  })

  it("raccourcit les références intra-agrégat", async () => {
    // La raison d'être du changement. Chiffres mesurés sous le packing en
    // étagères, sur ce même fixture : moyenne 591,4 px, max 976,3 px. Sous
    // radial : 363,0 et 488,1. Les bornes ci-dessous sont posées à mi-chemin,
    // assez larges pour ne pas casser au moindre pixel et assez serrées pour
    // qu'un retour aux étagères les fasse tomber.
    const { graph, aggregate, result } = await deepSetup()
    const centreOf = (id: NodeId) => {
      const r = result.positions.get(id)!
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    let total = 0
    let max = 0
    let n = 0
    for (const edge of graph.refEdges) {
      if (edge.to === null || edge.dangling) continue
      if (!aggregate.memberIds.has(edge.from) || !aggregate.memberIds.has(edge.to)) continue
      const p = centreOf(edge.from)
      const q = centreOf(edge.to)
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      total += d
      n++
      if (d > max) max = d
    }
    expect(n).toBe(40)
    expect(total / n).toBeLessThan(470)
    expect(max).toBeLessThan(730)
  })
})

describe("jitter — bruit déterministe contre la régularité du pavage", () => {
  /**
   * Écart-type de l'écart bord à bord au PLUS PROCHE VOISIN, sur tous les
   * disques. C'est la métrique qui objective « le pavage est régulier » : dans
   * un réseau, tous les voisins sont à la même distance, donc l'écart-type est
   * nul. Le jitter n'existe que pour le faire monter.
   */
  function nearestNeighbourSd(result: GraphLayoutResult, aggregates: AggregateIndex): number {
    const disks = disksOf(result, aggregates)
    const gaps: number[] = []
    for (let i = 0; i < disks.length; i++) {
      let best = Infinity
      for (let j = 0; j < disks.length; j++) {
        if (i === j) continue
        best = Math.min(best, diskGap(disks[i]!, disks[j]!))
      }
      gaps.push(best)
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    return Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length)
  }

  // `bigShop(3000)` est LE fixture qui isole l'effet : 167 agrégats de taille
  // identique et AUCUNE arête entre eux, donc la simulation n'a que la gravité
  // et la collision, et converge vers l'empilement hexagonal — l'optimum de
  // densité de cercles égaux. Sur un jeu à ressorts, la topologie brouillerait
  // la mesure.
  const flatSetup = () => setupOn(bigShop(3000))

  it(
    "sans jitter, tous les voisins sont exactement à clusterGap — le réseau",
    async () => {
      const { graph, aggregates, visible } = flatSetup()
      const result = await createTwoLevelLayoutEngine({ jitter: 0 }).layout(
        graph,
        aggregates,
        visible,
      )
      // Mesuré : 0,00 px. C'est la définition d'un pavage régulier, et c'est
      // l'état que le défaut corrige.
      expect(nearestNeighbourSd(result, aggregates)).toBeLessThan(0.5)
    },
    30_000,
  )

  it(
    "le jitter par défaut casse ce réseau, et l'amplitude gradue l'effet",
    async () => {
      const { graph, aggregates, visible } = flatSetup()
      const sdOf = async (jitter: number) => {
        const result = await createTwoLevelLayoutEngine({ jitter }).layout(
          graph,
          aggregates,
          visible,
        )
        return nearestNeighbourSd(result, aggregates)
      }
      // Mesuré : 0,00 / 6,36 / 12,02 / 17,65 px. La monotonie est la propriété
      // qui compte — `jitter` gradue bien la variance, il ne la déclenche pas
      // en tout ou rien.
      const [none, small, mid, large] = [await sdOf(0), await sdOf(16), await sdOf(32), await sdOf(48)]
      expect(none!).toBeLessThan(0.5)
      expect(small!).toBeGreaterThan(3)
      expect(mid!).toBeGreaterThan(small!)
      expect(large!).toBeGreaterThan(mid!)
      // Et le défaut est bien actif : sans argument, on obtient le régime de 32.
      const byDefault = nearestNeighbourSd(
        await createTwoLevelLayoutEngine().layout(graph, aggregates, visible),
        aggregates,
      )
      expect(byDefault).toBeCloseTo(mid!, 6)
    },
    60_000,
  )

  it(
    "le jitter ne touche NI les garanties NI les formes peintes",
    async () => {
      // Les deux invariants que ce mécanisme ne doit jamais entamer, et la
      // raison pour laquelle il est sûr d'en faire un défaut.
      //
      // 1. La passe dure finale travaille sur le VRAI rayon, donc l'écart
      //    garanti reste `clusterGap` quelle que soit l'amplitude. Mesuré :
      //    min nn = 160,00 px à 0, 16, 32, 48 et 64.
      // 2. Le gonflement n'entre pas dans le cercle englobant : à packing
      //    identique, les rayons émis doivent être IDENTIQUES d'une amplitude à
      //    l'autre. Seules les positions bougent.
      const { graph, aggregates, visible } = flatSetup()
      const quiet = await createTwoLevelLayoutEngine({ jitter: 0 }).layout(graph, aggregates, visible)
      const loud = await createTwoLevelLayoutEngine({ jitter: 64 }).layout(graph, aggregates, visible)

      for (const result of [quiet, loud]) {
        const disks = disksOf(result, aggregates)
        for (let i = 0; i < disks.length; i++) {
          for (let j = i + 1; j < disks.length; j++) {
            expect(diskGap(disks[i]!, disks[j]!)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
          }
        }
      }

      // Rayons identiques au bit près : le jitter est purement transitoire.
      const radiiOf = (r: GraphLayoutResult) =>
        [...r.clusters].sort((a, b) => (a.aggregateId < b.aggregateId ? -1 : 1)).map((c) => c.r)
      expect(radiiOf(loud)).toEqual(radiiOf(quiet))

      // Contre-garde : les POSITIONS, elles, doivent avoir bougé — sinon le
      // test ci-dessus passerait aussi avec un jitter inopérant.
      expect([...loud.positions.entries()]).not.toEqual([...quiet.positions.entries()])
    },
    60_000,
  )

  it("reste déterministe au bit près avec le jitter actif", async () => {
    // Le jitter est la seule source de « hasard » du moteur, et elle est
    // entièrement dérivée du hachage des ids. Deux exécutions doivent donc
    // rester identiques au bit près — c'est ce qui distingue ce mécanisme d'un
    // `Math.random`, qui donnerait le même rendu et casserait cette propriété.
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const a = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect(a.clusters).toEqual(b.clusters)
  })

  it("deux amplitudes différentes donnent deux mises en page différentes", async () => {
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const a = await createTwoLevelLayoutEngine({ jitter: 16 }).layout(graph, aggregates, visible)
    const b = await createTwoLevelLayoutEngine({ jitter: 48 }).layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).not.toEqual([...b.positions.entries()])
  })
})

describe("entrées dégénérées", () => {
  it("un graphe sans entité rend un résultat vide", async () => {
    const graph = buildGraph({}, config)
    const aggregates = buildAggregates(graph, validateConfig(config))
    const entities = [...graph.nodes.values()].filter((n) => n.kind === "entity")
    expect(entities).toHaveLength(0)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, new Set())
    expect(result.positions.size).toBe(0)
    expect(result.clusters).toEqual([])
  })

  it("aucune entité visible : rien n'est posé, et la normalisation ne divague pas", async () => {
    // `minX` vaut alors `Infinity` : la normalisation doit être court-circuitée,
    // sans quoi elle propagerait des `NaN` — ici il n'y a rien à observer, donc
    // c'est l'absence de jet et le résultat vide qui pinnent le garde-fou.
    const { graph, aggregates } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, new Set())
    expect(result.positions.size).toBe(0)
    expect(result.clusters).toEqual([])
  })

  it("une entité hors agrégat devient un disque singleton, écarté comme les autres", async () => {
    // /orders/1 référence le client GHOST : l'arête est cassée, donc aucune
    // racine ne l'atteint et il n'appartient à aucun agrégat. Sans le disque
    // singleton il resterait posé DANS l'enveloppe d'un voisin, qui ne le
    // contient pourtant pas — exactement le cas que `separateClusters` traite
    // de son côté.
    const { graph, aggregates, visible } = setup()
    expect(aggregates.byNode.has("/orders/1")).toBe(false)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.has("/orders/1")).toBe(true)
    expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"])

    const disks = disksOf(result, aggregates)
    expect(disks).toHaveLength(3)
    const lone = disks.find((d) => d.id === "/orders/1")!
    for (const cluster of result.clusters) {
      expect(diskGap(lone, cluster)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
    }

    // Et la carte isolée est bien HORS de chaque enveloppe peinte.
    const rect = result.positions.get("/orders/1")!
    for (const cluster of result.clusters) {
      for (const corner of cornersOf(rect)) {
        expect(Math.hypot(corner.x - cluster.cx, corner.y - cluster.cy)).toBeGreaterThan(cluster.r)
      }
    }
  })

  it("un agrégat d'une seule carte a une enveloppe, et c'est le cercle circonscrit de cette carte", async () => {
    // Customer#c2 (/customers/1) n'a aucune commande valide : son agrégat se
    // réduit à sa racine. Le packing d'un seul rect doit donner le cercle
    // circonscrit de ce rect, marge comprise — pas un cercle dégénéré de rayon
    // nul, ni un débordement de `Math.max(...[])`.
    const { graph, aggregates, visible } = setup()
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)

    const single = result.clusters.find((c) => c.aggregateId === "Customer#c2")!
    expect(aggregates.aggregates.get("Customer#c2")!.memberIds.size).toBe(1)
    const rect = result.positions.get(single.rootId)!
    expect(single.r).toBeCloseTo(Math.hypot(rect.width, rect.height) / 2 + PADDING, 6)
    expect(single.cx).toBeCloseTo(rect.x + rect.width / 2, 6)
    expect(single.cy).toBeCloseTo(rect.y + rect.height / 2, 6)
  })

  it("une config sans `aggregates` : chaque entité est son propre disque, zéro enveloppe", async () => {
    // `shopConfig` nu ne déclare aucune racine, donc `buildAggregates` rend un
    // index vide. Le moteur ne doit alors rien peindre — et surtout continuer
    // d'écarter les quatre cartes, qui sont quatre disques singletons.
    const { graph, aggregates, visible } = setupOn(shopData, shopConfig)
    expect(aggregates.aggregates.size).toBe(0)

    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toEqual([])
    expect(result.positions.size).toBe(4)

    const disks = disksOf(result, aggregates)
    expect(disks).toHaveLength(4)
    for (let i = 0; i < disks.length; i++) {
      for (let j = i + 1; j < disks.length; j++) {
        expect(diskGap(disks[i]!, disks[j]!)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
      }
    }
  })

  it("une entité arbitrée ne tombe que dans UNE enveloppe", async () => {
    // /orders/0 est à un saut de Customer#c1 et de Product#p9 ; `Customer`
    // étant déclaré en premier, il l'emporte (règle de partition,
    // `aggregate.ts`). Géométriquement, la carte doit être HORS du disque de
    // Product#p9 — ce que la séparation des disques garantit ici par
    // construction, puisqu'elle n'a jamais fait partie de ce cluster.
    const { graph, aggregates, visible } = setupOn(twoRootsData, twoRootsConfig)
    const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toHaveLength(2)

    const owning = result.clusters.filter((c) =>
      aggregates.aggregates.get(c.aggregateId)!.memberIds.has("/orders/0"),
    )
    expect(owning.map((c) => c.aggregateId)).toEqual(["Customer#c1"])

    const other = result.clusters.find((c) => c.aggregateId === "Product#p9")!
    const rect = result.positions.get("/orders/0")!
    for (const corner of cornersOf(rect)) {
      expect(Math.hypot(corner.x - other.cx, corner.y - other.cy)).toBeGreaterThan(other.r)
    }
    expect(diskGap(owning[0]!, other)).toBeGreaterThanOrEqual(CLUSTER_GAP - 1e-6)
  })
})
