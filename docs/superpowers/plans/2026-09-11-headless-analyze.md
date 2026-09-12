# Mode `--check` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `datagraph --check <data.json> -c <config.json> [--json]` construit le graphe, écrit un rapport sur stdout et sort avec un code — sans ouvrir de fenêtre.

**Architecture:** Une troisième entrée du cœur (`packages/core/src/validate.ts`) construit le rapport en TypeScript pur. Un script esbuild l'empaquette en un fichier ES unique **généré et commité** dans `apps/demo/src-tauri/generated/check.js`. Le binaire Rust l'embarque par `include_str!` et l'évalue dans un contexte QuickJS (`rquickjs`) borné en mémoire et en pile ; la frontière est une fonction JS qui prend deux chaînes et rend une chaîne. Rust ne désérialise que **son propre rapport**, pour le rendre en texte et pour le classer en code de sortie.

**Tech Stack:** TypeScript + vitest (cœur), esbuild (bundle), Rust + `cargo test` (`apps/demo/src-tauri`), `rquickjs` 0.9 (QuickJS), `serde` / `serde_json` (déjà en dépendances).

**Spec:** `docs/superpowers/specs/2026-09-11-headless-analyze-design.md` — à lire en entier avant la tâche 1. La conception y est tranchée ; ce plan ne la rouvre pas.

## Global Constraints

- **Anglais** pour tout ce qu'un développeur ou un utilisateur du CLI lit : commentaires de code (le « pourquoi », pas le « quoi »), noms de tests, messages de `throw`, `console.*`, `USAGE`, rapport texte et JSON. Le français reste réservé à la démo et au playground à l'écran, que cette fonctionnalité ne touche pas.
- **TDD** (`superpowers:test-driven-development`) : chaque tâche écrit le test d'abord, le voit échouer, puis écrit le code minimal. Les deux exceptions explicitement marquées sont les fichiers Rust neufs dont les tests ne compilent pas sans l'implémentation (même raisonnement que la tâche 2 du plan `2026-09-04-cli-enduser.md`).
- **Passe ADR avant chaque commit** (hook `.claude/hooks/adr-gate.sh`) : tout message de commit porte un trailer `ADR-Reviewed:`. ADR-0032 est créé en tâche 2 et l'index `docs/adr/README.md` est mis à jour dans le même commit.
- **Codes de sortie** : `0` config valide, `1` fichier illisible / JSON invalide (existant), `2` argument invalide (existant), `3` config invalide, `4` erreur interne. Une `GraphTooLargeError`, un préfixe de sélecteur qui ne résout pas et un `unresolved-reference` sortent en `3`. `dangling-ref`, `duplicate-id` et `missing-id` restent en `0`.
- **Le rapport JSON porte `"report": 1`.** Règle de compatibilité : ajouter un champ est permis, renommer ou retirer est une rupture qui incrémente le nombre.
- **Le bundle est généré et commité.** `cargo` ne dépend jamais de `pnpm` ; la fraîcheur est une affaire de test vitest, exactement comme `apps/demo/src/tokens.css`.
- **Aucune liaison d'hôte n'est injectée** dans le contexte QuickJS : la fermeture de validation n'attend ni `console`, ni timers, ni `fetch`, ni `Proxy`, ni `Symbol`, ni `async`.
- Commandes de vérification : `pnpm typecheck`, `pnpm build` puis `pnpm test` (vitest **et** `cargo test` via `apps/demo`), `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`.
- La première compilation Rust après la tâche 5 est longue : QuickJS est du C compilé par `rquickjs-sys`. Ce n'est pas un symptôme.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `packages/core/src/model.ts` *(modifié)* | Message de `GraphTooLargeError` passé en anglais. |
| `packages/core/src/validate.ts` *(créé)* | Le rapport, en TypeScript pur : `checkReport(data, config)` et `runCheck(dataText, configText)`. Fermeture volontairement étroite. Pas réexporté par `index.ts`. |
| `packages/core/scripts/check-entry.ts` *(créé)* | Deux lignes : l'entrée esbuild, qui pose `globalThis.__datagraph_check`. Jamais importée par le paquet. |
| `packages/core/scripts/check-bundle.ts` *(créé)* | `buildCheckBundle(): string` — la fonction pure, `esbuild.buildSync`. Calque de `renderTokensCss()`. |
| `packages/core/scripts/generate-check-bundle.ts` *(créé)* | Le script qui écrit. Calque de `packages/tokens/scripts/generate-css.ts`. |
| `packages/core/test/check.test.ts` *(créé)* | Couche 3 : la sémantique du rapport. Le gros de la couverture. |
| `packages/core/test/check-bundle.test.ts` *(créé)* | Couches 1 et 2 : pureté de la fermeture, fraîcheur du fichier commité. |
| `apps/demo/src-tauri/generated/check.js` *(généré, commité)* | Le bundle embarqué par `include_str!`. Jamais édité à la main. |
| `apps/demo/src-tauri/src/report.rs` *(créé)* | La forme du rapport côté Rust, `classify()` et `render_text()`. **Sans moteur** : testable sans compiler QuickJS. |
| `apps/demo/src-tauri/src/check.rs` *(créé)* | `run_check(data, config)` : le contexte QuickJS, ses bornes, la frontière à deux chaînes. Couches 4 et 5. |
| `apps/demo/src-tauri/src/cli.rs` *(modifié)* | Les drapeaux `--check` et `--json`, leurs règles, `USAGE`. |
| `apps/demo/src-tauri/src/main.rs` *(modifié)* | Le branchement, entre `load` et `run_with`. |
| `docs/adr/0032-embedded-core-for-headless-check.md` *(créé)* | La décision : embarquer le cœur plutôt que le porter ou ouvrir une fenêtre masquée. |

---

### Task 1: Cœur — le message de `GraphTooLargeError` passe en anglais

**Files:**
- Modify: `packages/core/src/model.ts` (dernières lignes, classe `GraphTooLargeError`)
- Test: `packages/core/test/build.test.ts:38-42`

**Interfaces:**
- Consumes: rien.
- Produces: `new GraphTooLargeError(count, max).message` vaut désormais
  `Graph exceeds maxNodes: <count> > <max> — raise "maxNodes" in the config (the CLI's -c option)`.
  La tâche 2 le recopie tel quel dans un `configErrors[].message`, et la tâche 6 le voit sortir d'un rapport.

Ce message est le seul du cœur resté en français. Il sortirait tel quel d'un rapport `--check`, y compris en `--json`, à côté de treize messages anglais.

- [ ] **Step 1: Durcir le test existant**

Dans `packages/core/test/build.test.ts`, remplacer le test des lignes 38-42 par :

```ts
  it("GraphTooLargeError says how to raise the cap, in English", () => {
    // The message travels: the demo paints it on its error screen and `--check`
    // prints it as a `graph-too-large` config error. It must name the lever
    // (`maxNodes` in the config) and it must read like the thirteen other core
    // messages — English, like the CLI that surfaces it.
    expect(() => buildGraph(bigShop(2000), { ...shopConfig, maxNodes: 100 })).toThrow(
      'Graph exceeds maxNodes: 101 > 100 — raise "maxNodes" in the config (the CLI\'s -c option)',
    )
  })
```

