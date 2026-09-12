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
