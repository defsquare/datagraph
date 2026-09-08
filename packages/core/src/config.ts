import { parseSelector, ConfigError, type PathSegment } from "./selector.js"

/**
 * Data-first contract: everything is expressed as paths.
 *
 * - `ids`: name → key path. The prefix (`$.customers[*]`) designates the set of
 *   instances, the last segment (`id`) the key field. The name is only a
 *   presentation handle (labels, colors, badges).
 * - `refs`: `{from, to}` joins — "the value at `from` equals the key value at
 *   `to`". An array, not a map: two refs may start from the same path without
 *   colliding on a key.
 * - `groups`: the `ids` names that anchor the grouping of the graph view. The
 *   order MATTERS: it breaks distance ties (see `buildAggregates`) and fixes the
 *   paint order of the envelopes.
 */
export interface DataGraphConfig {
  ids: Record<string, string>
  refs?: { from: string; to: string }[]
  groups?: string[]
  maxNodes?: number
  /** Label of the root node. Defaults to `"$"` — the root symbol of the selector
   * syntax `ids` already uses. An empty string is honored. */
  rootLabel?: string
}

/**
 * A declared reference, split into what building needs: the NAVIGATION from the
 * owning entity (empty for a direct field) and the key of the TERMINAL row that
 * carries the identifier.
 *
 * `path` carries the ABSOLUTE `from` as written in the config: it is the
 * declaration the author will re-read when `unresolved-reference` quotes it.
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

/**
 * THE package's translation boundary, and the only one.
 *
 * In, the PUBLIC data-first vocabulary: `ids` / `refs` / `groups`. Out, the
 * graph's INTERNAL vocabulary: `entities` / `references` / `aggregates`. Nothing
 * else in the package knows the public vocabulary — not `build.ts`, not
 * `aggregate.ts`, not the renderer, which only ever see the `ValidatedConfig`.
 * Corollary: renaming a word of the public contract must touch this file only
 * (and `DataGraphConfig` above).
 */
export function validateConfig(config: DataGraphConfig): ValidatedConfig {
  // A config loaded from disk (the CLI's `-c` option) can be any JSON: the type
  // guarantees nothing, and a raw TypeError would bubble up as-is to the end
  // user's error screen.
  if (typeof config.ids !== "object" || config.ids === null || Array.isArray(config.ids)) {
    throw new ConfigError("invalid-config", "Config must declare an ids object")
  }

  // `ids`: each path splits into an instance prefix + a key field.
  const entities = new Map<string, { segments: PathSegment[]; idField: string }>()
  // The COMPLETE segments (key field included), so `refs[].to` is compared as
  // parsed segments rather than raw strings.
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

  // `refs`: the target must be an `ids` path (aiming at a non-key field is out
  // of v1 scope — the door stays open without being paid for); the source must
  // STRICTLY extend an instance prefix, longest wins (on equal length, the
  // declaration order of `ids` decides — degenerate case of two names on the
  // same prefix).
  const references = new Map<string, ReferenceDecl[]>()
  // Guard before `for...of`: a config migrated from the old MAP form
  // (`references: {...}`) arrives here as an object, and an object is not
  // iterable (raw TypeError) — same for `groups` below, where a string would in
  // addition be silently iterated character by character.
  if (config.refs !== undefined && !Array.isArray(config.refs)) {
    throw new ConfigError("invalid-config", "Config 'refs' must be an array of {from, to} entries")
  }
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
    // Strict `<` above: the remainder is non-empty by construction.
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

  // `groups` → internal `aggregates`, order preserved.
  const aggregates: string[] = []
  if (config.groups !== undefined && !Array.isArray(config.groups)) {
    throw new ConfigError("invalid-config", "Config 'groups' must be an array of ids names")
  }
  for (const name of config.groups ?? []) {
    if (!entities.has(name)) {
      throw new ConfigError("unknown-group", `Unknown group: '${name}' is not declared in ids`)
    }
    aggregates.push(name)
  }

  // A MEMORY guard, no longer a cost guard: the graph view bounds what it lays
  // out itself, so the cap now only protects buildGraph + buildSearchIndex, both
  // linear. Default calibrated at the bench (`pnpm bench`, "memory scale"
  // section): 1M logical nodes = ~430 MB of heap (net; ~479 MB absolute, the
  // bench baseline included — cf. `bench/bench.ts`), ~0.8 s of build+index under
  // the DEFAULT node options — the webview won't have a `--max-old-space-size`
  // either.
  const maxNodes = config.maxNodes ?? 1_000_000

  // `??` and not `||`: an empty string is a valid label the caller is entitled
  // to want.
  const rootLabel = config.rootLabel ?? "$"

  return { entities, references, maxNodes, rootLabel, aggregates }
}
