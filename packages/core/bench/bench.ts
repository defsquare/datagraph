// Non-blocking performance bench for @defsquare/data-graph-core. Run via
// `pnpm bench` (root) or `pnpm --filter @defsquare/data-graph-core bench`.
// Always exits 0: this is a reporting tool, not a gate — CI must never fail
// because a bench number regressed. Read the printed lines against the
// budgets documented in the root README's "Performance budgets" section.
import { buildGraph, buildSearchIndex, createLayoutEngine, CollapseState, type DataGraphConfig } from "../src/index.js"

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
  const engine = createLayoutEngine()
  const t3 = performance.now()
  await engine.layout(graph, visible)
  report("layout initial (default-visible set)", performance.now() - t3, null)
  console.log(`  -> ${visible.size} nodes visible by default`)
}

main()
  .then(() => {
    console.log("--- bench done (non-blocking: exit 0 regardless of budgets) ---")
  })
  .catch((err: unknown) => {
    // A bench failure must never block CI/publish — report and still exit 0.
    console.error("[bench] failed (non-blocking):", err)
  })
