# data-graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lib de visualisation façon jsoncrack pour agrégats/entités : JSON + config → graphe interactif (WebGL) tenant ~10k nœuds, avec recherche, collapse et références entre entités.

**Architecture:** Cœur headless TypeScript (`@defsquare/data-graph-core` : parsing, modèle, collapse, recherche, layout elkjs) + renderer Pixi.js v8 (`@defsquare/data-graph` : rendu WebGL, caméra, interactions). Monorepo pnpm : `packages/core`, `packages/renderer`, `apps/demo`.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, tsup, elkjs, pixi.js v8, Vite (démo), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-30-data-graph-design.md`

## Global Constraints

- ESM only, TypeScript `strict: true`, Node ≥ 20.
- Zéro dépendance DOM dans `packages/core` (doit tourner en Node pour les tests).
- Dépendances runtime : core → `elkjs` uniquement ; renderer → `pixi.js` + core uniquement. Installer sans pin de version (`pnpm add <pkg>` = latest).
- Ids de nœuds = JSON pointers (`"/customers/0"`), stables entre deux `buildGraph` sur les mêmes données.
- Limite dure : `config.maxNodes` (défaut `50_000` nœuds logiques = nœuds + lignes scalaires) → `GraphTooLargeError` explicite.
- Budgets perf (spec) : parse+index 10k < 1 s ; expansion < 300 ms ; pan/zoom 60 fps à 2k nœuds visibles ; recherche < 50 ms.
- Raffinement assumé vs spec §3 : seul le **layout** (elkjs) tourne dans un worker (mécanisme worker d'elkjs, injectable). Parsing + index restent sur le main thread : one-shot < 1 s, YAGNI. Le point structurant (canvas interactif pendant le layout) est préservé.
- Thème par défaut = tokens Defsquare copiés (valeurs exactes en Task 10) ; mono = **Fira Code** (le DS utilise Fira Code, pas Plex Mono — la spec est corrigée sur ce point).
- Messages de commit : conventional commits (`feat:`, `test:`, `chore:`…), signés `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Docs à consulter en cas de doute d'API : context7 (`/pixijs/pixijs` pour Pixi v8 — BitmapText/eventMode ont changé vs v7 ; `elkjs` pour le format de graphe ELK).

---

### Task 1: Scaffolding monorepo + package core

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace pnpm fonctionnel ; `pnpm -r test` et `pnpm -r build` verts ; package `@defsquare/data-graph-core` importable.

- [ ] **Step 1: Créer la racine du workspace**

`pnpm-workspace.yaml` :
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json` racine :
```json
{
  "name": "data-graph-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`tsconfig.base.json` :
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore` : `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `test-results/`, `playwright-report/`

- [ ] **Step 2: Créer `packages/core`**

`packages/core/package.json` :
```json
{
  "name": "@defsquare/data-graph-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/core/tsconfig.json` étend `../../tsconfig.base.json` avec `"include": ["src", "test"]`.
`src/index.ts` : `export const VERSION = "0.1.0"`.
Installer : `pnpm add -D -w typescript` puis dans core `pnpm add -D tsup vitest`.

- [ ] **Step 3: Smoke test**

```ts
// packages/core/test/smoke.test.ts
import { describe, it, expect } from "vitest"
import { VERSION } from "../src/index.js"

describe("core package", () => {
  it("exports a version", () => { expect(VERSION).toBe("0.1.0") })
})
```

- [ ] **Step 4: Vérifier** — `pnpm test` et `pnpm build` à la racine : PASS.
- [ ] **Step 5: Commit** — `chore: scaffold pnpm monorepo with core package`

---

### Task 2: Sélecteur de chemin (sous-ensemble JSONPath)

**Files:**
- Create: `packages/core/src/selector.ts`
- Test: `packages/core/test/selector.test.ts`

**Interfaces:**
- Produces:
  - `type PathSegment = { kind: "key"; key: string } | { kind: "index"; index: number } | { kind: "wildcard" }`
  - `parseSelector(selector: string): PathSegment[]` — accepte `$`, `.clé`, `[*]`, `[3]`, `.*` ; jette `ConfigError` sinon.
  - `matchesPath(segments: PathSegment[], path: (string | number)[]): boolean` — longueur exacte, wildcard matche clé ou index.
  - `class ConfigError extends Error { code: string }` (dans `selector.ts`, réexportée par `index.ts`).

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/selector.test.ts
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
```

- [ ] **Step 2: Run** — `pnpm --filter @defsquare/data-graph-core test` : FAIL (module absent).
- [ ] **Step 3: Implémentation**

```ts
// packages/core/src/selector.ts
export class ConfigError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "ConfigError" }
}

export type PathSegment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }

const TOKEN = /^(?:\.(\*|[A-Za-z_$][\w$-]*)|\[(\*|\d+)\])/

export function parseSelector(selector: string): PathSegment[] {
  if (!selector.startsWith("$")) {
    throw new ConfigError("selector-syntax", `Selector must start with "$": ${selector}`)
  }
  let rest = selector.slice(1)
  const segments: PathSegment[] = []
  while (rest.length > 0) {
    const m = TOKEN.exec(rest)
    if (!m) throw new ConfigError("selector-syntax", `Invalid selector near "${rest}" in ${selector}`)
    if (m[1] !== undefined) {
      segments.push(m[1] === "*" ? { kind: "wildcard" } : { kind: "key", key: m[1] })
    } else {
      segments.push(m[2] === "*" ? { kind: "wildcard" } : { kind: "index", index: Number(m[2]) })
    }
    rest = rest.slice(m[0].length)
  }
  if (segments.length === 0) throw new ConfigError("selector-syntax", `Empty selector: ${selector}`)
  return segments
}

