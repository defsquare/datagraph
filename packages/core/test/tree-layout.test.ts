import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildTreeGraph } from "../src/tree.js"
import { CollapseState } from "../src/collapse.js"
import { createTreeLayout } from "../src/tree-layout.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import type { Graph, NodeId } from "../src/model.js"
import type { Rect } from "../src/structure-layout.js"
import { shopData, shopConfig } from "./fixtures.js"

/**
 * The shape of a NORMALISED document, the one the tree view exists for: two
 * groups, each claiming two infractions through a foreign key. Small enough that
 * the expected geometry can be written out in full.
 */
const joinData = {
  groupes: [{ id: "G1", label: "Rencontre" }, { id: "G2", label: "Discipline" }],
  infractions: [
    { id: "I1", groupeId: "G1", code: "1.1" },
    { id: "I2", groupeId: "G1", code: "1.2" },
    { id: "I3", groupeId: "G2", code: "2.1" },
  ],
}

const joinConfig: DataGraphConfig = {
  ids: {
    Groupe: "$.groupes[*].id",
    Infraction: "$.infractions[*].id",
  },
  refs: [{ from: "$.infractions[*].groupeId", to: "$.groupes[*].id" }],
  groups: ["Groupe"],
}

/** The tree graph plus the layout of everything the tree opens on. */
async function layoutTree(
  data: unknown,
  config: DataGraphConfig,
): Promise<{ tree: Graph; positions: Map<NodeId, Rect> }> {
  const tree = buildTreeGraph(buildGraph(data, config), validateConfig(config))
  const collapse = new CollapseState(tree, { expandEntities: true })
  const { positions } = await createTreeLayout().layout(tree, collapse.visibleNodeIds())
  return { tree, positions }
}

describe("createTreeLayout", () => {
  it("lays children out BELOW their parent", async () => {
    const { tree, positions } = await layoutTree(joinData, joinConfig)
    for (const node of tree.nodes.values()) {
      if (node.parentId === null || node.parentId === tree.rootId) continue
      const child = positions.get(node.id)
      const parent = positions.get(node.parentId)
      if (!child || !parent) continue
      expect(child.y, `${node.id} below ${node.parentId}`).toBeGreaterThanOrEqual(
        parent.y + parent.height,
      )
    }
  })

  it("keeps siblings in document order, left to right", async () => {
    const { positions } = await layoutTree(joinData, joinConfig)
    // G1's two infractions, in `childIds` order — which is the document's.
    const i1 = positions.get("/infractions/0")!
    const i2 = positions.get("/infractions/1")!
    expect(i1.x).toBeLessThan(i2.x)
    // And the two groups themselves, children of the root.
    const g1 = positions.get("/groupes/0")!
    const g2 = positions.get("/groupes/1")!
    expect(g1.x).toBeLessThan(g2.x)
  })

  it("drops the synthetic root while its children still share one row", async () => {
    const { tree, positions } = await layoutTree(joinData, joinConfig)
    // The root is visible in the MODEL — the collapse state and the search index
    // start from it — but it has no rect, hence no card.
    expect(new CollapseState(tree, { expandEntities: true }).visibleNodeIds()).toContain(tree.rootId)
    expect(positions.has(tree.rootId)).toBe(false)
    const g1 = positions.get("/groupes/0")!
    const g2 = positions.get("/groupes/1")!
    expect(g1.y).toBe(g2.y)
  })

  it("gives an elided array no box and hangs its elements under the entity card", async () => {
    const { tree, positions } = await layoutTree(shopData, shopConfig)
    // `lines` is an array under an Order entity: it is drawn as a row of that
    // entity's card, so it takes no box of its own.
    expect(tree.nodes.get("/orders/0/lines")!.elided).toBe(true)
    expect(positions.has("/orders/0/lines")).toBe(false)
    const order = positions.get("/orders/0")!
    for (const id of ["/orders/0/lines/0", "/orders/0/lines/1"]) {
      const element = positions.get(id)!
      expect(element, id).toBeDefined()
      expect(element.y, `${id} hangs under the order card`).toBeGreaterThanOrEqual(
        order.y + order.height,
      )
    }
  })
})
