# Vue graphe (entités, références, agrégats) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une seconde vue « graphe » où les sommets sont les entités, les arêtes les références, et les entités regroupées en agrégats déclarés — la vue structure existante restant strictement inchangée.

**Architecture:** Cinq modules nouveaux dans `packages/core` (config étendue, calcul des agrégats, enveloppe convexe, séparation de rectangles, moteur de layout organique), plus une bascule de vue dans le renderer. Le moteur de layout vit derrière un **point d'entrée séparé** (`@defsquare/data-graph-core/graph-layout`) chargé dynamiquement, pour que `cytoscape` n'entre jamais dans le bundle de qui n'utilise que la vue structure.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, tsup, cytoscape + cytoscape-fcose (nouveau, isolé), Pixi.js (renderer), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-31-graph-view-aggregates-design.md`
**Sonde préalable:** `docs/superpowers/spikes/2026-08-31-organic-layout.md`

## Global Constraints

- Branche de travail : `feat/graph-view-aggregates` (déjà créée, part de `main`).
- **Style : `packages/core` et `apps/demo` s'écrivent SANS points-virgules ; `packages/renderer` AVEC.** Respecter le fichier voisin, toujours.
- Indentation 2 espaces partout. Commentaires en français dans le code neuf, à la densité des fichiers voisins.
- **La vue structure ne doit subir aucune régression.** `CollapseState`, `createLayoutEngine`, `layout.ts` et le chemin ELK ne sont modifiés par aucune tâche.
- Le barrel `packages/core/src/index.ts` ne doit **jamais** exporter quoi que ce soit qui importe `cytoscape` (Task 6 pose le test de non-régression qui le garantit).
- Après chaque tâche : `pnpm -r typecheck` et `pnpm -r test` doivent passer. Le typecheck du renderer et de la démo lit les `dist/` du cœur : lancer `pnpm --filter @defsquare/data-graph-core build` puis `pnpm --filter @defsquare/data-graph build` avant de typechecker si une signature publique a bougé.
- Budget dur, vérifié par test : deux `layout()` sur les mêmes entrées donnent des positions **identiques au pixel**.
- Commit à la fin de chaque tâche, message en français, préfixe conventionnel.

## Structure des fichiers

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `packages/core/src/config.ts` | *(modifié)* champ `aggregates` | 1 |
| `packages/core/src/aggregate.ts` | *(neuf)* règle d'appartenance, index des agrégats | 2 |
| `packages/core/src/hull.ts` | *(neuf)* enveloppe convexe matelassée | 3 |
| `packages/core/src/separate.ts` | *(neuf)* séparation de rectangles par relaxation | 4 |
| `packages/core/src/aggregate-collapse.ts` | *(neuf)* visibilité pliée/dépliée des agrégats | 5 |
| `packages/core/src/graph-layout.ts` | *(neuf)* barrel du point d'entrée secondaire | 6 |
| `packages/core/src/layout-graph.ts` | *(neuf)* moteur fcose : sommets, arêtes, amorçage, enveloppes | 6-8 |
| `packages/renderer/src/draw.ts` | *(modifié)* `drawHulls` | 9 |
| `packages/renderer/src/create.ts` | *(modifié)* bascule de vue, calque d'enveloppes, import dynamique | 10 |
| `apps/demo/src/sample-data.ts`, `main.ts` | *(modifiés)* agrégats déclarés, générateur groupé, bouton | 11 |

---

### Task 1: Config — déclarer les racines d'agrégat

**Files:**
- Modify: `packages/core/src/config.ts:8-23` (interfaces), `:25-71` (`validateConfig`)
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `DataGraphConfig.aggregates?: string[]` ; `ValidatedConfig.aggregates: string[]` (tableau vide si non fourni, ordre de déclaration préservé).

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `packages/core/test/config.test.ts` :

```ts
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
```

Vérifier que `ConfigError` et `validateConfig` sont déjà importés en tête du fichier ; les ajouter à l'import existant sinon.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts`
Expected: FAIL — `aggregates` est `undefined` sur `ValidatedConfig`, et le cas « Ghost » ne lève pas.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/config.ts`, ajouter le champ à `DataGraphConfig` :

```ts
  /** Types d'entités qui sont racines d'agrégat, dans l'ordre de déclaration.
   * Cet ordre ne joue aucun rôle dans l'appartenance — le chevauchement est
   * autorisé, donc il n'y a rien à arbitrer — seulement dans l'ordre de
   * peinture des enveloppes, pour que le rendu soit reproductible. */
  aggregates?: string[]
```

à `ValidatedConfig` :

```ts
  aggregates: string[]
```

et, dans `validateConfig`, juste avant `const maxNodes = …` :

```ts
  const aggregates: string[] = []
  for (const name of config.aggregates ?? []) {
    if (!entities.has(name)) {
      throw new ConfigError("unknown-entity-type", `Unknown entity type: ${name}`)
    }
    aggregates.push(name)
  }
```

puis ajouter `aggregates` à l'objet retourné.

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Vérifier l'absence de régression**

Run: `pnpm --filter @defsquare/data-graph-core test`
Expected: tous les fichiers passent (48 tests avant cette tâche, plus les 3 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat(core): declarer les racines d'agregat dans la config"
```

---

### Task 2: `aggregate.ts` — la règle d'appartenance

C'est la tâche la plus dense du plan : toute la sémantique de la fonctionnalité y est.

**Files:**
- Create: `packages/core/src/aggregate.ts`
- Modify: `packages/core/src/index.ts` (export), `packages/core/test/fixtures.ts` (fixtures neuves)
- Test: `packages/core/test/aggregate.test.ts`

**Interfaces:**
- Consumes: `ValidatedConfig.aggregates` (Task 1) ; `Graph.nodes`, `Graph.refEdges` (existants).
- Produces:
  ```ts
  interface Aggregate { id: string; rootId: NodeId; rootType: string; memberIds: Set<NodeId> }
  interface AggregateIndex { aggregates: Map<string, Aggregate>; byNode: Map<NodeId, string[]> }
  function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex
  ```
  L'id d'un agrégat est `` `${rootType}#${rootEntityId}` ``.

**La règle, à garder sous les yeux pendant l'implémentation :** une entité E appartient à l'agrégat de racine R ssi `d(E, R) = dmin(E)`, où `d` est le nombre minimal de références sortantes menant de E à R, et `dmin(E)` le minimum sur toutes les racines atteignables. Une racine est à distance 0 d'elle-même, donc n'est jamais absorbée par une autre.

- [ ] **Step 1: Ajouter les fixtures**

Ajouter à `packages/core/test/fixtures.ts` (ne PAS toucher à `shopData`, `shopConfig` ni `bigShop` : `build.test.ts` et `search.test.ts` dépendent de leurs comptes exacts) :

```ts
/** Un Order référence à la fois un Customer et un Product, les deux racines :
 * égalité de distance, donc chevauchement. */
export const twoRootsData = {
  customers: [{ id: "c1", name: "Dupont" }],
  products: [{ id: "p9", name: "Vis" }],
  orders: [{ id: "o3", customerId: "c1", productId: "p9" }],
}

export const twoRootsConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Product: { match: "$.products[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer", productId: "Product" } },
  aggregates: ["Customer", "Product"],
}

/** Chaîne LineItem -> Order -> Customer : appartenance transitive à 2 sauts.
 * Et Customer -> Country, Country racine elle aussi : c'est le cas « hub »,
 * qui doit rester borné. */
export const chainData = {
  countries: [{ id: "fr", name: "France" }],
  customers: [{ id: "c1", name: "Dupont", countryId: "fr" }],
  orders: [{ id: "o1", customerId: "c1" }],
  lines: [{ id: "l1", orderId: "o1" }],
}

export const chainConfig: DataGraphConfig = {
  entities: {
    Country: { match: "$.countries[*]", id: "id" },
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
    LineItem: { match: "$.lines[*]", id: "id" },
  },
  references: {
    Customer: { countryId: "Country" },
    Order: { customerId: "Customer" },
    LineItem: { orderId: "Order" },
  },
  aggregates: ["Customer", "Country"],
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `packages/core/test/aggregate.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { shopData, shopConfig, twoRootsData, twoRootsConfig, chainData, chainConfig } from "./fixtures.js"

function index(data: unknown, config: Parameters<typeof validateConfig>[0]) {
  return buildAggregates(buildGraph(data, config), validateConfig(config))
}