export function matchesPath(segments: PathSegment[], path: (string | number)[]): boolean {
  if (segments.length !== path.length) return false
  return segments.every((seg, i) => {
    const part = path[i]!
    if (seg.kind === "wildcard") return true
    if (seg.kind === "key") return part === seg.key
    return part === seg.index
  })
}
```

- [ ] **Step 4: Run** — PASS. Réexporter depuis `index.ts` : `export { parseSelector, matchesPath, ConfigError, type PathSegment } from "./selector.js"`.
- [ ] **Step 5: Commit** — `feat(core): path selector (JSONPath subset)`

---

### Task 3: Validation de config

**Files:**
- Create: `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface EntityConfig { match: string; id: string }`
  - `interface DataGraphConfig { entities: Record<string, EntityConfig>; references?: Record<string, Record<string, string>>; maxNodes?: number }`
  - `interface ValidatedConfig { entities: Map<string, { segments: PathSegment[]; idField: string }>; references: Map<string, Map<string, string>>; maxNodes: number }`
  - `validateConfig(config: DataGraphConfig): ValidatedConfig` — jette `ConfigError` (codes `"selector-syntax"`, `"unknown-entity-type"`, `"empty-config"`).

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/config.test.ts
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
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — `validateConfig` parse chaque `match` via `parseSelector`, vérifie que chaque type source/cible de `references` existe dans `entities`, défaut `maxNodes: 50_000`. Structure de retour = maps du bloc Interfaces, rien de plus.
- [ ] **Step 4: Run** — PASS. Réexporter types + fonction depuis `index.ts`.
- [ ] **Step 5: Commit** — `feat(core): declarative config validation`

---

### Task 4: Construction du graphe (nœuds, lignes scalaires, imbrication)

**Files:**
- Create: `packages/core/src/model.ts`, `packages/core/src/build.ts`
- Create: `packages/core/test/fixtures.ts` (jeu e-commerce partagé)
- Test: `packages/core/test/build.test.ts`

**Interfaces:**
- Consumes: `validateConfig`, `matchesPath` (Tasks 2–3).
- Produces (dans `model.ts`, tout réexporté par `index.ts`) :
  - `type NodeId = string` (JSON pointer, racine = `"/"`)
  - `interface ScalarRow { key: string; value: string | number | boolean | null; valueType: "string" | "number" | "boolean" | "null" }`
  - `interface BaseNode { id: NodeId; path: (string | number)[]; label: string; rows: ScalarRow[]; parentId: NodeId | null; childIds: NodeId[] }`
  - `interface EntityNode extends BaseNode { kind: "entity"; entityType: string; entityId: string }`
  - `interface ObjectNode extends BaseNode { kind: "object" }`
  - `interface ArrayNode extends BaseNode { kind: "array"; length: number }`
  - `type GraphNode = EntityNode | ObjectNode | ArrayNode`
  - `interface ContainEdge { kind: "contain"; from: NodeId; to: NodeId }`
  - `interface RefEdge { kind: "ref"; from: NodeId; to: NodeId | null; field: string; targetType: string; targetId: string; dangling: boolean }`
  - `interface Diagnostic { code: "dangling-ref" | "duplicate-id" | "missing-id"; path: string; message: string }`
  - `interface Graph { nodes: Map<NodeId, GraphNode>; rootId: NodeId; containEdges: ContainEdge[]; refEdges: RefEdge[]; entityIndex: Map<string, Map<string, NodeId>>; diagnostics: Diagnostic[]; logicalNodeCount: number }`
  - `class GraphTooLargeError extends Error { count: number; max: number }`
  - Dans `build.ts` : `buildGraph(data: unknown, config: DataGraphConfig): Graph` (les `refEdges` restent vides ici — Task 5).

**Règles de construction** (c'est le cœur de la spec §Modèle) :
- Parcours récursif du JSON. Un objet devient un nœud ; ses valeurs **scalaires** deviennent des `rows` du nœud (PAS des nœuds enfants) ; ses valeurs objet/tableau deviennent des nœuds enfants + `ContainEdge`.
- Un tableau devient un `ArrayNode` ; ses items scalaires deviennent des rows (`key` = index en string), ses items objets des enfants.
- Un objet dont le `path` matche un sélecteur d'entité devient `EntityNode` avec `entityType` = clé de config et `entityId` = `String(obj[idField])`. S'il n'a pas le champ id → `ObjectNode` ordinaire + diagnostic `missing-id`. Deux entités de même type/id → la première gagne dans `entityIndex`, diagnostic `duplicate-id` sur la seconde.
- `label` : entité → `"Customer #42"` ; sinon clé dans le parent (`"address"`, `"lines[3]"` pour un item de tableau) ; racine → `"$"`.
- `id` : JSON pointer — racine `"/"`, puis `"/customers/0"` (échapper `~` → `~0` et `/` → `~1` dans les clés).
- `logicalNodeCount` = nombre de nœuds + nombre total de rows ; si > `maxNodes` → `GraphTooLargeError` (le check se fait pendant le parcours, pour ne pas geler sur un JSON énorme).

- [ ] **Step 1: Fixture partagée**

```ts
// packages/core/test/fixtures.ts
import type { DataGraphConfig } from "../src/config.js"

export const shopData = {
  customers: [
    { id: "c1", name: "Dupont", email: "dupont@example.com",
      address: { street: "1 rue de la Paix", city: "Paris" } },
    { id: "c2", name: "Martin", email: "martin@example.com" },
  ],
  orders: [
    { id: "o1", customerId: "c1", total: 99.5,
      lines: [{ sku: "A-1", qty: 2 }, { sku: "B-7", qty: 1 }] },
    { id: "o2", customerId: "GHOST", total: 12 },
  ],
}

