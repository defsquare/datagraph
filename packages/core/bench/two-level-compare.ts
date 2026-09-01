// SONDE JETABLE — voir docs/superpowers/spikes/2026-09-01-two-level-layout.md
//
// Compare le pipeline actuel de la vue graphe (fcose → separateOverlaps →
// separateClusters, `createGraphLayoutEngine`) au prototype à deux niveaux
// (`layout-two-level.ts`), sur les deux fixtures de référence du dépôt :
//
//   A. bigShop(3000) du cœur — 334 entités, 167 agrégats de 2 cartes, AUCUNE
//      arête inter-agrégat (chaque commande référence son seul client). C'est
//      le fixture du calibrage de `clusterGap` dans layout-graph.ts.
//   B. bigShop(4000) de la démo — 350 entités, 108 agrégats + 8 catégories
//      hors agrégat, AVEC arêtes inter-agrégats (Order→Product,
//      Product→Category). C'est le jeu qui coûte ~4,2 s à `setView("graph")`.
//
// Import depuis apps/demo assumé : la sonde est jetable, elle ne crée pas de
// dépendance durable du cœur vers la démo.
//
// Lancer : pnpm --filter @defsquare/data-graph-core exec tsx bench/two-level-compare.ts
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { buildGraph } from "../src/build.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import { buildAggregates, type AggregateIndex } from "../src/aggregate.js"
import { createGraphLayoutEngine, type GraphLayoutResult, type ClusterShape } from "../src/layout-graph.js"
import type { Graph, NodeId } from "../src/model.js"
import type { Rect } from "../src/layout.js"
import { twoLevelLayout } from "./layout-two-level.js"
import { bigShopData, shopConfig as demoConfig } from "../../../apps/demo/src/sample-data.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const SPIKE_DIR = join(HERE, "../../../docs/superpowers/spikes")

// Dupliqué de test/fixtures.ts, comme bench.ts, avec `aggregates` en plus.
function coreBigShop(n: number) {
  const customers = [], orders = []
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" } })
    orders.push({ id: `o${i}`, customerId: `c${i}`, total: i,
      lines: [{ sku: `S${i}`, qty: 1 }, { sku: `T${i}`, qty: 3 }] })
  }
  return { customers, orders }
}

const coreConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
  aggregates: ["Customer"],
}

interface Metrics {
  timeMs: number
  bbox: { w: number; h: number }
  fillPct: number
  cardOverlapPairs: number
  cardPairsUnderMargin: number
  envelopeOverlapPairs: number
  envelopeMeanNnGap: number
  meanCrossEdgeLen: number
  crossEdgeCount: number
}

/** Distance bord à bord de deux rects ; négative = recouvrement. */
function rectGap(a: Rect, b: Rect): number {
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
  if (gapX < 0 && gapY < 0) return Math.max(gapX, gapY) // pénétration
  return Math.hypot(Math.max(gapX, 0), Math.max(gapY, 0))
}

function computeMetrics(
  graph: Graph,
  result: GraphLayoutResult,
  timeMs: number,
  margin: number,
): Metrics {
  const rects = [...result.positions.values()]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let cardArea = 0
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height)
    cardArea += r.width * r.height
  }
  const bbox = { w: maxX - minX, h: maxY - minY }

  let cardOverlapPairs = 0
  let cardPairsUnderMargin = 0
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const g = rectGap(rects[i]!, rects[j]!)
      if (g < 0) cardOverlapPairs++
      else if (g < margin) cardPairsUnderMargin++
    }
  }

  const shapes = result.clusters
  let envelopeOverlapPairs = 0
  let nnSum = 0
  for (let i = 0; i < shapes.length; i++) {
    let nn = Infinity
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue
      const a = shapes[i]!, b = shapes[j]!
      const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r
      if (j > i && gap < 0) envelopeOverlapPairs++
      if (gap < nn) nn = gap
    }
    if (Number.isFinite(nn)) nnSum += nn
  }
  const envelopeMeanNnGap = shapes.length > 1 ? nnSum / shapes.length : NaN

  // Longueur moyenne des références inter-agrégats (centre à centre) : la
  // lisibilité d'un lien, c'est sa longueur à l'écran.
  const clusterOfNode = new Map<NodeId, string>()
  for (const s of shapes) {
    // approximation suffisante : un nœud appartient au cluster dont le disque le contient
  }
  let edgeSum = 0
  let edgeCount = 0
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const a = result.positions.get(edge.from)
    const b = result.positions.get(edge.to)
    if (!a || !b) continue
    // inter-agrégat = les deux bouts ne partagent aucune enveloppe contenant les deux
    const acx = a.x + a.width / 2, acy = a.y + a.height / 2
    const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2
    let sameCluster = false
    for (const s of shapes) {
      const inA = Math.hypot(acx - s.cx, acy - s.cy) <= s.r
      const inB = Math.hypot(bcx - s.cx, bcy - s.cy) <= s.r
      if (inA && inB) { sameCluster = true; break }
    }
    if (sameCluster) continue
    edgeSum += Math.hypot(acx - bcx, acy - bcy)
    edgeCount++
  }

  return {
    timeMs,
    bbox,
    fillPct: (cardArea / (bbox.w * bbox.h)) * 100,
    cardOverlapPairs,
    cardPairsUnderMargin,
    envelopeOverlapPairs,
    envelopeMeanNnGap,
    meanCrossEdgeLen: edgeCount > 0 ? edgeSum / edgeCount : NaN,
    crossEdgeCount: edgeCount,
  }
}

