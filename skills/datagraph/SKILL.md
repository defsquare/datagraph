---
name: datagraph
description: Use when showing the user a JSON document as an interactive graph of records and references - exploring nested/relational JSON, inspecting how entities join via foreign keys, or eyeballing an API payload's shape. Opens the local `datagraph` desktop app. Use when the user says "show me", "visualize", "let me see" about JSON data, or when a JSON structure is too tangled to explain in prose.
---

# datagraph

`datagraph` renders a JSON document as a navigable graph: records become cards,
declared foreign keys become edges, and declared aggregate roots become
envelopes around their members.

**The output is a window on the user's screen, not text you can read.** You are
launching a viewer for a human. You will not see the graph, so you cannot
report on its contents — hand it over and let the user look.

## When not to use this

- The user wants *facts* about the data (counts, dangling refs, cycles). Use
  `jq` and answer in text. `datagraph` returns nothing to you.
- The JSON is flat with no cross-references. A table or a `jq` excerpt is
  clearer than a graph.
- You are in a non-interactive session (cron, headless CI). No one is there to
  look at the window.

## Check it is installed

```bash
command -v datagraph
```

If absent, install it:

```bash
brew install defsquare/tap/datagraph
```

That is macOS on Apple silicon — the only platform with a published binary.
Anywhere else it is built from source from
<https://github.com/defsquare/datagraph> (clone, pnpm + a Rust toolchain, then
`pnpm --filter demo tauri build`, which produces
`apps/demo/src-tauri/target/release/datagraph`, a raw binary with no `.app`).
Tell the user that is what it takes and let them decide; do not launch that
build yourself.

## Protocol

### 1. Get the data into a file

If the user named a file, use it as-is. If the data came from a command,
an API call, or from you, write it to a working directory — the session
scratchpad if you were given one, otherwise `mktemp -d`.

### 2. Shape the data — only when you are the one producing it

If the user named an existing file, skip this: the shape is theirs. If you are
generating the document — an audit, an extraction, a transformation — its shape
is a decision, and it is the shape, not the config, that decides what a card
shows. `buildGraph` has exactly three rules:

| In the JSON | On screen |
|---|---|
| scalar field of an object | a `key: value` **row** on the card |
| object field | a **separate card**, and *no row at all* on the parent |
| array field | an `n items` pill on the parent, then **one card per element** |

So: **whatever you want to read inside a card must be a direct scalar field of
that object.** The natural JSON for a list of attributes is the wrong one here —
`{"columns": {...}}` sends them to a card of their own and leaves the parent
blank, `{"columns": [...]}` turns every attribute into a node of the graph.

When the document describes a **schema** rather than instances — DB tables, UML
classes, modules, API resources — read `references/class-diagrams.md` before
writing the file. The mapping is mechanical, and four collisions in it are
invisible until the window is open.

### 3. Write the config

The config is what turns a JSON tree into a graph. Without `-c`, the app opens
in *structure view only*: the raw nesting, no entities, no edges. That is a
legitimate mode for "what shape is this payload", but for anything relational,
write a config.

```json
{
  "ids": {
    "Customer": "$.customers[*].id",
    "Order": "$.orders[*].id"
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id" }
  ],
  "groups": ["Customer"],
  "rootLabel": "Shop"
}
```

- **`ids`** (required) — name → selector ending in the **id field**. Everything
  matched by the selector minus its last segment becomes an *entity*: the only
  node kind that starts collapsed and the only endpoint of a reference edge.
  The name is presentation only (labels, colors, badges).
- **`refs`** — `{ from, to }` joins. `from` selects a field whose value is a
  foreign key; `to` must be **one of the selectors declared verbatim in `ids`**.
  An unmatched target draws as a dangling edge rather than failing.
- **`groups`** — names from `ids` that are aggregate roots. **Order is
  load-bearing**: it breaks distance ties when a record is equidistant from two
  roots, and it fixes envelope paint order. Put the dominant root first.
- **`rootLabel`** — label on the root node, default `"$"`. Set it to something
  the user recognises. `""` is honoured, not replaced by the default.
- **`maxNodes`** — memory guard, default 1,000,000. Only set it if a build
  fails on it; the error names the fix.

### 4. Selector grammar — narrower than JSONPath

Must start with `$`, then only these tokens:

| Token | Meaning |
|---|---|
| `.key` | object key, matching `[A-Za-z_$][\w$-]*` |
| `.*` | any key at this level |
| `[3]` | array index |
| `[*]` | any array index |

There is **no** `..` recursive descent, no filters `[?(...)]`, no quoted keys.
A key like `@odata:id` or `user name` **cannot be expressed** — say so instead
of inventing syntax that will be rejected.

### 5. Pre-flight the selectors — this is the important step

Never launch the window without running `--check` first. It is the same core
the app runs, headless: it builds the graph, prints a report on stdout and
exits, opening nothing.

```bash
datagraph --check data.json -c config.json
```

- **exit 3 — the config is wrong** and you can fix it. The report names what
  failed: a malformed selector or an unknown group as an `errors` line, a
  selector whose instance path designates nothing in the document as
  `(path does not resolve)` beside its `ids` entry, a `refs[].to` that is not
  one of the `ids` selectors as an `unresolved-reference`. Fix and re-run until
  it is 0.
- **exit 0 — the config resolves.** Read the report anyway: `diagnostics` lists
  holes in the **data** — dangling foreign keys, duplicate ids, missing ids —
  which are not config bugs and so do not change the exit code, but are exactly
  the kind of thing worth telling the user before they look at the window. The
  `refs` lines carry the ratio: `0/12 resolved, 12/12 dangling` means the join
  is declared correctly and matches nothing real.
- **exit 1** — a file is unreadable or not valid JSON. **exit 2** — bad argv.
  **exit 4** — an internal error; report it, it is a bug in the binary.

Add `--json` when you want to parse the report rather than read it (same exit
codes, the full diagnostics list instead of the first 20).

`jq` still has a job, but it is *authoring*, not validation: when you are
writing a config against data whose shape you do not know, dump the real paths
first and write selectors from them.

```bash
jq 'paths(scalars) | @json' data.json | sort -u | head -50
```

### 6. Launch detached

The window holds the process for as long as the user keeps it open, so it must
never run in the foreground.

```bash
nohup datagraph data.json -c config.json > /tmp/datagraph.log 2>&1 &
```

Redirect both streams to a file: leaving them on a pipe can make the call hang
even when backgrounded. Then stop and tell the user the window is open.

## Argument rules

```
datagraph                              # built-in demo dataset
datagraph data.json                    # structure view only
datagraph data.json -c config.json     # full graph
datagraph --check data.json -c config.json          # validate, print report, exit
datagraph --check data.json -c config.json --json   # same report as JSON
datagraph --help
```

`-c` without a data file is an error. There is no `--config`, no `=` form, and
no second positional argument.

## If it fails

Every failure you can diagnose happens **before** the window opens:

- **exit 2** — bad argv; stderr carries the message plus the usage block.
- **exit 1** — a file cannot be read, or is not syntactically valid JSON.
- **exit 3** (`--check` only) — the config is semantically wrong; the report on
  stdout names the selector or reference at fault.
- **exit 4** (`--check` only) — internal error inside the validation engine.

All of them are avoidable by running step 5 first: `--check` catches 1, 2 and 3
without opening anything, so a config error screen is no longer a surprise the
user has to read out to you.

What stays invisible from your side is the **window**: its layout, whether the
graph looks legible, whether the envelopes make sense. If the user reports that
no window appeared, read the log you redirected to. Beyond that, ask the user
what they see; do not guess.
