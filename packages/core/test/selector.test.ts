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
    // `.foo` et `[0]` sont les deux formes de token du sélecteur : les
    // réancrer en `$..foo` serait une erreur de syntaxe, alors que l'auteur a
    // écrit un chemin parfaitement lisible.
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
    // `$` est un nom de clé valide pour le token du sélecteur, donc `$.lines`
    // ne peut pas être distingué syntaxiquement d'un chemin vers une clé
    // nommée `$`. Le cas n'est pas silencieux pour autant : ne matchant aucun
    // nœud, il ressort à la construction en `unresolved-reference`.
    expect(parseRelativePath("$.lines")).toEqual([
      { kind: "key", key: "$" }, { kind: "key", key: "lines" },
    ])
  })
  it("cites the ORIGINAL path in the error, not the re-anchored one", () => {
    // Le `$` est un détail d'implémentation : le faire apparaître enverrait
    // l'auteur chercher un caractère qu'il n'a pas écrit.
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