Si le compte `101` ne tombe pas juste, lire le nombre que vitest affiche dans l'échec du step 2 et le recopier : `countLogical` s'arrête au premier dépassement, la valeur est déterministe pour une fixture donnée.

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/build.test.ts`
Expected: FAIL — le message reçu est `… — relevez "maxNodes" dans la config (option -c de la CLI)`.

- [ ] **Step 3: Traduire le message**

Dans `packages/core/src/model.ts`, dans `GraphTooLargeError` :

```ts
export class GraphTooLargeError extends Error {
  constructor(public count: number, public max: number) {
    super(`Graph exceeds maxNodes: ${count} > ${max} — raise "maxNodes" in the config (the CLI's -c option)`)
    this.name = "GraphTooLargeError"
  }
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Suite complète**

Run: `pnpm build && pnpm test`
Expected: PASS. (`pnpm build` d'abord : `bundle-purity.test.ts` lit `dist/`.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/model.ts packages/core/test/build.test.ts
git commit -m "fix(core): message de GraphTooLargeError en anglais

ADR-Reviewed: none — correction de formulation, aucune décision d'architecture touchée."
```

---

### Task 2: Cœur — `validate.ts`, le constructeur de rapport, et l'ADR

**Files:**
- Create: `packages/core/src/validate.ts`
- Create: `packages/core/test/check.test.ts`
- Create: `docs/adr/0032-embedded-core-for-headless-check.md`
- Modify: `docs/adr/README.md` (dernière ligne du tableau)

**Interfaces:**
- Consumes: `buildGraph(data, config): Graph`, `parseSelector(s): PathSegment[]`, `matchesPath(segments, path): boolean`, `ConfigError`, `GraphTooLargeError`, `type Diagnostic`, `type Graph`, `type DataGraphConfig` — tous existants.
- Produces (utilisés par les tâches 3, 4 et 6) :
  - `checkReport(data: unknown, config: unknown): CheckReport`
  - `runCheck(dataText: string, configText: string): string` — JSON indenté de 2.
  - `interface CheckReport { report: 1; ok: boolean; configErrors: { code: string; message: string }[]; ids: Record<string, CheckIdEntry>; refs: CheckRefEntry[]; diagnostics: Diagnostic[]; totals: { nodes: number; logicalNodes: number; entities: number; refEdges: number } }`
  - `interface CheckIdEntry { selector: string; matched: number; pathResolves: boolean }`
  - `interface CheckRefEntry { from: string; to: string; matched: number; resolved: number; dangling: number }`
  - La tâche 4 déclare la forme miroir en Rust, champ pour champ, avec `rename_all = "camelCase"`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `packages/core/test/check.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { checkReport, runCheck } from "../src/validate.js"

/** The shape the whole feature rests on: two id declarations, one join. Counts
 * are stated literally rather than computed, so that a change in the build
 * traversal shows up here as a failing number instead of passing silently. */
const data = {
  customers: [{ id: "c1", name: "Ada" }, { id: "c2", name: "Alan" }],
  orders: [{ id: "o1", customerId: "c1" }, { id: "o2", customerId: "c2" }],
}
const config = {
  ids: { Customer: "$.customers[*].id", Order: "$.orders[*].id" },
  refs: [{ from: "$.orders[*].customerId", to: "$.customers[*].id" }],
  groups: ["Customer"],
}

describe("checkReport", () => {
  it("reports a valid config with its per-selector counts", () => {
    const report = checkReport(data, config)
    expect(report.report).toBe(1)
    expect(report.ok).toBe(true)
    expect(report.configErrors).toEqual([])
    expect(report.ids).toEqual({
      Customer: { selector: "$.customers[*].id", matched: 2, pathResolves: true },
      Order: { selector: "$.orders[*].id", matched: 2, pathResolves: true },
    })
    expect(report.refs).toEqual([
      {
        from: "$.orders[*].customerId",
        to: "$.customers[*].id",
        matched: 2,
        resolved: 2,
        dangling: 0,
      },
    ])
    expect(report.diagnostics).toEqual([])
    // 7 graph nodes: the root, the two arrays, the four records. 15 logical
    // nodes: the same 7 plus the 8 scalar rows (`id` and `name` on each
    // customer, `id` and `customerId` on each order). The second number is the
    // one `maxNodes` bounds, so it is the one comparable to what
    // `GraphTooLargeError` quotes.
    expect(report.totals).toEqual({ nodes: 7, logicalNodes: 15, entities: 4, refEdges: 2 })
  })

  it("keeps a selector that matches nothing valid when its prefix resolves", () => {
    // `$.orders[*].id` over an empty `orders` array correctly describes an empty
    // collection. This is the distinction the `jq` pre-flight could not make.
    const report = checkReport({ customers: [{ id: "c1" }], orders: [] }, config)
    expect(report.ids.Order).toEqual({ selector: "$.orders[*].id", matched: 0, pathResolves: true })
    expect(report.ok).toBe(true)
  })

  it("flags a selector whose prefix does not resolve", () => {
    const report = checkReport(data, { ids: { Produit: "$.produits[*].id" } })
    expect(report.ids.Produit).toEqual({
      selector: "$.produits[*].id",
      matched: 0,
      pathResolves: false,
    })
    expect(report.ok).toBe(false)
  })

  it("flags an unresolved reference declaration", () => {
    const report = checkReport({ customers: [{ id: "c1" }], orders: [{ id: "o1" }] }, config)
    expect(report.refs[0]).toEqual({
      from: "$.orders[*].customerId",
      to: "$.customers[*].id",
      matched: 0,
      resolved: 0,
      dangling: 0,
    })
    expect(report.diagnostics.map((d) => d.code)).toEqual(["unresolved-reference"])
    expect(report.ok).toBe(false)
  })

  it("keeps dangling references valid and reports the ratio", () => {
    // A foreign key pointing at nothing is a hole in the DATA: the config cannot
    // repair it, so the exit code must not blame it.
    const report = checkReport(
      { customers: [{ id: "c1" }], orders: [{ id: "o1", customerId: "c9" }] },
      config,
    )
    expect(report.refs[0]).toMatchObject({ matched: 1, resolved: 0, dangling: 1 })
    expect(report.diagnostics.map((d) => d.code)).toEqual(["dangling-ref"])
    expect(report.ok).toBe(true)
  })

  it("keeps duplicate and missing ids valid, as data diagnostics", () => {
    const duplicate = checkReport({ customers: [{ id: "c1" }, { id: "c1" }], orders: [] }, config)
    expect(duplicate.diagnostics.map((d) => d.code)).toEqual(["duplicate-id"])
    expect(duplicate.ok).toBe(true)

    const missing = checkReport({ customers: [{ name: "Ada" }], orders: [] }, config)
    expect(missing.diagnostics.map((d) => d.code)).toEqual(["missing-id"])
    expect(missing.ok).toBe(true)
  })

  it("turns a ConfigError into a report instead of an exception", () => {
    const report = checkReport(data, { ids: { Produit: "produits[*].id" } })
    expect(report.ok).toBe(false)
    expect(report.configErrors).toEqual([
      { code: "selector-syntax", message: 'Selector must start with "$": produits[*].id' },
    ])
    // The shape stays stable even when nothing could be built: a consumer reads
    // the same fields whatever the outcome. Both counts are 0, and that is the
    // honest report — the document was never walked.
    expect(report.ids).toEqual({})
    expect(report.refs).toEqual([])
    expect(report.diagnostics).toEqual([])
    expect(report.totals).toEqual({ nodes: 0, logicalNodes: 0, entities: 0, refEdges: 0 })
  })

  it("covers both failure paths of the selector regex", () => {
    expect(checkReport(data, { ids: { X: "$.orders[1x].id" } }).configErrors[0]?.message).toBe(
      'Invalid selector near "[1x].id" in $.orders[1x].id',
    )
    expect(checkReport(data, { ids: { X: "$.orders[*].@id" } }).configErrors[0]?.message).toBe(
      'Invalid selector near ".@id" in $.orders[*].@id',
    )
  })

  it("reports GraphTooLargeError as a config error, not as a crash", () => {
    // `maxNodes` IS a config field and the message names it: the user fixes this
    // by editing the config, which is exactly what exit 3 means.
    const report = checkReport(data, { ...config, maxNodes: 3 })
    expect(report.ok).toBe(false)
    expect(report.configErrors[0]?.code).toBe("graph-too-large")
    expect(report.configErrors[0]?.message).toContain('raise "maxNodes" in the config')
  })

  it("lets an unexpected failure travel as an exception", () => {
    // Anything the core did not declare is a bug or an exhausted engine. It must
    // NOT become a report: telling an agent its config is wrong when the fault is
    // ours condemns it to edit a correct file forever. A getter that blows up
    // imitates exactly that — a failure the core never promised.
    const exploding = {
      ids: { Customer: "$.customers[*].id" },
      get refs(): never {
        throw new RangeError("boom")
      },
    }
    expect(() => checkReport(data, exploding)).toThrow(RangeError)
  })
})

describe("runCheck", () => {
  it("takes two strings and returns the report as one string", () => {
    const out = runCheck(JSON.stringify(data), JSON.stringify(config))
    expect(typeof out).toBe("string")
    const parsed = JSON.parse(out)
    expect(parsed.report).toBe(1)
    expect(parsed.ok).toBe(true)
    expect(parsed.totals).toEqual({ nodes: 7, logicalNodes: 15, entities: 4, refEdges: 2 })
  })
})
```

Un mot sur le dernier test : `checkReport(data, null)` **ne** ferait **pas** l'affaire, parce que `validateConfig` lève alors une `ConfigError` `invalid-config`, qui est justement rattrapée. Il faut une défaillance que le cœur n'a jamais promise, d'où le getter qui explose.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/check.test.ts`
Expected: FAIL — `Cannot find module '../src/validate.js'`.

- [ ] **Step 3: Écrire `packages/core/src/validate.ts`**

```ts
/**
 * Third entry point of the core: the `--check` report.
 *
 * This module is bundled by `scripts/generate-check-bundle.ts` into the JavaScript
 * the `datagraph` binary embeds, so its import closure is DELIBERATELY narrow —
 * `build.ts`, `config.ts`, `selector.ts`, `model.ts` and nothing else. Reaching
 * `structure-layout.ts` would drag elkjs into a 6.5 kB bundle;
 * `test/check-bundle.test.ts` is what says so out loud instead of letting it
 * happen silently.
 *
 * It is NOT re-exported by `index.ts`: the package publishes what consumers
 * consume (ADR-0023), and the only consumer here is the bundler.
 */

import { buildGraph } from "./build.js"
import type { DataGraphConfig } from "./config.js"
import { GraphTooLargeError, type Diagnostic, type Graph } from "./model.js"
import { ConfigError, matchesPath, parseSelector, type PathSegment } from "./selector.js"

export interface CheckIdEntry {
  selector: string
  matched: number
  /**
   * Whether the INSTANCE PREFIX of the selector designates anything in this
   * document — `$.customers[*]` for `$.customers[*].id`.
   *
   * Deliberately distinct from `matched > 0`: `$.orders[*].id` over an empty
   * `orders` array matches nothing and is still a correct declaration of an
   * empty collection, whereas `$.produits[*].id` over a document with no
   * `produits` key is a config bug. Only the second one is an error, and that
   * distinction is the whole reason this field exists next to `matched`.
   */
  pathResolves: boolean
}

export interface CheckRefEntry {
  from: string
  to: string
  matched: number
  resolved: number
  dangling: number
}

export interface CheckReport {
  /**
   * Wire version. It goes against YAGNI on purpose: the consumer is a skill file
   * sitting on someone's disk, which is not updated with the binary. A version
   * does not repair a break, it makes it diagnosable. Associated rule: ADDING a
   * field is allowed, renaming or removing one is a break and bumps this number.
   */
  report: 1
  /**
   * True iff nothing here can be fixed by editing the config. This is the SINGLE
   * home of the exit-code rule: Rust's `classify` only turns it into 0 or 3, so
   * the rule never exists in two languages at once.
   */
  ok: boolean
  configErrors: { code: string; message: string }[]
  ids: Record<string, CheckIdEntry>
  refs: CheckRefEntry[]
  diagnostics: Diagnostic[]
  /**
   * Two counts, not one, and confusing them would trap the very consumer this
   * mode is for. `nodes` is the size of the graph, in the same unit as
   * `entities` and `refEdges`. `logicalNodes` counts the scalar rows on top, and
   * it is THE ONLY ONE `maxNodes` bounds — `build.ts` throws
   * `GraphTooLargeError(logicalNodeCount, maxNodes)`. With only `nodes`, an agent
   * that hit the cap reads `1000001 > 1000000` in the message, retries with a
   * raised bound, gets `nodes: 350000`, and has no way to relate the two numbers
   * or to see it was anywhere near the limit.
   */
  totals: { nodes: number; logicalNodes: number; entities: number; refEdges: number }
}

/** The boundary the binary calls: two strings in, one string out. */
export function runCheck(dataText: string, configText: string): string {
  const report = checkReport(JSON.parse(dataText), JSON.parse(configText))
  return JSON.stringify(report, null, 2)
}

export function checkReport(data: unknown, config: unknown): CheckReport {
  const typed = config as DataGraphConfig
  let graph: Graph
  try {
    graph = buildGraph(data, typed)
  } catch (error) {
    // Only the core's two DECLARED failures become a report. `ConfigError` is a
    // wrong declaration; `GraphTooLargeError` names `maxNodes`, a config field,
    // so it too is fixed by editing the config. Anything else keeps travelling
    // as an exception, which is how the binary exits 4 instead of 3.
    if (error instanceof ConfigError) return failed(error.code, error.message)
    if (error instanceof GraphTooLargeError) return failed("graph-too-large", error.message)
    throw error
  }

  const ids = analyzeIds(data, typed, graph)
  const refs = analyzeRefs(typed, graph)
  const diagnostics = graph.diagnostics

  let entities = 0
  for (const byId of graph.entityIndex.values()) entities += byId.size

  const ok =
    Object.values(ids).every((entry) => entry.pathResolves) &&
    !diagnostics.some((d) => d.code === "unresolved-reference")

  return {
    report: 1,
    ok,
    configErrors: [],
    ids,
    refs,
    diagnostics,
    // `nodes` shares a unit with `entities` and `refEdges`; `logicalNodes` is the
    // one `maxNodes` bounds, hence the one comparable to the number
    // `GraphTooLargeError` quotes. Both, because neither answers the other's
    // question.
    totals: {
      nodes: graph.nodes.size,
      logicalNodes: graph.logicalNodeCount,
      entities,
      refEdges: graph.refEdges.length,
    },
  }
}

/** A failed report keeps the FULL shape: a consumer reads the same fields
 * whatever the outcome, and never has to branch on presence. Both counts are 0
 * because no graph was built — which is exactly what a reader should conclude
 * from reading zero there. */
function failed(code: string, message: string): CheckReport {
  return {
    report: 1,
    ok: false,
    configErrors: [{ code, message }],
    ids: {},
    refs: [],
    diagnostics: [],
    totals: { nodes: 0, logicalNodes: 0, entities: 0, refEdges: 0 },
  }
}

function analyzeIds(
  data: unknown,
  config: DataGraphConfig,
  graph: Graph,
): Record<string, CheckIdEntry> {
  const ids: Record<string, CheckIdEntry> = {}
  for (const [name, selector] of Object.entries(config.ids)) {
    const segments = parseSelector(selector)
    // Everything but the last segment: the key field names a ROW, the prefix
    // names the instances — the same split `validateConfig` makes.
    const prefix = segments.slice(0, -1)
    let matched = 0
    for (const node of graph.nodes.values()) if (matchesPath(prefix, node.path)) matched++
    ids[name] = { selector, matched, pathResolves: resolves(data, prefix) }
  }
  return ids
}

function analyzeRefs(config: DataGraphConfig, graph: Graph): CheckRefEntry[] {
  return (config.refs ?? []).map((ref) => {
    const fromSegments = parseSelector(ref.from)
    let matched = 0
    let resolved = 0
    let dangling = 0
    for (const edge of graph.refEdges) {
      const holder = graph.nodes.get(edge.from)
      if (!holder) continue
      // An edge belongs to this declaration when the ABSOLUTE path of the row it
      // carries matches `from`. Attributing by field name alone would merge two
      // declarations ending on the same key under different prefixes, and
      // `RefEdge` deliberately does not carry the declaration that produced it.
      if (!matchesPath(fromSegments, [...holder.path, edge.field])) continue
      matched++
      if (edge.dangling) dangling++
      else resolved++
    }
    return { from: ref.from, to: ref.to, matched, resolved, dangling }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Does this path designate anything in THIS document?
 *
 * Walks the raw data rather than the graph, because the question is about the
 * document's shape and not about what got built. Two rules carry the whole
 * distinction the exit code rests on: a key that exists nowhere fails, while a
 * wildcard over an EMPTY container succeeds — the container is there, it is just
 * empty, and there is nothing left to disprove below it.
 */
function resolves(data: unknown, segments: PathSegment[]): boolean {
  let current: unknown[] = [data]
  for (const segment of segments) {
    if (segment.kind === "key") {
      const key = segment.key
      const next = current.filter(isRecord).filter((v) => key in v).map((v) => v[key])
      if (next.length === 0) return false
      current = next
    } else if (segment.kind === "index") {
      const index = segment.index
      const next = current
        .filter((v): v is unknown[] => Array.isArray(v))
        .map((a) => a[index])
        .filter((v) => v !== undefined)
      if (next.length === 0) return false
      current = next
    } else {
      const containers = current.filter((v) => Array.isArray(v) || isRecord(v))
      if (containers.length === 0) return false
      current = containers.flatMap((v) =>
        Array.isArray(v) ? v : Object.values(v as Record<string, unknown>),
      )
      if (current.length === 0) return true
    }
  }
  return true
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/check.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. `src/validate.ts` est couvert par `"include": ["src", "test"]` du `tsconfig.json` du cœur.

- [ ] **Step 6: Écrire l'ADR**

Créer `docs/adr/0032-embedded-core-for-headless-check.md` :

```markdown
# ADR-0032 — The `--check` report runs the core inside an embedded JS engine

**Date**: 2026-09-11
**Status**: Accepted

## Context

`datagraph` had one output: a window. `cli.rs` validates JSON *syntax* only, on
purpose — the TypeScript core is the single source of truth for the config
contract (ADR-0004, superseded by ADR-0022). A semantically invalid config was
therefore reported in-app, on a screen an agent never sees. The agent that had
just written that config believed it had succeeded.

The `datagraph` skill worked around the hole by translating every selector into
`jq` and checking the match was non-empty. `jq` can say that a path matches; it
cannot say that a reference resolves.

## Decision

`datagraph --check <data.json> -c <config.json> [--json]` builds the graph, prints
a report on stdout and exits with a code, without opening a window.

The binary carries the validation itself, without reimplementing it:

- `packages/core/src/validate.ts` is a third entry point of the core, whose import
  closure is `selector.ts` → `config.ts` → `build.ts` + `model.ts`. Measured: 6.5 kB
  minified, no host global expected, bare ES2020.
- `packages/core/scripts/generate-check-bundle.ts` bundles it with esbuild into
  `apps/demo/src-tauri/generated/check.js`, **generated and committed**,
  non-minified. `include_str!` needs the file at Rust compile time, and making
  cargo depend on pnpm would order two toolchains that have no reason to know each
  other. The same contract as `apps/demo/src/tokens.css` (ADR-0027): a freshness
  test compares byte for byte.
- The binary evaluates it in **QuickJS** (`rquickjs`), with a memory bound and a
  stack bound on the context. Nothing is injected: the boundary is one function,
  two strings in, one string out.

The exit code answers one question — *can I fix this by editing the config?* `0`
valid, `3` invalid config, `4` internal error, on top of the existing `1` and `2`.
A `GraphTooLargeError`, an unresolved selector prefix and an `unresolved-reference`
are config bugs. A dangling foreign key, a duplicate id and a missing id are holes
in the DATA and stay at `0`.

## Alternatives considered

- **A hidden Tauri window** — no new dependency, but it starts a rendering engine
  to print text, makes the exit code asynchronous, needs a display server on Linux,
  and routes validation through the renderer when it must stay dry. Defensible if
  the bundle had weighed 500 kB. At 6.5 kB, no.
- **Porting the validation to Rust** — examined seriously, with a differential test
  corpus to prevent drift. The technique is sound and solves the wrong problem: it
  detects divergence, it does not write the Rust. ~590 dense lines to port, plus 14
  error messages the demo paints verbatim. What decided it is churn: 19 commits on
  `config.ts` + `build.ts` in the last 30 days, two of them breaking. The door stays
  open — once the contract stabilises, the port becomes mechanical, and the corpus
  will then be generated from a running implementation instead of hand-written
  against a spec.
- **Boa instead of QuickJS** — a spike compared both on seven cases and four tiers.
  Output identical byte for byte; Boa 2.7× to 6.5× slower. Memory decided: 1854 MB
  at the 1M-node tier, above the ~1.5 GB target that fixed `maxNodes` at 1,000,000.
  QuickJS holds at 569 MB. Boa remains a documented fallback whose correctness the
  spike established.
- **An MCP server** — ruled out while the consumer is Claude Code: the skill plus
  Bash is enough.

## Consequences

- **The config contract has exactly one implementation.** The 14 `ConfigError`
  messages read identically in `--check` and on the app's error screen. No
  translation layer.
- **`cargo build` now compiles QuickJS in C**, which lengthens the first build.
  `rquickjs` 0.9 also raises the crate's `rust-version` to 1.81.
- **A change to the validation closure that is not regenerated breaks `pnpm test`.**
  That is the explicit price of the committed artifact, and the only thing that
  keeps the bundle from drifting away from the core.
- **`validate.ts` must not gain an import.** One reaching `structure-layout.ts`
  would bring elkjs into the binary, +1.5 MB, silently. A purity test walks the
  closure recursively, like `bundle-purity.test.ts` does for `graph-layout`.
- **The report is a public wire format**, versioned by `report: 1`. Its consumer
  is a skill file on someone's disk, not updated with the binary: adding a field
  is allowed, renaming or removing one is a break.
- Deliberately out of scope: rich data analysis (degrees, connected components,
  cycles, orphans). The report is shaped to take it without breaking.
```

- [ ] **Step 7: Mettre à jour l'index des ADR**

Dans `docs/adr/README.md`, ajouter à la fin du tableau :

```markdown
| 0032 | [The `--check` report runs the core inside an embedded JS engine](./0032-embedded-core-for-headless-check.md) | 2026-09-11 | Accepted |
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/validate.ts packages/core/test/check.test.ts docs/adr/0032-embedded-core-for-headless-check.md docs/adr/README.md
git commit -m "feat(core): validate.ts — le rapport --check, en TypeScript pur

ADR-Reviewed: ADR-0032 créé (cœur embarqué pour le mode --check headless), index mis à jour. ADR-0023 relu : validate.ts n'entre pas dans index.ts, la surface publique ne bouge pas."
```

---

### Task 3: Cœur — génération du bundle, fichier commité, tests de pureté et de fraîcheur

**Files:**
- Create: `packages/core/scripts/check-entry.ts`
- Create: `packages/core/scripts/check-bundle.ts`
- Create: `packages/core/scripts/generate-check-bundle.ts`
- Create: `packages/core/test/check-bundle.test.ts`
- Create: `apps/demo/src-tauri/generated/check.js` (généré, commité)
- Modify: `packages/core/package.json` (script `generate:check`, devDependency `esbuild`)
- Modify: `packages/core/tsconfig.json` (`include` gagne `"scripts"`)

**Interfaces:**
- Consumes: `runCheck` (tâche 2).
- Produces (utilisés par la tâche 5) :
  - `buildCheckBundle(): string` depuis `packages/core/scripts/check-bundle.js`
  - `CHECK_BUNDLE_BANNER: string` — l'en-tête du fichier généré.
  - Le fichier `apps/demo/src-tauri/generated/check.js`, qui pose `globalThis.__datagraph_check = (dataText, configText) => string`.

Le calque exact est `packages/tokens/scripts/generate-css.ts` + `packages/tokens/test/css.test.ts` : lire les deux avant de commencer. La seule divergence est la place de la fonction pure. `renderTokensCss()` vit dans `src/` parce qu'elle est aussi un export publié (`./css`) ; `buildCheckBundle()` ne peut pas y vivre — elle importe `esbuild`, une devDependency Node-only qui n'a rien à faire dans la fermeture du paquet publié. Elle vit donc dans `scripts/`, avec le script qui l'appelle.

- [ ] **Step 1: Ajouter esbuild en devDependency explicite**

Run: `pnpm --filter @defsquare/data-graph-core add -D esbuild`

Il n'y est aujourd'hui qu'en transitif via tsup, et un test qui compare des octets ne peut pas dépendre d'une version qui bouge dans le dos.

- [ ] **Step 2: Déclarer le script et étendre le tsconfig**

Dans `packages/core/package.json`, dans `"scripts"`, après `"build"` :

```json
    "generate:check": "tsx scripts/generate-check-bundle.ts",
```

Dans `packages/core/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "scripts"]
}
```

- [ ] **Step 3: Écrire les tests qui échouent**

Créer `packages/core/test/check-bundle.test.ts` :

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { buildCheckBundle } from "../scripts/check-bundle.js"

/**
 * Layer 1 of the `--check` test plan: the closure of `validate.ts` must stay
 * narrow. Without this, an import added there brings elkjs into the binary — a
 * 6.5 kB bundle becomes 1.5 MB — with nothing to signal it.
 *
 * The march is RECURSIVE over relative imports, the same shape as
 * `bundle-purity.test.ts`, and it walks the SOURCES rather than `dist/`:
 * `validate.ts` is not a tsup entry point, it only ever exists as a bundle.
 */
describe("check bundle purity", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url))

  function closureOf(entry: string): Map<string, string> {
    const files = new Map<string, string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (files.has(file)) continue
      const source = readFileSync(file, "utf8")
      files.set(file, source)
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1]!
        expect(specifier.startsWith("."), `${file} imports the package "${specifier}"`).toBe(true)
        queue.push(join(dirname(file), specifier.replace(/\.js$/, ".ts")))
      }
    }
    return files
  }

  it("reaches build, config, selector and model — and nothing else", () => {
    const closure = closureOf(join(srcDir, "validate.ts"))
    const names = [...closure.keys()].map((file) => file.slice(srcDir.length + 1)).sort()
    expect(names).toEqual(["build.ts", "config.ts", "model.ts", "selector.ts", "validate.ts"])
  })

  it("expects no host global", () => {
    // The engine that runs this bundle starts on a bare ES: `console`, timers and
    // `fetch` exist only if someone adds them. The measurement that made the whole
    // design viable was that there is nothing to add — this test is what keeps it
    // true.
    const closure = closureOf(join(srcDir, "validate.ts"))
    for (const [file, source] of closure) {
      expect(source, `${file} expects a host global`).not.toMatch(
        /\b(console|process|structuredClone|Proxy|Symbol|setTimeout|fetch)\b/,
      )
      expect(source, `${file} uses an async construct`).not.toMatch(/\b(async|await)\b|function\*/)
    }
  })
})

/**
 * Layer 2: the committed file is the one the binary embeds. Same contract as
 * `apps/demo/src/tokens.css` (ADR-0027) — generated AND committed, because
 * `include_str!` needs it at Rust compile time and cargo must never depend on
 * pnpm. This test is the guard against forgetting to regenerate.
 */
describe("generated check.js", () => {
  const committed = fileURLToPath(
    new URL("../../../apps/demo/src-tauri/generated/check.js", import.meta.url),
  )

  it("is up to date (byte for byte)", () => {
    expect(readFileSync(committed, "utf8")).toBe(buildCheckBundle())
  })

  it("exposes the boundary the binary calls", () => {
    const bundle = readFileSync(committed, "utf8")
    expect(bundle).toContain("globalThis.__datagraph_check")
    expect(bundle).toContain("GENERATED FILE")
  })

  it("stays small enough that nobody has to wonder", () => {
    // Not minified on purpose: 16 kB instead of 6.5 weighs nothing against a
    // 9.2 MB binary, and buys a diff that can be reviewed plus a test failure that
    // can be read. The ceiling is here to catch a dependency creeping in, not to
    // police bytes.
    expect(readFileSync(committed, "utf8").length).toBeLessThan(64 * 1024)
  })
})
```

