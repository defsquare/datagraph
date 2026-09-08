import { describe, it, expect } from "vitest"
import { validateConfig } from "../src/config.js"
import { ConfigError } from "../src/selector.js"

const base = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
}

describe("validateConfig", () => {
  it("compiles ids and refs into the internal shape and applies defaults", () => {
    const v = validateConfig(base)
    expect(v.entities.get("Customer")).toEqual({
      segments: [{ kind: "key", key: "customers" }, { kind: "wildcard" }],
      idField: "id",
    })
    expect(v.references.get("Order")).toEqual([
      {
        navigate: [],
        field: "customerId",
        targetType: "Customer",
        // `path` carries the ABSOLUTE `from` exactly as written: it is the
        // declaration the author will read back in a diagnostic.
        path: "$.orders[*].customerId",
      },
    ])
    // `maxNodes` no longer guards layout cost (the graph view bounds what it
    // lays out on its own): it is a pure MEMORY guard over buildGraph +
    // buildSearchIndex, both linear. The default is calibrated at the bench —
    // 1 M logical nodes fit in ~430 MB of heap / ~0.8 s under default node
    // options (see bench/bench.ts, "memory scale" section).
    expect(v.maxNodes).toBe(1_000_000)
    expect(v.rootLabel).toBe("$")
  })

  it("splits a nested ref into navigation + terminal field", () => {
    const v = validateConfig({
      ids: { Order: "$.orders[*].id", Product: "$.products[*].id" },
      refs: [{ from: "$.orders[*].lines[*].productRef", to: "$.products[*].id" }],
    })
    expect(v.references.get("Order")).toEqual([{
      navigate: [{ kind: "key", key: "lines" }, { kind: "wildcard" }],
      field: "productRef",
      targetType: "Product",
      path: "$.orders[*].lines[*].productRef",
    }])
  })

  it("attributes a ref to the LONGEST matching instance prefix", () => {
    // `$.orders[*].lines[*]` is a longer prefix than `$.orders[*]`: the ref
    // belongs to Line, not to Order.
    const v = validateConfig({
      ids: {
        Order: "$.orders[*].id",
        Line: "$.orders[*].lines[*].id",
        Product: "$.products[*].id",
      },
      refs: [{ from: "$.orders[*].lines[*].productRef", to: "$.products[*].id" }],
    })
    expect(v.references.has("Order")).toBe(false)
    expect(v.references.get("Line")).toEqual([{
      navigate: [],
      field: "productRef",
      targetType: "Product",
      path: "$.orders[*].lines[*].productRef",
    }])
  })

  it("accepts an empty ids map (structure-only mode)", () => {
    const v = validateConfig({ ids: {} })
    expect(v.entities.size).toBe(0)
    expect(v.references.size).toBe(0)
    expect(v.aggregates).toEqual([])
  })

  it("rejects a non-object ids value", () => {
    for (const bad of [undefined, null, [], "x"]) {
      expect(() => validateConfig({ ids: bad } as never)).toThrow(/ids object/)
    }
  })

  it("rejects an id path that is not a string or does not end on a field name", () => {
    expect(() => validateConfig({ ids: { X: 42 } } as never)).toThrow(ConfigError)
    for (const bad of ["$.customers[*]", "$.customers[0]", "$.customers.*"]) {
      expect(() => validateConfig({ ids: { X: bad } })).toThrow(/end on a field name/)
    }
    expect(() => validateConfig({ ids: { X: "nope" } })).toThrow(ConfigError) // selector-syntax
  })

  it("rejects a ref whose target is not a declared id path", () => {
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
    })).toThrow(/declared id path/)
    // Same instance set but a different field: rejected too — targeting a
    // non-key field is out of scope for v1 (door left open).
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].name" }],
    })).toThrow(/declared id path/)
  })

  it("rejects a ref whose source extends no declared instance prefix", () => {
    expect(() => validateConfig({
      ids: { Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
    })).toThrow(/extend a declared/)
  })

  it("rejects a ref source that does not end on a field name", () => {
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].lines[*]", to: "$.customers[*].id" }],
    })).toThrow(/end on a field name/)
  })

  it("rejects a malformed ref entry", () => {
    for (const bad of [null, "x", { from: "$.orders[*].c" }, { to: "$.customers[*].id" }]) {
      expect(() => validateConfig({ ...base, refs: [bad] } as never)).toThrow(/'from' and 'to'/)
    }
  })

  it("rejects a non-array refs value", () => {
    expect(() => validateConfig({ ...base, refs: {} } as never)).toThrow(/'refs' must be an array/)
  })

  it("keeps two refs from the same path (array, no collision)", () => {
    const v = validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id", Vip: "$.vips[*].id" },
      refs: [
        { from: "$.orders[*].customerId", to: "$.customers[*].id" },
        { from: "$.orders[*].customerId", to: "$.vips[*].id" },
      ],
    })
    expect(v.references.get("Order")).toHaveLength(2)
  })
})

describe("groups", () => {
  it("defaults to an empty list and preserves declaration order", () => {
    expect(validateConfig(base).aggregates).toEqual([])
    const v = validateConfig({
      ...base,
      groups: ["Order", "Customer"],
    })
    expect(v.aggregates).toEqual(["Order", "Customer"])
  })

  it("rejects a group that is not declared in ids", () => {
    expect(() => validateConfig({ ...base, groups: ["Ghost"] })).toThrow(/not declared in ids/)
  })

  it("rejects a non-array groups value", () => {
    expect(() => validateConfig({ ...base, groups: {} } as never)).toThrow(/'groups' must be an array/)
    expect(() => validateConfig({ ...base, groups: "Customer" } as never)).toThrow(/'groups' must be an array/)
  })
})
