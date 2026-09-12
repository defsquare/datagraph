/**
 * Third entry point of the core: the `--check` report.
 *
 * This module is bundled by `scripts/generate-check-bundle.ts` into the JavaScript
 * the `datagraph` binary embeds, so its import closure is DELIBERATELY narrow —
 * `build.ts`, `config.ts`, `selector.ts`, `model.ts` and nothing else. Reaching
 * `structure-layout.ts` would drag elkjs into the 18,798-byte committed bundle;
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
   * mode is for. `nodes` is the size of the graph. `entities` is NOT in the
   * same unit: it sums the DISTINCT ids per entity type, from the deduplicated
   * `entityIndex` — the two diverge exactly on a `duplicate-id` diagnostic,
   * where `nodes` still counts every node but `entities` only the first one
   * seen per id. `logicalNodes` counts the scalar rows on top, and it is THE
   * ONLY ONE `maxNodes` bounds — `build.ts` throws
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
    if (error instanceof GraphTooLargeError) {
      // `error.count` IS the count the message quotes (`maxNodes: <count> >
      // <max>`): reporting it in `totals.logicalNodes` too is what lets a
      // consumer read the number instead of regexing it back out of the
      // message the field exists to make unnecessary.
      return failed("graph-too-large", error.message, error.count)
    }
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
    // `nodes` and `entities` are NOT the same unit — see the field doc above,
    // and a `duplicate-id` diagnostic is where that shows. `logicalNodes` is the
    // one `maxNodes` bounds, hence the one comparable to the number
    // `GraphTooLargeError` quotes. Both travel, because neither answers the
    // other's question.
    totals: {
      nodes: graph.nodes.size,
      logicalNodes: graph.logicalNodeCount,
      entities,
      refEdges: graph.refEdges.length,
    },
  }
}

/** A failed report keeps the FULL shape: a consumer reads the same fields
 * whatever the outcome, and never has to branch on presence. Every count is 0
 * because no graph was built — except `logicalNodes` on the `graph-too-large`
 * path, where the count IS known (`GraphTooLargeError.count`, the traversal ran
 * far enough to hit the cap) and withholding it would force a consumer to
 * regex it back out of the message instead of reading the field. */
function failed(code: string, message: string, logicalNodes = 0): CheckReport {
  return {
    report: 1,
    ok: false,
    configErrors: [{ code, message }],
    ids: {},
    refs: [],
    diagnostics: [],
    totals: { nodes: 0, logicalNodes, entities: 0, refEdges: 0 },
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
