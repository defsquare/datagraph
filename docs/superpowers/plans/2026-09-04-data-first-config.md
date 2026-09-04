# Contrat data-first `ids`/`refs`/`groups` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le contrat public DDD (`entities`/`references`/`aggregates`) par un contrat data-first (`ids`/`refs`/`groups`) sans changer aucun comportement en aval de `ValidatedConfig`.

**Architecture:** `validateConfig` est réécrit pour compiler la nouvelle forme vers le `ValidatedConfig` existant (noms → segments + champ-clé ; refs `{from,to}` scindées en propriétaire/navigation/champ ; `groups` → `aggregates` interne). `build.ts`, `aggregate.ts`, layout et renderer sont intacts, à une ligne de diagnostic près. Le reste du chantier est la migration mécanique de toutes les configs littérales (fixtures, tests, démo, e2e, fixtures CLI) et des docs.

**Tech Stack:** TypeScript (Vitest), Rust (texte `--help` + tests cargo), Playwright (e2e inchangés dans leurs assertions).

**Spec:** `docs/superpowers/specs/2026-09-04-data-first-config-design.md`

## Global Constraints

- Rupture 0.x sans couche de compatibilité : `entities`/`references`/`aggregates` disparaissent du type public. Aucune assertion de comportement ne change (libellés `Customer #c1`, couleurs, agrégats, résolution identiques par construction).
- Messages d'erreur du cœur en anglais ; commentaires de code en français (le « pourquoi »).
- `refs[].to` doit être exactement l'un des chemins de `ids`, comparé en segments parsés. `refs[].from` doit étendre STRICTEMENT un préfixe d'instances ; plus long préfixe gagne.
- Sans `-c`, le CLI synthétise `{ ids: {} }` ; `--help` dit « declaring ids, refs and groups ».
- Régression documentée : les clés exotiques (`@odata:id`) ne sont plus déclarables comme référence (grammaire de sélecteurs) — le test correspondant est SUPPRIMÉ, pas adapté.
- Ordre de vérification : `pnpm build` avant `pnpm test` (bundle-purity lit `dist/`) ; `pnpm --filter @defsquare/data-graph build` avant `pnpm --filter demo e2e`.

## Recette de migration des configs (référence commune à toutes les tâches)

| Ancienne forme | Nouvelle forme |
|---|---|
| `entities: { X: { match: "$.p[*]", id: "id" } }` | `ids: { X: "$.p[*].id" }` |
| `references: { X: { customerId: "Y" } }` | `refs: [{ from: "<match de X>.customerId", to: "<chemin ids de Y>" }]` |
| `references: { X: { "lines[*].productRef": "Y" } }` | `refs: [{ from: "<match de X>.lines[*].productRef", to: "<chemin ids de Y>" }]` |
| `aggregates: ["A", "B"]` | `groups: ["A", "B"]` (même ordre — il arbitre) |
| `{ entities: {} }` | `{ ids: {} }` |

Les assertions qui citent une déclaration de référence (diagnostic `unresolved-reference`, `ReferenceDecl.path`) citent désormais le `from` ABSOLU tel qu'écrit.

---

### Task 1: Cœur — nouveau `validateConfig`, tests et fixtures core

**Files:**
- Modify: `packages/core/src/config.ts` (réécriture)
- Modify: `packages/core/src/build.ts:363` (une ligne)
- Modify: `packages/core/test/config.test.ts` (réécriture)
- Modify: `packages/core/test/fixtures.ts:16-22,37-45,57-70,104-115`
- Modify: configs littérales des autres tests core (`build.test.ts`, `references.test.ts`, `value-object-refs.test.ts`, `aggregate.test.ts`, `array-rows.test.ts`, `search.test.ts`, `layout-two-level.test.ts`, …) via la recette

