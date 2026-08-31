import { describe, it, expect } from "vitest"
import type { Aggregate, AggregateIndex } from "../src/aggregate.js"
import type { Rect } from "../src/layout.js"
import type { NodeId } from "../src/model.js"
import { separateClusters } from "../src/cluster-separate.js"

/** Un `AggregateIndex` monté à la main : ces tests portent sur la géométrie,
 * pas sur la règle d'appartenance (couverte par `aggregate.test.ts`). Le
 * premier membre listé sert de racine. */
function indexOf(spec: Record<string, NodeId[]>): AggregateIndex {
  const aggregates = new Map<string, Aggregate>()
  const byNode = new Map<NodeId, string[]>()
  for (const [id, members] of Object.entries(spec)) {
    aggregates.set(id, {
      id,
      rootId: members[0]!,
      rootType: id.split("#")[0]!,
      memberIds: new Set(members),
    })
    for (const member of members) byNode.set(member, [...(byNode.get(member) ?? []), id])
  }
  return { aggregates, byNode }
}

function rects(spec: Record<NodeId, [number, number]>): Map<NodeId, Rect> {
  const positions = new Map<NodeId, Rect>()
  for (const [id, [x, y]] of Object.entries(spec)) {
    positions.set(id, { x, y, width: 100, height: 40 })
  }
  return positions
}

function centreOf(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function distanceBetween(a: Rect, b: Rect): number {
  const p = centreOf(a)
  const q = centreOf(b)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

/** Distances intra-agrégat, une par paire, dans un ordre stable. */
function intraDistances(positions: Map<NodeId, Rect>, members: NodeId[]): number[] {
  const out: number[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      out.push(distanceBetween(positions.get(members[i]!)!, positions.get(members[j]!)!))
    }
  }
  return out
}

function overlaps(a: Rect, b: Rect): boolean {
  const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return px > 1e-9 && py > 1e-9
}

/** Boîte englobante des membres positionnés d'un agrégat. */
function bboxOf(positions: Map<NodeId, Rect>, members: Iterable<NodeId>): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of members) {
    const rect = positions.get(id)
    if (!rect) continue
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Deux agrégats de trois cartes, posés l'un sur l'autre : leurs boîtes
 * englobantes se recouvrent franchement, sans qu'aucune carte n'en recouvre
 * une autre. C'est exactement l'entrée que la passe doit ouvrir. */
function twoTangledClusters() {
  const positions = rects({
    "a/0": [0, 0],
    "a/1": [0, 60],
    "a/2": [0, 120],
    "b/0": [140, 20],
    "b/1": [140, 80],
    "b/2": [140, 140],
  })
  const aggregates = indexOf({
    "A#a": ["a/0", "a/1", "a/2"],
    "B#b": ["b/0", "b/1", "b/2"],
  })
  return { positions, aggregates }
}

describe("separateClusters", () => {
  it("preserves intra-cluster geometry EXACTLY — rigid translation", () => {
    const { positions, aggregates } = twoTangledClusters()
    const beforeA = intraDistances(positions, ["a/0", "a/1", "a/2"])
    const beforeB = intraDistances(positions, ["b/0", "b/1", "b/2"])

    separateClusters(positions, aggregates, 400, 3000)

    // Égalité STRICTE, pas une tolérance : la passe ne translate que des
    // clusters entiers, donc la géométrie interne est bit à bit la même.
    expect(intraDistances(positions, ["a/0", "a/1", "a/2"])).toEqual(beforeA)
    expect(intraDistances(positions, ["b/0", "b/1", "b/2"])).toEqual(beforeB)
  })

  it("increases the mean inter-cluster distance materially", () => {
    const { positions, aggregates } = twoTangledClusters()
    const membersA = ["a/0", "a/1", "a/2"]
    const membersB = ["b/0", "b/1", "b/2"]
    const meanCross = (p: Map<NodeId, Rect>) => {
      let sum = 0
      let n = 0
      for (const a of membersA) {
        for (const b of membersB) {
          sum += distanceBetween(p.get(a)!, p.get(b)!)
          n++
        }
      }
      return sum / n
    }

    const before = meanCross(positions)
    separateClusters(positions, aggregates, 400, 3000)
    const after = meanCross(positions)

    // Mesuré sur ce fixture, gap = 400 : 156,44 px avant, 505,14 px après
    // (×3,23). Les deux chiffres sont ceux de l'exécution, pas une cible.
    expect(before).toBeCloseTo(156.44, 1)
    expect(after).toBeCloseTo(505.14, 1)
    expect(after).toBeGreaterThan(before * 2)
  })

  it("leaves two aggregates that share a member exactly where they are", () => {
    // Une entité partagée ne peut pas suivre deux clusters rigidement : les
    // écarter n'a pas de sens, ils s'interpénètrent par construction. La passe
    // exempte donc ces paires — sans quoi elle ne convergerait jamais.
    const positions = rects({ "a/0": [0, 0], "s/0": [120, 0], "b/0": [240, 0] })
    const aggregates = indexOf({ "A#a": ["a/0", "s/0"], "B#b": ["b/0", "s/0"] })
    const before = new Map([...positions].map(([id, r]) => [id, { ...r }]))

    separateClusters(positions, aggregates, 400, 3000)

    for (const [id, rect] of before) expect(positions.get(id)).toEqual(rect)
  })

  it("treats an entity outside every aggregate as its own cluster", () => {
    // Sans ça, une entité isolée resterait posée à l'intérieur de l'enveloppe
    // d'un agrégat voisin, qui ne la contient pourtant pas.
    const positions = rects({ "a/0": [0, 0], "a/1": [0, 60], "lone/0": [40, 20] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"] })

    separateClusters(positions, aggregates, 200, 3000)

    const hull = bboxOf(positions, ["a/0", "a/1"])
    const lone = positions.get("lone/0")!
    expect(overlaps(hull, lone)).toBe(false)
  })

  it("keeps cards non-overlapping", () => {
    const { positions, aggregates } = twoTangledClusters()
    separateClusters(positions, aggregates, 400, 3000)
    const all = [...positions.values()]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i]!, all[j]!)).toBe(false)
      }
    }
  })

  it("opens at least `gap` between two cluster bounding boxes", () => {
    const { positions, aggregates } = twoTangledClusters()
    separateClusters(positions, aggregates, 400, 3000)
    const boxA = bboxOf(positions, ["a/0", "a/1", "a/2"])
    const boxB = bboxOf(positions, ["b/0", "b/1", "b/2"])
    const px = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x)
    const py = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y)
    // Séparées le long d'au moins un axe, d'au moins `gap`.
    expect(Math.max(-px, -py)).toBeGreaterThanOrEqual(400 - 1e-6)
  })

  it("is deterministic across two runs", () => {
    const first = twoTangledClusters()
    const second = twoTangledClusters()
    separateClusters(first.positions, first.aggregates, 400, 3000)
    separateClusters(second.positions, second.aggregates, 400, 3000)
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()])
  })
})

