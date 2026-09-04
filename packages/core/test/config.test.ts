import { describe, it, expect } from "vitest"
import { validateConfig } from "../src/config.js"
import { ConfigError } from "../src/selector.js"

const base = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
}

describe("validateConfig", () => {
  it("accepts a valid config and applies defaults", () => {
    const v = validateConfig(base)
    expect(v.entities.get("Order")!.idField).toBe("id")
    // Une clé sans `.` ni `[` reste une clé de ligne verbatim : navigation vide.
    expect(v.references.get("Order")).toEqual([
      { navigate: [], field: "customerId", targetType: "Customer", path: "customerId" },
    ])
    expect(v.maxNodes).toBe(50_000)
  })
  it("rejects a reference to an unknown entity type", () => {
    expect(() => validateConfig({
      ...base, references: { Order: { customerId: "Client" } },
    })).toThrow(ConfigError) // code "unknown-entity-type" — pour la source ET la cible
    expect(() => validateConfig({
      ...base, references: { Facture: { customerId: "Customer" } },
    })).toThrow(ConfigError)
  })
  it("parses a reference key that holds a relative path", () => {
    const v = validateConfig({
      ...base, references: { Order: { "lines[*].productRef": "Customer" } },
    })
    expect(v.references.get("Order")).toEqual([{
      navigate: [{ kind: "key", key: "lines" }, { kind: "wildcard" }],
      field: "productRef",
      targetType: "Customer",
      path: "lines[*].productRef",
    }])
  })

  it("keeps an exotic key verbatim instead of parsing it", () => {
    // Le token du sélecteur n'accepte pas `@`, mais une clé JSON, si : la
    // parser rejetterait une config qui marche aujourd'hui.
    const v = validateConfig({ ...base, references: { Order: { "@odata:id": "Customer" } } })
    expect(v.references.get("Order")![0]).toMatchObject({ navigate: [], field: "@odata:id" })
  })

  it("rejects a reference path whose last segment is not a field name", () => {
    // Le chemin désigne une LIGNE, et une ligne a un nom.
    for (const bad of ["lines[*]", "lines[*].*", "lines[0]"]) {
      expect(() => validateConfig({
        ...base, references: { Order: { [bad]: "Customer" } },
      })).toThrow(ConfigError)
    }
  })

  it("rejects a malformed reference path", () => {
    expect(() => validateConfig({
      ...base, references: { Order: { "lines[.productRef": "Customer" } },
    })).toThrow(ConfigError)
  })

  it("accepts an empty entities map (structure-only mode)", () => {
    // Un JSON sans entités est exactement « un arbre » : le CLI end-user ouvre
    // un document sans config en vue structure seule.
    const v = validateConfig({ entities: {} })
    expect(v.entities.size).toBe(0)
    expect(v.references.size).toBe(0)
    expect(v.aggregates).toEqual([])
  })

  it("rejects a config whose entities map is missing or not an object", () => {
    // Une config `-c` vient du disque : le type ne la garantit pas. Le rejet
    // doit être une ConfigError lisible, pas un TypeError sur `Object.entries`.
    expect(() => validateConfig({} as never)).toThrow(ConfigError)
    expect(() => validateConfig({ entities: null } as never)).toThrow(ConfigError)
  })

  it("rejects bad selectors", () => {
    expect(() => validateConfig({ entities: { X: { match: "nope", id: "id" } } })).toThrow(ConfigError)
  })
})

describe("aggregates", () => {
  const base = {
    entities: {
      Customer: { match: "$.customers[*]", id: "id" },
      Order: { match: "$.orders[*]", id: "id" },
    },
  }

  it("defaults to an empty list", () => {
    expect(validateConfig(base).aggregates).toEqual([])
  })

  it("preserves declaration order", () => {
    const v = validateConfig({ ...base, aggregates: ["Order", "Customer"] })
    expect(v.aggregates).toEqual(["Order", "Customer"])
  })

  it("rejects an aggregate root that is not a declared entity type", () => {
    expect(() => validateConfig({ ...base, aggregates: ["Ghost"] })).toThrow(ConfigError)
  })
})