**Interfaces:**
- Consomme : `parseSelector`, `ConfigError`, `PathSegment` de `selector.ts` (inchangés) ; `ValidatedConfig`/`ReferenceDecl` gardent leurs formes actuelles.
- Produit (utilisé par les tâches 2-3) : `DataGraphConfig = { ids: Record<string, string>; refs?: { from: string; to: string }[]; groups?: string[]; maxNodes?: number; rootLabel?: string }`. `EntityConfig` est SUPPRIMÉ du module et de l'export (`packages/core/src/index.ts` et le réexport renderer le perdent en Task 2).

- [ ] **Step 1: Réécrire `config.test.ts` (les tests d'abord)**

Remplacer intégralement `packages/core/test/config.test.ts` par :

```ts
import { describe, it, expect } from "vitest"
import { validateConfig } from "../src/config.js"
import { ConfigError } from "../src/selector.js"

const base = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
}

describe("validateConfig", () => {
  it("compiles ids and refs into the internal shape and applies defaults", () => {
    const v = validateConfig(base)
    expect(v.entities.get("Customer")).toEqual({
      segments: [{ kind: "key", key: "customers" }, { kind: "wildcard" }],
      idField: "id",
    })
    expect(v.references.get("Order")).toEqual([
      {
        navigate: [],
        field: "customerId",
        targetType: "Customer",
        // `path` porte le `from` ABSOLU tel qu'écrit : c'est la déclaration
        // que l'auteur relira dans un diagnostic.
        path: "$.orders[*].customerId",
      },
    ])
    expect(v.maxNodes).toBe(50_000)
    expect(v.rootLabel).toBe("$")
  })

  it("splits a nested ref into navigation + terminal field", () => {
    const v = validateConfig({
      ids: { Order: "$.orders[*].id", Product: "$.products[*].id" },
      refs: [{ from: "$.orders[*].lines[*].productRef", to: "$.products[*].id" }],
    })
    expect(v.references.get("Order")).toEqual([{
      navigate: [{ kind: "key", key: "lines" }, { kind: "wildcard" }],
      field: "productRef",
      targetType: "Product",
      path: "$.orders[*].lines[*].productRef",
    }])
  })

  it("attributes a ref to the LONGEST matching instance prefix", () => {
    // `$.orders[*].lines[*]` est un préfixe plus long que `$.orders[*]` : la
    // ref appartient à Line, pas à Order.
    const v = validateConfig({
      ids: {
        Order: "$.orders[*].id",
        Line: "$.orders[*].lines[*].id",
        Product: "$.products[*].id",
      },
      refs: [{ from: "$.orders[*].lines[*].productRef", to: "$.products[*].id" }],
    })
    expect(v.references.has("Order")).toBe(false)
    expect(v.references.get("Line")).toEqual([{
      navigate: [],
      field: "productRef",
      targetType: "Product",
      path: "$.orders[*].lines[*].productRef",
    }])
  })

  it("accepts an empty ids map (structure-only mode)", () => {
    const v = validateConfig({ ids: {} })
    expect(v.entities.size).toBe(0)
    expect(v.references.size).toBe(0)
    expect(v.aggregates).toEqual([])
  })

  it("rejects a non-object ids value", () => {
    for (const bad of [undefined, null, [], "x"]) {
      expect(() => validateConfig({ ids: bad } as never)).toThrow(/ids object/)
    }
  })

  it("rejects an id path that is not a string or does not end on a field name", () => {
    expect(() => validateConfig({ ids: { X: 42 } } as never)).toThrow(ConfigError)
    for (const bad of ["$.customers[*]", "$.customers[0]", "$.customers.*"]) {
      expect(() => validateConfig({ ids: { X: bad } })).toThrow(/end on a field name/)
    }
    expect(() => validateConfig({ ids: { X: "nope" } })).toThrow(ConfigError) // selector-syntax
  })

  it("rejects a ref whose target is not a declared id path", () => {
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
    })).toThrow(/declared id path/)
    // Même ensemble d'instances mais autre champ : refusé aussi — viser un
    // champ non-clé est hors scope v1 (porte laissée ouverte).
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].name" }],
    })).toThrow(/declared id path/)
  })

  it("rejects a ref whose source extends no declared instance prefix", () => {
    expect(() => validateConfig({
      ids: { Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
    })).toThrow(/extend a declared/)
  })

  it("rejects a ref source that does not end on a field name", () => {
    expect(() => validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id" },
      refs: [{ from: "$.orders[*].lines[*]", to: "$.customers[*].id" }],
    })).toThrow(/end on a field name/)
  })

  it("rejects a malformed ref entry", () => {
    for (const bad of [null, "x", { from: "$.orders[*].c" }, { to: "$.customers[*].id" }]) {
      expect(() => validateConfig({ ...base, refs: [bad] } as never)).toThrow(/'from' and 'to'/)
    }
  })

  it("keeps two refs from the same path (array, no collision)", () => {
    const v = validateConfig({
      ids: { Order: "$.orders[*].id", Customer: "$.customers[*].id", Vip: "$.vips[*].id" },
      refs: [
        { from: "$.orders[*].customerId", to: "$.customers[*].id" },
        { from: "$.orders[*].customerId", to: "$.vips[*].id" },
      ],
    })
    expect(v.references.get("Order")).toHaveLength(2)
  })
})

describe("groups", () => {
  it("defaults to an empty list and preserves declaration order", () => {
    expect(validateConfig(base).aggregates).toEqual([])
    const v = validateConfig({
      ...base,
      groups: ["Order", "Customer"],
    })
    expect(v.aggregates).toEqual(["Order", "Customer"])
  })

  it("rejects a group that is not declared in ids", () => {
    expect(() => validateConfig({ ...base, groups: ["Ghost"] })).toThrow(/not declared in ids/)
  })
})
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts`
Expected: FAIL massif — l'implémentation actuelle rejette la clé `ids`.

- [ ] **Step 3: Réécrire `config.ts`**

Remplacer intégralement `packages/core/src/config.ts` par :

```ts
import { parseSelector, ConfigError, type PathSegment } from "./selector.js"

/**
 * Contrat data-first : tout s'exprime en chemins.
 *
 * - `ids` : nom → chemin de clé. Le préfixe (`$.customers[*]`) désigne
 *   l'ensemble d'instances, le dernier segment (`id`) le champ-clé. Le nom
 *   n'est qu'une poignée de présentation (libellés, couleurs, badges).
 * - `refs` : joins `{from, to}` — « la valeur à `from` égale la valeur de clé
 *   à `to` ». Un tableau, pas une map : deux refs peuvent partir du même
 *   chemin sans collision de clé.
 * - `groups` : les noms de `ids` qui ancrent le regroupement de la vue
 *   graphe. L'ordre est PORTEUR : il arbitre les égalités de distance (voir
 *   `buildAggregates`) et fixe l'ordre de peinture des enveloppes.
 */
export interface DataGraphConfig {
  ids: Record<string, string>
  refs?: { from: string; to: string }[]
  groups?: string[]
  maxNodes?: number
  /** Libellé du nœud racine. Défaut `"$"` — le symbole racine de la syntaxe
   * de sélecteur que `ids` utilise déjà. Une chaîne vide est respectée. */
  rootLabel?: string
}

/**
 * Une référence déclarée, découpée en ce dont la construction a besoin : la
 * NAVIGATION depuis l'entité propriétaire (vide pour un champ direct) et la
 * clé de la ligne TERMINALE qui porte l'identifiant.
 *
 * `path` porte le `from` ABSOLU tel qu'écrit dans la config : c'est la
 * déclaration que l'auteur relira quand `unresolved-reference` la citera.
 */
export interface ReferenceDecl {
  navigate: PathSegment[]
  field: string
  targetType: string
  path: string
}

export interface ValidatedConfig {
  entities: Map<string, { segments: PathSegment[]; idField: string }>
  references: Map<string, ReferenceDecl[]>
  maxNodes: number
  rootLabel: string
  aggregates: string[]
}

function segmentsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const other = b[i]!
    if (seg.kind !== other.kind) return false
    if (seg.kind === "key" && other.kind === "key") return seg.key === other.key
    if (seg.kind === "index" && other.kind === "index") return seg.index === other.index
    return true
  })
}

export function validateConfig(config: DataGraphConfig): ValidatedConfig {
  // Une config chargée du disque (option `-c` de la CLI) peut être n'importe
  // quel JSON : le type ne garantit rien, et un TypeError brut remonterait
  // tel quel jusqu'à l'écran d'erreur de l'utilisateur final.
  if (typeof config.ids !== "object" || config.ids === null || Array.isArray(config.ids)) {
    throw new ConfigError("invalid-config", "Config must declare an ids object")
  }

  // `ids` : chaque chemin se scinde en préfixe d'instances + champ-clé.
  const entities = new Map<string, { segments: PathSegment[]; idField: string }>()
  // Les segments COMPLETS (champ-clé inclus), pour comparer `refs[].to` en
  // segments parsés plutôt qu'en chaînes brutes.
  const idPathSegments = new Map<string, PathSegment[]>()
  for (const [name, idPath] of Object.entries(config.ids)) {
    if (typeof idPath !== "string") {
      throw new ConfigError("invalid-config", `Id path for '${name}' must be a string selector`)
    }
    const segments = parseSelector(idPath)
    const last = segments[segments.length - 1]!
    if (last.kind !== "key") {
      throw new ConfigError(
        "invalid-config",
        `Id path for '${name}' must end on a field name: ${idPath}`,
      )
    }
    entities.set(name, { segments: segments.slice(0, -1), idField: last.key })
    idPathSegments.set(name, segments)
  }

  // `refs` : la cible doit être un chemin de `ids` (viser un champ non-clé
  // est hors scope v1 — la porte reste ouverte sans être payée) ; la source
  // doit étendre STRICTEMENT un préfixe d'instances, le plus long gagne (à
  // longueur égale, l'ordre de déclaration de `ids` tranche — cas dégénéré
  // de deux noms sur le même préfixe).
  const references = new Map<string, ReferenceDecl[]>()
  for (const ref of config.refs ?? []) {
    if (
      typeof ref !== "object" || ref === null ||
      typeof (ref as { from?: unknown }).from !== "string" ||
      typeof (ref as { to?: unknown }).to !== "string"
    ) {
      throw new ConfigError("invalid-config", "Each ref must declare string 'from' and 'to' paths")
    }
    const toSegments = parseSelector(ref.to)
    let targetType: string | undefined
    for (const [name, segs] of idPathSegments) {
      if (segmentsEqual(segs, toSegments)) { targetType = name; break }
    }
    if (targetType === undefined) {
      throw new ConfigError("invalid-config", `Ref target must be a declared id path: ${ref.to}`)
    }

    const fromSegments = parseSelector(ref.from)
    let owner: string | undefined
    let ownerLen = -1
    for (const [name, entity] of entities) {
      const prefix = entity.segments
      if (
        prefix.length < fromSegments.length &&
        prefix.length > ownerLen &&
        segmentsEqual(prefix, fromSegments.slice(0, prefix.length))
      ) {
        owner = name
        ownerLen = prefix.length
      }
    }
    if (owner === undefined) {
      throw new ConfigError(
        "invalid-config",
        `Ref source must extend a declared instance prefix: ${ref.from}`,
      )
    }
    // `<` strict ci-dessus : le reste est non vide par construction.
    const remainder = fromSegments.slice(ownerLen)
    const last = remainder[remainder.length - 1]!
    if (last.kind !== "key") {
      throw new ConfigError(
        "invalid-config",
        `Ref source must end on a field name: ${ref.from}`,
      )
    }
    const decl: ReferenceDecl = {
      navigate: remainder.slice(0, -1),
      field: last.key,
      targetType,
      path: ref.from,
    }
    const list = references.get(owner)
    if (list) list.push(decl)
    else references.set(owner, [decl])
  }

  // `groups` → `aggregates` interne, ordre conservé.
  const aggregates: string[] = []
  for (const name of config.groups ?? []) {
    if (!entities.has(name)) {
      throw new ConfigError("unknown-entity-type", `Unknown group: '${name}' is not declared in ids`)
    }
    aggregates.push(name)
  }

  const maxNodes = config.maxNodes ?? 50_000

  // `??` et non `||` : une chaîne vide est un libellé valide que l'appelant a
  // le droit de vouloir.
  const rootLabel = config.rootLabel ?? "$"

  return { entities, references, maxNodes, rootLabel, aggregates }
}
```

(`EntityConfig` et `parseReferenceKey` disparaissent ; l'import de `parseRelativePath` aussi — la fonction reste dans `selector.ts`, elle est de l'API publique du module.)

Dans `packages/core/src/index.ts`, retirer `EntityConfig` de l'export s'il y figure (vérifier avec `rg -n "EntityConfig" packages/core/src/index.ts`).

- [ ] **Step 4: La ligne de `build.ts`**

À `packages/core/src/build.ts:363`, remplacer :

```ts
        path: `${sourceType}.${decl.path}`,
```

par :

```ts
        // `decl.path` est désormais le `from` absolu : le préfixer du type
        // produirait « Order.$.orders[*]… ».
        path: decl.path,
```

- [ ] **Step 5: Vérifier que config.test.ts passe**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts`
Expected: PASS (tous).

- [ ] **Step 6: Migrer les fixtures et configs littérales du cœur**

Dans `packages/core/test/fixtures.ts`, les quatre configs deviennent :

```ts
export const shopConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
  },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
}
```

```ts
export const twoRootsConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Product: "$.products[*].id",
    Order: "$.orders[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.orders[*].productId", to: "$.products[*].id" },
  ],
  groups: ["Customer", "Product"],
}
```

```ts
export const chainConfig: DataGraphConfig = {
  ids: {
    Country: "$.countries[*].id",
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    LineItem: "$.lines[*].id",
  },
  refs: [
    { from: "$.customers[*].countryId", to: "$.countries[*].id" },
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.lines[*].orderId", to: "$.orders[*].id" },
  ],
  groups: ["Customer", "Country"],
}
```

```ts
export const bigShopReviewsConfig: DataGraphConfig = {
  ids: {
    Customer: "$.customers[*].id",
    Order: "$.orders[*].id",
    Review: "$.reviews[*].id",
  },
  refs: [
    { from: "$.orders[*].customerId", to: "$.customers[*].id" },
    { from: "$.reviews[*].customerId", to: "$.customers[*].id" },
  ],
  groups: ["Customer"],
}
```

Puis migrer TOUTES les configs littérales restantes des tests core via la recette (les trouver : `rg -ln "entities:" packages/core/test`). Attention aux points suivants :
- `build.test.ts` : le test « builds a plain structure tree » passe `{ entities: {} }` → `{ ids: {} }` ; les tests « invalid-config » citent `{}`/`{ entities: null }`/`{ entities: [] }` et les gardes par entrée — les réécrire sur la forme `ids` est INUTILE : ces cas sont maintenant couverts par le nouveau `config.test.ts` (Step 1). Supprimer de `build.test.ts` les tests de validation de config qui doublonnent, garder ceux qui exercent `buildGraph`.
- `references.test.ts` / `value-object-refs.test.ts` : toute assertion citant un chemin de déclaration (diagnostic `unresolved-reference`, `path`) passe au `from` absolu (ex. `Order.customerId` → `$.orders[*].customerId`). Les localiser : `rg -n "unresolved-reference|\.path" packages/core/test/references.test.ts packages/core/test/value-object-refs.test.ts`.
- Le test historique des clés exotiques (`@odata:id`) et des chemins relatifs de `parseReferenceKey` a déjà disparu avec la réécriture de `config.test.ts` (régression assumée par le spec).

- [ ] **Step 7: Suite core complète**

Run: `pnpm build && pnpm --filter @defsquare/data-graph-core test`
Expected: PASS. (Le build renderer échouera peut-être sur `config.entities` dans `create.ts` — c'est la Task 2 ; si `pnpm build` bloque, utiliser `pnpm --filter @defsquare/data-graph-core build` pour ce step et noter que la vérification croisée arrive en Task 2.)

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core)!: contrat data-first ids/refs/groups"
```