describe("separateClusters — entrées dégénérées", () => {
  it("no aggregate at all: every entity is its own cluster", () => {
    const positions = rects({ "x/0": [0, 0], "x/1": [20, 10] })
    separateClusters(positions, { aggregates: new Map(), byNode: new Map() }, 200, 3000)
    const a = positions.get("x/0")!
    const b = positions.get("x/1")!
    const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    expect(Math.max(-px, -py)).toBeGreaterThanOrEqual(200 - 1e-6)
  })

  it("a single aggregate covering everything: nothing moves", () => {
    const positions = rects({ "a/0": [0, 0], "a/1": [10, 10] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"] })
    const before = new Map([...positions].map(([id, r]) => [id, { ...r }]))
    separateClusters(positions, aggregates, 400, 3000)
    for (const [id, rect] of before) expect(positions.get(id)).toEqual(rect)
  })

  it("a single-member aggregate is separated like any other cluster", () => {
    const positions = rects({ "a/0": [0, 0], "b/0": [20, 10] })
    const aggregates = indexOf({ "A#a": ["a/0"], "B#b": ["b/0"] })
    separateClusters(positions, aggregates, 200, 3000)
    const a = positions.get("a/0")!
    const b = positions.get("b/0")!
    const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    expect(Math.max(-px, -py)).toBeGreaterThanOrEqual(200 - 1e-6)
  })

  it("an empty position map is a no-op", () => {
    const positions = new Map<NodeId, Rect>()
    separateClusters(positions, { aggregates: new Map(), byNode: new Map() }, 400, 3000)
    expect(positions.size).toBe(0)
  })

  it("an aggregate whose members are all unpositioned is skipped", () => {
    const positions = rects({ "b/0": [0, 0] })
    const aggregates = indexOf({ "A#a": ["a/0", "a/1"], "B#b": ["b/0"] })
    expect(() => separateClusters(positions, aggregates, 400, 3000)).not.toThrow()
    expect(positions.get("b/0")).toEqual({ x: 0, y: 0, width: 100, height: 40 })
  })
})