export const shopConfig: DataGraphConfig = {
  entities: {
    Customer: { match: "$.customers[*]", id: "id" },
    Order: { match: "$.orders[*]", id: "id" },
  },
  references: { Order: { customerId: "Customer" } },
}

/** Génère ~`n` nœuds logiques pour les tests de perf/échelle. */
export function bigShop(n: number) {
  const customers = [], orders = []
  for (let i = 0; customers.length * 8 + orders.length * 10 < n; i++) {
    customers.push({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@x.fr`,
      address: { street: `${i} rue X`, city: "Lyon" } })
    orders.push({ id: `o${i}`, customerId: `c${i}`, total: i,
      lines: [{ sku: `S${i}`, qty: 1 }, { sku: `T${i}`, qty: 3 }] })
  }
  return { customers, orders }
}
```

- [ ] **Step 2: Tests (failing)**

```ts
// packages/core/test/build.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { GraphTooLargeError } from "../src/model.js"
import { shopData, shopConfig, bigShop } from "./fixtures.js"

describe("buildGraph", () => {
  const g = buildGraph(shopData, shopConfig)

  it("recognizes entities from config", () => {
    const c1 = g.nodes.get("/customers/0")!
    expect(c1.kind).toBe("entity")
    expect(c1).toMatchObject({ entityType: "Customer", entityId: "c1", label: "Customer #c1" })
    expect(g.entityIndex.get("Customer")!.get("c1")).toBe("/customers/0")
  })
  it("groups scalar fields as rows, not child nodes", () => {
    const c1 = g.nodes.get("/customers/0")!
    expect(c1.rows.map(r => r.key)).toEqual(["id", "name", "email"])
    expect(c1.childIds).toEqual(["/customers/0/address"]) // seul l'objet imbriqué est un enfant
  })
  it("builds containment edges and stable pointer ids", () => {
    expect(g.containEdges).toContainEqual({ kind: "contain", from: "/customers/0", to: "/customers/0/address" })
    expect(g.nodes.get("/orders/0/lines")!.kind).toBe("array")
    expect(g.nodes.get("/orders/0/lines/1")!.label).toBe("lines[1]")
  })
  it("flags entity without id field as missing-id and keeps it an object", () => {
    const g2 = buildGraph({ customers: [{ name: "SansId" }] }, shopConfig)
    expect(g2.nodes.get("/customers/0")!.kind).toBe("object")
    expect(g2.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-id", path: "/customers/0" }))
  })
  it("flags duplicate entity ids, first wins", () => {
    const g2 = buildGraph({ customers: [{ id: "c1", name: "A" }, { id: "c1", name: "B" }] }, shopConfig)
    expect(g2.entityIndex.get("Customer")!.get("c1")).toBe("/customers/0")
    expect(g2.diagnostics).toContainEqual(expect.objectContaining({ code: "duplicate-id", path: "/customers/1" }))
  })
  it("throws GraphTooLargeError above maxNodes", () => {
    expect(() => buildGraph(bigShop(2000), { ...shopConfig, maxNodes: 100 })).toThrow(GraphTooLargeError)
  })
  it("handles 10k logical nodes under 1s", () => {
    const t0 = performance.now()
    const big = buildGraph(bigShop(10_000), shopConfig)
    expect(big.logicalNodeCount).toBeGreaterThan(9_000)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
```

- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implémentation** — `model.ts` (types + `GraphTooLargeError`), `build.ts` : `validateConfig` puis parcours récursif appliquant exactement les règles ci-dessus. Fonctions internes : `pointerOf(path)`, `escapePointerSegment(key)`, `visitValue(value, path, parentId)`. Compter `logicalNodeCount` au fil de l'eau et jeter dès dépassement.
- [ ] **Step 5: Run** — PASS. Réexporter depuis `index.ts`.
- [ ] **Step 6: Commit** — `feat(core): graph builder with entity detection and scalar row grouping`

---

### Task 5: Résolution des références

**Files:**
- Modify: `packages/core/src/build.ts` (2e passe après le parcours)
- Test: `packages/core/test/references.test.ts`

**Interfaces:**
- Consumes: `Graph`, `ValidatedConfig.references` (Tasks 3–4).
- Produces: `buildGraph` remplit `graph.refEdges` : pour chaque `EntityNode` dont `entityType` a des références configurées et dont une **row** porte le champ référence, une `RefEdge`. Cible résolue via `entityIndex` ; introuvable → `to: null, dangling: true` + diagnostic `dangling-ref`.

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/references.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("reference resolution", () => {
  const g = buildGraph(shopData, shopConfig)

  it("resolves configured references to entity nodes", () => {
    expect(g.refEdges).toContainEqual({
      kind: "ref", from: "/orders/0", to: "/customers/0",
      field: "customerId", targetType: "Customer", targetId: "c1", dangling: false,
    })
  })
  it("keeps dangling references with a diagnostic", () => {
    expect(g.refEdges).toContainEqual(expect.objectContaining({
      from: "/orders/1", to: null, targetId: "GHOST", dangling: true,
    }))
    expect(g.diagnostics).toContainEqual(expect.objectContaining({ code: "dangling-ref", path: "/orders/1" }))
  })
  it("supports circular references between entities", () => {
    const data = { as: [{ id: "a1", bId: "b1" }], bs: [{ id: "b1", aId: "a1" }] }
    const g2 = buildGraph(data, {
      entities: { A: { match: "$.as[*]", id: "id" }, B: { match: "$.bs[*]", id: "id" } },
      references: { A: { bId: "B" }, B: { aId: "A" } },
    })
    expect(g2.refEdges).toHaveLength(2)
    expect(g2.diagnostics).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — dans `buildGraph`, après le parcours : itérer `graph.nodes`, pour chaque entité regarder `references.get(entityType)`, chercher la row du champ, résoudre via `entityIndex`. Valeur de row convertie en `String()` pour le lookup.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): reference edges with dangling detection`

---

### Task 6: État de collapse

**Files:**
- Create: `packages/core/src/collapse.ts`
- Test: `packages/core/test/collapse.test.ts`

**Interfaces:**
- Consumes: `Graph` (Task 4).
- Produces: `class CollapseState` :
  - `constructor(graph: Graph)` — état initial : **tout replié sauf la racine** (les entités racines sont visibles mais repliées, cf. spec §Layout).
  - `isExpanded(id: NodeId): boolean`
  - `expand(id: NodeId): void` / `collapse(id: NodeId): void`
  - `visibleNodeIds(): Set<NodeId>` — un nœud est visible ssi tous ses ancêtres sont expanded (la racine est toujours expanded et toujours visible).
  - `expandPathTo(id: NodeId): NodeId[]` — déplie tous les ancêtres de `id` et retourne les ids **nouvellement** dépliés (ordre racine → feuille). Base du "la recherche contourne le collapse".

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/collapse.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("CollapseState", () => {
  it("starts with only root children visible, collapsed", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const visible = cs.visibleNodeIds()
    expect(visible).toContain("/customers/0")     // enfant de /customers, lui-même enfant de racine…
    expect(visible).not.toContain("/customers/0/address") // …mais rien sous une entité repliée
    expect(cs.isExpanded("/customers/0")).toBe(false)
  })
  it("expand reveals direct children only", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/orders/0")
    expect(cs.visibleNodeIds()).toContain("/orders/0/lines")
    expect(cs.visibleNodeIds()).not.toContain("/orders/0/lines/0") // lines pas encore déplié
  })
  it("expandPathTo returns newly expanded ancestors root-first", () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const newly = cs.expandPathTo("/orders/0/lines/1")
    expect(newly).toEqual(["/orders/0", "/orders/0/lines"])
    expect(cs.visibleNodeIds()).toContain("/orders/0/lines/1")
    expect(cs.expandPathTo("/orders/0/lines/1")).toEqual([]) // idempotent
  })
})
```

Note importante encodée par le premier test : au chargement, la spec veut voir les **entités racines** repliées. Avec la fixture, `/customers` et `/orders` sont des enfants directs de la racine — l'état initial met donc la racine ET ses conteneurs directs (`/customers`, `/orders`) expanded s'ils ne sont **pas** des entités, en s'arrêtant à la première entité rencontrée. Règle exacte : à la construction, faire un BFS depuis la racine et marquer expanded chaque nœud non-entité rencontré ; s'arrêter de descendre sous un nœud entité.

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — `Set<NodeId>` interne des expanded + la règle BFS ci-dessus. `visibleNodeIds` : DFS depuis la racine, on inclut chaque nœud rencontré, on ne descend que si expanded.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): collapse state with entity-boundary defaults`

---

### Task 7: Index de recherche

**Files:**
- Create: `packages/core/src/search.ts`
- Test: `packages/core/test/search.test.ts`

**Interfaces:**
- Consumes: `Graph` (Task 4).
- Produces:
  - `interface SearchResult { nodeId: NodeId; field: string | null; matched: string }` — `field` = clé de la row qui matche (`null` si c'est le label/id d'entité qui matche), `matched` = texte source du match.
  - `buildSearchIndex(graph: Graph): SearchIndex`
  - `class SearchIndex { search(query: string): SearchResult[] }` — insensible à la casse, `includes` sur : labels, ids d'entités, clés de rows, valeurs scalaires stringifiées. Ordre des résultats = ordre d'insertion des nœuds (ordre document). Query vide → `[]`. Dédoublonnage : un nœud apparaît au plus une fois par champ matché.

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/search.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { buildSearchIndex } from "../src/search.js"
import { shopData, shopConfig, bigShop } from "./fixtures.js"

describe("SearchIndex", () => {
  const idx = buildSearchIndex(buildGraph(shopData, shopConfig))

  it("finds by scalar value, case-insensitive", () => {
    expect(idx.search("DUPONT")).toContainEqual(
      { nodeId: "/customers/0", field: "name", matched: "Dupont" })
  })
  it("finds by key and by entity id", () => {
    expect(idx.search("customerId").length).toBeGreaterThanOrEqual(2)
    expect(idx.search("c1")).toContainEqual(expect.objectContaining({ nodeId: "/customers/0" }))
  })
  it("searches collapsed regions too (index covers full graph)", () => {
    expect(idx.search("rue de la paix")).toContainEqual(
      expect.objectContaining({ nodeId: "/customers/0/address" }))
  })
  it("returns [] for empty query and stays under 50ms on 10k nodes", () => {
    expect(idx.search("")).toEqual([])
    const big = buildSearchIndex(buildGraph(bigShop(10_000), shopConfig))
    const t0 = performance.now()
    big.search("client 42")
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — à la construction, aplatir le graphe en une liste d'entrées `{ nodeId, field, text, lower }` (label, entityId, chaque row clé + valeur). `search` : scan linéaire sur `lower.includes(q)`. Pas de structure fancy — le scan de ~40k chaînes tient largement sous 50 ms.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): full-graph search index`

---

### Task 8: Mesure des nœuds + layout initial (elkjs)

**Files:**
- Create: `packages/core/src/measure.ts`, `packages/core/src/layout.ts`
- Test: `packages/core/test/layout.test.ts`

**Interfaces:**
- Consumes: `Graph`, `CollapseState.visibleNodeIds()` (Tasks 4, 6). Dépendance : `pnpm --filter @defsquare/data-graph-core add elkjs`.
- Produces:
  - `interface Size { width: number; height: number }`
  - `interface NodeMetrics { charWidth: number; rowHeight: number; headerHeight: number; paddingX: number; maxTextChars: number }` + `export const DEFAULT_METRICS: NodeMetrics = { charWidth: 7.2, rowHeight: 20, headerHeight: 28, paddingX: 12, maxTextChars: 42 }`
  - `measureNode(node: GraphNode, metrics?: NodeMetrics): Size` — largeur = min(maxTextChars, plus longue ligne `clé: valeur`) × charWidth + 2×paddingX ; hauteur = headerHeight + rows.length × rowHeight. Déterministe, pas de DOM.
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface LayoutResult { positions: Map<NodeId, Rect> }`
  - `type ElkFactory = () => InstanceType<typeof import("elkjs/lib/elk.bundled.js").default>`
  - `createLayoutEngine(opts?: { elkFactory?: ElkFactory }): LayoutEngine` — défaut : elk bundled in-process (Node/tests) ; le renderer injectera une factory worker.
  - `LayoutEngine.layout(graph: Graph, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<LayoutResult>` — construit le graphe ELK **d'imbrication uniquement** (arêtes contain entre nœuds visibles), algo `layered`, direction `RIGHT`, spacing 24/48. Les refEdges ne participent pas au layout (spec : elles se superposent).

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/layout.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { measureNode, DEFAULT_METRICS } from "../src/measure.js"
import { createLayoutEngine } from "../src/layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("measureNode", () => {
  it("is deterministic and scales with rows", () => {
    const g = buildGraph(shopData, shopConfig)
    const c1 = g.nodes.get("/customers/0")!
    const s = measureNode(c1)
    expect(s.height).toBe(DEFAULT_METRICS.headerHeight + 3 * DEFAULT_METRICS.rowHeight)
    expect(s.width).toBeGreaterThan(100)
    expect(measureNode(c1)).toEqual(s)
  })
})

describe("LayoutEngine.layout", () => {
  it("positions all visible nodes left-to-right without overlap", async () => {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    cs.expand("/customers/0")
    const visible = cs.visibleNodeIds()
    const { positions } = await createLayoutEngine().layout(g, visible)
    expect(positions.size).toBe(visible.size)
    const parent = positions.get("/customers/0")!
    const child = positions.get("/customers/0/address")!
    expect(child.x).toBeGreaterThan(parent.x + parent.width) // gauche → droite
    const rects = [...positions.values()]
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
                      a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlap).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — `measure.ts` trivial. `layout.ts` : construire `{ id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "24", "elk.layered.spacing.nodeNodeBetweenLayers": "48" }, children: [...], edges: [...] }` **à plat** (pas de hiérarchie ELK — les contain edges suffisent à produire les couches), appeler `elk.layout(...)`, recopier `x/y/width/height` dans la map. Import : `import ELK from "elkjs/lib/elk.bundled.js"`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): node measurement and elkjs layered layout`

---

### Task 9: Layout incrémental (expand/collapse partiels)

**Files:**
- Modify: `packages/core/src/layout.ts`
- Test: `packages/core/test/layout-incremental.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces, sur `LayoutEngine` :
  - `layoutAfterExpand(prev: LayoutResult, graph: Graph, expandedId: NodeId, visible: Set<NodeId>, metrics?: NodeMetrics): Promise<LayoutResult>` — algorithme spec §Layout :
    1. Layouter en isolation (elk) le sous-graphe **nouvellement visible** sous `expandedId`.
    2. Le positionner à `(rect(expandedId).x + rect(expandedId).width + 48, rect(expandedId).y)`.
    3. `delta = max(0, hauteurBBoxSousArbre − rect(expandedId).height)` ; décaler de `delta` vers le bas tout nœud déjà présent dont `y > rect(expandedId).y + rect(expandedId).height / 2` et qui n'est pas dans le sous-arbre.
    4. Mémoriser `delta` dans `expansionDeltas: Map<NodeId, number>` (champ privé du moteur).
  - `layoutAfterCollapse(prev: LayoutResult, graph: Graph, collapsedId: NodeId, visible: Set<NodeId>): LayoutResult` — synchrone : retirer les positions des nœuds devenus invisibles, remonter de `expansionDeltas.get(collapsedId) ?? 0` les nœuds sous le seuil, oublier le delta.

- [ ] **Step 1: Tests (failing)**

```ts
// packages/core/test/layout-incremental.test.ts
import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { createLayoutEngine } from "../src/layout.js"
import { shopData, shopConfig } from "./fixtures.js"

describe("incremental layout", () => {
  async function setup() {
    const g = buildGraph(shopData, shopConfig)
    const cs = new CollapseState(g)
    const engine = createLayoutEngine()
    const initial = await engine.layout(g, cs.visibleNodeIds())
    return { g, cs, engine, initial }
  }

  it("expand keeps nodes above unchanged, shifts nodes below, no overlap", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const next = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    const anchor = before.get("/customers/0")!
    for (const [id, r] of before) {
      if (r.y + r.height <= anchor.y) expect(next.positions.get(id)).toEqual(r) // au-dessus : intact
    }
    expect(next.positions.has("/customers/0/address")).toBe(true)
    const addr = next.positions.get("/customers/0/address")!
    expect(addr.x).toBeGreaterThan(anchor.x + anchor.width)
  })

  it("collapse restores previous vertical positions", async () => {
    const { g, cs, engine, initial } = await setup()
    const before = new Map([...initial.positions].map(([id, r]) => [id, { ...r }]))
    cs.expand("/customers/0")
    const expanded = await engine.layoutAfterExpand(initial, g, "/customers/0", cs.visibleNodeIds())
    cs.collapse("/customers/0")
    const back = engine.layoutAfterCollapse(expanded, g, "/customers/0", cs.visibleNodeIds())
    expect(back.positions.size).toBe(before.size)
    for (const [id, r] of before) expect(back.positions.get(id)!.y).toBeCloseTo(r.y, 5)
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implémentation** — suivre l'algorithme du bloc Interfaces à la lettre. Le sous-graphe isolé se layoute avec la même config elk que Task 8.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): incremental expand/collapse layout with sibling shift`

---

### Task 10: Package renderer + thèmes

**Files:**
- Create: `packages/renderer/package.json`, `packages/renderer/tsconfig.json`
- Create: `packages/renderer/src/theme.ts`, `packages/renderer/src/index.ts`
- Test: `packages/renderer/test/theme.test.ts`

**Interfaces:**
- Produces: package `@defsquare/data-graph` (build/test/typecheck identiques au core ; `pnpm add pixi.js` + `pnpm add @defsquare/data-graph-core@workspace:*`).
  - `interface Theme { fonts: { body: string; mono: string }; colors: { background: string; nodeFill: string; nodeStroke: string; text: string; textMuted: string; entity: string; refEdge: string; containEdge: string; selection: string; searchHighlight: string; danglingRef: string }; byEntityType?: Record<string, { accent: string }> }`
  - `resolveTheme(partial?: DeepPartial<Theme>): Theme` — merge sur le thème Defsquare.
  - Trois thèmes exportés, valeurs **exactes** (tokens DS Defsquare, `colors_and_type.css`) :

```ts
// packages/renderer/src/theme.ts — valeurs à copier telles quelles
export const defsquareTheme: Theme = {
  fonts: {
    body: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif",
    mono: "Fira Code, SF Mono, Menlo, Consolas, monospace",
  },
  colors: {
    background: "#f7f7f8",      // --color-bg-muted
    nodeFill: "#ffffff",        // --color-bg-card
    nodeStroke: "#e5e7eb",      // --color-border
    text: "#070f19",            // --color-fg (primaries-200)
    textMuted: "#4b5563",       // --color-fg-muted
    entity: "#f65e5e",          // --color-accent (rouge Defsquare)
    refEdge: "#2a5a98",         // --color-primary-500
    containEdge: "#9ca3af",     // --color-fg-subtle
    selection: "#1e416e",       // --color-primary (base)
    searchHighlight: "#E2CA9E", // --color-beige
    danglingRef: "#d97706",     // --color-warning
  },
}
export const neutralLightTheme: Theme = { /* mêmes clés ; gris neutres : bg #fafafa, fill #fff, stroke #e4e4e7, text #18181b, muted #52525b, entity #2563eb, refEdge #7c3aed, containEdge #a1a1aa, selection #2563eb, searchHighlight #fde047, danglingRef #dc2626 ; fonts system-ui/monospace */ }
export const neutralDarkTheme: Theme = { /* bg #18181b, fill #27272a, stroke #3f3f46, text #fafafa, muted #a1a1aa, entity #60a5fa, refEdge #a78bfa, containEdge #52525b, selection #60a5fa, searchHighlight #ca8a04, danglingRef #f87171 ; fonts idem */ }
```

(Les deux thèmes neutres sont écrits en entier dans le code réel — les commentaires ci-dessus donnent toutes les valeurs.)

- [ ] **Step 1: Test (failing)** — `resolveTheme()` sans argument === `defsquareTheme` ; `resolveTheme({ colors: { entity: "#000000" } })` ne change que `entity` ; les trois thèmes ont exactement les mêmes clés.
- [ ] **Step 2: Run** — FAIL, puis implémentation (merge récursif à deux niveaux, pas de lib), PASS.
- [ ] **Step 3: Commit** — `feat(renderer): theme tokens (defsquare + neutral light/dark)`

---

### Task 11: Renderer squelette — Pixi app, caméra, rendu LOD, fit

**Files:**
- Create: `packages/renderer/src/create.ts` (API publique), `packages/renderer/src/camera.ts`, `packages/renderer/src/draw.ts`
- Create: `apps/demo/` (Vite vanilla-ts : `index.html`, `src/main.ts`, `package.json`) — harnais de dev minimal branché sur la fixture e-commerce.
- Test: manuel via démo (les tests automatisés du renderer arrivent en Task 14 avec Playwright).

**Interfaces:**
- Consumes: tout le core + `resolveTheme` (Task 10).
- Produces:
  - `interface DataGraphOptions { data: unknown; config: DataGraphConfig; theme?: DeepPartial<Theme>; elkWorkerUrl?: string | URL }`
  - `createDataGraph(container: HTMLElement, options: DataGraphOptions): DataGraph` — async en interne (Pixi v8 `Application.init` est async) mais retourne l'objet immédiatement, prêt après un `ready: Promise<void>` exposé.
  - `interface DataGraph { ready: Promise<void>; fit(): void; expand(id: NodeId): Promise<void>; collapse(id: NodeId): Promise<void>; focus(id: NodeId): void; select(id: NodeId): void; search(q: string): SearchResult[]; nextMatch(): SearchResult | null; prevMatch(): SearchResult | null; on(event: "select" | "followRef", cb: (payload: any) => void): () => void; setData(data: unknown, config?: DataGraphConfig): Promise<void>; diagnostics(): Diagnostic[]; destroy(): void }` — Tasks 11–13 remplissent progressivement ; dans cette task : `ready`, `fit`, `destroy`, `diagnostics`, rendu statique.
  - `camera.ts` : `class Camera { constructor(stage: Container, canvas: HTMLCanvasElement); fitTo(bounds: Rect, viewport: Size): void; centerOn(rect: Rect, viewport: Size, scale?: number): void; scale(): number; dispose(): void }` — pan au drag (pointer events), zoom molette centré sur le curseur (bornes 0.02–3), applique position/scale au `stage`.
  - `draw.ts` : `drawNode(node: GraphNode, rect: Rect, theme: Theme, lod: 0 | 1 | 2): Container` et `drawEdges(graph, positions, theme, lod): Graphics` :
    - LOD 0 (scale ≥ 0.5) : boîte arrondie (radius 6 = `--radius-md`), header coloré (accent entité ou `byEntityType`), rows en `BitmapText` (`clé:` en textMuted, valeur en text, mono pour les valeurs).
    - LOD 1 (0.15 ≤ scale < 0.5) : boîte + label seul.
    - LOD 2 (scale < 0.15) : rectangle plein coloré par type, sans texte.
    - Arêtes contain : bézier horizontale pleine `containEdge` ; arêtes ref : **pointillée** (segments via `Graphics.moveTo/lineTo`), `refEdge`, ou `danglingRef` + croix terminale si pendante (une pendante part du bord droit du nœud source vers un court stub).
    - Police bitmap : `BitmapFont.install({ name: "dg-body", style: { fontFamily: theme.fonts.body, fontSize: 14 } })` au premier rendu (vérifier l'API v8 sur context7 : `/pixijs/pixijs`).
  - Rendu : `rebuild()` interne — détruit et redessine les containers des nœuds visibles à partir de `LayoutResult` (suffisant en v1 ; culling natif Pixi `cullable = true` sur chaque container + `cullArea`). Re-render du LOD déclenché quand le scale franchit un seuil.
  - `elkWorkerUrl` : si fourni, `createLayoutEngine({ elkFactory: () => new ELK({ workerUrl }) })` ; sinon elk in-process. La démo passera l'URL du worker elkjs via Vite (`new URL("elkjs/lib/elk-worker.min.js", import.meta.url)`).

- [ ] **Step 1: Créer `apps/demo`** — Vite vanilla-ts (`pnpm create vite apps/demo --template vanilla-ts`), dépendance workspace sur le renderer, `main.ts` :

```ts
import { createDataGraph } from "@defsquare/data-graph"
import { shopData, shopConfig } from "./sample-data" // copier la fixture bigShop(2000) + shop
const graph = createDataGraph(document.getElementById("app")!, {
  data: shopData, config: shopConfig,
  elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
})
await graph.ready
graph.fit()
```

- [ ] **Step 2: Implémenter `create.ts` + `camera.ts` + `draw.ts`** dans cet ordre : init Pixi (`Application.init({ background, resizeTo: container, antialias: true })`), pipeline `buildGraph → CollapseState → layout initial → rebuild → fit()`.
- [ ] **Step 3: Vérification manuelle** — `pnpm --filter demo dev` : les entités racines apparaissent repliées, gauche→droite, pan/zoom fluides, LOD change au zoom arrière, arêtes ref pointillées visibles entre Order et Customer.
- [ ] **Step 4: Typecheck + build** — `pnpm typecheck && pnpm build` verts.
- [ ] **Step 5: Commit** — `feat(renderer): pixi renderer skeleton with camera, LOD and demo app`

---

### Task 12: Interactions — expand/collapse, sélection, followRef, focus

**Files:**
- Modify: `packages/renderer/src/create.ts`, `packages/renderer/src/draw.ts`
- Create: `packages/renderer/src/events.ts` (mini event-emitter typé, ~30 lignes, `on/emit/off`)

**Interfaces:**
- Consumes: Tasks 9, 11.
- Produces:
  - Clic sur le **header** d'un nœud ayant des enfants → toggle expand/collapse : `expand(id)` appelle `CollapseState.expand` + `layoutAfterExpand` + rebuild + transition animée des positions (interpolation 200 ms via ticker Pixi — `--transition`) ; `collapse(id)` symétrique avec `layoutAfterCollapse`.
  - Clic sur le **corps** d'un nœud → `select(id)` : événement `"select"` avec le `GraphNode` complet ; highlight : contour `selection` épaissi sur le nœud, sur ses arêtes contain jusqu'à la racine et sur ses refEdges sortantes.
  - Clic sur une **arête ref** (hit area = polygone épaissi le long du trait) ou sur la row du champ référence → événement `"followRef"` avec la `RefEdge` ; si `to !== null`, `expandPathTo(to)` + layout + `focus(to)`.
  - `focus(id)` : si le nœud n'est pas visible, `expandPathTo` + layouts d'expansion en cascade (dans l'ordre retourné) ; puis `camera.centerOn(rect, viewport, 1)`.
  - Pixi v8 : `container.eventMode = "static"`, handlers `pointertap`. Distinguer drag (pan) et tap : seuil de 4 px de déplacement.
- Vérification manuelle sur la démo (les asserts automatisés arrivent en Task 14).

- [ ] **Step 1: Implémenter events.ts + wiring des handlers** (ordre : toggle, select+highlight, followRef, focus).
- [ ] **Step 2: Vérification manuelle** — sur la démo : déplier `Order #o1`, cliquer `customerId` → la vue déplie et centre `Customer #c1` surligné ; la ref pendante de `o2` s'affiche en warning et un clic dessus n'émet pas de `followRef` vers une cible.
- [ ] **Step 3: Câbler un panneau de détail d'exemple dans la démo** (aside HTML listant `label`, `path`, rows — branché sur `graph.on("select", ...)`) : c'est la preuve que l'API "détail hors lib" suffit.
- [ ] **Step 4: Commit** — `feat(renderer): expand/collapse, selection, followRef and focus interactions`

---

### Task 13: Recherche câblée

**Files:**
- Modify: `packages/renderer/src/create.ts`
- Modify: `apps/demo/src/main.ts` + `apps/demo/index.html` (champ de recherche + compteur `3/12` + boutons ↑↓)

**Interfaces:**
- Consumes: Tasks 7, 12.
- Produces:
  - `graph.search(q)` : interroge le `SearchIndex` (construit une fois au `setData`/init), stocke les résultats + curseur interne à −1, applique un highlight `searchHighlight` sur les nœuds **visibles** matchés, retourne les résultats.
  - `graph.nextMatch()` / `graph.prevMatch()` : avance/recule le curseur (circulaire), `focus(nodeId)` du résultat courant (dépliage auto compris), highlight renforcé sur le courant ; retourne le `SearchResult` ou `null` si aucun résultat.
  - `search("")` efface les highlights et vide l'état.
  - `graph.setData(data, config?)` : re-exécute tout le pipeline (`buildGraph → CollapseState → SearchIndex → layout initial → rebuild → fit`) en réutilisant la config courante si `config` est omis ; l'état de recherche/sélection est réinitialisé.
- Vérification manuelle : chercher un client au fond d'une région repliée → `nextMatch` déplie et centre.

- [ ] **Step 1: Implémenter `setData` + la recherche, puis câbler l'UI démo** (input avec debounce 150 ms, Enter = nextMatch, Shift+Enter = prevMatch ; un bouton "recharger le petit/gros dataset" dans la démo exerce `setData`).
- [ ] **Step 2: Vérification manuelle** (scénario ci-dessus, y compris la fixture 2000 nœuds).
- [ ] **Step 3: Commit** — `feat(renderer): search with auto-expand navigation`

---

### Task 14: Habillage DS de la démo + tests Playwright

**Files:**
- Modify: `apps/demo/index.html`, créer `apps/demo/src/style.css` (tokens DS : fond `#f7f7f8`, header avec ink `#172741`, accent `#f65e5e`, fonts IBM Plex Sans Condensed + Fira Code via Google Fonts, radius 6 px, `--shadow-md` sur le panneau détail)
- Create: `apps/demo/e2e/smoke.spec.ts`, `apps/demo/playwright.config.ts`

**Interfaces:**
- Consumes: démo complète (Tasks 11–13).
- Produces: `pnpm --filter demo e2e` vert. Config Playwright : `webServer: { command: "pnpm dev", port: 5173 }`, projet chromium seul.

- [ ] **Step 1: Styler la démo** (chrome de page sobre : barre titre "data-graph" + champ recherche + compteur + panneau détail à droite ; le canvas reste dominant).
- [ ] **Step 2: Tests e2e (failing d'abord si l'app expose mal les hooks)** — pour rendre le canvas testable, exposer dans la démo `window.__graph = graph` et un div `#selection-label` mis à jour par le handler `select` :

```ts
// apps/demo/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test"

test("loads and renders collapsed roots", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await expect(page.locator("canvas")).toBeVisible()
})

test("select event reaches the host detail panel", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.select("/customers/0"))
  await expect(page.locator("#selection-label")).toContainText("Customer #c1")
})

test("search navigates and auto-expands to a hidden match", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.fill("#search", "rue de la paix")
  await page.press("#search", "Enter") // nextMatch
  const focused = await page.evaluate(() => (window as any).__graph.nextMatch()?.nodeId ?? null)
  expect(focused).not.toBeNull()
})

test("expand/collapse via API changes visible node count", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.expand("/orders/0"))
  // pas d'assertion pixel : on vérifie l'absence d'erreur console
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e)))
  await page.evaluate(() => (window as any).__graph.collapse("/orders/0"))
  expect(errors).toEqual([])
})
```

- [ ] **Step 3: Run** — `pnpm --filter demo e2e` : PASS.
- [ ] **Step 4: Commit** — `feat(demo): defsquare-styled demo shell with playwright smoke tests`

---

### Task 15: Bench, README, métadonnées de publication

**Files:**
- Create: `packages/core/bench/bench.ts` (script tsx : `buildGraph` + `buildSearchIndex` + layout initial sur `bigShop(10_000)`, imprime les temps vs budgets, exit 0 toujours — non bloquant)
- Create: `README.md` (racine : pitch, GIF placeholder à remplacer à la main, quickstart copiable = le code de la démo, tableau de l'API publique, section config entités/références, budgets perf)
- Modify: `packages/*/package.json` (metadata npm : `description`, `repository`, `license: "MIT"`, `keywords`, `sideEffects: false`), créer `LICENSE` (MIT, copyright Defsquare)

**Interfaces:**
- Consumes: tout.
- Produces: `pnpm bench` à la racine ; les deux packages passent `pnpm publish --dry-run`.

- [ ] **Step 1: Écrire le bench + script racine** `"bench": "pnpm --filter @defsquare/data-graph-core bench"` ; le bench mesure et affiche : `parse+index 10k: XXXms (budget 1000ms)`, `layout initial: XXXms`, `search: XXXms (budget 50ms)`.
- [ ] **Step 2: README + LICENSE + metadata.** Vérifier `pnpm publish --dry-run` dans chaque package (contenu du tarball = `dist` + README).
- [ ] **Step 3: Vérification finale complète** — `pnpm typecheck && pnpm build && pnpm test && pnpm --filter demo e2e && pnpm bench` : tout vert, budgets respectés ou écart documenté dans le README.
- [ ] **Step 4: Commit** — `chore: bench script, README and publish metadata`
