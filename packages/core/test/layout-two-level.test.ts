import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates, type AggregateIndex } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { enclosingCircle } from "../src/hull.js"
import type { Rect } from "../src/layout.js"
import type { GraphLayoutResult } from "../src/layout-graph.js"
import type { NodeId } from "../src/model.js"
import { createTwoLevelLayoutEngine } from "../src/layout-two-level.js"
import { shopData, shopConfig, bigShop, twoRootsData, twoRootsConfig } from "./fixtures.js"

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
      // `cluster-separate.test.ts`, pour la même raison.
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
      // Le minimum est atteint, et à `cardGap` exactement : le packing pose
      // bien la marge, il ne la dépasse pas « par sécurité ».
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
      // `layout-graph.test.ts` interdit dans `positions`.
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

  it("inclut le cardGap demandé dans le packing", async () => {
    const { graph, aggregates, visible } = setupOn(bigShop(600))
    const result = await createTwoLevelLayoutEngine({ cardGap: 64 }).layout(
      graph,
      aggregates,
      visible,
    )
    // Customer#c0 tient deux cartes : la racine et sa commande. Le packing les
    // pose côte à côte, séparées par exactement `cardGap`.
    const members = [...aggregates.aggregates.get("Customer#c0")!.memberIds]
    expect(members).toHaveLength(2)
    const a = result.positions.get(members[0]!)!
    const b = result.positions.get(members[1]!)!
    const { px, py } = penetrations(a, b)
    expect(Math.max(-px, -py)).toBeCloseTo(64, 6)
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