describe("buildAggregates", () => {
  it("groups a root with the entities that reference it", () => {
    const idx = index(shopData, { ...shopConfig, aggregates: ["Customer"] })
    expect([...idx.aggregates.keys()].sort()).toEqual(["Customer#c1", "Customer#c2"])
    expect([...idx.aggregates.get("Customer#c1")!.memberIds].sort()).toEqual(["/customers/0", "/orders/0"])
    // c2 n'est référencée par personne : son agrégat se réduit à elle-même.
    expect([...idx.aggregates.get("Customer#c2")!.memberIds]).toEqual(["/customers/1"])
  })

  it("leaves an entity with a dangling reference out of every aggregate", () => {
    const idx = index(shopData, { ...shopConfig, aggregates: ["Customer"] })
    // /orders/1 pointe vers "GHOST" : la référence est cassée, elle ne propage rien.
    expect(idx.byNode.get("/orders/1")).toBeUndefined()
  })

  it("puts an entity in several aggregates when the distances tie", () => {
    const idx = index(twoRootsData, twoRootsConfig)
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1", "Product#p9"])
    expect(idx.aggregates.get("Customer#c1")!.memberIds.has("/orders/0")).toBe(true)
    expect(idx.aggregates.get("Product#p9")!.memberIds.has("/orders/0")).toBe(true)
  })

  it("orders byNode by declaration order of the root type", () => {
    const reversed = { ...twoRootsConfig, aggregates: ["Product", "Customer"] }
    const idx = index(twoRootsData, reversed)
    expect(idx.byNode.get("/orders/0")).toEqual(["Product#p9", "Customer#c1"])
  })

  it("is transitive: a LineItem two hops away joins the Customer aggregate", () => {
    const idx = index(chainData, chainConfig)
    expect(idx.aggregates.get("Customer#c1")!.memberIds.has("/lines/0")).toBe(true)
  })

  it("bounds a hub root: only the nearest root claims an entity", () => {
    const idx = index(chainData, chainConfig)
    // L'Order atteint Customer à 1 saut et Country à 2 : il reste chez Customer.
    expect(idx.byNode.get("/orders/0")).toEqual(["Customer#c1"])
    // Country ne récupère donc pas tout le graphe.
    expect([...idx.aggregates.get("Country#fr")!.memberIds]).toEqual(["/countries/0"])
  })

  it("never absorbs a root into another aggregate", () => {
    const idx = index(chainData, chainConfig)
    // c1 référence fr, mais c1 est elle-même racine : distance 0 à elle-même.
    expect(idx.byNode.get("/customers/0")).toEqual(["Customer#c1"])
  })

  it("terminates on a reference cycle", () => {
    const data = { as: [{ id: "a1", bId: "b1" }], bs: [{ id: "b1", aId: "a1" }] }
    const config = {
      entities: { A: { match: "$.as[*]", id: "id" }, B: { match: "$.bs[*]", id: "id" } },
      references: { A: { bId: "B" }, B: { aId: "A" } },
      aggregates: ["A"],
    }
    const idx = index(data, config)
    expect([...idx.aggregates.get("A#a1")!.memberIds].sort()).toEqual(["/as/0", "/bs/0"])
  })

  it("produces no aggregate for a declared root type with no instance", () => {
    const data = { customers: [], orders: [{ id: "o1", customerId: "GHOST" }] }
    const idx = index(data, { ...shopConfig, aggregates: ["Customer"] })
    expect(idx.aggregates.size).toBe(0)
    expect(idx.byNode.size).toBe(0)
  })

  it("produces nothing when no aggregate root is declared", () => {
    const idx = index(shopData, shopConfig)
    expect(idx.aggregates.size).toBe(0)
  })
})
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/aggregate.test.ts`
Expected: FAIL — `Cannot find module '../src/aggregate.js'`.

- [ ] **Step 4: Implémenter**

Créer `packages/core/src/aggregate.ts` :

```ts
import type { ValidatedConfig } from "./config.js"
import type { Graph, NodeId } from "./model.js"

export interface Aggregate {
  /** `${rootType}#${rootEntityId}` — stable d'une construction à l'autre. */
  id: string
  rootId: NodeId
  rootType: string
  /** Inclut `rootId`. */
  memberIds: Set<NodeId>
}

export interface AggregateIndex {
  aggregates: Map<string, Aggregate>
  /** Plusieurs entrées pour une entité = chevauchement. Ordre stable : celui
   * de `ValidatedConfig.aggregates`, puis l'id de la racine. */
  byNode: Map<NodeId, string[]>
}

/**
 * Calcule les agrégats par un BFS **multi-source inverse** sur `refEdges` : on
 * part de toutes les racines à la fois, à distance 0, et on remonte les
 * références (de la cible vers la source). La distance ainsi trouvée pour une
 * entité E est exactement le nombre minimal de références sortantes menant de E
 * à cette racine.
 *
 * Un seul parcours pour toutes les racines — donc linéaire en (entités +
 * références), pas un BFS par racine. C'est aussi ce qui rend le chevauchement
 * naturel : une racine découverte à distance ÉGALE s'ajoute à l'ensemble, une
 * racine découverte à distance SUPÉRIEURE est ignorée.
 *
 * Corollaire important : une racine a une distance 0 à elle-même, donc rien ne
 * peut la revendiquer, et un hub très référencé ne peut pas aspirer tout le
 * graphe — les entités proches d'une racine plus près restent chez elle.
 */
export function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex {
  const aggregates = new Map<string, Aggregate>()
  const byNode = new Map<NodeId, string[]>()

  const rootTypes = new Set(config.aggregates)
  if (rootTypes.size === 0) return { aggregates, byNode }

  // Rang de déclaration, pour l'ordre stable de `byNode`.
  const typeRank = new Map<string, number>()
  config.aggregates.forEach((type, i) => typeRank.set(type, i))

  // 1. Les racines.
  const roots: { id: NodeId; aggId: string }[] = []
  for (const node of graph.nodes.values()) {
    if (node.kind !== "entity" || !rootTypes.has(node.entityType)) continue
    const aggId = `${node.entityType}#${node.entityId}`
    aggregates.set(aggId, {
      id: aggId,
      rootId: node.id,
      rootType: node.entityType,
      memberIds: new Set([node.id]),
    })
    roots.push({ id: node.id, aggId })
  }
  if (roots.length === 0) return { aggregates, byNode }

  // 2. Adjacence inverse : cible -> sources qui la référencent. Les arêtes
  //    cassées ne propagent rien.
  const incoming = new Map<NodeId, NodeId[]>()
  for (const edge of graph.refEdges) {
    if (edge.to === null || edge.dangling) continue
    const sources = incoming.get(edge.to)
    if (sources) sources.push(edge.from)
    else incoming.set(edge.to, [edge.from])
  }

  // 3. BFS multi-source. `dist` fait aussi office de marquage de visite, ce qui
  //    coupe les cycles.
  const dist = new Map<NodeId, number>()
  const claims = new Map<NodeId, Set<string>>()
  const queue: NodeId[] = []

  for (const root of roots) {
    dist.set(root.id, 0)
    claims.set(root.id, new Set([root.aggId]))
    queue.push(root.id)
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const currentDist = dist.get(current)!
    const currentClaims = claims.get(current)!
    const nextDist = currentDist + 1

    for (const source of incoming.get(current) ?? []) {
      const known = dist.get(source)
      if (known === undefined) {
        dist.set(source, nextDist)
        claims.set(source, new Set(currentClaims))
        queue.push(source)
      } else if (known === nextDist) {
        // Distance égale : les deux racines revendiquent — c'est le
        // chevauchement, et c'est voulu.
        const set = claims.get(source)!
        for (const aggId of currentClaims) set.add(aggId)
      }
      // known < nextDist : une racine plus proche a déjà pris cette entité.
    }
  }

  // 4. Report dans les agrégats, avec un ordre stable.
  for (const [nodeId, claimed] of claims) {
    const ids = [...claimed].sort((a, b) => {
      const rankA = typeRank.get(aggregates.get(a)!.rootType) ?? 0
      const rankB = typeRank.get(aggregates.get(b)!.rootType) ?? 0
      return rankA !== rankB ? rankA - rankB : a < b ? -1 : a > b ? 1 : 0
    })
    byNode.set(nodeId, ids)
    for (const aggId of ids) aggregates.get(aggId)!.memberIds.add(nodeId)
  }

  return { aggregates, byNode }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/aggregate.test.ts`
Expected: PASS — les 10 tests.

- [ ] **Step 6: Exporter depuis le barrel**

`aggregate.ts` n'a aucune dépendance externe : il a sa place dans `packages/core/src/index.ts`. Ajouter après la ligne d'export de `collapse.js` :

```ts
export { buildAggregates, type Aggregate, type AggregateIndex } from "./aggregate.js"
```

- [ ] **Step 7: Vérifier l'ensemble**

Run: `pnpm --filter @defsquare/data-graph-core test && pnpm --filter @defsquare/data-graph-core typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/aggregate.ts packages/core/src/index.ts \
        packages/core/test/aggregate.test.ts packages/core/test/fixtures.ts
git commit -m "feat(core): calculer les agregats par distance minimale aux racines"
```

---

### Task 3: `hull.ts` — enveloppe convexe matelassée

**Files:**
- Create: `packages/core/src/hull.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/test/hull.test.ts`

**Interfaces:**
- Consumes: `Rect` (`./layout.js`, existant).
- Produces: `interface Point { x: number; y: number }` ; `function paddedHull(rects: Rect[], padding: number): Point[]` — polygone en **sens horaire ou trigonométrique cohérent**, sans point dupliqué, `[]` pour une entrée vide.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/core/test/hull.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { paddedHull } from "../src/hull.js"
import type { Rect } from "../src/layout.js"

/** Vrai si `p` est dans le polygone convexe `poly` (ou sur son bord), à
 * epsilon près. Sert d'invariant à toutes les assertions de ce fichier. */
function inside(poly: { x: number; y: number }[], p: { x: number; y: number }): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function corners(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ]
}

describe("paddedHull", () => {
  it("returns an empty polygon for no rects", () => {
    expect(paddedHull([], 10)).toEqual([])
  })

  it("wraps a single rect in its padded box", () => {
    const poly = paddedHull([{ x: 10, y: 20, width: 100, height: 40 }], 5)
    expect(poly).toHaveLength(4)
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    expect(Math.min(...xs)).toBe(5)
    expect(Math.max(...xs)).toBe(115)
    expect(Math.min(...ys)).toBe(15)
    expect(Math.max(...ys)).toBe(65)
  })

  it("contains every corner of every input rect", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
      { x: -80, y: 220, width: 60, height: 50 },
    ]
    const poly = paddedHull(rects, 12)
    for (const r of rects) {
      for (const c of corners(r)) expect(inside(poly, c)).toBe(true)
    }
  })

  it("handles collinear rect centres without emitting duplicate points", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 100, y: 0, width: 50, height: 20 },
      { x: 200, y: 0, width: 50, height: 20 },
    ]
    const poly = paddedHull(rects, 4)
    expect(poly).toHaveLength(4)
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`
    expect(new Set(poly.map(key)).size).toBe(poly.length)
  })

  it("collapses identical stacked rects to a single padded box", () => {
    const r: Rect = { x: 7, y: 9, width: 30, height: 30 }
    expect(paddedHull([r, { ...r }, { ...r }], 3)).toHaveLength(4)
  })

  it("is deterministic", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 120, width: 80, height: 60 },
      { x: 120, y: 400, width: 140, height: 30 },
    ]
    expect(paddedHull(rects, 12)).toEqual(paddedHull(rects, 12))
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/hull.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `packages/core/src/hull.ts` :

