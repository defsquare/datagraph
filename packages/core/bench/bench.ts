// Non-blocking performance bench for @defsquare/datagraph-core. Run via
// `pnpm bench` (root) or `pnpm --filter @defsquare/datagraph-core bench`.
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

// Scale measurement: `maxNodes` is no longer a layout-cost guard (the graph
// view bounds what it lays out) but a MEMORY guard over buildGraph +
// buildSearchIndex, both linear. The `config.ts` default is therefore chosen on
// these numbers, measured under DEFAULT node options: the webview will not get
// a `--max-old-space-size` either.
//
// METHODOLOGY — the grouped sweep (the three tiers back to back) is a NOISY
// UPPER BOUND, not the deciding measurement: the tiers run in the same heap, the
// GC has not necessarily run between them, so the printed `heap` still carries
// leftovers from the previous tier (up to ~650 MB observed at 1 M). The
// `maxNodes: 1_000_000` default in `config.ts` was fixed on ISOLATED runs, one
// process per tier, via `BENCH_SCALE_N`:
//
//   BENCH_SCALE_N=100000  pnpm --filter @defsquare/datagraph-core bench  →  95 MB,  66 ms
//   BENCH_SCALE_N=500000  ...                                            → 291 MB, 338 ms
//   BENCH_SCALE_N=1000000 ...                                            → 479 MB, 814 ms
//
// (absolute heap and build+index; node 25 / darwin arm64, default options.)
// Those heaps include a ~40 MB floor: the bench has already built the 10k graph
// and its layout engine above, and never frees them. Growth stays linear —
// ~0.43 KB and ~0.8 µs per logical node — and 479 MB leaves 3× of headroom under
// the ~1.5 GB budget aimed at, hence 1 M.
//
// Redo those three isolated runs before touching the default: the grouped
// sweep's numbers are not comparable to them.
async function scaleSweep(): Promise<void> {
  console.log("\n--- memory scale buildGraph + buildSearchIndex ---")
  console.log("    (grouped sweep = upper bound noised by the GC; the maxNodes default is calibrated on isolated runs, cf. scaleSweep's comment)")
  // MAX_SAFE_INTEGER: without it the measurement would be blocked by the
  // default in force, which is precisely what we are trying to calibrate.
  const unbounded: DataGraphConfig = { ...bigShopConfig, maxNodes: Number.MAX_SAFE_INTEGER }

  // `BENCH_SCALE_N` narrows the sweep to a single tier: that is what makes the
  // isolated protocol above reproducible without an out-of-repo script.
  const override = process.env.BENCH_SCALE_N
  const tiers = override !== undefined ? [Number(override)] : [100_000, 500_000, 1_000_000]

  for (const n of tiers) {
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
        // Both deltas can come out NEGATIVE: they are `heapUsed` differences
        // between two instants, and a GC occurring between the bounds frees
        // more than was allocated. Only the absolute `heap` is authoritative.
        ` | heap ${mb(peak)} (GC-noised deltas, sometimes negative — source ${mb(afterData - before)}, graph+index ${mb(peak - afterData)})` +
        ` | ${graph.logicalNodeCount} logical nodes`,
      )
    } catch (err: unknown) {
      // An OOM/failure at a tier IS a measurement: print it and carry on.
      console.log(`n=${n}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function main(): Promise<void> {
  const N = 10_000
  console.log(`--- datagraph-core bench (bigShop(${N})) ---`)

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
  report("initial layout (default-visible set)", performance.now() - t3, null)
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
