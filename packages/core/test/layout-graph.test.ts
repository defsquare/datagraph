import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { createGraphLayoutEngine } from "../src/layout-graph.js"
import {
  shopData,
  shopConfig,
  bigShop,
  twoRootsData,
  twoRootsConfig,
  bigShopWithReviews,
  bigShopReviewsConfig,
} from "./fixtures.js"

const config = { ...shopConfig, aggregates: ["Customer"] }

/** `separationMargin` par défaut de `createGraphLayoutEngine` : l'écart que la
 * passe de séparation garantit entre deux cartes. */
const MARGIN = 16

function setup() {
  const graph = buildGraph(shopData, config)
  const aggregates = buildAggregates(graph, validateConfig(config))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

describe("createGraphLayoutEngine", () => {
  it("positions entities only — no root, no array, no object node", async () => {
    const { graph, aggregates, visible } = setup()
    // La racine et le nœud tableau /customers sont ajoutés à `visible` pour
    // que le filtre `kind !== "entity"` de layout-graph.ts soit réellement
    // exercé : sans eux, `visible` ne contient que des entités et le filtre
    // ne rejette jamais rien.
    const visibleWithStructural = new Set([...visible, graph.rootId, "/customers"])
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visibleWithStructural)
    for (const id of result.positions.keys()) {
      expect(graph.nodes.get(id)?.kind).toBe("entity")
    }
    expect(result.positions.has("/")).toBe(false)
    expect(result.positions.has("/customers")).toBe(false)
  })

  it("never leaks a virtual cluster centre into the result", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    for (const id of result.positions.keys()) expect(id.startsWith("__agg:")).toBe(false)
  })

  it("places every visible entity", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(visible.size)
  })

  it("is deterministic to the pixel across two runs", async () => {
    const { graph, aggregates, visible } = setup()
    const a = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const b = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
  })

  it("pulls a referenced entity closer than an unrelated one", async () => {
    // shopData (2 clients) donne un signal trop faible pour être fiable : à
    // cette échelle, l'amorçage déterministe par hachage domine encore le
    // résultat plus que la seule arête de référence. bigShop produit N paires
    // customer/order INDÉPENDANTES (order_i référence uniquement customer_i,
    // jamais un autre client) : chaque paire est sa propre composante
    // connexe, ce qui donne à fcose un vrai signal de regroupement à
    // exploiter, et à ce test une marge large et non fragile.
    const data = bigShop(150)
    const graph = buildGraph(data, config)
    const aggregates = buildAggregates(graph, validateConfig(config))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

    const centreOf = (id: string) => {
      const r = result.positions.get(id)!
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    const distanceBetween = (a: string, b: string) => {
      const p = centreOf(a)
      const q = centreOf(b)
      return Math.hypot(p.x - q.x, p.y - q.y)
    }

    // /orders/0 référence /customers/0 via customerId : une arête les relie.
    // /customers/<dernier> n'a aucun lien, direct ou indirect, avec
    // /orders/0 — deux composantes disjointes, que fcose écarte nettement
    // l'une de l'autre. Sans la construction des arêtes de référence
    // (layout-graph.ts), ce test ne distinguerait plus les deux distances.
    const last = data.customers.length - 1
    const linked = distanceBetween("/orders/0", "/customers/0")
    const unrelated = distanceBetween("/orders/0", `/customers/${last}`)

    expect(linked).toBeLessThan(unrelated * 0.5)
  })

  it("pulls two members of the same aggregate closer than an entity from another aggregate", async () => {
    // order_i et customer_i (test précédent) sont DÉJÀ reliés par une arête
    // de référence directe, donc ce test-là ne dit rien sur le regroupement
    // par agrégat spécifiquement. Ici order_i et review_i sont FRÈRES — tous
    // deux référencent customer_i, mais aucune arête ne les relie entre eux
    // — donc leur seule attraction possible passe par le voisin partagé
    // customer_i, tiré des deux côtés par une arête de référence. C'est ce
    // mécanisme, et lui seul (il n'y a pas de centre virtuel d'agrégat —
    // mesuré et retiré, voir la note dans layout-graph.ts), qui doit
    // rapprocher order_i et review_i plus qu'une entité d'un autre agrégat.
    // bigShopWithReviews produit N triplets indépendants, chacun sa propre
    // composante connexe.
    const data = bigShopWithReviews(150)
    const graph = buildGraph(data, bigShopReviewsConfig)
    const aggregates = buildAggregates(graph, validateConfig(bigShopReviewsConfig))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

    const centreOf = (id: string) => {
      const r = result.positions.get(id)!
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    const distanceBetween = (a: string, b: string) => {
      const p = centreOf(a)
      const q = centreOf(b)
      return Math.hypot(p.x - q.x, p.y - q.y)
    }

    // /orders/0 et /reviews/0 partagent l'agrégat Customer#c0 — tous deux
    // référencent /customers/0 — sans arête directe entre eux. /orders/<dernier>
    // est un Order d'un AUTRE agrégat, sans lien direct ni indirect avec /orders/0.
    const last = data.customers.length - 1
    const sameAggregate = distanceBetween("/orders/0", "/reviews/0")
    const otherAggregate = distanceBetween("/orders/0", `/orders/${last}`)

    expect(sameAggregate).toBeLessThan(otherAggregate * 0.5)
  })

  it(
    "sépare toutes les cartes d'au moins separationMargin, à l'échelle",
    async () => {
      // Deux raisons de ne PAS jouer cette assertion sur shopData :
      //
      // 1. shopData ne compte que 4 entités, et fcose n'y produit AUCUN
      //    empilement — mesuré sur sa sortie brute (moteur construit avec
      //    `separationIterations: 0`) : 0 paire en recouvrement. Le résultat
      //    était donc déjà disjoint avant même la passe de séparation, et
      //    l'assertion passait sans rien exercer — ce qui privait aussi de sa
      //    justification le relèvement de `separationIterations` (600 → 3000),
      //    motivé par des recouvrements que quatre cartes ne produisent jamais.
      //    À 334 cartes, la même mesure donne 160 paires en recouvrement et une
      //    carte recouverte jusqu'à 40,5 % de son aire : la passe de séparation
      //    y est réellement le seul rempart.
      // 2. Le prédicat historique (`ox > 0 && oy > 0`, sans marge) ne testait
      //    que le non-recouvrement nu, alors que le contrat de
      //    `separateOverlaps` — et la ligne « budgets » du README — promettent
      //    un ÉCART d'au moins `separationMargin`. On reprend donc ici le
      //    prédicat fort de `separate.test.ts` : marge ajoutée aux deux
      //    pénétrations, exactement la condition de collision qu'applique
      //    `separateOverlaps` elle-même.
      //
      // Mesuré à 334 cartes : 0 paire en recouvrement, 0 paire à moins de
      // `separationMargin`. La garantie de marge N'EST PAS inconditionnelle au
      // delà — voir la ligne « budgets » du README, corrigée en conséquence :
      // le plafond d'itérations laisse 47 paires sous la marge à 450 cartes et
      // 289 à 900 cartes (jamais un recouvrement, seulement un écart trop
      // court). Ce test garde donc l'échelle où la promesse tient.
      const data = bigShop(3000)
      const graph = buildGraph(data, config)
      const aggregates = buildAggregates(graph, validateConfig(config))
      const visible = new Set(
        [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
      )
      const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

      const rects = [...result.positions.values()]
      expect(rects.length).toBeGreaterThan(300)

      // Comptage plutôt qu'un `expect` par paire : 334 cartes font 55 611
      // paires, et un échec dit alors COMBIEN de paires fautent, pas seulement
      // la première.
      let overlapping = 0
      let tooClose = 0
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!
          const b = rects[j]!
          const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          if (px > 1e-6 && py > 1e-6) overlapping++
          if (px + MARGIN > 1e-6 && py + MARGIN > 1e-6) tooClose++
        }
      }
      expect(overlapping).toBe(0)
      expect(tooClose).toBe(0)
    },
    // La mise en page de 334 cartes coûte ~2 s, au-dessus du défaut de 5 s une
    // fois la suite complète en concurrence.
    60_000,
  )
})

