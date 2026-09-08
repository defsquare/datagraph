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

/**
 * A RELATIVE path, in the same grammar as `parseSelector` but anchored on a node
 * instead of the root: `lines[*].productRef` rather than
 * `$.lines[*].productRef`.
 *
 * Implemented by re-anchoring the string on `$` rather than duplicating the
 * token loop: the two grammars must stay the SAME, or one form would accept what
 * the other rejects. The `$.` is only prepended when the path does not already
 * start with a token (`.foo`, `[0]`), so both spellings are accepted.
 *
 * The error is restated on the ORIGINAL path: quoting the re-anchored form would
 * surface a `$` in the message that the caller never wrote.
 */
export function parseRelativePath(path: string): PathSegment[] {
  const anchored = path.startsWith(".") || path.startsWith("[") ? `$${path}` : `$.${path}`
  try {
    return parseSelector(anchored)
  } catch {
    throw new ConfigError("selector-syntax", `Invalid relative path: ${path}`)
  }
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