- [ ] **Step 4: Vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/check-bundle.test.ts`
Expected: FAIL — `Cannot find module '../scripts/check-bundle.js'`.

- [ ] **Step 5: Écrire l'entrée du bundle**

Créer `packages/core/scripts/check-entry.ts` :

```ts
/**
 * Entry point of the bundle the `datagraph` binary embeds. Never imported by the
 * package itself — its only job is to publish the boundary as a global, because
 * an embedded engine has no module loader to reach an export through.
 *
 * Kept apart from `src/validate.ts` so that module stays free of side effects and
 * remains directly unit-testable.
 */
import { runCheck } from "../src/validate.js"

;(globalThis as unknown as { __datagraph_check: typeof runCheck }).__datagraph_check = runCheck
```

- [ ] **Step 6: Écrire le générateur pur**

Créer `packages/core/scripts/check-bundle.ts` :

```ts
/**
 * The pure generator, separated from the script that writes — same split as
 * `renderTokensCss()` and `packages/tokens/scripts/generate-css.ts`. `buildSync`
 * rather than `build`, so the freshness test stays a plain synchronous
 * comparison.
 */

import { buildSync } from "esbuild"
import { fileURLToPath } from "node:url"

export const CHECK_BUNDLE_BANNER = `// GENERATED FILE — do not edit.
// Run \`pnpm --filter @defsquare/data-graph-core generate:check\` after any change to
// the validation closure (validate.ts, build.ts, config.ts, selector.ts, model.ts).
// Embedded verbatim in the datagraph binary by \`include_str!\`, see
// apps/demo/src-tauri/src/check.rs. Freshness: packages/core/test/check-bundle.test.ts.`