const TYPE_COLORS: Record<string, string> = {
  Customer: "#2563eb",
  Order: "#d97706",
  Product: "#059669",
  Category: "#7c3aed",
}

function writeSvg(path: string, graph: Graph, result: GraphLayoutResult, title: string): void {
  const rects = [...result.positions.entries()]
  let maxX = 0, maxY = 0
  for (const [, r] of rects) {
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  const pad = 40
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${maxX + 2 * pad} ${maxY + 2 * pad}">`,
    `<title>${title}</title>`,
    `<rect x="${-pad}" y="${-pad}" width="${maxX + 2 * pad}" height="${maxY + 2 * pad}" fill="#f8fafc"/>`,
  )
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const a = result.positions.get(edge.from)
    const b = result.positions.get(edge.to)
    if (!a || !b) continue
    parts.push(
      `<line x1="${(a.x + a.width / 2).toFixed(1)}" y1="${(a.y + a.height / 2).toFixed(1)}" x2="${(b.x + b.width / 2).toFixed(1)}" y2="${(b.y + b.height / 2).toFixed(1)}" stroke="#94a3b8" stroke-width="2" opacity="0.35"/>`,
    )
  }
  for (const s of result.clusters) {
    parts.push(
      `<circle cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" r="${s.r.toFixed(1)}" fill="#3b82f6" fill-opacity="0.05" stroke="#3b82f6" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="8 6"/>`,
    )
  }
  for (const [id, r] of rects) {
    const node = graph.nodes.get(id)
    const color = node && node.kind === "entity" ? (TYPE_COLORS[node.entityType] ?? "#64748b") : "#64748b"
    parts.push(
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.width}" height="${r.height}" rx="6" fill="white" stroke="${color}" stroke-width="2"/>`,
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.width}" height="8" rx="4" fill="${color}" opacity="0.85"/>`,
    )
  }
  parts.push("</svg>")
  writeFileSync(path, parts.join("\n"))
}

async function median3(run: () => Promise<GraphLayoutResult>): Promise<{ result: GraphLayoutResult; ms: number }> {
  const times: number[] = []
  let result!: GraphLayoutResult
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    result = await run()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  return { result, ms: times[1]! }
}

function fmt(m: Metrics): string {
  return [
    `${m.timeMs.toFixed(0)} ms`,
    `${m.bbox.w.toFixed(0)}×${m.bbox.h.toFixed(0)}`,
    `${m.fillPct.toFixed(1)} %`,
    `${m.cardOverlapPairs}`,
    `${m.cardPairsUnderMargin}`,
    `${m.envelopeOverlapPairs}`,
    `${Number.isFinite(m.envelopeMeanNnGap) ? m.envelopeMeanNnGap.toFixed(1) : "—"}`,
    `${Number.isFinite(m.meanCrossEdgeLen) ? `${m.meanCrossEdgeLen.toFixed(0)} px (${m.crossEdgeCount})` : "—"}`,
  ].join(" | ")
}

async function compare(
  label: string,
  slug: string,
  data: unknown,
  config: DataGraphConfig,
): Promise<void> {
  const graph = buildGraph(data, config)
  const validated = validateConfig(config)
  const aggregates: AggregateIndex = buildAggregates(graph, validated)
  const visible = new Set(graph.nodes.keys())
  const entityCount = [...graph.nodes.values()].filter((n) => n.kind === "entity").length

  console.log(`\n=== ${label} — ${entityCount} entités, ${aggregates.aggregates.size} agrégats ===`)
  console.log("engine | temps | bbox | remplissage | recouvr. cartes | paires < marge | recouvr. env. | nn env. moyen | réf. inter-agrégat")

  const engine = createGraphLayoutEngine()
  const base = await median3(() => engine.layout(graph, aggregates, visible))
  const baseM = computeMetrics(graph, base.result, base.ms, 16)
  console.log(`actuel (fcose+2 passes) | ${fmt(baseM)}`)
  writeSvg(join(SPIKE_DIR, `2026-09-01-two-level-${slug}-baseline.svg`), graph, base.result, `${label} — pipeline actuel`)

  const proto = await median3(async () => twoLevelLayout(graph, aggregates, visible))
  const protoM = computeMetrics(graph, proto.result, proto.ms, 16)
  console.log(`proto deux niveaux | ${fmt(protoM)}`)
  writeSvg(join(SPIKE_DIR, `2026-09-01-two-level-${slug}-proto.svg`), graph, proto.result, `${label} — proto deux niveaux`)

  // Déterminisme du proto : deux exécutions, positions identiques au bit près.
  const again = twoLevelLayout(graph, aggregates, visible)
  let maxDelta = 0
  for (const [id, r] of proto.result.positions) {
    const s = again.positions.get(id)!
    maxDelta = Math.max(maxDelta, Math.abs(r.x - s.x), Math.abs(r.y - s.y))
  }
  console.log(`déterminisme proto : écart max entre deux runs = ${maxDelta} px`)
}

async function main(): Promise<void> {
  await compare("A. bigShop(3000) cœur — sans arêtes inter-agrégats", "core3000", coreBigShop(3000), coreConfig)
  await compare("B. bigShop(4000) démo — avec arêtes inter-agrégats", "demo4000", bigShopData, demoConfig)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
