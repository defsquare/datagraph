import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildTreeGraph } from "../src/tree.js"
import { CollapseState } from "../src/collapse.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import type { Graph, NodeId } from "../src/model.js"
import { shopData, shopConfig } from "./fixtures.js"

function tree(data: unknown, config: DataGraphConfig): { source: Graph; result: Graph } {
  const source = buildGraph(data, config)
  return { source, result: buildTreeGraph(source, validateConfig(config)) }
}

/**
 * The shape of a NORMALISED document, the one the tree view exists for: flat
 * tables joined by foreign keys, a join table with two references, a lookup
 * table shared by every join row, and one table nobody points at — a normalised
 * export in miniature.
 */
const joinData = {
  groups: [{ id: "G1", label: "Group A" }, { id: "G2", label: "Group B" }],
  items: [
    { id: "I1", groupId: "G1", code: "1.1" },
    { id: "I2", groupId: "G2", code: "2.1" },
  ],
  types: [{ id: "T1", label: "Type One" }],
  relations: [
    { id: "R1", itemId: "I1", typeId: "T1" },
    { id: "R2", itemId: "I2", typeId: "T1" },
  ],
  venues: [{ id: "S1", name: "Venue One" }],
}

const joinConfig: DataGraphConfig = {
  ids: {
    Group: "$.groups[*].id",
    Item: "$.items[*].id",
    Type: "$.types[*].id",
    Relation: "$.relations[*].id",
    Venue: "$.venues[*].id",
  },
  refs: [
    { from: "$.items[*].groupId", to: "$.groups[*].id" },
    { from: "$.relations[*].itemId", to: "$.items[*].id" },
    { from: "$.relations[*].typeId", to: "$.types[*].id" },
  ],
  groups: ["Group"],
}

/** A nested entity — an order written INSIDE its customer — plus a reference out
 * of it, which is what could otherwise turn containment into a cycle. */
const nestedData = {
  customers: [{ id: "c1", name: "Dupont", orders: [{ id: "o1", sellerId: "s1" }] }],
  sellers: [{ id: "s1", name: "Martin" }],
}

const nestedConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.customers[*].orders[*].id",
    Seller: "$.sellers[*].id",
  },
  refs: [{ from: "$.customers[*].orders[*].sellerId", to: "$.sellers[*].id" }],
  groups: ["Seller"],
}

