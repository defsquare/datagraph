import { describe, expect, it } from "vitest"
import { checkReport, runCheck } from "../src/validate.js"

/** The shape the whole feature rests on: two id declarations, one join. Counts
 * are stated literally rather than computed, so that a change in the build
 * traversal shows up here as a failing number instead of passing silently. */
const data = {
  customers: [{ id: "c1", name: "Ada" }, { id: "c2", name: "Alan" }],
  orders: [{ id: "o1", customerId: "c1" }, { id: "o2", customerId: "c2" }],
}
const config = {
  ids: { Customer: "$.customers[*].id", Order: "$.orders[*].id" },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

describe("checkReport", () => {
  it("reports a valid config with its per-selector counts", () => {
    const report = checkReport(data, config)
    expect(report.report).toBe(1)
    expect(report.ok).toBe(true)
    expect(report.configErrors).toEqual([])
    expect(report.ids).toEqual({
      Customer: { selector: "$.customers[*].id", matched: 2, pathResolves: true },
      Order: { selector: "$.orders[*].id", matched: 2, pathResolves: true },
    })
    expect(report.refs).toEqual([
      {
        from: "$.orders[*].customerId",
        to: "$.customers[*].id",
        matched: 2,
        resolved: 2,
        dangling: 0,
      },
    ])
    expect(report.diagnostics).toEqual([])
    // 7 graph nodes: the root, the two arrays, the four records. 15 logical
    // nodes: the same 7 plus the 8 scalar rows (`id` and `name` on each
    // customer, `id` and `customerId` on each order). The second number is the
    // one `maxNodes` bounds, so it is the one comparable to what
    // `GraphTooLargeError` quotes.
    expect(report.totals).toEqual({ nodes: 7, logicalNodes: 15, entities: 4, refEdges: 2 })
  })

  it("keeps a selector that matches nothing valid when its prefix resolves", () => {
    // `$.orders[*].id` over an empty `orders` array correctly describes an empty
    // collection. This is the distinction the `jq` pre-flight could not make.
    const report = checkReport({ customers: [{ id: "c1" }], orders: [] }, config)
    expect(report.ids.Order).toEqual({ selector: "$.orders[*].id", matched: 0, pathResolves: true })
    expect(report.ok).toBe(true)
  })

  it("flags a selector whose prefix does not resolve", () => {
    const report = checkReport(data, { ids: { Produit: "$.produits[*].id" } })
    expect(report.ids.Produit).toEqual({
      selector: "$.produits[*].id",
      matched: 0,
      pathResolves: false,
    })
    expect(report.ok).toBe(false)
  })

  it("flags an unresolved reference declaration", () => {
    const report = checkReport({ customers: [{ id: "c1" }], orders: [{ id: "o1" }] }, config)
    expect(report.refs[0]).toEqual({
      from: "$.orders[*].customerId",
      to: "$.customers[*].id",
      matched: 0,
      resolved: 0,
      dangling: 0,
    })
    expect(report.diagnostics.map((d) => d.code)).toEqual(["unresolved-reference"])
    expect(report.ok).toBe(false)
  })

  it("keeps dangling references valid and reports the ratio", () => {
    // A foreign key pointing at nothing is a hole in the DATA: the config cannot
    // repair it, so the exit code must not blame it.
    const report = checkReport(
      { customers: [{ id: "c1" }], orders: [{ id: "o1", customerId: "c9" }] },
      config,
    )
    expect(report.refs[0]).toMatchObject({ matched: 1, resolved: 0, dangling: 1 })
    expect(report.diagnostics.map((d) => d.code)).toEqual(["dangling-ref"])
    expect(report.ok).toBe(true)
  })

  it("keeps duplicate and missing ids valid, as data diagnostics", () => {
    const duplicate = checkReport({ customers: [{ id: "c1" }, { id: "c1" }], orders: [] }, config)
    expect(duplicate.diagnostics.map((d) => d.code)).toEqual(["duplicate-id"])
    expect(duplicate.ok).toBe(true)

    const missing = checkReport({ customers: [{ name: "Ada" }], orders: [] }, config)
    expect(missing.diagnostics.map((d) => d.code)).toEqual(["missing-id"])
    expect(missing.ok).toBe(true)
  })

  it("turns a ConfigError into a report instead of an exception", () => {
    const report = checkReport(data, { ids: { Produit: "produits[*].id" } })
    expect(report.ok).toBe(false)
    expect(report.configErrors).toEqual([
      { code: "selector-syntax", message: 'Selector must start with "$": produits[*].id' },
    ])
    // The shape stays stable even when nothing could be built: a consumer reads
    // the same fields whatever the outcome. Both counts are 0, and that is the
    // honest report — the document was never walked.
    expect(report.ids).toEqual({})
    expect(report.refs).toEqual([])
    expect(report.diagnostics).toEqual([])
    expect(report.totals).toEqual({ nodes: 0, logicalNodes: 0, entities: 0, refEdges: 0 })
  })

  it("covers both failure paths of the selector regex", () => {
    expect(checkReport(data, { ids: { X: "$.orders[1x].id" } }).configErrors[0]?.message).toBe(
      'Invalid selector near "[1x].id" in $.orders[1x].id',
    )
    expect(checkReport(data, { ids: { X: "$.orders[*].@id" } }).configErrors[0]?.message).toBe(
      'Invalid selector near ".@id" in $.orders[*].@id',
    )
  })

  it("reports GraphTooLargeError as a config error, not as a crash", () => {
    // `maxNodes` IS a config field and the message names it: the user fixes this
    // by editing the config, which is exactly what exit 3 means.
    const report = checkReport(data, { ...config, maxNodes: 3 })
    expect(report.ok).toBe(false)
    expect(report.configErrors[0]?.code).toBe("graph-too-large")
    expect(report.configErrors[0]?.message).toContain('raise "maxNodes" in the config')
    // The traversal ran far enough to hit the cap, so the count IS known —
    // `GraphTooLargeError.count`, the same number the message quotes (`4 > 3`).
    // Withholding it from `totals` would force a consumer to regex it back out
    // of the message instead of reading the field that exists for exactly this.
    expect(report.totals).toEqual({ nodes: 0, logicalNodes: 4, entities: 0, refEdges: 0 })
  })

  it("turns a null config into a report instead of crashing", () => {
    // `null` is valid JSON and reachable end to end through a `-c` file. Before
    // the fix, `validateConfig` read `.ids` off `null` before its own null
    // check ran, so this raised a raw `TypeError` instead of the `ConfigError`
    // `checkReport` catches — which would have surfaced as the CLI's exit 4
    // ("internal error") for what is, in truth, an invalid config (exit 3).
    const report = checkReport(data, null)
    expect(report.ok).toBe(false)
    expect(report.configErrors).toEqual([
      { code: "invalid-config", message: "Config must declare an ids object" },
    ])
    expect(report.totals).toEqual({ nodes: 0, logicalNodes: 0, entities: 0, refEdges: 0 })
  })

  it("lets an unexpected failure travel as an exception", () => {
    // Anything the core did not declare is a bug or an exhausted engine. It must
    // NOT become a report: telling an agent its config is wrong when the fault is
    // ours condemns it to edit a correct file forever. A getter that blows up
    // imitates exactly that — a failure the core never promised.
    const exploding = {
      ids: { Customer: "$.customers[*].id" },
      get refs(): never {
        throw new RangeError("boom")
      },
    }
    expect(() => checkReport(data, exploding)).toThrow(RangeError)
  })
})

describe("runCheck", () => {
  it("takes two strings and returns the report as one string", () => {
    const out = runCheck(JSON.stringify(data), JSON.stringify(config))
    expect(typeof out).toBe("string")
    const parsed = JSON.parse(out)
    expect(parsed.report).toBe(1)
    expect(parsed.ok).toBe(true)
    expect(parsed.totals).toEqual({ nodes: 7, logicalNodes: 15, entities: 4, refEdges: 2 })
  })
})
