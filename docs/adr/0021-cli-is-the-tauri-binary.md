# ADR-0021 — The end-user CLI is the Tauri binary itself, with argv parsed in Rust

**Date**: 2026-09-04
**Status**: Accepted

## Context

To open a JSON document without writing code you need
`datagraph data.json [-c config.json]`. The desktop shell already exists
(ADR-0020); what is left to decide is **who** reads `argv`.

## Decision

The **existing Tauri binary reads `argv` itself**. No Node wrapper, no local
server plus browser, no second application: `apps/demo` **becomes** the
application, and with no argument it stays in demo mode (behaviour preserved for
the e2e suite).

Split of responsibilities:

- **Rust** (`src-tauri/src/cli.rs`) — hand-written argv parsing (one positional,
  `-c <path>`, `--help`; no need for `clap`), file reading, and a "this is JSON"
  check via `serde_json`. Every failure is reported on stderr with a non-zero exit
  code **before any window opens** (`2` for a bad argument, `1` for a file that
  cannot be read or parsed). The payload is stored in a `tauri::State` and served
  by a `launch_payload` command.
- **TypeScript** — **semantic** config validation (known names, selectors) stays in
  the core: re-validating it in Rust would duplicate `validateConfig`. A
  semantically invalid config produces an error screen inside the window.

The binary is renamed `datagraph` to align command and artefact. CLI messages and
`--help` text are in **English**, whereas code comments stay in French.

## Alternatives considered

- **A Node wrapper launching the binary** — rejected: one more runtime dependency
  for work the binary already does.
- **A `-d` flag for the data file** — rejected in favour of a **positional**, the
  shape expected of a file opener.
- **Watch / hot reload** — out of scope for v1: a single read at launch.

## Consequences

- `apps/demo`'s Rust stops being boilerplate: `cli.rs` carries tested logic (13
  `cargo` tests, one of which loads the committed `fixtures/`, so a syntactically
  broken fixture fails the build), and the package's `test` script runs `cargo
  test` — so the root `pnpm test` requires a Rust toolchain.
- `apps/demo/src/launch.ts` becomes the seam between the two halves: under Tauri
  (`window.__TAURI_INTERNALS__`) it calls `launch_payload`, otherwise it falls back
  to the demo.
- Without `-c`, the CLI synthesises an empty config: `validateConfig` had to accept
  zero entities — a JSON document with no entities is exactly a tree. The graph
  view then has nothing to show, and the view toggle is hidden.
- That "no config" mode is what exposed the structure view's scale defect: with no
  entities, nothing stops the initial expansion (ADR-0025).
- The path is covered without a desktop build by `e2e/file-mode.spec.ts`, which
  fakes `__TAURI_INTERNALS__` and replays the real `fixtures/` (ADR-0010).