describe("cluster shapes", () => {
  it("emits one hull per aggregate that has a visible member", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"])
  })

  it("wraps every member rect inside its aggregate hull", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

    const inside = (poly: { x: number; y: number }[], p: { x: number; y: number }) => {
      let sign = 0
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!
        const b = poly[(i + 1) % poly.length]!
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (Math.abs(cross) < 1e-6) continue
        const s = cross > 0 ? 1 : -1
        if (sign === 0) sign = s
        else if (s !== sign) return false
      }
      return true
    }

    for (const cluster of result.clusters) {
      const members = aggregates.aggregates.get(cluster.aggregateId)!.memberIds
      for (const id of members) {
        const r = result.positions.get(id)
        if (!r) continue
        for (const c of [
          { x: r.x, y: r.y },
          { x: r.x + r.width, y: r.y },
          { x: r.x, y: r.y + r.height },
          { x: r.x + r.width, y: r.y + r.height },
        ]) {
          expect(inside(cluster.polygon, c)).toBe(true)
        }
      }
    }
  })

  it("emits no hull for an aggregate with no visible member", async () => {
    const { graph, aggregates } = setup()
    // Seule /customers/0 est visible : l'agrégat Customer#c2 n'a aucun membre.
    const visible = new Set(["/customers/0"])
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters.map((c) => c.aggregateId)).toEqual(["Customer#c1"])
  })

  it("gives a shared entity a place inside both hulls", async () => {
    const graph = buildGraph(twoRootsData, twoRootsConfig)
    const aggregates = buildAggregates(graph, validateConfig(twoRootsConfig))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toHaveLength(2)
    for (const cluster of result.clusters) {
      expect(aggregates.aggregates.get(cluster.aggregateId)!.memberIds.has("/orders/0")).toBe(true)
    }
  })
})

