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
    expect(v.references.get("Order")!.get("customerId")).toBe("Customer")
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
  it("rejects an empty entities map and bad selectors", () => {
    expect(() => validateConfig({ entities: {} })).toThrow(ConfigError) // "empty-config"
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
