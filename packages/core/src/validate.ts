/**
 * Third entry point of the core: the `--check` report.
 *
 * Bundled by `scripts/generate-check-bundle.ts` into the JavaScript the
 * `datagraph` binary embeds, so its import closure must stay narrow —
 * `build.ts`, `config.ts`, `selector.ts`, `model.ts` and nothing else. Reaching
 * `structure-layout.ts` would drag elkjs into the committed bundle;
 * `test/check-bundle.test.ts` enforces it.
 *
 * NOT re-exported by `index.ts`: the package publishes what consumers consume
 * (ADR-0023), and the only consumer here is the bundler.
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
   * Distinct from `matched > 0`: `$.orders[*].id` over an empty `orders` matches
   * nothing and is still a correct declaration; `$.produits[*].id` over a document
   * with no `produits` key is a config bug — only that one is an error.
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
   * Wire version, against YAGNI on purpose: the consumer is a skill file on
   * someone's disk, not updated with the binary, so a break must at least be
   * diagnosable. ADDING a field is allowed; renaming or removing one bumps this.
   */
  report: 1
  /**
   * True iff nothing here can be fixed by editing the config. SINGLE home of the
   * exit-code rule: `runCheck` turns it into the 0 or 3 the binary exits with, so
   * the rule never exists in TS and Rust at once.
   */
  ok: boolean
  configErrors: { code: string; message: string }[]
  ids: Record<string, CheckIdEntry>
  refs: CheckRefEntry[]
  diagnostics: Diagnostic[]
  /**
   * `nodes` is the size of the graph. `entities` is NOT in the same unit: it
   * sums the DISTINCT ids per entity type, from the deduplicated `entityIndex`
   * — the two diverge exactly on a `duplicate-id` diagnostic. `logicalNodes`
   * counts the scalar rows on top, and it is THE ONLY ONE `maxNodes` bounds —
   * `build.ts` throws `GraphTooLargeError(logicalNodeCount, maxNodes)`.
   */
  totals: { nodes: number; logicalNodes: number; entities: number; refEdges: number }
}

/**
 * The boundary the binary calls: exit code on the first line, rendered output
 * after it. The binary parses nothing of the report, so the shape, the rendering
 * AND the exit-code rule all live here only.
 */
export function runCheck(dataText: string, configText: string, asJson: boolean): string {
  const report = checkReport(JSON.parse(dataText), JSON.parse(configText))
  const output = asJson ? `${JSON.stringify(report, null, 2)}\n` : renderText(report)
  return `${report.ok ? 0 : 3}\n${output}`
}

/** Text mode lists at most this many diagnostics: ten thousand dangling
 * references must not scroll the report off the terminal. `--json` still carries
 * every one. */
const MAX_LISTED_DIAGNOSTICS = 20

/** Pads on CODE POINTS, not UTF-16 units: a non-ASCII name or selector would
 * otherwise shift its whole column. */
function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - [...text].length))
}

export function renderText(report: CheckReport): string {
  let out = report.ok
    ? `✓ config valid — ${report.totals.entities} entities, ` +
      `${report.refs.reduce((sum, entry) => sum + entry.resolved, 0)} references resolved\n`
    : "✗ config invalid\n"

  out += "\n"
  // `errors`, `ids` and `refs` read as one table, so they are separated from the
  // verdict above and the diagnostics below, never from one another.
  const mark = out.length

  if (report.configErrors.length > 0) {
    out += "  errors\n"
    for (const error of report.configErrors) out += `    ${error.code}  ${error.message}\n`
  }

  // Alphabetical, hence stable between runs. The JSON keeps the config's own
  // declaration order — the two orders differ on purpose.
  const ids = Object.entries(report.ids).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (ids.length > 0) {
    out += "  ids\n"
    const nameWidth = Math.max(...ids.map(([name]) => [...name].length))
    const selectorWidth = Math.max(...ids.map(([, entry]) => [...entry.selector].length))
    for (const [name, entry] of ids) {
      const warning = entry.pathResolves ? "" : "  (path does not resolve)"
      const unit = entry.matched === 1 ? "instance" : "instances"
      out +=
        `    ${pad(name, nameWidth)}  ${pad(entry.selector, selectorWidth)}  ` +
        `${entry.matched} ${unit}${warning}\n`
    }
  }

  if (report.refs.length > 0) {
    out += "  refs\n"
    for (const entry of report.refs) {
      // The dangling RATIO, not just the count: `12/12 dangling` is what makes an
      // entirely broken declaration visible.
      const dangling = entry.dangling > 0 ? `, ${entry.dangling}/${entry.matched} dangling` : ""
      out += `    ${entry.from} → ${entry.to}    ${entry.resolved}/${entry.matched} resolved${dangling}\n`
    }
  }

  // With nothing between the verdict and the diagnostics — an empty `ids` — there
  // must not be two blank lines in a row.
  if (out.length > mark) out += "\n"

  if (report.diagnostics.length === 0) {
    out += "  No diagnostics.\n"
  } else {
    out += `  diagnostics (${report.diagnostics.length})\n`
    for (const entry of report.diagnostics.slice(0, MAX_LISTED_DIAGNOSTICS)) {
      out += `    ${entry.code}  ${entry.message}\n`
    }
    if (report.diagnostics.length > MAX_LISTED_DIAGNOSTICS) {
      const rest = report.diagnostics.length - MAX_LISTED_DIAGNOSTICS
      out += `    … and ${rest} more — use --json for the full list\n`
    }
  }

  return out
}

export function checkReport(data: unknown, config: unknown): CheckReport {
  const typed = config as DataGraphConfig
  let graph: Graph
  try {
    graph = buildGraph(data, typed)
  } catch (error) {
    // Only the core's two DECLARED failures become a report: `ConfigError` is a
    // wrong declaration, `GraphTooLargeError` names `maxNodes` — a config field.
    // Anything else keeps travelling as an exception, so the binary exits 4, not 3.
    if (error instanceof ConfigError) return failed(error.code, error.message)
    if (error instanceof GraphTooLargeError) {
      // `error.count` IS the count the message quotes, so reporting it in
      // `totals.logicalNodes` saves regexing it back out of that message.
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
    // Three different units — see the `totals` field doc.
    totals: {
      nodes: graph.nodes.size,
      logicalNodes: graph.logicalNodeCount,
      entities,
      refEdges: graph.refEdges.length,
    },
  }
}

/** A failed report keeps the FULL shape, so consumers never branch on presence.
 * Every count is 0 because no graph was built — except `logicalNodes` on the
 * `graph-too-large` path, where the count IS known
 * (`GraphTooLargeError.count`). */
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
      // carries matches `from`: by field name alone, two declarations ending on
      // the same key under different prefixes would merge. `RefEdge` deliberately
      // does not carry the declaration that produced it.
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
 * Walks the raw data, not the graph: the question is about the document's shape,
 * not about what got built. Two rules carry the exit code: a key that exists
 * nowhere fails, a wildcard over an EMPTY container succeeds.
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
