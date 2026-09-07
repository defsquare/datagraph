// Non-blocking performance bench for @defsquare/data-graph-core. Run via
// `pnpm bench` (root) or `pnpm --filter @defsquare/data-graph-core bench`.
// Always exits 0: this is a reporting tool, not a gate — CI must never fail
// because a bench number regressed. Read the printed lines against the
// budgets documented in the root README's "Performance budgets" section.
import { buildGraph, buildSearchIndex, createStructureLayoutEngine, CollapseState, type DataGraphConfig } from "../src/index.js"

// Duplicated from packages/core/test/fixtures.ts on purpose: bench/ is
// compiled/run standalone via tsx and must not depend on test-only files
// (which pull in vitest-oriented setup). Keep this in sync with fixtures.ts
// bigShop() by hand if either changes.
function bigShop(n: number): { customers: unknown[]; orders: unknown[] } {
  const customers: unknown[] = []
  const orders: unknown[] = []
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({
      id: `c${i}`,
      name: `Client ${i}`,
      email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" },
    })
    orders.push({
      id: `o${i}`,
      customerId: `c${i}`,
      total: i,
      lines: [
        { sku: `S${i}`, qty: 1 },
        { sku: `T${i}`, qty: 3 },
      ],
    })
  }
  return { customers, orders }
}

const bigShopConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
}

function report(label: string, ms: number, budgetMs: number | null): void {
  const within = budgetMs === null || ms <= budgetMs
  const flag = budgetMs !== null && !within ? "  <-- OVER BUDGET" : ""
  const budgetStr = budgetMs !== null ? ` (budget ${budgetMs}ms)` : ""
  console.log(`${label}: ${ms.toFixed(1)}ms${budgetStr}${flag}`)
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

// Mesure d'échelle : `maxNodes` n'est plus une garde de coût de layout (la vue
// graphe borne ce qu'elle dispose) mais une garde MÉMOIRE sur buildGraph +
// buildSearchIndex, tous deux linéaires. Le défaut de `config.ts` se choisit
// donc sur ces chiffres-là, mesurés sous les options node PAR DÉFAUT : la
// webview n'aura pas de `--max-old-space-size` non plus.
async function scaleSweep(): Promise<void> {
  console.log("\n--- échelle mémoire buildGraph + buildSearchIndex ---")
  // MAX_SAFE_INTEGER : sans quoi la mesure serait bloquée par le défaut en
  // vigueur, qui est précisément ce qu'on cherche à calibrer.
  const unbounded: DataGraphConfig = { ...bigShopConfig, maxNodes: Number.MAX_SAFE_INTEGER }

  for (const n of [100_000, 500_000, 1_000_000]) {
    try {
      const before = process.memoryUsage().heapUsed
      const data = bigShop(n)
      const afterData = process.memoryUsage().heapUsed

      const t0 = performance.now()
      const graph = buildGraph(data, unbounded)
      const buildMs = performance.now() - t0

      const t1 = performance.now()
      buildSearchIndex(graph)
      const indexMs = performance.now() - t1

      const peak = process.memoryUsage().heapUsed
      console.log(
        `n=${n}: build ${buildMs.toFixed(0)}ms + index ${indexMs.toFixed(0)}ms = ${(buildMs + indexMs).toFixed(0)}ms` +
        ` | heap ${mb(peak)} (données source ${mb(afterData - before)}, graphe+index ${mb(peak - afterData)})` +
        ` | ${graph.logicalNodeCount} nœuds logiques`,
      )
    } catch (err: unknown) {
      // Un OOM/échec à un palier EST une mesure : on l'imprime et on continue.
      console.log(`n=${n}: ÉCHEC — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function main(): Promise<void> {
  const N = 10_000
  console.log(`--- data-graph-core bench (bigShop(${N})) ---`)

  const data = bigShop(N)

  const t0 = performance.now()
  const graph = buildGraph(data, bigShopConfig)
  report("parse+index 10k (buildGraph)", performance.now() - t0, 1000)
  console.log(`  -> ${graph.logicalNodeCount} logical nodes, ${graph.nodes.size} rendered nodes`)

  const t1 = performance.now()
  const searchIndex = buildSearchIndex(graph)
  report("buildSearchIndex", performance.now() - t1, null)

  const t2 = performance.now()
  const results = searchIndex.search("client 42")
  report('search("client 42")', performance.now() - t2, 50)
  console.log(`  -> ${results.length} match(es)`)

  const collapseState = new CollapseState(graph)
  const visible = collapseState.visibleNodeIds()
  const engine = createStructureLayoutEngine()
  const t3 = performance.now()
  await engine.layout(graph, visible)
  report("layout initial (default-visible set)", performance.now() - t3, null)
  console.log(`  -> ${visible.size} nodes visible by default`)

  await scaleSweep()
}

main()
  .then(() => {
    console.log("--- bench done (non-blocking: exit 0 regardless of budgets) ---")
  })
  .catch((err: unknown) => {
    // A bench failure must never block CI/publish — report and still exit 0.
    console.error("[bench] failed (non-blocking):", err)
  })