export function buildCheckBundle(): string {
  const entry = fileURLToPath(new URL("./check-entry.ts", import.meta.url))
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    // `iife` because the engine evaluates this as a SCRIPT in global scope: no
    // module loader is wired, which is the whole point of the bare-ES posture.
    format: "iife",
    // The measured floor of what the closure uses: `Map`, `Set`, `class extends`,
    // `??`, `?.`. Anything lower would make esbuild down-level and grow the file
    // for an engine that does not need it.
    target: "es2020",
    platform: "neutral",
    charset: "utf8",
    legalComments: "none",
    // Not minified: 16 kB instead of 6.5 is nothing against a 9.2 MB binary, and
    // it buys a reviewable diff and a readable test failure.
    minify: false,
    banner: { js: CHECK_BUNDLE_BANNER },
  })
  const file = result.outputFiles[0]
  if (!file) throw new Error("esbuild produced no output for the check bundle")
  return file.text
}
```

- [ ] **Step 7: Écrire le script qui écrit**

Créer `packages/core/scripts/generate-check-bundle.ts` :

```ts
/**
 * Writes `apps/demo/src-tauri/generated/check.js` from the core's validation
 * closure.
 *
 * The file is generated AND committed: `include_str!` needs it to exist at Rust
 * compile time, and making cargo depend on pnpm would impose an order between two
 * toolchains that have no reason to know each other. That order is not resolved
 * here, it is removed. The freshness test (`test/check-bundle.test.ts`) is the
 * guard against forgetting to regenerate.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { buildCheckBundle } from "./check-bundle.js"

const target = fileURLToPath(
  new URL("../../../apps/demo/src-tauri/generated/check.js", import.meta.url),
)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, buildCheckBundle())
console.log(`written: ${target}`)
```

- [ ] **Step 8: Générer le bundle**

Run: `pnpm --filter @defsquare/data-graph-core generate:check`
Expected: `written: …/apps/demo/src-tauri/generated/check.js`.

Puis relire le fichier produit : il doit commencer par la bannière, contenir `globalThis.__datagraph_check` près de la fin, et ne citer ni `elk` ni `import` de paquet. Si esbuild échoue à résoudre `../src/validate.js`, c'est que la réécriture TypeScript `.js` → `.ts` ne s'est pas appliquée : vérifier que l'entrée est bien un `.ts` (esbuild ne fait cette réécriture que pour un importateur TypeScript).

- [ ] **Step 9: Vérifier que les tests passent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/check-bundle.test.ts`
Expected: PASS (5 tests).

Si `expects no host global` échoue sur un mot présent dans un commentaire plutôt que dans du code, ne pas affaiblir la regex : reformuler le commentaire. Le test lit la source entière, et c'est bien ainsi — un commentaire qui parle de `console` dans cette fermeture est un signal, pas un faux positif.

- [ ] **Step 10: Suite complète et typecheck**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/scripts packages/core/test/check-bundle.test.ts packages/core/package.json packages/core/tsconfig.json apps/demo/src-tauri/generated/check.js pnpm-lock.yaml
git commit -m "feat(core): bundle de validation généré et commité pour le binaire

ADR-Reviewed: ADR-0032 relu — le fichier généré-et-commité et la promotion d'esbuild en devDependency y sont décrits, rien à créer. ADR-0027 relu : même contrat que tokens.css, non superseded."
```

---

### Task 4: Rust — `report.rs`, la forme du rapport, `classify` et le rendu texte

**Files:**
- Create: `apps/demo/src-tauri/src/report.rs`
- Modify: `apps/demo/src-tauri/src/lib.rs:1` (ajout de `pub mod report;`)

**Interfaces:**
- Consumes: la forme JSON produite par `runCheck` (tâche 2), `serde` + `serde_json` (déjà en dépendances).
- Produces (utilisés par les tâches 5 et 6) :
  - `report::Report` et ses membres `ConfigErrorEntry`, `IdEntry`, `RefEntry`, `DiagnosticEntry`, `Totals`
  - `report::parse(json: &str) -> Result<Report, String>`
  - `report::classify(report: &Report) -> i32`
  - `report::render_text(report: &Report) -> String`
  - `report::{EXIT_OK, EXIT_INVALID_CONFIG, EXIT_INTERNAL}`

Ce module est **pur** : aucun moteur. C'est ce qui permet de tester le mapping des codes de sortie et tout le rendu sans compiler QuickJS, et c'est pour cela qu'il est écrit avant `check.rs`.

- [ ] **Step 1: Écrire le module avec ses tests**

Créer `apps/demo/src-tauri/src/report.rs` :

```rust
//! The `--check` report, Rust side: the wire shape, the exit-code rule and the
//! text rendering.
//!
//! NO engine here. Keeping this module pure is what lets the exit codes and the
//! whole rendering be unit-tested without compiling QuickJS, and it is the line
//! the test plan draws: SEMANTICS are tested in TypeScript, the BOUNDARY is
//! tested in Rust. Duplicating the semantic corpus on this side would recreate
//! the two-language tax that refusing the Rust port avoided.

use serde::Deserialize;
use std::collections::BTreeMap;

/// The exit code answers ONE question: can the user fix this by editing the
/// config? `1` (unreadable file) and `2` (bad argument) are `main.rs`'s and
/// predate this mode.
pub const EXIT_OK: i32 = 0;
pub const EXIT_INVALID_CONFIG: i32 = 3;
pub const EXIT_INTERNAL: i32 = 4;

/// Text mode lists at most this many diagnostics. A document with ten thousand
/// dangling references must not scroll a terminal off its own report; `--json`
/// still carries every one of them.
const MAX_LISTED_DIAGNOSTICS: usize = 20;

#[derive(Debug, Deserialize)]
pub struct ConfigErrorEntry {
  pub code: String,
  pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdEntry {
  pub selector: String,
  pub matched: u64,
  pub path_resolves: bool,
}

#[derive(Debug, Deserialize)]
pub struct RefEntry {
  pub from: String,
  pub to: String,
  pub matched: u64,
  pub resolved: u64,
  pub dangling: u64,
}

#[derive(Debug, Deserialize)]
pub struct DiagnosticEntry {
  pub code: String,
  pub path: String,
  pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
  /// The size of the graph, in the same unit as `entities` and `ref_edges`.
  pub nodes: u64,
  /// The same nodes plus the scalar rows, and THE ONLY COUNT `maxNodes` bounds:
  /// it is what `GraphTooLargeError` quotes, so it is the only one an agent that
  /// hit the cap can compare its retry against.
  pub logical_nodes: u64,
  pub entities: u64,
  pub ref_edges: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
  /// Wire version. Carried, not asserted on: the binary owns the bundle that
  /// produced it, so a mismatch here would mean the build is inconsistent with
  /// itself. The field exists for the SKILL FILE reading this output, which is
  /// not updated with the binary.
  pub report: u32,
  pub ok: bool,
  pub config_errors: Vec<ConfigErrorEntry>,
  /// A `BTreeMap`, so the text rendering is alphabetical and therefore stable
  /// between runs. The JSON is printed verbatim and keeps the config's own
  /// declaration order — the two orders differ on purpose, each serving its
  /// reader.
  pub ids: BTreeMap<String, IdEntry>,
  pub refs: Vec<RefEntry>,
  pub diagnostics: Vec<DiagnosticEntry>,
  pub totals: Totals,
}

pub fn parse(json: &str) -> Result<Report, String> {
  serde_json::from_str(json).map_err(|e| format!("report is not the expected shape: {e}"))
}

/// `ok` is computed once, in TypeScript (`validate.ts`), so the rule has a single
/// home. Here it only becomes a process code — deriving it again from the
/// report's contents would put the same rule in two languages, which is exactly
/// what embedding the core was meant to avoid.
pub fn classify(report: &Report) -> i32 {
  if report.ok {
    EXIT_OK
  } else {
    EXIT_INVALID_CONFIG
  }
}

pub fn render_text(report: &Report) -> String {
  let mut out = String::new();

  if report.ok {
    let resolved: u64 = report.refs.iter().map(|entry| entry.resolved).sum();
    out.push_str(&format!(
      "✓ config valid — {} entities, {} references resolved\n",
      report.totals.entities, resolved
    ));
  } else {
    out.push_str("✗ config invalid\n");
  }

  out.push('\n');
  // Everything between this mark and the diagnostics is one block: `errors`,
  // `ids` and `refs` read as a single table, so they are not separated from one
  // another — only from the verdict above and the diagnostics below.
  let mark = out.len();

  if !report.config_errors.is_empty() {
    out.push_str("  errors\n");
    for error in &report.config_errors {
      out.push_str(&format!("    {}  {}\n", error.code, error.message));
    }
  }

  if !report.ids.is_empty() {
    out.push_str("  ids\n");
    // Padding on `chars().count()`, not `len()`: a name or a selector holding a
    // non-ASCII character would otherwise shift its whole column.
    let name_width = report.ids.keys().map(|k| k.chars().count()).max().unwrap_or(0);
    let selector_width = report
      .ids
      .values()
      .map(|entry| entry.selector.chars().count())
      .max()
      .unwrap_or(0);
    for (name, entry) in &report.ids {
      let warning = if entry.path_resolves { "" } else { "  (path does not resolve)" };
      out.push_str(&format!(
        "    {name:name_width$}  {:selector_width$}  {} instances{warning}\n",
        entry.selector, entry.matched
      ));
    }
  }

  if !report.refs.is_empty() {
    out.push_str("  refs\n");
    for entry in &report.refs {
      // The dangling RATIO, not just the count: `12/12 dangling` is the shape
      // that makes an entirely broken declaration visible without the exit code
      // having to guess whether the config or the data is at fault.
      let dangling = if entry.dangling > 0 {
        format!(", {}/{} dangling", entry.dangling, entry.matched)
      } else {
        String::new()
      };
      out.push_str(&format!(
        "    {} → {}    {}/{} resolved{dangling}\n",
        entry.from, entry.to, entry.resolved, entry.matched
      ));
    }
  }

  // A report with nothing between the verdict and the diagnostics — an empty
  // `ids` map — must not print two blank lines in a row.
  if out.len() > mark {
    out.push('\n');
  }

  if report.diagnostics.is_empty() {
    out.push_str("  No diagnostics.\n");
  } else {
    out.push_str(&format!("  diagnostics ({})\n", report.diagnostics.len()));
    for entry in report.diagnostics.iter().take(MAX_LISTED_DIAGNOSTICS) {
      out.push_str(&format!("    {}  {}\n", entry.code, entry.message));
    }
    if report.diagnostics.len() > MAX_LISTED_DIAGNOSTICS {
      out.push_str(&format!(
        "    … and {} more — use --json for the full list\n",
        report.diagnostics.len() - MAX_LISTED_DIAGNOSTICS
      ));
    }
  }

  out
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The wire format, written out as the TypeScript emits it, for
  /// `apps/demo/fixtures/shop.json` and its config — the counts are the measured
  /// ones. Parsing this is what proves the camelCase mapping holds: a renamed
  /// field would show up here and nowhere else on the Rust side.
  const VALID: &str = r#"{
    "report": 1,
    "ok": true,
    "configErrors": [],
    "ids": {
      "Customer": { "selector": "$.customers[*].id", "matched": 2, "pathResolves": true },
      "Order": { "selector": "$.orders[*].id", "matched": 2, "pathResolves": true }
    },
    "refs": [
      { "from": "$.orders[*].customerId", "to": "$.customers[*].id",
        "matched": 2, "resolved": 2, "dangling": 0 }
    ],
    "diagnostics": [],
    "totals": { "nodes": 11, "logicalNodes": 27, "entities": 4, "refEdges": 2 }
  }"#;

  const INVALID: &str = r#"{
    "report": 1,
    "ok": false,
    "configErrors": [
      { "code": "selector-syntax", "message": "Selector must start with \"$\": produits[*].id" }
    ],
    "ids": {},
    "refs": [],
    "diagnostics": [],
    "totals": { "nodes": 0, "logicalNodes": 0, "entities": 0, "refEdges": 0 }
  }"#;

  #[test]
  fn parses_the_camel_case_wire_format() {
    let report = parse(VALID).unwrap();
    assert_eq!(report.report, 1);
    assert!(report.ok);
    assert_eq!(report.totals.nodes, 11);
    assert_eq!(report.totals.logical_nodes, 27);
    assert_eq!(report.totals.ref_edges, 2);
    assert_eq!(report.ids["Customer"].matched, 2);
    assert!(report.ids["Customer"].path_resolves);
    assert_eq!(report.refs[0].resolved, 2);
  }

  #[test]
  fn a_malformed_report_is_an_error_not_a_panic() {
    assert!(parse("{\"nope\": true}").is_err());
  }

  #[test]
  fn a_valid_config_exits_zero() {
    assert_eq!(classify(&parse(VALID).unwrap()), EXIT_OK);
  }

  #[test]
  fn an_invalid_config_exits_three() {
    assert_eq!(classify(&parse(INVALID).unwrap()), EXIT_INVALID_CONFIG);
  }

  /// The whole layout, pinned exactly. Columns line up because "Order" is padded
  /// to the width of "Customer" (8) and "$.orders[*].id" to the width of
  /// "$.customers[*].id" (17), plus two literal spaces between columns; a blank
  /// line separates the verdict, the table and the diagnostics, and nothing else.
  #[test]
  fn the_text_report_states_the_verdict_and_the_counts() {
    let expected = [
      "✓ config valid — 4 entities, 2 references resolved",
      "",
      "  ids",
      "    Customer  $.customers[*].id  2 instances",
      "    Order     $.orders[*].id     2 instances",
      "  refs",
      "    $.orders[*].customerId → $.customers[*].id    2/2 resolved",
      "",
      "  No diagnostics.",
      "",
    ]
    .join("\n");
    assert_eq!(render_text(&parse(VALID).unwrap()), expected);
  }

  #[test]
  fn the_text_report_quotes_config_errors() {
    let text = render_text(&parse(INVALID).unwrap());
    assert!(text.starts_with("✗ config invalid"), "{text}");
    assert!(text.contains("selector-syntax  Selector must start with \"$\""), "{text}");
  }

  /// Counts measured on the two-customers/two-orders document declaring only
  /// `$.produits[*].id`: the graph is built, nothing matches.
  #[test]
  fn an_unresolved_prefix_is_named_on_its_line() {
    let json = r#"{
      "report": 1, "ok": false, "configErrors": [],
      "ids": { "Produit": { "selector": "$.produits[*].id", "matched": 0, "pathResolves": false } },
      "refs": [], "diagnostics": [],
      "totals": { "nodes": 7, "logicalNodes": 15, "entities": 0, "refEdges": 0 }
    }"#;
    let text = render_text(&parse(json).unwrap());
    assert!(text.contains("0 instances  (path does not resolve)"), "{text}");
  }

  /// Counts measured on a document with an empty `customers` array and 12 orders
  /// all pointing at `c9`. The verdict stays `ok`: the config is fine, the data
  /// has a hole — and the ratio is what makes that hole impossible to miss.
  #[test]
  fn a_fully_dangling_declaration_shows_its_ratio() {
    let json = r#"{
      "report": 1, "ok": true, "configErrors": [], "ids": {},
      "refs": [ { "from": "$.orders[*].customerId", "to": "$.customers[*].id",
                  "matched": 12, "resolved": 0, "dangling": 12 } ],
      "diagnostics": [],
      "totals": { "nodes": 15, "logicalNodes": 39, "entities": 12, "refEdges": 12 }
    }"#;
    let text = render_text(&parse(json).unwrap());
    assert!(text.contains("0/12 resolved, 12/12 dangling"), "{text}");
  }

  /// The same document with 25 dangling orders instead of 12 — measured counts,
  /// so the literal describes a report the core can actually produce.
  #[test]
  fn the_text_report_truncates_a_flood_of_diagnostics() {
    let diagnostics: Vec<String> = (0..25)
      .map(|i| format!(r#"{{ "code": "dangling-ref", "path": "/orders/{i}", "message": "m{i}" }}"#))
      .collect();
    let json = format!(
      r#"{{ "report": 1, "ok": true, "configErrors": [], "ids": {{}}, "refs": [],
            "diagnostics": [{}],
            "totals": {{ "nodes": 28, "logicalNodes": 78, "entities": 25, "refEdges": 25 }} }}"#,
      diagnostics.join(",")
    );
    let text = render_text(&parse(&json).unwrap());
    assert!(text.contains("diagnostics (25)"), "{text}");
    assert!(text.contains("… and 5 more — use --json for the full list"), "{text}");
    assert!(!text.contains("m24"), "{text}");
  }
}
```

Le module est écrit d'un bloc, tests inclus : le cycle rouge/vert classique s'applique mal à un fichier Rust neuf dont les tests ne compilent pas sans l'implémentation. La vérification est que chaque assertion décrit bien le contrat — même raisonnement que la tâche 2 du plan `2026-09-04-cli-enduser.md`.

- [ ] **Step 2: Déclarer le module**

Dans `apps/demo/src-tauri/src/lib.rs`, sous `pub mod cli;` :

```rust
pub mod report;
```

- [ ] **Step 3: Vérifier que les tests passent**

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: PASS — les 13 tests de `cli` plus les 9 de `report`.

Si l'assertion d'alignement des colonnes échoue, lire la ligne exacte que le message d'erreur affiche et recopier l'espacement réel : c'est la largeur des colonnes qui est le contrat, pas le nombre d'espaces écrit ici de mémoire.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/src-tauri/src/report.rs apps/demo/src-tauri/src/lib.rs
git commit -m "feat(desktop): report.rs — forme du rapport, codes de sortie, rendu texte

ADR-Reviewed: ADR-0032 relu — la taxonomie des codes de sortie et la frontière « sémantique en TS, frontière en Rust » y sont décrites, rien à créer."
```

---

### Task 5: Rust — `check.rs`, le moteur QuickJS embarqué

**Files:**
- Create: `apps/demo/src-tauri/src/check.rs`
- Modify: `apps/demo/src-tauri/src/lib.rs:1-2` (ajout de `pub mod check;`)
- Modify: `apps/demo/src-tauri/Cargo.toml` (`rust-version`, dépendance `rquickjs`)

**Interfaces:**
- Consumes: `apps/demo/src-tauri/generated/check.js` (tâche 3), `report::{parse, classify, Report}` (tâche 4).
- Produces (utilisé par la tâche 6) : `check::run_check(data: &str, config: &str) -> Result<String, String>` — `Ok` porte le rapport JSON, `Err` un message de défaillance du moteur, qui sortira en `4`.

- [ ] **Step 1: Ajouter la dépendance et relever le MSRV**

Dans `apps/demo/src-tauri/Cargo.toml` :

```toml
rust-version = "1.81"
```

(`rquickjs` 0.9 déclare `rust-version = "1.81"` ; laisser `1.77.2` mentirait sur ce que le paquet exige.)

Et dans `[dependencies]`, après `serde` :

```toml
# QuickJS, sans aucune feature : ni `loader` ni `dyn-load`. Le contexte ne doit
# résoudre aucun module — le seul JavaScript qui y entre est le nôtre, embarqué
# par include_str! et figé à la compilation.
rquickjs = "0.9"
```

Run: `cargo fetch --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: `rquickjs`, `rquickjs-core`, `rquickjs-sys` résolus.

- [ ] **Step 2: Écrire le module avec ses tests**

Créer `apps/demo/src-tauri/src/check.rs` :

```rust
//! The embedded engine: the `--check` mode's JavaScript half.
//!
//! The bundle is generated from `packages/core` and COMMITTED (see
//! `pnpm --filter @defsquare/data-graph-core generate:check`). `include_str!`
//! needs it at Rust compile time, and cargo must never depend on pnpm; its
//! freshness is a vitest matter, not a cargo one.
//!
//! Nothing is injected into the context. The validation closure was measured to
//! expect no host global — no `console`, no timers, no `fetch` — so the safe
//! posture is simply the default. `Context::full` is still required: "full" here
//! means the STANDARD intrinsics (`JSON`, `RegExp`, `Map`, `Set`), which the core
//! does use, whereas `Context::base` would leave `JSON` undefined.

use rquickjs::{Context, Ctx, Function, Runtime};

const BUNDLE: &str = include_str!("../generated/check.js");

/// The data is arbitrary, so both bounds are set even though the JavaScript is
/// ours and frozen at compile time.
///
/// Memory: the core calibrates its own `maxNodes` default (1,000,000) against a
/// ~1.5 GB target, and QuickJS was measured at 569 MB on that tier. The limit
/// sits at the CALIBRATION, not at the measurement, so that the core's own cap —
/// which names the way out — stays the thing that fires first on a legitimate
/// document.
const MEMORY_LIMIT: usize = 1536 * 1024 * 1024;

/// Stack: `buildGraph` walks the document by recursion, and so does `JSON.parse`.
/// This must stay strictly UNDER the OS thread stack (8 MiB by default on macOS
/// and Linux) so that a document too deeply nested raises a catchable
/// `InternalError: stack overflow` — which exits 4 — instead of a native crash
/// that would have no exit code at all.
const STACK_LIMIT: usize = 4 * 1024 * 1024;

/// Two strings in, one string out. Rust deserializes NOTHING of the user's data:
/// the JavaScript parses it and hands the report back as text. That is the same
/// argument `cli.rs` already makes on `read_json`, and `load()` already returns
/// the `String`s that go straight in here.
pub fn run_check(data: &str, config: &str) -> Result<String, String> {
  let runtime = Runtime::new().map_err(|e| e.to_string())?;
  runtime.set_memory_limit(MEMORY_LIMIT);
  runtime.set_max_stack_size(STACK_LIMIT);
  let context = Context::full(&runtime).map_err(|e| e.to_string())?;
  context.with(|ctx| {
    ctx.eval::<(), _>(BUNDLE).map_err(|error| describe(&ctx, error))?;
    let check: Function = ctx
      .globals()
      .get("__datagraph_check")
      .map_err(|error| describe(&ctx, error))?;
    let json: String = check.call((data, config)).map_err(|error| describe(&ctx, error))?;
    Ok(json)
  })
}

/// A `rquickjs::Error::Exception` carries no message of its own: the thrown value
/// has to be fetched from the context. Without this, the only thing surfacing
/// would be the word "exception" — precisely the useless diagnostic an exit 4
/// must never be, since it is what tells someone the fault is ours and not their
/// config's.
fn describe(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
  if !error.is_exception() {
    return error.to_string();
  }
  let value = ctx.catch();
  match value.as_exception() {
    Some(exception) => exception.message().unwrap_or_else(|| exception.to_string()),
    None => format!("{value:?}"),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::report;

  /// The committed fixtures, which are what the docs tell you to type after
  /// `datagraph`. `CARGO_MANIFEST_DIR` is `src-tauri/`, so this does not depend on
  /// the test runner's working directory.
  fn fixture(name: &str) -> String {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
    std::fs::read_to_string(format!("{dir}/{name}")).unwrap()
  }

  #[test]
  fn the_bundle_evaluates_and_exposes_the_boundary() {
    let json = run_check("{}", r#"{"ids": {}}"#).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(parsed.report, 1);
    assert!(parsed.ok);
  }

  #[test]
  fn strings_cross_the_boundary_unchanged() {
    // A config error message carrying quotes: nothing on the Rust side re-encodes
    // it, so what the core wrote is what the user reads.
    let json = run_check("{}", r#"{"ids": {"X": "produits[*].id"}}"#).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(parsed.config_errors[0].code, "selector-syntax");
    assert_eq!(
      parsed.config_errors[0].message,
      "Selector must start with \"$\": produits[*].id"
    );
    assert_eq!(report::classify(&parsed), report::EXIT_INVALID_CONFIG);
  }

  /// The gift the check mode makes to the existing suite. `load_reads_the
  /// _committed_fixtures` could only prove the files exist and are JSON; the
  /// semantic counterpart used to live in `e2e/file-mode.spec.ts`. It can now be
  /// proved here, without Playwright.
  #[test]
  fn the_committed_fixtures_are_a_valid_config() {
    let json = run_check(&fixture("shop.json"), &fixture("shop.config.json")).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(report::classify(&parsed), report::EXIT_OK);
    // Measured on the fixture: 11 graph nodes, 27 logical ones. The two differ,
    // which is exactly why both travel — only the second is what `maxNodes`
    // bounds.
    assert_eq!(parsed.totals.nodes, 11);
    assert_eq!(parsed.totals.logical_nodes, 27);
    assert_eq!(parsed.totals.entities, 4);
    assert_eq!(parsed.totals.ref_edges, 2);
    assert_eq!(parsed.ids["Customer"].matched, 2);
    assert!(parsed.ids["Order"].path_resolves);
    assert_eq!(parsed.refs[0].resolved, 2);
    assert!(parsed.diagnostics.is_empty());
  }

  #[test]
  fn an_unresolved_prefix_exits_three() {
    let config = r#"{"ids": {"Produit": "$.produits[*].id"}}"#;
    let parsed = report::parse(&run_check(&fixture("shop.json"), config).unwrap()).unwrap();
    assert!(!parsed.ids["Produit"].path_resolves);
    assert_eq!(report::classify(&parsed), report::EXIT_INVALID_CONFIG);
  }

  #[test]
  fn a_dangling_reference_stays_valid() {
    // A foreign key pointing at nothing is a hole in the DATA. Exit 0, with the
    // diagnostic to read.
    let data = r#"{"customers": [{"id": "c1"}], "orders": [{"id": "o1", "customerId": "c9"}]}"#;
    let parsed = report::parse(&run_check(data, &fixture("shop.config.json")).unwrap()).unwrap();
    assert_eq!(report::classify(&parsed), report::EXIT_OK);
    assert_eq!(parsed.diagnostics[0].code, "dangling-ref");
    assert_eq!(parsed.refs[0].dangling, 1);
  }
}
```

- [ ] **Step 3: Déclarer le module**

Dans `apps/demo/src-tauri/src/lib.rs`, en tête :

```rust
pub mod check;
pub mod cli;
pub mod report;
```

- [ ] **Step 4: Compiler et tester**

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: PASS. **La première compilation est longue** — `rquickjs-sys` compile QuickJS en C. Ce n'est pas un symptôme.

Points de friction possibles, dans l'ordre de probabilité :
- `ctx.eval::<(), _>(BUNDLE)` : si l'inférence bloque, écrire `let _: () = ctx.eval(BUNDLE).map_err(…)?;`.
- `check.call((data, config))` : si `IntoArgs` refuse les `&str`, passer `(data.to_string(), config.to_string())`.
- `error.is_exception()` / `value.as_exception()` : vérifiés présents dans `rquickjs-core` 0.9 (`src/result.rs:197`, `src/value.rs:715`). Si une version ultérieure les déplace, `matches!(error, rquickjs::Error::Exception)` est l'équivalent.
- Bindings C absentes pour la plateforme : ajouter la feature `bindgen` à `rquickjs` (`rquickjs = { version = "0.9", features = ["bindgen"] }`), qui régénère les bindings au lieu d'utiliser les pré-générées.

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src-tauri/src/check.rs apps/demo/src-tauri/src/lib.rs apps/demo/src-tauri/Cargo.toml apps/demo/src-tauri/Cargo.lock
git commit -m "feat(desktop): check.rs — le cœur embarqué dans QuickJS, borné en mémoire et en pile

ADR-Reviewed: ADR-0032 relu et confirmé par le code (QuickJS contre Boa, include_str!, aucune liaison d'hôte). ADR-0020 relu : le shell Tauri et son binaire brut ne changent pas."
```

---

### Task 6: Rust — drapeaux `--check` / `--json`, `USAGE`, branchement de `main.rs`

**Files:**
- Modify: `apps/demo/src-tauri/src/cli.rs` (`USAGE`, `Cli`, `parse`, et les littéraux `Cli { … }` des tests)
- Modify: `apps/demo/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `check::run_check` (tâche 5), `report::{parse, classify, render_text, EXIT_INTERNAL}` (tâche 4), `cli::load` (existant, inchangé).
- Produces : la surface de commande complète. `Cli` gagne `check: bool` et `json: bool`, et dérive désormais `Default`.

`load()` ne bouge pas : il lit les deux fichiers et vérifie leur syntaxe JSON, soit exactement la précondition du mode check, dont il hérite le bon comportement sur fichier manquant ou JSON cassé.

- [ ] **Step 1: Écrire les tests de `parse` qui échouent**

Dans `apps/demo/src-tauri/src/cli.rs`, dans `mod tests`, après `dash_c_alone_is_an_error` :

```rust
  #[test]
  fn check_is_a_flag_not_a_subcommand() {
    // Same argument line as a launch: you validate, then you drop `--check` to
    // open the window. A subcommand would break that gesture.
    let cli = parse(&args(&["--check", "data.json", "-c", "conf.json"])).unwrap();
    assert!(cli.check);
    assert!(!cli.json);
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
  }

  #[test]
  fn json_is_recognized_alongside_check() {
    let cli = parse(&args(&["--check", "data.json", "-c", "conf.json", "--json"])).unwrap();
    assert!(cli.check);
    assert!(cli.json);
  }

  #[test]
  fn check_without_a_config_is_an_error() {
    // Without a config there is nothing to validate: structure-only mode has no
    // contract to be valid or invalid about.
    let err = parse(&args(&["--check", "data.json"])).unwrap_err();
    assert!(err.contains("'--check' requires a config file"), "{err}");
  }

  #[test]
  fn json_without_check_is_an_error() {
    // `--json` is the FORMAT of a report. Refusing it explicitly beats ignoring
    // it in silence.
    let err = parse(&args(&["data.json", "--json"])).unwrap_err();
    assert!(err.contains("'--json' requires '--check'"), "{err}");
  }

  #[test]
  fn help_still_wins_over_the_new_rules() {
    assert!(parse(&args(&["--check", "--help"])).unwrap().help);
    assert!(parse(&args(&["--json", "--help"])).unwrap().help);
  }

  #[test]
  fn usage_documents_the_check_mode() {
    assert!(USAGE.contains("--check"), "{USAGE}");
    assert!(USAGE.contains("--json"), "{USAGE}");
  }
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: FAIL à la compilation — `no field 'check' on type 'Cli'`.

- [ ] **Step 3: Étendre `Cli` et `parse`**

Dans `apps/demo/src-tauri/src/cli.rs`, remplacer la déclaration de `Cli` par :

```rust
/// `Default` is derived so that the tests can name only the field they are about
/// (`Cli { data_path: Some(p), ..Default::default() }`). Adding a flag then costs
/// one line here instead of a pass over every literal — which is exactly the
/// churn `--check` and `--json` would otherwise have caused. The default is also
/// the meaningful one: no file, no flag, demo mode.
#[derive(Debug, Default, PartialEq)]
pub struct Cli {
  pub data_path: Option<String>,
  pub config_path: Option<String>,
  pub help: bool,
  pub check: bool,
  pub json: bool,
}
```

Dans `parse`, déclarer les deux drapeaux à côté de `help` :

```rust
  let mut check = false;
  let mut json = false;
```

ajouter deux bras au `match`, avant le bras `s if s.starts_with('-')` :

```rust
      "--check" => check = true,
      "--json" => json = true,
```

remplacer le bloc de validation final par :

```rust
  // `--help` wins over everything: the user asked for help, they get it.
  if !help {
    if config_path.is_some() && data_path.is_none() {
      return Err("option '-c' requires a data file argument".to_string());
    }
    if check && config_path.is_none() {
      return Err("option '--check' requires a config file".to_string());
    }
    if json && !check {
      return Err("option '--json' requires '--check'".to_string());
    }
  }
  Ok(Cli { data_path, config_path, help, check, json })
```

- [ ] **Step 4: Étendre `USAGE`**

Remplacer la constante `USAGE` par :

```rust
pub const USAGE: &str = "datagraph - explore a JSON document as a graph of records and references

Usage:
  datagraph [<data.json>] [-c <config.json>]
  datagraph --check <data.json> -c <config.json> [--json]

Arguments:
  <data.json>       Path to the JSON document to open.
                    Without it, the app opens on the built-in demo dataset.

Options:
  -c <config.json>  Path to a JSON config declaring ids, refs
                    and groups. Without it, the document opens in
                    structure view only.
  --check           Validate the config against the data, print a report on
                    stdout and exit without opening a window. Requires -c.
                    Exit 0 valid config, 3 invalid config, 4 internal error.
  --json            Print the --check report as JSON instead of text.
  -h, --help        Show this help and exit.";
```

- [ ] **Step 5: Réécrire les littéraux `Cli` des tests**

Dans `mod tests`, les six constructions de `Cli` deviennent :

```rust
    assert_eq!(cli, Cli::default());                                   // no_args_means_demo_mode
    let cli = Cli::default();                                          // load_without_data_path_is_none
    let cli = Cli { data_path: Some(data), config_path: Some(conf), ..Default::default() };
    let cli = Cli { data_path: Some("/nonexistent/nope.json".to_string()), ..Default::default() };
    let cli = Cli { data_path: Some(format!("{dir}/shop.json")),
                    config_path: Some(format!("{dir}/shop.config.json")), ..Default::default() };
    let cli = Cli { data_path: Some(data.clone()), ..Default::default() };
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: PASS — 19 tests `cli`, 9 `report`, 5 `check`.

- [ ] **Step 7: Brancher `main.rs`**

Remplacer `apps/demo/src-tauri/src/main.rs` par :

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use data_graph_lib::{check, cli, report};

fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let parsed = match cli::parse(&args) {
    Ok(parsed) => parsed,
    Err(message) => {
      eprintln!("datagraph: {message}\n\n{}", cli::USAGE);
      std::process::exit(2);
    }
  };
  if parsed.help {
    println!("{}", cli::USAGE);
    return;
  }
  let payload = match cli::load(&parsed) {
    Ok(payload) => payload,
    Err(message) => {
      eprintln!("datagraph: {message}");
      std::process::exit(1);
    }
  };
  // The check mode returns from HERE. `run_with` is never reached, so no window
  // can open: that is the shape of the flow, not a precaution taken inside it.
  if parsed.check {
    run_check_mode(payload.as_ref(), parsed.json);
  }
  data_graph_lib::run_with(payload);
}

/// Never returns: every path exits the process with the code the report earned.
fn run_check_mode(payload: Option<&cli::LaunchPayload>, as_json: bool) -> ! {
  // `parse` guarantees `--check` comes with `-c`, and `-c` with a data file, so
  // both strings are here. The branch exists because an impossible state must
  // still name itself rather than panic — and it is OUR fault, hence exit 4.
  let Some((data, config)) = payload.and_then(|p| p.config.as_ref().map(|c| (&p.data, c))) else {
    eprintln!("datagraph: internal error: --check reached without both files");
    std::process::exit(report::EXIT_INTERNAL);
  };

  let json = match check::run_check(data, config) {
    Ok(json) => json,
    Err(message) => {
      // A stack overflow, an exhausted memory budget or a core bug. Telling an
      // agent its config is wrong when the fault is ours condemns it to edit a
      // correct file forever, so this can never be a 3.
      eprintln!("datagraph: internal error: {message}");
      std::process::exit(report::EXIT_INTERNAL);
    }
  };
  let parsed = match report::parse(&json) {
    Ok(parsed) => parsed,
    Err(message) => {
      eprintln!("datagraph: internal error: {message}");
      std::process::exit(report::EXIT_INTERNAL);
    }
  };

  if as_json {
    // Printed VERBATIM: re-serializing would round-trip the report through a
    // second encoder for no reason, and would let the two spellings drift.
    println!("{json}");
  } else {
    print!("{}", report::render_text(&parsed));
  }
  std::process::exit(report::classify(&parsed));
}
```

- [ ] **Step 8: Vérifier le comportement bout en bout**

```bash
cargo build --manifest-path apps/demo/src-tauri/Cargo.toml
BIN=apps/demo/src-tauri/target/debug/datagraph

$BIN --check apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json; echo "exit=$?"
# → rapport texte, ✓ config valid — 4 entities, 2 references resolved, exit=0

$BIN --check apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json --json | head -5
# → { "report": 1, "ok": true, …

echo '{"ids": {"Produit": "$.produits[*].id"}}' > /tmp/bad.json
$BIN --check apps/demo/fixtures/shop.json -c /tmp/bad.json; echo "exit=$?"
# → (path does not resolve), exit=3

echo '{"ids": {"X": "produits[*].id"}}' > /tmp/syntax.json
$BIN --check apps/demo/fixtures/shop.json -c /tmp/syntax.json; echo "exit=$?"
# → ✗ config invalid + selector-syntax, exit=3

$BIN --check apps/demo/fixtures/shop.json; echo "exit=$?"
# → datagraph: option '--check' requires a config file + usage, exit=2

$BIN apps/demo/fixtures/shop.json --json; echo "exit=$?"
# → datagraph: option '--json' requires '--check' + usage, exit=2

$BIN --check missing.json -c apps/demo/fixtures/shop.config.json; echo "exit=$?"
# → datagraph: cannot read 'missing.json', exit=1

$BIN --help; echo "exit=$?"
# → usage citant --check et --json, exit=0
```

Expected: exactement ces sorties, et **aucune fenêtre** dans aucun des huit cas.

- [ ] **Step 9: Commit**

```bash
git add apps/demo/src-tauri/src/cli.rs apps/demo/src-tauri/src/main.rs
git commit -m "feat(desktop): --check et --json — surface de commande et branchement

ADR-Reviewed: ADR-0032 relu (drapeau plutôt que sous-commande, codes 0/3/4). ADR-0021 relu : le CLI reste le binaire Tauri, non superseded."
```

---

### Task 7: Documentation et vérification finale

**Files:**
- Modify: `README.md:69-76` (bloc Usage) et `README.md:99-101`
- Modify: `apps/demo/README.md:15-50` (section CLI)
- Modify: `packages/core/README.md` (nouvelle section après `## API surface`)
- Modify: `CLAUDE.md` (sections Commandes et Structure)

**Interfaces:**
- Consumes: le binaire complet (tâches 1 à 6).
- Produces: la documentation du mode `--check` là où quelqu'un la cherche.

- [ ] **Step 1: README racine**

Dans le bloc **Usage.** (ligne 69), ajouter après la ligne `datagraph` seul :

```bash
datagraph --check data.json -c config.json          # validate the config, print a report, exit
datagraph --check data.json -c config.json --json   # same report, as JSON
```

Et après le paragraphe « Argument and file errors… » (ligne 99), insérer :

````markdown
**Checking a config without opening it.** `--check` builds the graph, prints a
report on stdout and exits — no window. It reports, per selector, how many
instances it matched and whether its path resolves at all, and per reference how
many joins resolved or dangled.

```
✓ config valid — 4 entities, 2 references resolved

  ids
    Customer  $.customers[*].id  2 instances
    Order     $.orders[*].id     2 instances
  refs
    $.orders[*].customerId → $.customers[*].id    2/2 resolved

  No diagnostics.
```

(Copy this block from the binary's own output rather than from here — the columns
are computed, and a hand-typed example drifts.)

The exit code answers one question — *can I fix this by editing the config?*
`0` valid (the report may still carry data diagnostics), `3` invalid config,
`4` internal error, on top of the existing `1` for an unreadable file and `2`
for a bad argument. A dangling foreign key, a duplicate id or a missing id is a
hole in the **data**, so it stays at `0`; an unresolved selector prefix or a
reference declaration nothing satisfied is a **config** bug, so it exits `3`.
`--json` prints the same report as JSON, carrying a `"report": 1` version field.
Its `totals` hold two node counts: `nodes`, the size of the graph, and
`logicalNodes`, the same nodes plus the scalar rows — the second is the one
`maxNodes` bounds, so it is the one to compare against the number a
`GraphTooLargeError` quotes.
````

- [ ] **Step 2: README de la démo**

Dans `apps/demo/README.md`, section `## CLI`, ajouter les deux lignes `--check` au bloc de commandes, puis après le paragraphe « The argument parser lives in… » :

````markdown
`--check` is the headless half of the same binary. It requires `-c` (without a
config there is no contract to check) and refuses `--json` on its own (that is
the format of a report). It builds the graph with the **same TypeScript core**
the window uses — bundled into
[`src-tauri/generated/check.js`](./src-tauri/generated/check.js) and evaluated in
an embedded QuickJS by [`src-tauri/src/check.rs`](./src-tauri/src/check.rs) — so
the fourteen `ConfigError` messages read identically here and on the app's error
screen. The report's shape, the exit codes and the text rendering live in
[`src-tauri/src/report.rs`](./src-tauri/src/report.rs).

| Exit | Meaning |
|---|---|
| `0` | Config valid. The report may still carry **data** diagnostics. |
| `1` | File unreadable, or invalid JSON. |
| `2` | Invalid argument. |
| `3` | Invalid config: a `ConfigError`, a selector prefix that does not resolve, or a reference declaration nothing satisfied. |
| `4` | Internal error: engine failure or a core bug. Never a verdict on your config. |

```bash
datagraph --check fixtures/shop.json -c fixtures/shop.config.json
datagraph --check fixtures/shop.json -c fixtures/shop.config.json --json
```

`check.js` is **generated and committed**: `include_str!` needs it at Rust compile
time, so cargo never has to run pnpm. Regenerate it with
`pnpm --filter @defsquare/data-graph-core generate:check` after any change to the
validation closure — `packages/core/test/check-bundle.test.ts` compares it byte
for byte and fails `pnpm test` otherwise. See
[ADR-0032](../../docs/adr/0032-embedded-core-for-headless-check.md).
````

- [ ] **Step 3: README du cœur**

Dans `packages/core/README.md`, après la section `## API surface` (avant `## License`) :

````markdown
## The `--check` bundle

`src/validate.ts` is a **third entry point**, outside the published API: it builds
the report the `datagraph --check` CLI prints. It is deliberately narrow —
`build.ts`, `config.ts`, `selector.ts`, `model.ts` and nothing else — because it
is bundled into a single ES file the desktop binary embeds and runs in QuickJS.
Reaching `structure-layout.ts` would drag elkjs into it, 6.5 kB becoming 1.5 MB.

```bash
pnpm --filter @defsquare/data-graph-core generate:check
```

writes `apps/demo/src-tauri/generated/check.js`, which is **committed**: Rust's
`include_str!` needs the file at compile time, and cargo must never depend on
pnpm. `test/check-bundle.test.ts` guards two things — that the closure stays
narrow and expects no host global, and that the committed file matches the
generator byte for byte. A change to the validation closure that is not
regenerated breaks `pnpm test`. The decision is in
[ADR-0032](../../docs/adr/0032-embedded-core-for-headless-check.md).
````

- [ ] **Step 4: CLAUDE.md**

Dans la section **Commands**, après la ligne Desktop, ajouter :

```markdown
- Mode `--check` (validation headless, sans fenêtre) : `datagraph --check <data.json> -c <config.json> [--json]` — codes de sortie 0 valide / 3 config invalide / 4 erreur interne. Le bundle qu'il exécute est généré par `pnpm --filter @defsquare/data-graph-core generate:check` et **commité** dans `apps/demo/src-tauri/generated/check.js` ; `test/check-bundle.test.ts` en vérifie la fraîcheur octet pour octet, donc une modification de `validate.ts`/`build.ts`/`config.ts`/`selector.ts`/`model.ts` non régénérée casse `pnpm test`.
```

Dans la section **Structure**, compléter la puce `packages/core` :

```markdown
- `packages/core` — graph, layout (ELK + the two-level engine for the graph view), aggregates, search. `src/validate.ts` est une troisième entrée, hors API publiée : la fermeture de validation qu'esbuild empaquette pour le binaire (voir `scripts/check-bundle.ts` et ADR-0032). Elle ne doit atteindre ni `structure-layout.ts` ni elkjs.
```

et la puce `apps/demo` :

```markdown
  Le Rust porte aussi le mode `--check` : `report.rs` (forme du rapport, codes de sortie, rendu texte — pur, testable sans moteur) et `check.rs` (QuickJS via `rquickjs`, bundle embarqué par `include_str!`).
```

- [ ] **Step 5: Vérification finale globale**

```bash
pnpm typecheck
pnpm build
pnpm test
cargo test --manifest-path apps/demo/src-tauri/Cargo.toml
```

Expected: tout PASS. `pnpm test` couvre les cinq couches du plan de test : pureté et fraîcheur du bundle plus sémantique du rapport côté vitest, frontière et bout-en-bout côté cargo.

- [ ] **Step 6: Vérifier que le mode fenêtre n'a pas bougé**

```bash
pnpm --filter @defsquare/data-graph build && pnpm --filter demo e2e
```

Expected: PASS sans modifier aucun test — aucune des sept tâches ne touche le frontend, et `--check` sort avant `run_with`.

- [ ] **Step 7: Commit**

```bash
git add README.md apps/demo/README.md packages/core/README.md CLAUDE.md
git commit -m "docs: mode --check — usage, codes de sortie, bundle généré

ADR-Reviewed: ADR-0032 relu, la documentation le cite depuis les trois READMEs ; aucune décision nouvelle dans ce diff."
```

---

## Self-Review

**Couverture du spec.** Les cinq volets sont couverts : entrée `validate.ts` et constructeur de rapport (tâche 2), génération du bundle (tâche 3), côté Rust drapeaux + branchement + QuickJS + bornes + rendu (tâches 4 à 6), codes de sortie via `classify` (tâche 4), les cinq couches de test (pureté et fraîcheur en tâche 3, sémantique en tâche 2, frontière et bout-en-bout en tâche 5). La correction notée au passage est la tâche 1. L'ADR est en tâche 2, index compris.

**Points que le spec laissait ouverts et que ce plan tranche**, à relire en revue :

1. **`totals` porte deux comptes** — `nodes` (`graph.nodes.size`, l'unité partagée avec `entities` et `refEdges`) et `logicalNodes` (`graph.logicalNodeCount`, le seul que `maxNodes` borne et le seul comparable au nombre que cite `GraphTooLargeError`). Tranché par le spec, pas par ce plan : la première version du plan n'en gardait qu'un, et n'en garder qu'un laisse un agent qui a dépassé le cap sans moyen de relier `1000001 > 1000000` au `nodes: 350000` de son essai suivant. Toutes les valeurs des tests ont été **mesurées** en exécutant `buildGraph` sur la fixture de chaque cas ; aucune n'est estimée.
2. **L'attribution d'une arête à sa déclaration** se fait en comparant le chemin absolu de la ligne (`holder.path` + `edge.field`) au sélecteur `from`. `RefEdge` ne porte pas la déclaration qui l'a produite et le spec ne dit pas comment les relier ; cette règle évite d'ajouter un champ au modèle et de dupliquer la traversée de `build.ts`.
3. **`pathResolves` porte sur le PRÉFIXE d'instances**, pas sur le sélecteur entier : un champ d'id absent produit `missing-id` (code 0) et non un préfixe non résolu (code 3).
4. **`GraphTooLargeError` sort en 3**, en `configErrors` avec le code `graph-too-large`. Le spec la range à l'étage 2 de son échelle d'erreurs sans lui donner de code ; `maxNodes` est un champ de config et le message nomme ce levier, donc la question « puis-je corriger ça en éditant la config ? » répond oui.
5. **`ok` est calculé en TypeScript, `classify` ne fait que le traduire en code.** L'alternative — redériver les trois conditions en Rust — remettrait la règle dans deux langages.
6. **Le rendu texte plafonne à 20 diagnostics** avec une ligne « … and N more ». Le spec ne borne pas la liste.
7. **`buildCheckBundle()` vit dans `scripts/`, pas dans `src/`**, contrairement à `renderTokensCss()` : elle importe esbuild, qui n'a rien à faire dans la fermeture du paquet publié.
8. **`rquickjs` 0.9 relève le `rust-version` du crate à 1.81** (il était à 1.77.2).