---

### Task 2: Renderer — `config.ids` et fixtures renderer

**Files:**
- Modify: `packages/renderer/src/create.ts:568-575` (accents) et sa JSDoc
- Modify: `packages/renderer/src/index.ts:61-71` (réexports)
- Modify: `packages/renderer/test/fixtures.ts:24,40` + configs littérales des tests (`array-token.test.ts:42`, `ref-indicator.test.ts:47`, …)

**Interfaces:**
- Consomme : `DataGraphConfig = { ids, refs?, groups?, maxNodes?, rootLabel? }` (Task 1).
- Produit : rien de nouveau — le renderer reste identique en comportement.

- [ ] **Step 1: `create.ts`**

À `packages/renderer/src/create.ts:573`, remplacer :

```ts
    entityAccents = entityAccentMap(Object.keys(config.entities), theme);
```

par :

```ts
    entityAccents = entityAccentMap(Object.keys(config.ids), theme);
```

et mettre à jour la JSDoc au-dessus (ligne ~570) : `config.entities` → `config.ids`.

- [ ] **Step 2: Réexports**

Dans `packages/renderer/src/index.ts`, retirer `EntityConfig` de la liste réexportée depuis `@defsquare/data-graph-core` (lignes 61-71) — le type n'existe plus.

- [ ] **Step 3: Migrer les fixtures/tests renderer**