```ts
import type { Rect } from "./layout.js"

export interface Point {
  x: number
  y: number
}

/**
 * Enveloppe convexe des coins des rectangles, chacun préalablement **gonflé**
 * de `padding`.
 *
 * Gonfler les rectangles en entrée plutôt que décaler le polygone en sortie
 * évite tout calcul d'offset de polygone (bissectrices, coins rentrants,
 * auto-intersections) tout en restant exact : l'enveloppe convexe d'un ensemble
 * de boîtes gonflées contient l'enveloppe des boîtes d'origine dilatée d'au
 * moins `padding` dans chaque direction axiale.
 *
 * Balayage de Andrew (monotone chain), O(n log n). Les points colinéaires sont
 * éliminés (`cross <= 0`), donc trois cartes alignées produisent bien un
 * quadrilatère et non un polygone à points redondants.
 */
export function paddedHull(rects: Rect[], padding: number): Point[] {
  if (rects.length === 0) return []

  const points: Point[] = []
  for (const r of rects) {
    const left = r.x - padding
    const top = r.y - padding
    const right = r.x + r.width + padding
    const bottom = r.y + r.height + padding
    points.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom })
  }

  points.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))

  // Doublons exacts retirés : ils feraient produire au balayage des arêtes de
  // longueur nulle (cas des cartes empilées à l'identique).
  const unique: Point[] = []
  for (const p of points) {
    const last = unique[unique.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    unique.push(p)
  }
  if (unique.length < 3) return unique

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Le dernier point de chaque chaîne est le premier de l'autre.
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/hull.test.ts`
Expected: PASS — les 6 tests.

- [ ] **Step 5: Exporter depuis le barrel**

Dans `packages/core/src/index.ts`, après l'export de `aggregate.js` :

```ts
export { paddedHull, type Point } from "./hull.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hull.ts packages/core/src/index.ts packages/core/test/hull.test.ts
git commit -m "feat(core): enveloppe convexe matelassee pour les agregats"
```

---

### Task 4: `separate.ts` — séparation des cartes

Code repris de la sonde `spike/organic-layout` (`packages/core/src/layout-force.ts`), où il a été validé par les bancs de mesure : sans lui, fcose recouvre jusqu'à 94 % de l'aire des cartes ; avec lui, on tombe à 0.

**Files:**
- Create: `packages/core/src/separate.ts`
- Test: `packages/core/test/separate.test.ts`

**Interfaces:**
- Consumes: `Rect`, `NodeId`.
- Produces: `function separateOverlaps(positions: Map<NodeId, Rect>, margin: number, iterations: number): void` — **mute les `Rect` en place**, ne renvoie rien.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/core/test/separate.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { separateOverlaps } from "../src/separate.js"
import type { Rect } from "../src/layout.js"

function overlapCount(positions: Map<string, Rect>, margin: number): number {
  const rects = [...positions.values()]
  let n = 0
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
      if (ox > 1e-6 && oy > 1e-6) n++
    }
  }
  return n
}