describe("cluster separation", () => {
  /** Boîte englobante d'un polygone d'enveloppe. Comparer les boîtes plutôt
   * que les polygones suffit ici et se lit : si les boîtes sont disjointes,
   * les enveloppes le sont a fortiori. */
  const boxOf = (polygon: { x: number; y: number }[]) => {
    const xs = polygon.map((p) => p.x)
    const ys = polygon.map((p) => p.y)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }
  const boxesOverlap = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-6 &&
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 1e-6

  it(
    "leaves no two aggregate envelopes overlapping, at scale",
    async () => {
      const data = bigShop(3000)
      const graph = buildGraph(data, config)
      const aggregates = buildAggregates(graph, validateConfig(config))
      const visible = new Set(
        [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
      )
      const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
      expect(result.clusters.length).toBeGreaterThan(150)

      // Mesuré sans la passe (`clusterGap: 0`) sur ce même fixture : 310 paires
      // d'enveloppes franchement superposées et 0,7 px d'écart moyen au plus
      // proche voisin. Aucun agrégat ne partage de membre ici (chaque commande
      // ne référence qu'un client), donc l'exemption ne s'applique pas : le
      // compte attendu est zéro.
      let overlapping = 0
      const boxes = result.clusters.map((c) => boxOf(c.polygon))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxesOverlap(boxes[i]!, boxes[j]!)) overlapping++
        }
      }
      expect(overlapping).toBe(0)
    },
    60_000,
  )

  it("exempts two aggregates that share a member entity", async () => {
    // /orders/0 est à distance égale de Customer#c1 et Product#p9 : il
    // appartient aux DEUX agrégats. Leurs enveloppes se recouvrent donc par
    // construction — les écarter reviendrait à déchirer la carte partagée. La
    // passe laisse ce couple tranquille, et c'est le seul cas où deux
    // enveloppes ont le droit de se croiser.
    const graph = buildGraph(twoRootsData, twoRootsConfig)
    const aggregates = buildAggregates(graph, validateConfig(twoRootsConfig))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toHaveLength(2)

    const [a, b] = result.clusters
    expect(boxesOverlap(boxOf(a!.polygon), boxOf(b!.polygon))).toBe(true)

    // Cette assertion-là ne suffit PAS à prouver l'exemption : les deux
    // enveloppes contiennent la carte partagée, donc elles se croisent même si
    // la passe les a écartées. On compare donc aux positions obtenues avec la
    // passe désactivée : sur ce fixture, tous les clusters sont exemptés, donc
    // la passe ne doit RIEN déplacer.
    const untouched = await createGraphLayoutEngine({ clusterGap: 0 }).layout(graph, aggregates, visible)
    expect([...result.positions.entries()]).toEqual([...untouched.positions.entries()])
  })

  it("keeps the layout deterministic once clusters are separated", async () => {
    // Le déterminisme est déjà couvert plus haut sur `shopData` (2 agrégats de
    // 2 cartes, où la passe n'a presque rien à faire). Ici elle travaille pour
    // de vrai : plusieurs dizaines de clusters à écarter.
    const data = bigShop(600)
    const graph = buildGraph(data, config)
    const aggregates = buildAggregates(graph, validateConfig(config))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const first = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const second = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
  })
})