Appliquer la recette à toutes les configs littérales : `rg -ln "entities:" packages/renderer/test` puis migration 1:1 (ex. `packages/renderer/test/array-token.test.ts:42` : `entities: { Product: { match: "$.products[*]", id: "id" } }` → `ids: { Product: "$.products[*].id" }`).

- [ ] **Step 4: Vérifier**

Run: `pnpm build && pnpm test`
Expected: PASS partout (core 150+ et renderer 241) — c'est la première fois que les deux paquets compilent ensemble sur le nouveau contrat.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer
git commit -m "feat(renderer)!: suivre le contrat data-first ids/refs/groups"
```

---

### Task 3: Démo — sample-data, launch, chrome, fixtures CLI, e2e

**Files:**
- Modify: `apps/demo/src/sample-data.ts:266-292` (les deux configs)
- Modify: `apps/demo/src/launch.ts:26-28`
- Modify: `apps/demo/src/main.ts:27-33`
- Modify: `apps/demo/fixtures/shop.config.json`
- Modify: configs littérales des e2e (`apps/demo/e2e/array-token.spec.ts:111`, `value-object-refs.spec.ts:30`, `view.spec.ts:42`)

**Interfaces:**
- Consomme : `DataGraphConfig` nouveau (Task 1), déjà réexporté par le renderer (Task 2).
- Produit : rien — comportement démo et e2e strictement identiques.

- [ ] **Step 1: Migrer les configs de la démo**

`apps/demo/src/sample-data.ts` : appliquer la recette aux deux configs (`shopConfig` ~ligne 266, `bigShopConfig` ~ligne 288). Rappel : `shopConfig` du sample déclare aussi `reviews[*].customerId` sur Order (chemin imbriqué) → `{ from: "$.orders[*].reviews[*].customerId", to: "$.customers[*].id" }` — vérifier le chemin réel dans le fichier avant d'écrire (lire les lignes 260-295).

`apps/demo/fixtures/shop.config.json` devient :

```json
{
  "ids": {
    "Customer": "$.customers[*].id",
    "Order": "$.orders[*].id"
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id" }
  ],
  "groups": ["Customer"]
}
```

- [ ] **Step 2: `launch.ts` et `main.ts`**

`apps/demo/src/launch.ts:26-28` : le commentaire et la synthèse passent à `ids` :

```ts
  // Sans `-c` : config vide = vue structure seule. `ids` absent est
  // impossible côté Rust (il n'envoie que du JSON validé), mais une config
  // vide reste le contrat du mode structure.
  const config: DataGraphConfig =
    payload.config === null ? { ids: {} } : (JSON.parse(payload.config) as DataGraphConfig);