describe("separateOverlaps", () => {
  it("pushes two overlapping rects apart", () => {
    const positions = new Map<string, Rect>([
      ["a", { x: 0, y: 0, width: 100, height: 50 }],
      ["b", { x: 20, y: 10, width: 100, height: 50 }],
    ])
    separateOverlaps(positions, 8, 200)
    expect(overlapCount(positions, 8)).toBe(0)
  })

  it("leaves an already disjoint layout untouched", () => {
    const positions = new Map<string, Rect>([
      ["a", { x: 0, y: 0, width: 100, height: 50 }],
      ["b", { x: 500, y: 500, width: 100, height: 50 }],
    ])
    separateOverlaps(positions, 8, 200)
    expect(positions.get("a")).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(positions.get("b")).toEqual({ x: 500, y: 500, width: 100, height: 50 })
  })

  it("resolves a dense pile", () => {
    const positions = new Map<string, Rect>()
    for (let i = 0; i < 40; i++) {
      positions.set(`n${i}`, { x: (i % 5) * 6, y: Math.floor(i / 5) * 6, width: 120, height: 60 })
    }
    separateOverlaps(positions, 10, 2000)
    expect(overlapCount(positions, 10)).toBe(0)
  })

  it("is deterministic", () => {
    const make = () => {
      const m = new Map<string, Rect>()
      for (let i = 0; i < 20; i++) m.set(`n${i}`, { x: i * 3, y: i * 2, width: 90, height: 40 })
      return m
    }
    const a = make()
    const b = make()
    separateOverlaps(a, 6, 500)
    separateOverlaps(b, 6, 500)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it("handles a single rect and an empty map", () => {
    const one = new Map<string, Rect>([["a", { x: 1, y: 2, width: 3, height: 4 }]])
    expect(() => separateOverlaps(one, 5, 10)).not.toThrow()
    expect(one.get("a")).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(() => separateOverlaps(new Map(), 5, 10)).not.toThrow()
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/separate.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `packages/core/src/separate.ts` :

```ts
import type { NodeId } from "./model.js"
import type { Rect } from "./layout.js"

/**
 * Écarte les rectangles qui se chevauchent, **en place**, par relaxation : à
 * chaque passe, toute paire en collision est repoussée le long de son axe de
 * moindre pénétration, chaque carte encaissant la moitié du déplacement.
 *
 * Cette passe est indispensable et n'est pas un réglage fin : une force
 * converge vers un compromis attraction/répulsion, jamais vers une contrainte
 * dure de non-recouvrement. Aucun calibrage de longueur d'arête ne la remplace.
 *
 * Le voisinage est trouvé via une grille de hachage dont la maille vaut la plus
 * grande carte, donc toute paire en collision tombe dans des cellules
 * adjacentes : on reste linéaire au lieu de comparer les n² paires.
 *
 * Déterministe : aucun aléa, ordre d'itération stable (celui d'insertion de la
 * Map). Sort dès qu'une passe ne bouge plus rien.
 */
export function separateOverlaps(
  positions: Map<NodeId, Rect>,
  margin: number,
  iterations: number,
): void {
  const ids = [...positions.keys()]
  if (ids.length < 2) return

  let cell = 0
  for (const rect of positions.values()) {
    cell = Math.max(cell, rect.width + margin, rect.height + margin)
  }
  if (cell <= 0) return

  for (let pass = 0; pass < iterations; pass++) {
    const buckets = new Map<string, NodeId[]>()
    for (const id of ids) {
      const r = positions.get(id)!
      const key = `${Math.floor((r.x + r.width / 2) / cell)},${Math.floor((r.y + r.height / 2) / cell)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(id)
      else buckets.set(key, [id])
    }

    let moved = false
    const seen = new Set<string>()
    for (const id of ids) {
      const a = positions.get(id)!
      const cx = Math.floor((a.x + a.width / 2) / cell)
      const cy = Math.floor((a.y + a.height / 2) / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other === id) continue
            const pair = id < other ? `${id} ${other}` : `${other} ${id}`
            if (seen.has(pair)) continue
            seen.add(pair)

            const b = positions.get(other)!
            const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
            const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
            if (ox <= 0 || oy <= 0) continue

            moved = true
            if (ox < oy) {
              const push = (ox / 2) * (a.x + a.width / 2 <= b.x + b.width / 2 ? -1 : 1)
              a.x += push
              b.x -= push
            } else {
              const push = (oy / 2) * (a.y + a.height / 2 <= b.y + b.height / 2 ? -1 : 1)
              a.y += push
              b.y -= push
            }
          }
        }
      }
    }
    if (!moved) break
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/separate.test.ts`
Expected: PASS — les 5 tests.

Si « resolves a dense pile » échoue, c'est un manque d'itérations et non un bug : la sonde a mesuré qu'il faut ~600 passes à 800 cartes. Augmenter le nombre d'itérations du test avant de toucher à l'algorithme.

- [ ] **Step 5: Commit**

Ne PAS exporter depuis le barrel : `separate.ts` est un détail d'implémentation du moteur de layout, pas une API publique.

```bash
git add packages/core/src/separate.ts packages/core/test/separate.test.ts
git commit -m "feat(core): passe de separation des cartes qui se chevauchent"
```

---

### Task 5: `aggregate-collapse.ts` — visibilité plié/déplié

**Files:**
- Create: `packages/core/src/aggregate-collapse.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/test/aggregate-collapse.test.ts`

**Interfaces:**
- Consumes: `AggregateIndex` (Task 2).
- Produces:
  ```ts
  class AggregateCollapseState {
    constructor(index: AggregateIndex, allEntityIds: Iterable<NodeId>)
    isExpanded(aggregateId: string): boolean
    expand(aggregateId: string): void
    collapse(aggregateId: string): void
    visibleEntityIds(): Set<NodeId>
  }
  ```
  Le second paramètre est indispensable : `AggregateIndex` ne connaît que les
  entités qui appartiennent à au moins un agrégat, or une entité hors de tout
  agrégat doit rester visible. Sans cette liste, elle disparaîtrait de la vue.

**Règles de visibilité, dans cet ordre :** une racine est toujours visible ; une entité sans agrégat est toujours visible ; un membre non-racine est visible ssi **au moins un** de ses agrégats est déplié. Les agrégats démarrent **dépliés**.

`CollapseState` n'est pas touchée : elle continue de servir la vue structure.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/core/test/aggregate-collapse.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { AggregateCollapseState } from "../src/aggregate-collapse.js"
import { shopData, shopConfig, twoRootsData, twoRootsConfig } from "./fixtures.js"

const shopAgg = { ...shopConfig, aggregates: ["Customer"] }

function state(data: unknown, config: Parameters<typeof validateConfig>[0]) {
  const graph = buildGraph(data, config)
  const entityIds = [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id)
  return new AggregateCollapseState(buildAggregates(graph, validateConfig(config)), entityIds)
}

describe("AggregateCollapseState", () => {
  it("starts with every aggregate expanded", () => {
    const s = state(shopData, shopAgg)
    expect(s.isExpanded("Customer#c1")).toBe(true)
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })

  it("collapsing an aggregate hides its non-root members", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    const visible = s.visibleEntityIds()
    expect(visible.has("/customers/0")).toBe(true) // la racine reste
    expect(visible.has("/orders/0")).toBe(false)
  })

  it("re-expanding restores them", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    s.expand("Customer#c1")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })

  it("keeps an entity outside any aggregate always visible", () => {
    const s = state(shopData, shopAgg)
    s.collapse("Customer#c1")
    s.collapse("Customer#c2")
    // /orders/1 a une référence cassée : il n'appartient à aucun agrégat.
    expect(s.visibleEntityIds().has("/orders/1")).toBe(true)
  })

  it("keeps a shared entity visible while any of its aggregates is expanded", () => {
    const s = state(twoRootsData, twoRootsConfig)
    s.collapse("Customer#c1")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true) // Product#p9 est encore déplié
    s.collapse("Product#p9")
    expect(s.visibleEntityIds().has("/orders/0")).toBe(false) // tous fermés
  })

  it("ignores collapse of an unknown aggregate id", () => {
    const s = state(shopData, shopAgg)
    expect(() => s.collapse("Ghost#x")).not.toThrow()
    expect(s.visibleEntityIds().has("/orders/0")).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/aggregate-collapse.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `packages/core/src/aggregate-collapse.ts` :

```ts
import type { AggregateIndex } from "./aggregate.js"
import type { NodeId } from "./model.js"

/**
 * Suit quels agrégats sont dépliés dans la vue graphe, et en dérive
 * l'ensemble des entités visibles.
 *
 * Les agrégats démarrent **dépliés** : la vue graphe existe pour montrer le
 * graphe, pas pour le cacher. Replier réduit un agrégat à sa seule carte
 * racine.
 *
 * Distincte de `CollapseState`, qui gouverne l'arbre de containment de la vue
 * structure et n'est pas concernée ici.
 */
export class AggregateCollapseState {
  private readonly index: AggregateIndex
  private readonly allEntityIds: NodeId[]
  private readonly collapsed: Set<string> = new Set()

  constructor(index: AggregateIndex, allEntityIds: Iterable<NodeId>) {
    this.index = index
    this.allEntityIds = [...allEntityIds]
  }

  isExpanded(aggregateId: string): boolean {
    return !this.collapsed.has(aggregateId)
  }

  expand(aggregateId: string): void {
    this.collapsed.delete(aggregateId)
  }

  collapse(aggregateId: string): void {
    // Un id inconnu est ignoré plutôt que de lever : l'appelant est un
    // gestionnaire de clic, pas un contrat interne.
    if (!this.index.aggregates.has(aggregateId)) return
    this.collapsed.add(aggregateId)
  }

  /**
   * Une racine est toujours visible ; une entité qui n'appartient à aucun
   * agrégat aussi. Un membre non-racine est visible dès qu'**au moins un** de
   * ses agrégats est déplié — c'est la règle correcte sous chevauchement : une
   * entité partagée reste montrée par celui de ses agrégats qui est ouvert.
   */
  visibleEntityIds(): Set<NodeId> {
    const visible = new Set<NodeId>()

    // Une entité hors de tout agrégat n'est gouvernée par aucun pli : elle est
    // toujours visible. `AggregateIndex` ne la connaît pas, d'où la liste
    // complète passée au constructeur.
    for (const id of this.allEntityIds) {
      if (!this.index.byNode.has(id)) visible.add(id)
    }

    for (const aggregate of this.index.aggregates.values()) {
      visible.add(aggregate.rootId)
      if (this.collapsed.has(aggregate.id)) continue
      for (const memberId of aggregate.memberIds) visible.add(memberId)
    }

    return visible
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/aggregate-collapse.test.ts`
Expected: PASS — les 6 tests.

- [ ] **Step 5: Exporter depuis le barrel**

```ts
export { AggregateCollapseState } from "./aggregate-collapse.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/aggregate-collapse.ts packages/core/src/index.ts \
        packages/core/test/aggregate-collapse.test.ts
git commit -m "feat(core): etat plie/deplie des agregats pour la vue graphe"
```

---

### Task 6: Point d'entrée séparé + moteur de layout minimal

Cette tâche installe les dépendances, crée le second point d'entrée, et livre un moteur qui place **les entités et les références seulement** — sans agrégats ni enveloppes, qui viennent en Task 7. Le packaging voyage avec le module qui en a besoin.

**Files:**
- Modify: `packages/core/package.json` (deps, `exports`, script `build`)
- Create: `packages/core/src/cytoscape-fcose.d.ts`, `packages/core/src/layout-graph.ts`, `packages/core/src/graph-layout.ts`
- Test: `packages/core/test/layout-graph.test.ts`, `packages/core/test/bundle-purity.test.ts`

**Interfaces:**
- Consumes: `separateOverlaps` (Task 4), `Graph`, `NodeId`, `Rect`, `NodeMetrics`, `measureNode`.
- Produces:
  ```ts
  interface GraphLayoutOptions {
    clusterPull?: number
    hullPadding?: number
    separationMargin?: number
    separationIterations?: number
  }
  interface GraphLayoutResult extends LayoutResult {
    clusters: { aggregateId: string; rootId: NodeId; polygon: Point[] }[]
  }
  interface GraphLayoutEngine {
    layout(graph: Graph, aggregates: AggregateIndex, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<GraphLayoutResult>
    layoutAfterExpand(prev: GraphLayoutResult, graph: Graph, aggregates: AggregateIndex, expandedAggId: string, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<GraphLayoutResult>
    layoutAfterCollapse(prev: GraphLayoutResult, graph: Graph, aggregates: AggregateIndex, collapsedAggId: string, visible: Set<NodeId>): GraphLayoutResult
  }
  function createGraphLayoutEngine(opts?: GraphLayoutOptions): GraphLayoutEngine
  ```
  En Task 6, `clusters` est toujours `[]` et `layoutAfterExpand`/`layoutAfterCollapse` ne sont pas encore implémentés (Task 8).

- [ ] **Step 1: Installer les dépendances**

```bash
pnpm --filter @defsquare/data-graph-core add cytoscape cytoscape-fcose
pnpm --filter @defsquare/data-graph-core add -D @types/cytoscape
```

`cytoscape-fcose` ne publie pas de types. Créer `packages/core/src/cytoscape-fcose.d.ts` :

```ts
declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape"
  const ext: cytoscape.Ext
  export default ext
}
```

- [ ] **Step 2: Écrire le test de pureté du bundle**

C'est le garde-fou du budget : sans lui, un export négligent depuis le barrel ferait entrer +183 ko gzip dans le bundle de tout consommateur de la vue structure.

Créer `packages/core/test/bundle-purity.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Le barrel principal ne doit tirer ni cytoscape ni fcose : ils sont réservés
 * au point d'entrée `./graph-layout`, chargé dynamiquement par le renderer.
 * Sans ce test, un simple `export … from "./layout-graph.js"` dans index.ts
 * imposerait ~183 ko gzip à qui n'utilise que la vue structure. */
describe("bundle purity", () => {
  const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url))

  it("keeps cytoscape out of the main entry point", () => {
    if (!existsSync(dist)) {
      throw new Error("dist/index.js absent — lancer `pnpm --filter @defsquare/data-graph-core build` avant ce test")
    }
    const source = readFileSync(dist, "utf8")
    expect(source).not.toMatch(/cytoscape/)
  })
})
```

- [ ] **Step 3: Écrire les tests du moteur**

Créer `packages/core/test/layout-graph.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig } from "../src/config.js"
import { createGraphLayoutEngine } from "../src/layout-graph.js"
import { shopData, shopConfig } from "./fixtures.js"

const config = { ...shopConfig, aggregates: ["Customer"] }

function setup() {
  const graph = buildGraph(shopData, config)
  const aggregates = buildAggregates(graph, validateConfig(config))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

describe("createGraphLayoutEngine", () => {
  it("positions entities only — no root, no array, no object node", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    for (const id of result.positions.keys()) {
      expect(graph.nodes.get(id)?.kind).toBe("entity")
    }
    expect(result.positions.has("/")).toBe(false)
    expect(result.positions.has("/customers")).toBe(false)
  })

  it("never leaks a virtual cluster centre into the result", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    for (const id of result.positions.keys()) expect(id.startsWith("__agg:")).toBe(false)
  })

  it("places every visible entity", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.positions.size).toBe(visible.size)
  })

  it("is deterministic to the pixel across two runs", async () => {
    const { graph, aggregates, visible } = setup()
    const a = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const b = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
  })

  it("leaves no overlapping cards", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    const rects = [...result.positions.values()]
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(ox > 1e-6 && oy > 1e-6).toBe(false)
      }
    }
  })
})
```

- [ ] **Step 4: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 5: Implémenter le moteur**

Créer `packages/core/src/layout-graph.ts` :

```ts
import cytoscape from "cytoscape"
import fcose from "cytoscape-fcose"
import type { AggregateIndex } from "./aggregate.js"
import type { Graph, NodeId } from "./model.js"
import type { LayoutResult, Rect } from "./layout.js"
import type { Point } from "./hull.js"
import { measureNode, DEFAULT_METRICS, type NodeMetrics } from "./measure.js"
import { separateOverlaps } from "./separate.js"

cytoscape.use(fcose as cytoscape.Ext)

export interface GraphLayoutOptions {
  /** Poids d'attraction d'un membre vers le centre virtuel de son agrégat. */
  clusterPull?: number
  /** Marge entre une carte et le bord de l'enveloppe de son agrégat. */
  hullPadding?: number
  /** Marge garantie entre deux cartes par la passe de séparation. */
  separationMargin?: number
  separationIterations?: number
}

export interface ClusterShape {
  aggregateId: string
  rootId: NodeId
  polygon: Point[]
}

export interface GraphLayoutResult extends LayoutResult {
  clusters: ClusterShape[]
}

export interface GraphLayoutEngine {
  layout(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics?: NodeMetrics,
  ): Promise<GraphLayoutResult>
}

const DEFAULTS: Required<GraphLayoutOptions> = {
  clusterPull: 3,
  hullPadding: 18,
  separationMargin: 16,
  separationIterations: 600,
}

/** Hachage FNV-1a de l'id, base de l'amorçage déterministe des positions. */
function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Position initiale déterministe, tirée du seul id du nœud et projetée sur un
 * disque de rayon `radius`. C'est la pièce qui rend la vue reproductible : la
 * sonde mesurait 1589 px d'écart médian entre deux runs identiques, parce que
 * fcose place ses nœuds par une méthode spectrale ALÉATOIRE. En fournissant
 * nous-mêmes les positions et en passant `randomize: false`, ce tirage est
 * court-circuité et la sortie devient stable d'une session à l'autre.
 */
function seedPosition(id: string, radius: number): Point {
  const h = hashOf(id)
  const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI
  const r = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * radius
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
}

