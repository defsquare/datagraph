import { describe, it, expect } from "vitest"
import { parseSelector, matchesPath, ConfigError } from "../src/selector.js"

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
