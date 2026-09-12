import { describe, expect, it } from "vitest"
import { checkReport, renderText, runCheck, type CheckReport } from "../src/validate.js"

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

/** A report with every field at its empty value, so each rendering test names
 * only what it is about. */
function report(overrides: Partial<CheckReport>): CheckReport {
  return {
    report: 1,
    ok: true,
    configErrors: [],
    ids: {},
    refs: [],
    diagnostics: [],
    totals: { nodes: 0, logicalNodes: 0, entities: 0, refEdges: 0 },
    ...overrides,
  }
}

/** The measured report for `apps/demo/fixtures/shop.json` and its config. */
const valid = report({
  ids: {
    Customer: { selector: "$.customers[*].id", matched: 2, pathResolves: true },
    Order: { selector: "$.orders[*].id", matched: 2, pathResolves: true },
  },
  refs: [
    {
      from: "$.orders[*].customerId",
      to: "$.customers[*].id",
      matched: 2,
      resolved: 2,
      dangling: 0,
    },
  ],
  totals: { nodes: 11, logicalNodes: 27, entities: 4, refEdges: 2 },
})

describe("renderText", () => {
  /** The whole layout, pinned exactly. Columns line up because "Order" is padded
   * to the width of "Customer" (8) and "$.orders[*].id" to the width of
   * "$.customers[*].id" (17), plus two literal spaces between columns; a blank
   * line separates the verdict, the table and the diagnostics, and nothing else. */
  it("states the verdict and the counts", () => {
    expect(renderText(valid)).toBe(
      [
        "✓ config valid — 4 entities, 2 references resolved",
        "",
        "  ids",
        "    Customer  $.customers[*].id  2 instances",
        "    Order     $.orders[*].id     2 instances",
        "  refs",
        "    $.orders[*].customerId → $.customers[*].id    2/2 resolved",
        "",
        "  No diagnostics.",
        "",
      ].join("\n"),
    )
  })

  it("quotes config errors", () => {
    const text = renderText(
      report({
        ok: false,
        configErrors: [
          { code: "selector-syntax", message: 'Selector must start with "$": produits[*].id' },
        ],
      }),
    )
    expect(text.startsWith("✗ config invalid")).toBe(true)
    expect(text).toContain('selector-syntax  Selector must start with "$"')
  })

  /** A selector matching exactly one row must read "1 instance", not "1
   * instances" — the singular a plural-only format string silently drops. */
  it("says 1 instance in the singular", () => {
    const text = renderText(
      report({ ids: { Order: { selector: "$.orders[*].id", matched: 1, pathResolves: true } } }),
    )
    expect(text).toContain("1 instance\n")
    expect(text).not.toContain("1 instances")
  })

  it("names an unresolved prefix on its line", () => {
    const text = renderText(
      report({
        ok: false,
        ids: { Produit: { selector: "$.produits[*].id", matched: 0, pathResolves: false } },
      }),
    )
    expect(text).toContain("0 instances  (path does not resolve)")
  })

  /** An empty `customers` array and 12 orders all pointing at `c9`: the config is
   * fine, the data has a hole — and the ratio is what makes that hole visible. */
  it("shows the ratio of a fully dangling declaration", () => {
    const text = renderText(
      report({
        refs: [
          {
            from: "$.orders[*].customerId",
            to: "$.customers[*].id",
            matched: 12,
            resolved: 0,
            dangling: 12,
          },
        ],
      }),
    )
    expect(text).toContain("0/12 resolved, 12/12 dangling")
  })

  it("truncates a flood of diagnostics", () => {
    const text = renderText(
      report({
        diagnostics: Array.from({ length: 25 }, (_, i) => ({
          code: "dangling-ref" as const,
          path: `/orders/${i}`,
          message: `m${i}`,
        })),
      }),
    )
    expect(text).toContain("diagnostics (25)")
    expect(text).toContain("… and 5 more — use --json for the full list")
    expect(text).not.toContain("m24")
  })
})

describe("runCheck", () => {
  it("prefixes the JSON report with exit code 0", () => {
    const out = runCheck(JSON.stringify(data), JSON.stringify(config), true)
    const newline = out.indexOf("\n")
    expect(out.slice(0, newline)).toBe("0")
    const parsed = JSON.parse(out.slice(newline + 1))
    expect(parsed.report).toBe(1)
    expect(parsed.ok).toBe(true)
    expect(parsed.totals).toEqual({ nodes: 7, logicalNodes: 15, entities: 4, refEdges: 2 })
  })

  it("renders text instead of JSON when asJson is false", () => {
    const out = runCheck(JSON.stringify(data), JSON.stringify(config), false)
    expect(out).toBe(`0\n${renderText(checkReport(data, config))}`)
    expect(out.startsWith("0\n✓ config valid — 4 entities, 2 references resolved\n")).toBe(true)
  })

  it("prefixes an invalid config with exit code 3", () => {
    const invalid = JSON.stringify({ ids: { Produit: "$.produits[*].id" } })
    const out = runCheck(JSON.stringify(data), invalid, false)
    expect(out.split("\n")[0]).toBe("3")
    expect(out).toContain("✗ config invalid")
  })
})