export function createGraphLayoutEngine(opts: GraphLayoutOptions = {}): GraphLayoutEngine {
  const options: Required<GraphLayoutOptions> = { ...DEFAULTS, ...opts }

  return {
    async layout(graph, _aggregates, visible, metrics = DEFAULT_METRICS) {
      const sizes = new Map<NodeId, { width: number; height: number }>()
      const elements: cytoscape.ElementDefinition[] = []

      // Sommets : les entités visibles, et rien d'autre. Les nœuds structurels
      // (racine, tableaux, objets) n'existent pas dans cette vue.
      const entityIds: NodeId[] = []
      for (const id of visible) {
        const node = graph.nodes.get(id)
        if (!node || node.kind !== "entity") continue
        entityIds.push(id)
      }
      entityIds.sort() // ordre stable, condition du déterminisme

      const radius = Math.sqrt(Math.max(1, entityIds.length)) * 220
      for (const id of entityIds) {
        const node = graph.nodes.get(id)!
        const size = measureNode(node, metrics)
        sizes.set(id, size)
        elements.push({
          group: "nodes",
          data: { id, w: size.width, h: size.height },
          position: seedPosition(id, radius),
        })
      }

      // Arêtes : les références non cassées dont les deux bouts sont visibles.
      const entitySet = new Set(entityIds)
      for (const edge of graph.refEdges) {
        if (edge.to === null || edge.dangling) continue
        if (!entitySet.has(edge.from) || !entitySet.has(edge.to)) continue
        elements.push({
          group: "edges",
          data: { id: `r:${edge.from}->${edge.to}:${edge.field}`, source: edge.from, target: edge.to },
        })
      }

      // `styleEnabled: true` est indispensable en headless : sans lui cytoscape
      // ne calcule aucune dimension et fcose traite les cartes comme des points
      // de taille nulle — elles se recouvrent alors massivement.
      const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        elements,
        style: [{ selector: "node", style: { width: "data(w)", height: "data(h)" } }],
      })

      const layout = cy.layout({
        name: "fcose",
        randomize: false,
        animate: false,
        fit: false,
        nodeDimensionsIncludeLabels: false,
        // Les défauts de fcose sont calibrés pour des nœuds ponctuels : une
        // longueur d'arête idéale de 50 px est absurde entre deux cartes de
        // 140–340 px de large. On la dérive de la taille des deux boîtes.
        idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
          const s = sizes.get(edge.source().id()) ?? { width: 160, height: 40 }
          const t = sizes.get(edge.target().id()) ?? { width: 160, height: 40 }
          return (s.width + t.width) / 2 + options.separationMargin * 2
        },
      } as cytoscape.LayoutOptions)

      const done = layout.promiseOn("layoutstop")
      layout.run()
      await done

      const positions = new Map<NodeId, Rect>()
      for (const id of entityIds) {
        const size = sizes.get(id)!
        const pos = cy.getElementById(id).position()
        // cytoscape positionne par le centre ; `Rect` est un coin haut-gauche.
        positions.set(id, {
          x: pos.x - size.width / 2,
          y: pos.y - size.height / 2,
          width: size.width,
          height: size.height,
        })
      }
      cy.destroy()

      separateOverlaps(positions, options.separationMargin, options.separationIterations)

      // Normalisation : le coin haut-gauche de la bbox à l'origine.
      let minX = Infinity
      let minY = Infinity
      for (const rect of positions.values()) {
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
      }
      if (Number.isFinite(minX)) {
        for (const rect of positions.values()) {
          rect.x -= minX
          rect.y -= minY
        }
      }

      return { positions, clusters: [] }
    },
  }
}
```

- [ ] **Step 6: Lancer les tests du moteur**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: PASS — les 5 tests.

**Si « is deterministic to the pixel » échoue**, c'est que fcose garde une source d'aléa malgré `randomize: false`. Échelle de repli, dans l'ordre, en relançant le test après chaque marche :
1. ajouter `packComponents: false` aux options du layout (le placement des composantes disjointes est la source la plus probable) ;
2. ajouter `quality: "proof"` (supprime l'échantillonnage aléatoire de l'étape spectrale) ;
3. en dernier recours, se passer de fcose pour ce test en fixant `numIter: 0` — les positions amorcées passent alors directement à `separateOverlaps`, qui est déterministe par construction ; documenter alors la limite dans le fichier.

Ne PAS supprimer ni assouplir ce test : c'est une exigence du spec, pas un budget.

- [ ] **Step 7: Créer le second point d'entrée**

Créer `packages/core/src/graph-layout.ts` :

```ts
// Point d'entrée secondaire : tout ce qui dépend de cytoscape vit ici et
// SEULEMENT ici. Le barrel principal (`index.ts`) ne doit jamais réexporter ce
// module, sous peine d'imposer ~183 ko gzip à tout consommateur de la vue
// structure. `test/bundle-purity.test.ts` garde cette invariante.
export {
  createGraphLayoutEngine,
  type ClusterShape,
  type GraphLayoutEngine,
  type GraphLayoutOptions,
  type GraphLayoutResult,
} from "./layout-graph.js"
```

Dans `packages/core/package.json`, remplacer le champ `exports` et le script `build` :

```jsonc
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./graph-layout": {
    "types": "./dist/graph-layout.d.ts",
    "import": "./dist/graph-layout.js"
  }
},
"scripts": {
  "build": "tsup src/index.ts src/graph-layout.ts --format esm --dts",
  // … les autres scripts inchangés
}
```

- [ ] **Step 8: Construire et vérifier la pureté du bundle**

```bash
pnpm --filter @defsquare/data-graph-core build
pnpm --filter @defsquare/data-graph-core exec vitest run test/bundle-purity.test.ts
```
Expected: PASS. Si `cytoscape` apparaît dans `dist/index.js`, c'est qu'un fichier atteint depuis `index.ts` importe `layout-graph.js` — le retrouver et couper le lien.

- [ ] **Step 9: Vérifier l'ensemble**

Run: `pnpm --filter @defsquare/data-graph-core test && pnpm --filter @defsquare/data-graph-core typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/layout-graph.ts packages/core/src/graph-layout.ts \
        packages/core/src/cytoscape-fcose.d.ts packages/core/package.json \
        packages/core/test/layout-graph.test.ts packages/core/test/bundle-purity.test.ts \
        pnpm-lock.yaml
git commit -m "feat(core): moteur de layout organique sur un point d'entree isole"
```

---

### Task 7: Regroupement par agrégat et enveloppes

**Files:**
- Modify: `packages/core/src/layout-graph.ts`
- Test: `packages/core/test/layout-graph.test.ts` (ajouts)

**Interfaces:**
- Consumes: `AggregateIndex` (Task 2), `paddedHull` (Task 3), le moteur de la Task 6.
- Produces: `GraphLayoutResult.clusters` réellement peuplé.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `packages/core/test/layout-graph.test.ts` :

```ts
describe("cluster shapes", () => {
  it("emits one hull per aggregate that has a visible member", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters.map((c) => c.aggregateId).sort()).toEqual(["Customer#c1", "Customer#c2"])
  })

  it("wraps every member rect inside its aggregate hull", async () => {
    const { graph, aggregates, visible } = setup()
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)

    const inside = (poly: { x: number; y: number }[], p: { x: number; y: number }) => {
      let sign = 0
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!
        const b = poly[(i + 1) % poly.length]!
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (Math.abs(cross) < 1e-6) continue
        const s = cross > 0 ? 1 : -1
        if (sign === 0) sign = s
        else if (s !== sign) return false
      }
      return true
    }

    for (const cluster of result.clusters) {
      const members = aggregates.aggregates.get(cluster.aggregateId)!.memberIds
      for (const id of members) {
        const r = result.positions.get(id)
        if (!r) continue
        for (const c of [
          { x: r.x, y: r.y },
          { x: r.x + r.width, y: r.y },
          { x: r.x, y: r.y + r.height },
          { x: r.x + r.width, y: r.y + r.height },
        ]) {
          expect(inside(cluster.polygon, c)).toBe(true)
        }
      }
    }
  })

  it("emits no hull for an aggregate with no visible member", async () => {
    const { graph, aggregates } = setup()
    // Seule /customers/0 est visible : l'agrégat Customer#c2 n'a aucun membre.
    const visible = new Set(["/customers/0"])
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters.map((c) => c.aggregateId)).toEqual(["Customer#c1"])
  })

  it("gives a shared entity a place inside both hulls", async () => {
    const graph = buildGraph(twoRootsData, twoRootsConfig)
    const aggregates = buildAggregates(graph, validateConfig(twoRootsConfig))
    const visible = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
    )
    const result = await createGraphLayoutEngine().layout(graph, aggregates, visible)
    expect(result.clusters).toHaveLength(2)
    for (const cluster of result.clusters) {
      expect(aggregates.aggregates.get(cluster.aggregateId)!.memberIds.has("/orders/0")).toBe(true)
    }
  })
})
```

Ajouter `twoRootsData, twoRootsConfig` à l'import de `./fixtures.js` en tête du fichier, et `buildAggregates`/`validateConfig` s'ils n'y sont pas déjà.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: FAIL — `result.clusters` est `[]`.

- [ ] **Step 3: Implémenter les centres virtuels**

Dans `layout-graph.ts`, renommer le paramètre `_aggregates` en `aggregates`, importer `paddedHull`, et ajouter — **après** la boucle des arêtes de référence, **avant** la création de `cytoscape(...)` :

```ts
      // Regroupement : un nœud invisible de taille nulle par agrégat, relié à
      // chacun de ses membres visibles. Les membres d'un même agrégat se
      // regroupent mécaniquement ; une entité qui appartient à DEUX agrégats
      // est tirée par deux centres et se pose entre eux — c'est exactement le
      // comportement voulu sous chevauchement, et c'est pourquoi ce montage
      // supporte l'appartenance multiple là où des boîtes compound ne le
      // pourraient pas (cytoscape n'accepte qu'un parent par nœud).
      const centreIds: string[] = []
      for (const aggregate of aggregates.aggregates.values()) {
        const members = [...aggregate.memberIds].filter((id) => entitySet.has(id)).sort()
        if (members.length === 0) continue
        const centreId = `__agg:${aggregate.id}`
        centreIds.push(centreId)
        elements.push({
          group: "nodes",
          data: { id: centreId, w: 1, h: 1 },
          position: seedPosition(centreId, radius),
        })
        for (const memberId of members) {
          elements.push({
            group: "edges",
            data: { id: `a:${centreId}->${memberId}`, source: centreId, target: memberId },
          })
        }
      }
