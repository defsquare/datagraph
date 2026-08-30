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
