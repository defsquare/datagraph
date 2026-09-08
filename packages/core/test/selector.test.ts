import { describe, it, expect } from "vitest"
import { parseSelector, parseRelativePath, matchesPath, ConfigError } from "../src/selector.js"

describe("parseSelector", () => {
  it("parses root + keys + wildcards", () => {
    expect(parseSelector("$.customers[*]")).toEqual([
      { kind: "key", key: "customers" }, { kind: "wildcard" },
    ])
    expect(parseSelector("$.order.lines[*].product")).toEqual([
      { kind: "key", key: "order" }, { kind: "key", key: "lines" },
      { kind: "wildcard" }, { kind: "key", key: "product" },
    ])
    expect(parseSelector("$[2].*")).toEqual([{ kind: "index", index: 2 }, { kind: "wildcard" }])
  })
  it("rejects malformed selectors with ConfigError", () => {
    for (const bad of ["customers[*]", "$..deep", "$.a[", "$.a[*", ""]) {
      expect(() => parseSelector(bad)).toThrow(ConfigError)
    }
  })
})

describe("parseRelativePath", () => {
  it("parses a path anchored on a node instead of the root", () => {
    expect(parseRelativePath("customerId")).toEqual([{ kind: "key", key: "customerId" }])
    expect(parseRelativePath("lines[*].productRef")).toEqual([
      { kind: "key", key: "lines" }, { kind: "wildcard" }, { kind: "key", key: "productRef" },
    ])
    expect(parseRelativePath("lines[0].discount.couponRef")).toEqual([
      { kind: "key", key: "lines" }, { kind: "index", index: 0 },
      { kind: "key", key: "discount" }, { kind: "key", key: "couponRef" },
    ])
  })
  it("accepts a path that already starts on a token", () => {
    // `.foo` and `[0]` are the selector's two token forms: re-anchoring them
    // as `$..foo` would be a syntax error, when the author wrote a perfectly
    // readable path.
    expect(parseRelativePath(".lines[*]")).toEqual(parseRelativePath("lines[*]"))
    expect(parseRelativePath("[0].sku")).toEqual([
      { kind: "index", index: 0 }, { kind: "key", key: "sku" },
    ])
  })
  it("rejects the same malformed shapes as parseSelector", () => {
    for (const bad of ["a..b", "a[", "a[*", ""]) {
      expect(() => parseRelativePath(bad)).toThrow(ConfigError)
    }
  })
  it("treats a leading $ as an ordinary key, not as the root anchor", () => {
    // `$` is a valid key name for the selector's token, so `$.lines` cannot be
    // told apart syntactically from a path to a key named `$`. The case is not
    // silent for all that: matching no node, it surfaces at build time as
    // `unresolved-reference`.
    expect(parseRelativePath("$.lines")).toEqual([
      { kind: "key", key: "$" }, { kind: "key", key: "lines" },
    ])
  })
  it("cites the ORIGINAL path in the error, not the re-anchored one", () => {
    // The `$` is an implementation detail: surfacing it would send the author
    // hunting for a character they never wrote.
    expect(() => parseRelativePath("a..b")).toThrow(/a\.\.b/)
    expect(() => parseRelativePath("a..b")).not.toThrow(/\$/)
  })
})

describe("matchesPath", () => {
  const seg = parseSelector("$.customers[*]")
  it("matches exact-length paths", () => {
    expect(matchesPath(seg, ["customers", 0])).toBe(true)
    expect(matchesPath(seg, ["customers", 12])).toBe(true)
  })
  it("rejects wrong key, wrong depth", () => {
    expect(matchesPath(seg, ["orders", 0])).toBe(false)
    expect(matchesPath(seg, ["customers"])).toBe(false)
    expect(matchesPath(seg, ["customers", 0, "name"])).toBe(false)
  })
})