```

`apps/demo/src/main.ts:27-33` : le check structure-only passe à `ids` (garder le commentaire existant en remplaçant `entities` par `ids`) :

```ts
  if (Object.keys(launch.config.ids ?? {}).length === 0) {
```

- [ ] **Step 3: Migrer les configs des e2e**

Appliquer la recette aux trois specs listés (configs passées à `setData` dans le navigateur). Ne toucher AUCUNE assertion : le comportement est identique.

- [ ] **Step 4: Vérifier**

Run: `pnpm typecheck && pnpm --filter @defsquare/data-graph build && pnpm --filter demo e2e`
Expected: typecheck PASS, e2e 24/24 sans modification d'assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src apps/demo/fixtures apps/demo/e2e
git commit -m "feat(demo)!: migrer la démo et les fixtures au contrat ids/refs/groups"
```

---

### Task 4: Rust `--help`, tests cargo, documentation

**Files:**
- Modify: `apps/demo/src-tauri/src/cli.rs:21,170,174`
- Modify: `README.md` (exemples et prose de config), `packages/core/README.md`, `packages/renderer/README.md`
- Modify: `CLAUDE.md` si une forme de config y apparaît (vérifier : `rg -n "entities" CLAUDE.md`)

**Interfaces:**
- Consomme : le contrat final (Tasks 1-3). Produit : docs cohérentes.

- [ ] **Step 1: `cli.rs`**

Ligne 21, le texte d'aide devient :

```rust
  -c <config.json>  Path to a JSON config declaring ids, refs
                    and groups. Without it, the document opens in
                    structure view only.
```

Lignes 170 et 174 (tests) : `{"entities": {}}` → `{"ids": {}}` dans les deux littéraux.

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: 12/12 PASS.

- [ ] **Step 2: READMEs**

Pour chacun des trois READMEs (`rg -n "entities|aggregates|references" README.md packages/core/README.md packages/renderer/README.md` pour tout localiser) :
- migrer chaque bloc de config d'exemple via la recette ;
- reformuler la prose : « entities/aggregates » → « ids/refs/groups » (parler de « keyed records », « joins », « groups » plutôt que d'entités/agrégats) ; le pitch racine « but for aggregates and entities, with real reference edges » devient « but for keyed records and real reference edges » ;
- ajouter au README racine, près de la doc de config, la limitation assumée : « Field keys that don't match the selector token grammar (e.g. `@odata:id`) can no longer be declared as reference fields. » ;
- la section **CLI usage** du README racine : « a JSON config declaring entities, references and aggregates » → « declaring ids, refs and groups ».

- [ ] **Step 3: Vérification globale finale**

Run: `pnpm typecheck && pnpm build && pnpm test && cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: tout PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/src-tauri README.md packages/core/README.md packages/renderer/README.md CLAUDE.md
git commit -m "docs!: contrat data-first ids/refs/groups dans l'aide CLI et les READMEs"
```