```

L'attraction est réglée par `idealEdgeLength` : une arête vers un centre doit être **plus courte** qu'une arête de référence. Remplacer le corps de `idealEdgeLength` par :

```ts
        idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
          const s = sizes.get(edge.source().id()) ?? { width: 160, height: 40 }
          const t = sizes.get(edge.target().id()) ?? { width: 160, height: 40 }
          const base = (s.width + t.width) / 2 + options.separationMargin * 2
          // Une arête d'agrégat (source `__agg:`) tire plus fort, donc plus court.
          return edge.source().id().startsWith("__agg:") ? base / options.clusterPull : base
        },
```

Les centres n'apparaissent jamais dans le résultat : la boucle de relecture des positions itère sur `entityIds`, qui ne les contient pas. Rien à retirer.

- [ ] **Step 4: Implémenter les enveloppes**

Remplacer `return { positions, clusters: [] }` par :

```ts
      // Enveloppes, calculées APRÈS la normalisation pour être dans le même
      // repère que les positions. Ordre stable : celui de `aggregates`, qui
      // suit lui-même l'ordre de déclaration de la config.
      const clusters: ClusterShape[] = []
      for (const aggregate of aggregates.aggregates.values()) {
        const rects: Rect[] = []
        for (const memberId of aggregate.memberIds) {
          const rect = positions.get(memberId)
          if (rect) rects.push(rect)
        }
        if (rects.length === 0) continue
        clusters.push({
          aggregateId: aggregate.id,
          rootId: aggregate.rootId,
          polygon: paddedHull(rects, options.hullPadding),
        })
      }

      return { positions, clusters }
```

et ajouter en tête du fichier :

```ts
import { paddedHull } from "./hull.js"
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: PASS — les 9 tests, dont le déterminisme qui doit tenir malgré les centres (leurs positions sont amorcées par le même hachage).

- [ ] **Step 6: Vérifier l'ensemble et committer**

```bash
pnpm --filter @defsquare/data-graph-core test
git add packages/core/src/layout-graph.ts packages/core/test/layout-graph.test.ts
git commit -m "feat(core): regrouper par agregat via des centres virtuels et tracer les enveloppes"
```

---

### Task 8: Dépliage sans dérive — épinglage

C'est le point qui avait fait échouer la sonde : elle mesurait **1084 px de dérive médiane** sur les nœuds déjà présents à chaque dépliage. Ici on l'annule par construction.

**Files:**
- Modify: `packages/core/src/layout-graph.ts`
- Test: `packages/core/test/layout-graph.test.ts` (ajouts)

**Interfaces:**
- Produces: `layoutAfterExpand` et `layoutAfterCollapse` sur `GraphLayoutEngine`, signatures données en Task 6.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `packages/core/test/layout-graph.test.ts` :

```ts
describe("incremental relayout", () => {
  it("leaves already-placed entities where they were on expand", async () => {
    const { graph, aggregates } = setup()
    const engine = createGraphLayoutEngine()
    const collapsed = new Set(["/customers/0", "/customers/1"])
    const before = await engine.layout(graph, aggregates, collapsed)

    const expanded = new Set([...collapsed, "/orders/0"])
    const after = await engine.layoutAfterExpand(before, graph, aggregates, "Customer#c1", expanded)

    for (const [id, rect] of before.positions) {
      const moved = after.positions.get(id)!
      // La passe de séparation peut encore écarter un nœud épinglé qui se fait
      // mordre : la tolérance vaut la marge de séparation, pas zéro.
      expect(Math.hypot(moved.x - rect.x, moved.y - rect.y)).toBeLessThanOrEqual(40)
    }
    expect(after.positions.has("/orders/0")).toBe(true)
  })

  it("drops hidden entities on collapse without re-running any force", () => {
    const engine = createGraphLayoutEngine()
    const prev = {
      positions: new Map([
        ["/customers/0", { x: 0, y: 0, width: 100, height: 40 }],
        ["/orders/0", { x: 300, y: 0, width: 100, height: 40 }],
      ]),
      clusters: [],
    }
    const { graph, aggregates } = setup()
    const after = engine.layoutAfterCollapse(prev, graph, aggregates, "Customer#c1", new Set(["/customers/0"]))
    expect([...after.positions.keys()]).toEqual(["/customers/0"])
    // Le nœud restant n'a pas bougé : aucune force n'a tourné.
    expect(after.positions.get("/customers/0")).toEqual({ x: 0, y: 0, width: 100, height: 40 })
  })

  it("recomputes hulls after a collapse", () => {
    const engine = createGraphLayoutEngine()
    const prev = {
      positions: new Map([
        ["/customers/0", { x: 0, y: 0, width: 100, height: 40 }],
        ["/orders/0", { x: 300, y: 0, width: 100, height: 40 }],
      ]),
      clusters: [],
    }
    const { graph, aggregates } = setup()
    const after = engine.layoutAfterCollapse(prev, graph, aggregates, "Customer#c1", new Set(["/customers/0"]))
    const hull = after.clusters.find((c) => c.aggregateId === "Customer#c1")!
    // L'enveloppe ne doit plus englober la carte disparue.
    expect(Math.max(...hull.polygon.map((p) => p.x))).toBeLessThan(300)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: FAIL — `layoutAfterExpand is not a function`.

- [ ] **Step 3: Refactoriser le corps commun**

Extraire de `layout` tout le corps dans une fonction interne du closure :

```ts
  async function run(
    graph: Graph,
    aggregates: AggregateIndex,
    visible: Set<NodeId>,
    metrics: NodeMetrics,
    pinned?: Map<NodeId, Point>,
  ): Promise<GraphLayoutResult>
```

Deux changements dans le corps :

1. **Amorçage** — la position initiale d'un nœud épinglé est sa position connue (centre), pas le hachage :

```ts
        const pin = pinned?.get(id)
        elements.push({
          group: "nodes",
          data: { id, w: size.width, h: size.height },
          position: pin ? { x: pin.x, y: pin.y } : seedPosition(id, radius),
        })
```

2. **Épinglage** — ajouter aux options du layout fcose :

```ts
        // Épingle les entités déjà placées : seuls les nœuds nouvellement
        // révélés sont relaxés. C'est ce qui annule la dérive globale d'une
        // force-layout — la carte que l'utilisateur regardait ne bouge plus.
        fixedNodeConstraint: pinned
          ? [...pinned].map(([nodeId, position]) => ({ nodeId, position }))
          : undefined,
```

3. **Normalisation** — la translation finale déplacerait les nœuds épinglés. Ne normaliser que lorsqu'il n'y a pas d'épinglage :

```ts
      if (!pinned) {
        // … le bloc de normalisation existant
      }
```

`layout` devient alors :

```ts
    async layout(graph, aggregates, visible, metrics = DEFAULT_METRICS) {
      return run(graph, aggregates, visible, metrics)
    },
```

- [ ] **Step 4: Implémenter `layoutAfterExpand` et `layoutAfterCollapse`**

```ts
    async layoutAfterExpand(prev, graph, aggregates, _expandedAggId, visible, metrics = DEFAULT_METRICS) {
      // Toutes les entités déjà positionnées ET toujours visibles sont
      // épinglées à leur centre actuel ; les nouvelles seules sont relaxées.
      const pinned = new Map<NodeId, Point>()
      for (const [id, rect] of prev.positions) {
        if (!visible.has(id)) continue
        pinned.set(id, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      }
      return run(graph, aggregates, visible, metrics, pinned)
    },

    layoutAfterCollapse(prev, _graph, aggregates, _collapsedAggId, visible) {
      // Synchrone par contrat : on retire les nœuds devenus invisibles et on
      // recalcule les enveloppes sur ce qui reste. Aucune force ne tourne, donc
      // le trou laissé ne se referme pas jusqu'au prochain dépliage — c'est un
      // compromis assumé, cohérent avec l'épinglage.
      const positions = new Map<NodeId, Rect>()
      for (const [id, rect] of prev.positions) {
        if (visible.has(id)) positions.set(id, { ...rect })
      }

      const clusters: ClusterShape[] = []
      for (const aggregate of aggregates.aggregates.values()) {
        const rects: Rect[] = []
        for (const memberId of aggregate.memberIds) {
          const rect = positions.get(memberId)
          if (rect) rects.push(rect)
        }
        if (rects.length === 0) continue
        clusters.push({
          aggregateId: aggregate.id,
          rootId: aggregate.rootId,
          polygon: paddedHull(rects, options.hullPadding),
        })
      }

      return { positions, clusters }
    },
```

Le calcul des enveloppes apparaît maintenant à deux endroits : l'extraire dans une fonction interne `hullsFor(positions, aggregates)` et l'appeler des deux côtés.

Étendre l'interface `GraphLayoutEngine` avec les deux signatures données en Task 6, et réexporter depuis `graph-layout.ts` si de nouveaux types apparaissent.

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/layout-graph.test.ts`
Expected: PASS — les 12 tests.

Si `fixedNodeConstraint` ne suffit pas à tenir la tolérance de 40 px, vérifier d'abord que la normalisation est bien désactivée sous épinglage (c'est la cause la plus probable : une translation globale déplace tout le monde uniformément).

- [ ] **Step 6: Commit**

```bash
pnpm --filter @defsquare/data-graph-core test && pnpm --filter @defsquare/data-graph-core build
git add packages/core/src/layout-graph.ts packages/core/test/layout-graph.test.ts
git commit -m "feat(core): epingler les entites placees au depliage pour supprimer la derive"
```

---

### Task 9: `drawHulls` — peindre les enveloppes

**Files:**
- Modify: `packages/renderer/src/draw.ts` (ajout en fin de fichier)
- Test: `packages/renderer/test/hulls.test.ts`

**⚠️ Le renderer s'écrit AVEC des points-virgules.**

**Interfaces:**
- Consumes: `ClusterShape.polygon` (Task 7), `Theme`.
- Produces: `function drawHulls(hulls: { polygon: Point[]; color: string }[], theme: Theme): Graphics`.