describe("buildTreeGraph", () => {
  it("hangs a top-level entity under the target of the reference it was claimed through", () => {
    const { result } = tree(joinData, joinConfig)
    expect(result.nodes.get("/items/0")!.parentId).toBe("/groups/0")
    expect(result.nodes.get("/items/1")!.parentId).toBe("/groups/1")
    // The join row carries two references; only one of them leads back to a
    // declared root, and that is the one the BFS claimed it through.
    expect(result.nodes.get("/relations/0")!.parentId).toBe("/items/0")
    expect(result.nodes.get("/relations/1")!.parentId).toBe("/items/1")
  })

  it("puts the unclaimed entities under the root, after the aggregate roots, in document order", () => {
    const { result } = tree(joinData, joinConfig)
    // The two groups are the declared roots and come first; the shared lookup
    // row and the table nobody points at follow, in document order.
    expect(result.nodes.get(result.rootId)!.childIds).toEqual([
      "/groups/0",
      "/groups/1",
      "/types/0",
      "/venues/0",
    ])
    expect(result.nodes.get("/types/0")!.parentId).toBe(result.rootId)
  })

  it("drops the structural nodes and gives the synthetic root no rows", () => {
    const { source, result } = tree(joinData, joinConfig)
    expect(source.nodes.has("/groups")).toBe(true)
    expect(result.nodes.has("/groups")).toBe(false)
    expect(result.nodes.has("/relations")).toBe(false)
    const root = result.nodes.get(result.rootId)!
    expect(root.rows).toEqual([])
    expect(root.parentId).toBeNull()
    expect(root.elided).toBe(false)
    expect(root.label).toBe(source.nodes.get(source.rootId)!.label)
  })

  it("keeps everything nested under an entity, with its parent and its elision", () => {
    const { source, result } = tree(shopData, { ...shopConfig, groups: ["Customer"] })
    // A value object stays where it is written.
    expect(result.nodes.get("/customers/0/address")!.parentId).toBe("/customers/0")
    // An elided array keeps its card-less status AND the row that drives it, so
    // "lines: 2" still reveals two cards.
    const lines = result.nodes.get("/orders/0/lines")!
    expect(lines.elided).toBe(true)
    expect(lines.parentId).toBe("/orders/0")
    expect(result.nodes.get("/orders/0")!.rows).toEqual(source.nodes.get("/orders/0")!.rows)
    expect(result.nodes.get("/orders/0")!.rows).toContainEqual({
      key: "lines",
      value: 2,
      valueType: "array",
      arrayId: "/orders/0/lines",
    })
  })

  it("leaves a nested entity under its container even when a reference claims it", () => {
    const { result } = tree(nestedData, nestedConfig)
    // The order is claimed by the seller it references, but containment is the
    // stronger signal: only TOP-LEVEL entities move.
    expect(result.nodes.get("/customers/0/orders/0")!.parentId).toBe("/customers/0/orders")
    expect(result.nodes.get("/customers/0/orders")!.parentId).toBe("/customers/0")
  })

  it("puts an entity whose reference is dangling under the root", () => {
    const { result } = tree(shopData, { ...shopConfig, groups: ["Customer"] })
    // /orders/1 points at "GHOST": nothing claimed it.
    expect(result.nodes.get("/orders/1")!.parentId).toBe(result.rootId)
    expect(result.nodes.get("/orders/0")!.parentId).toBe("/customers/0")
  })

  it("falls back to the root rather than closing a cycle", () => {
    // The outer entity references an entity written INSIDE it: taking that
    // predecessor as parent would make the outer its own ancestor.
    const cycleData = { outers: [{ id: "out1", innerRef: "in1", inners: [{ id: "in1" }] }] }
    const cycleConfig: DataGraphConfig = {
      ids: { Outer: "$.outers[*].id", Inner: "$.outers[*].inners[*].id" },
      refs: [{ from: "$.outers[*].innerRef", to: "$.outers[*].inners[*].id" }],
      groups: ["Inner"],
    }
    const { result } = tree(cycleData, cycleConfig)
    expect(result.nodes.get("/outers/0")!.parentId).toBe(result.rootId)
    for (const id of result.nodes.keys()) {
      const seen = new Set<NodeId>()
      let current: NodeId | null = id
      while (current !== null) {
        expect(seen.has(current)).toBe(false)
        seen.add(current)
        current = result.nodes.get(current)!.parentId
      }
    }
  })

  it("does not mutate the source graph", () => {
    const source = buildGraph(joinData, joinConfig)
    const snapshot = JSON.stringify(
      [...source.nodes.values()].map((n) => [n.id, n.parentId, n.childIds, n.cardChildCount]),
    )
    const edgeCount = source.containEdges.length
    buildTreeGraph(source, validateConfig(joinConfig))
    expect(
      JSON.stringify(
        [...source.nodes.values()].map((n) => [n.id, n.parentId, n.childIds, n.cardChildCount]),
      ),
    ).toBe(snapshot)
    expect(source.containEdges.length).toBe(edgeCount)
  })

  it("shares references, entity index, diagnostics and the node count with the source", () => {
    const { source, result } = tree(joinData, joinConfig)
    expect(result.refEdges).toBe(source.refEdges)
    expect(result.entityIndex).toBe(source.entityIndex)
    expect(result.diagnostics).toBe(source.diagnostics)
    expect(result.logicalNodeCount).toBe(source.logicalNodeCount)
    expect(result.rootId).toBe(source.rootId)
  })

  it("emits exactly one containment edge per parent→child link, and counts the cards", () => {
    const { result } = tree(joinData, joinConfig)
    const links = new Set<string>()
    for (const node of result.nodes.values()) {
      for (const childId of node.childIds) links.add(`${node.id}>${childId}`)
      expect(node.cardChildCount).toBe(
        node.childIds.filter((id) => !result.nodes.get(id)!.elided).length,
      )
    }
    expect(result.containEdges.length).toBe(links.size)
    expect(new Set(result.containEdges.map((e) => `${e.from}>${e.to}`))).toEqual(links)
    // Parent before child: the layout engine reads the edges in order.
    const seen = new Set<NodeId>([result.rootId])
    for (const edge of result.containEdges) {
      expect(seen.has(edge.from)).toBe(true)
      seen.add(edge.to)
    }
  })

  it("lays out under the structure view's own machinery", async () => {
    const { result } = tree(joinData, joinConfig)
    const collapse = new CollapseState(result)
    collapse.expand("/groups/0")
    const visible = collapse.visibleNodeIds()
    const { positions } = await createStructureLayoutEngine().layout(result, visible)
    // Elided nodes are rows of their parent's card and have no rect: the
    // invariant applies to DRAWN nodes.
    const drawn = [...visible].filter((id) => !result.nodes.get(id)!.elided)
    expect(positions.size).toBe(drawn.length)
    for (const id of drawn) expect(positions.has(id)).toBe(true)
    // The expansion revealed the item the group claimed, not a table.
    expect(visible.has("/items/0")).toBe(true)
  })
})