L'entrée est volontairement de la donnée nue (`polygon` + `color`) et non un `ClusterShape` : la résolution de la couleur depuis le type d'entité appartient à `create.ts`, ce qui rend cette fonction testable sans graphe ni index d'agrégats.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/renderer/test/hulls.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { drawHulls } from "../src/draw.js";
import { resolveTheme } from "../src/theme.js";

describe("drawHulls", () => {
  const theme = resolveTheme(undefined);

  it("returns an empty Graphics for no hulls", () => {
    const g = drawHulls([], theme);
    expect(g).toBeDefined();
    expect(g.destroyed).toBe(false);
  });

  it("draws without throwing for a triangle and a quad", () => {
    const g = drawHulls(
      [
        { polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], color: "#ff0000" },
        { polygon: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 60 }, { x: 200, y: 60 }], color: "#00ff00" },
      ],
      theme,
    );
    expect(g).toBeDefined();
  });

  it("skips a degenerate polygon of fewer than three points", () => {
    expect(() => drawHulls([{ polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#fff" }], theme)).not.toThrow();
  });
});
```

Vérifier la signature réelle de `resolveTheme` dans `packages/renderer/src/theme.ts` et l'adapter si elle diffère ; s'inspirer de `packages/renderer/test/theme.test.ts` pour la construction d'un thème de test.

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `pnpm --filter @defsquare/data-graph exec vitest run test/hulls.test.ts`
Expected: FAIL — `drawHulls` n'est pas exportée.

- [ ] **Step 3: Implémenter**

Ajouter en fin de `packages/renderer/src/draw.ts` :

```ts
/**
 * Peint les enveloppes d'agrégats : remplissage translucide plus contour, dans
 * la couleur d'accent du type de la racine. Le calque qui les reçoit est le
 * plus bas du monde, donc elles passent derrière les arêtes et les cartes.
 *
 * Un polygone de moins de trois points n'est pas une surface et est ignoré.
 */
export function drawHulls(
  hulls: { polygon: { x: number; y: number }[]; color: string }[],
  theme: Theme,
): Graphics {
  const g = new Graphics();
  for (const hull of hulls) {
    if (hull.polygon.length < 3) continue;
    const [first, ...rest] = hull.polygon;
    g.moveTo(first!.x, first!.y);
    for (const point of rest) g.lineTo(point.x, point.y);
    g.closePath();
    g.fill({ color: hull.color, alpha: 0.08 });
    g.stroke({ color: hull.color, alpha: 0.35, width: 1.5 });
  }
  return g;
}
```

Vérifier l'API Graphics utilisée par `drawEdges`/`drawNode` dans le même fichier et s'y conformer : le projet est sur Pixi v8, où `fill`/`stroke` prennent un objet d'options — mais si le code voisin utilise une autre forme, suivre le voisin. Le paramètre `theme` reste dans la signature même s'il n'est pas lu aujourd'hui : les autres fonctions de dessin le prennent, et l'alpha du remplissage devra en dépendre quand le thème sombre sera ajusté.

- [ ] **Step 4: Lancer le test**

Run: `pnpm --filter @defsquare/data-graph exec vitest run test/hulls.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm --filter @defsquare/data-graph test
git add packages/renderer/src/draw.ts packages/renderer/test/hulls.test.ts
git commit -m "feat(renderer): dessiner les enveloppes d'agregats"
```

---

### Task 10: Bascule de vue dans le renderer

**Files:**
- Modify: `packages/renderer/src/create.ts` — options (`:40-53`), calque (`:156-166`), `rebuild` (`:310-352`), `fitInternal` (`:358-361`), API publique (`:62-91`)
- Modify: `packages/renderer/src/index.ts` (export du type de vue)
- Test: `packages/renderer/test/view.test.ts`

**⚠️ Points-virgules. ⚠️ Ne rien changer au chemin de la vue structure.**

**Interfaces:**
- Consumes: `buildAggregates`, `AggregateCollapseState` (barrel du cœur) ; `createGraphLayoutEngine` (import **dynamique** de `@defsquare/data-graph-core/graph-layout`) ; `drawHulls` (Task 9).
- Produces: `DataGraphOptions.view?: DataGraphView` ; `DataGraph.setView(view): Promise<void>` ; `DataGraph.currentView(): DataGraphView`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/renderer/test/view.test.ts`. S'inspirer d'un test existant du renderer pour savoir comment une instance est montée sans DOM réel ; si aucun ne monte `createDataGraph`, se limiter aux fonctions pures et déplacer la couverture de bascule vers l'e2e de la Task 11 — le noter alors explicitement dans le commit.

```ts
import { describe, it, expect } from "vitest";
import { nearestEntityAncestor } from "../src/create.js";
import { buildGraph } from "@defsquare/data-graph-core";
import { shopData, shopConfig } from "./fixtures.js";

describe("nearestEntityAncestor", () => {
  const graph = buildGraph(shopData, shopConfig);

  it("returns the node itself when it is an entity", () => {
    expect(nearestEntityAncestor(graph, "/customers/0")).toBe("/customers/0");
  });

  it("walks up to the closest entity ancestor", () => {
    // /customers/0/address est un objet imbriqué sous une entité.
    expect(nearestEntityAncestor(graph, "/customers/0/address")).toBe("/customers/0");
  });

  it("returns null when no ancestor is an entity", () => {
    expect(nearestEntityAncestor(graph, "/customers")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nearestEntityAncestor(graph, "/nope")).toBeNull();
  });
});
```

Créer `packages/renderer/test/fixtures.ts` avec les mêmes `shopData`/`shopConfig` que `packages/core/test/fixtures.ts` (le renderer est un consommateur du paquet publié et ne doit pas importer les fichiers de test du cœur — c'est la convention déjà appliquée par la démo).

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @defsquare/data-graph exec vitest run test/view.test.ts`
Expected: FAIL — `nearestEntityAncestor` n'est pas exportée.

- [ ] **Step 3: Implémenter `nearestEntityAncestor`**

Ajouter à `packages/renderer/src/create.ts`, près de `boundsOf` :

```ts
/**
 * Remonte `parentId` jusqu'à trouver une entité. Sert au report de sélection
 * entre les deux vues : la vue graphe ne connaît que des entités, donc quitter
 * la vue structure depuis un objet imbriqué doit sélectionner l'entité qui le
 * contient plutôt que de vider la sélection.
 */
export function nearestEntityAncestor(graph: Graph, id: NodeId): NodeId | null {
  let current = graph.nodes.get(id);
  while (current) {
    if (current.kind === "entity") return current.id;
    current = current.parentId ? graph.nodes.get(current.parentId) ?? undefined : undefined;
  }
  return null;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @defsquare/data-graph exec vitest run test/view.test.ts`
Expected: PASS

- [ ] **Step 5: Ajouter le calque d'enveloppes**

Dans `create.ts`, déclarer le calque **avant** `edgesGraphics` et l'ajouter en premier :

```ts
  let hullsGraphics = new Graphics();
  let edgesGraphics = new Graphics();
  // … déclarations existantes
  world.addChild(hullsGraphics, edgesGraphics, edgeHitLayer, nodesLayer, overlayGraphics);
```

**Piège à ne pas rater :** `rebuild()` réinsère les arêtes par `world.addChildAt(edgesGraphics, 0)` (`create.ts:327`). Avec un calque d'enveloppes en dessous, l'index correct devient **1**. Modifier cette ligne en `world.addChildAt(edgesGraphics, 1)` et ajouter, juste avant :

```ts
    hullsGraphics.destroy();
    hullsGraphics = drawHulls(hullsFor(), theme);
    world.addChildAt(hullsGraphics, 0);
```

avec, dans le closure :

```ts
  /** Les enveloppes à peindre : vide en vue structure. La couleur vient de
   * l'accent du type de la racine, comme pour les cartes. */
  function hullsFor(): { polygon: { x: number; y: number }[]; color: string }[] {
    if (view !== "graph" || !graph || !graphLayout) return [];
    return graphLayout.clusters.map((cluster) => {
      const root = graph!.nodes.get(cluster.rootId);
      return { polygon: cluster.polygon, color: root ? accentFor(root) : theme.strokes.border };
    });
  }
```

Vérifier le nom exact du jeton de thème utilisé en repli (`theme.strokes.border` ici) contre `packages/renderer/src/theme.ts` et corriger si besoin.

- [ ] **Step 6: Ajouter l'état de vue et l'import dynamique**

```ts
export type DataGraphView = "structure" | "graph";
```

dans `DataGraphOptions` :

```ts
  /** Vue initiale. `"structure"` (défaut) met en page l'arbre de containment ;
   * `"graph"` met en page les entités et leurs références, groupées par
   * agrégat. */
  view?: DataGraphView;
```

dans `DataGraph` :

```ts
  setView(view: DataGraphView): Promise<void>;
  currentView(): DataGraphView;
```

et dans le closure :

```ts
  let view: DataGraphView = options.view ?? "structure";
  let aggregateIndex: AggregateIndex | undefined;
  let aggregateCollapse: AggregateCollapseState | undefined;
  let graphLayout: GraphLayoutResult | undefined;
  let graphEngine: GraphLayoutEngine | undefined;

  /** Charge le moteur organique à la demande. `cytoscape` pèse ~183 ko gzip :
   * il ne doit entrer dans le bundle que de qui bascule réellement en vue
   * graphe, jamais dans celui d'un consommateur de la seule vue structure.
   * C'est pourquoi le cœur l'expose sur un point d'entrée séparé. */
  async function ensureGraphEngine(): Promise<GraphLayoutEngine> {
    if (!graphEngine) {
      const mod = await import("@defsquare/data-graph-core/graph-layout");
      graphEngine = mod.createGraphLayoutEngine();
    }
    return graphEngine;
  }
```

`AggregateIndex`, `AggregateCollapseState` et `buildAggregates` s'importent depuis le barrel `@defsquare/data-graph-core` (ils n'ont aucune dépendance externe) ; `GraphLayoutEngine` et `GraphLayoutResult` sont des **imports de type seulement** depuis `@defsquare/data-graph-core/graph-layout` — un `import type` ne produit aucun code à l'exécution et ne casse donc pas l'isolement du bundle.

- [ ] **Step 7: Implémenter `setView`**

```ts
    async setView(next: DataGraphView): Promise<void> {
      await ready;
      if (destroyed || next === view || !graph) return;
      view = next;

      if (view === "graph") {
        if (!aggregateIndex) {
          aggregateIndex = buildAggregates(graph, validateConfig(currentConfig));
          const entityIds = [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id);
          aggregateCollapse = new AggregateCollapseState(aggregateIndex, entityIds);
        }
        const engine = await ensureGraphEngine();
        graphLayout = await engine.layout(graph, aggregateIndex, aggregateCollapse!.visibleEntityIds(), metrics);
        // La vue graphe ne connaît que des entités : reporter la sélection.
        if (selectedId) selectedId = nearestEntityAncestor(graph, selectedId);
      }

      rebuild();
      fitInternal();
      app.render();
    },

    currentView(): DataGraphView {
      return view;
    },
```

- [ ] **Step 8: Router `rebuild` et `fitInternal` sur la bonne source**

`rebuild()` lit aujourd'hui `layoutResult.positions` et `collapseState.visibleNodeIds()`. Introduire deux accesseurs et les utiliser partout dans `rebuild` **à la place** des accès directs :

```ts
  function activePositions(): Map<NodeId, Rect> | undefined {
    return view === "graph" ? graphLayout?.positions : layoutResult?.positions;
  }

  function activeVisible(): Set<NodeId> {
    if (view === "graph") return aggregateCollapse?.visibleEntityIds() ?? new Set();
    return collapseState?.visibleNodeIds() ?? new Set();
  }
```

et remplacer la garde d'entrée de `rebuild` par une garde sur `activePositions()`.

`fitInternal` doit englober les enveloppes, qui débordent des cartes :

```ts
  function fitInternal(): void {
    const positions = activePositions();
    if (!camera || !positions) return;
    const bounds = boundsOf(positions);
    if (view === "graph" && graphLayout) {
      for (const cluster of graphLayout.clusters) {
        for (const p of cluster.polygon) {
          const right = bounds.x + bounds.width;
          const bottom = bounds.y + bounds.height;
          bounds.x = Math.min(bounds.x, p.x);
          bounds.y = Math.min(bounds.y, p.y);
          bounds.width = Math.max(right, p.x) - bounds.x;
          bounds.height = Math.max(bottom, p.y) - bounds.y;
        }
      }
    }
    camera.fitTo(bounds, viewport());
  }
```

En vue graphe, `drawEdges` doit tracer les références comme arêtes principales et non le containment. Passer par un paramètre plutôt que dupliquer la fonction : si `drawEdges` ne le permet pas, ajouter un argument `mode: "contain" | "ref"` à sa signature et le router depuis `rebuild`. Vérifier son corps avant de choisir.

- [ ] **Step 9: Vérifier**

```bash
pnpm --filter @defsquare/data-graph-core build
pnpm --filter @defsquare/data-graph test
pnpm --filter @defsquare/data-graph typecheck
pnpm --filter @defsquare/data-graph build
```
Expected: PASS partout. **La vue structure doit être strictement inchangée** : les 53 tests du renderer qui passaient avant doivent passer après.

- [ ] **Step 10: Commit**

```bash
git add packages/renderer/src/create.ts packages/renderer/src/index.ts \
        packages/renderer/test/view.test.ts packages/renderer/test/fixtures.ts
git commit -m "feat(renderer): basculer entre vue structure et vue graphe"
```

---

### Task 11: Démo et e2e

**Files:**
- Modify: `apps/demo/src/sample-data.ts`, `apps/demo/src/main.ts`, `apps/demo/index.html`
- Test: `apps/demo/e2e/smoke.spec.ts` (ajout)

**⚠️ La démo s'écrit AVEC des points-virgules** (suivre le fichier).

**Interfaces:**
- Consumes: `DataGraph.setView` / `currentView` (Task 10).

- [ ] **Step 1: Déclarer les agrégats et grouper les données**

Dans `apps/demo/src/sample-data.ts`, ajouter à `shopConfig` :

```ts
  aggregates: ["Customer"],
```

et remplacer `bigShop` par une version qui donne 2 à 4 commandes par client — sans quoi chaque agrégat ne contient que deux cartes et le regroupement est invisible :

```ts
/** Génère ~`n` nœuds logiques, avec 2 à 4 commandes par client pour que le
 * regroupement par agrégat soit visible. Diverge volontairement de
 * `packages/core/test/fixtures.ts`, dont `build.test.ts` et `search.test.ts`
 * dépendent des comptes exacts : ne pas resynchroniser ces deux-là. */
export function bigShop(n: number) {
  const customers = [];
  const orders = [];
  let orderSeq = 0;
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({
      id: `c${i}`,
      name: `Client ${i}`,
      email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" },
    });
    const count = 2 + (i % 3);
    for (let k = 0; k < count; k++) {
      orders.push({
        id: `o${orderSeq++}`,
        customerId: `c${i}`,
        total: i * 10 + k,
        lines: [{ sku: `S${i}-${k}`, qty: 1 }],
      });
    }
  }
  return { customers, orders };
}
```

- [ ] **Step 2: Ajouter le bouton de bascule**

Dans `apps/demo/index.html`, à côté du bouton `#fit`, ajouter :

```html
<button id="toggle-view" type="button">Vue graphe</button>
```

Dans `apps/demo/src/main.ts`, après le bloc du bouton de thème :

```ts
// --- Bascule Structure / Graphe.
const toggleViewBtn = document.getElementById("toggle-view") as HTMLButtonElement | null;

toggleViewBtn?.addEventListener("click", () => {
  void (async () => {
    toggleViewBtn.disabled = true;
    try {
      const next = graph.currentView() === "graph" ? "structure" : "graph";
      await graph.setView(next);
      toggleViewBtn.textContent = next === "graph" ? "Vue structure" : "Vue graphe";
    } finally {
      toggleViewBtn.disabled = false;
    }
  })();
});
```

- [ ] **Step 3: Vérifier à la main**

```bash
pnpm --filter @defsquare/data-graph-core build
pnpm --filter @defsquare/data-graph build
pnpm --filter demo dev
```

Ouvrir la démo, passer au jeu de données étendu, basculer en vue graphe. Attendu : des grappes de cartes cerclées d'enveloppes colorées, remplissant l'écran après `fit()` — et non le trait vertical de la vue structure. Recharger la page deux fois : **l'image doit être identique** (c'est le déterminisme de la Task 6, visible à l'œil).

- [ ] **Step 4: Ajouter le test e2e**

Ajouter à `apps/demo/e2e/smoke.spec.ts`, en suivant le style du fichier (il attend `graph.ready`, pas seulement la présence de `window.__graph`) :

```ts
test("bascule en vue graphe et n'y place que des entités", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__graph.ready);

  await page.getByRole("button", { name: "Vue graphe" }).click();

  const view = await page.evaluate(() => (window as any).__graph.currentView());
  expect(view).toBe("graph");

  // Le bouton a basculé son libellé : la vue est bien active.
  await expect(page.getByRole("button", { name: "Vue structure" })).toBeVisible();
});
```

- [ ] **Step 5: Lancer l'e2e**

Run: `pnpm --filter demo e2e`
Expected: PASS

- [ ] **Step 6: Vérifier l'ensemble et committer**

```bash
pnpm -r typecheck && pnpm -r test
git add apps/demo/src/sample-data.ts apps/demo/src/main.ts apps/demo/index.html apps/demo/e2e/smoke.spec.ts
git commit -m "feat(demo): basculer en vue graphe et grouper les commandes par client"
```

---

### Task 12: Documentation

**Files:**
- Modify: `README.md`, `packages/core/README.md`, `packages/renderer/README.md`

- [ ] **Step 1: Documenter le champ `aggregates`**

Dans `packages/core/README.md`, à la suite de la documentation de `references`, décrire `aggregates` et **énoncer la règle d'appartenance** (distance minimale, chevauchement en cas d'égalité, racine jamais absorbée, hub borné). Reprendre les exemples du spec plutôt que d'en inventer.

- [ ] **Step 2: Documenter la vue graphe**

Dans `packages/renderer/README.md`, documenter `view`, `setView`, `currentView`, et **signaler explicitement l'import dynamique** : basculer en vue graphe charge `cytoscape` (~183 ko gzip), qui n'entre jamais dans le bundle d'un consommateur de la seule vue structure.

- [ ] **Step 3: Mettre à jour le README racine**

Ajouter la vue graphe à la liste des fonctionnalités et compléter la section « Performance budgets » avec les budgets du spec (ratio, remplissage, déterminisme au pixel).

- [ ] **Step 4: Commit**

```bash
git add README.md packages/core/README.md packages/renderer/README.md
git commit -m "docs: documenter les agregats et la vue graphe"
```

---

## Revue du plan

**Couverture du spec** — chaque section du spec est portée par une tâche : règle d'appartenance → 2 ; `config.aggregates` → 1 ; `aggregate.ts` → 2 ; `hull.ts` → 3 ; `separate.ts` → 4 ; `layout-graph.ts` → 6-8 ; packaging et point d'entrée séparé → 6 ; `aggregate-collapse.ts` → 5 ; épinglage au dépliage → 8 ; renderer et calque d'enveloppes → 9-10 ; sélection partagée → 10 ; démo et fixtures → 11 ; budgets (déterminisme, non-recouvrement, pureté du bundle) → tests des tâches 4, 6, 8 ; documentation → 12.

**Deux zones d'incertitude assumées**, chacune avec sa porte de sortie écrite dans la tâche :
- Le **déterminisme de fcose** (Task 6, Step 6) : l'échelle de repli est explicite, et le test est une exigence qu'on ne relâche pas.
- Le **montage d'un test de renderer** (Task 10, Step 1) : s'il n'existe pas de précédent montant `createDataGraph` sans DOM, la couverture de bascule bascule vers l'e2e de la Task 11.

**Point de vigilance transverse** : `world.addChildAt(edgesGraphics, 0)` devient `1` avec le calque d'enveloppes (Task 10, Step 5). C'est la régression la plus facile à introduire et la plus discrète — les arêtes passeraient sous les enveloppes.
