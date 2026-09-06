# demo

The reference application for [`data-graph`](../../README.md). It is two things
in one package:

- a **Vite web app** that exercises the renderer's public API end to end — small
  and large fixtures, search, theme swap, structure/graph view toggle, a detail
  panel built entirely from the `select` event — and hosts the Playwright e2e
  suite;
- a **Tauri v2 desktop shell** around that same app, whose binary doubles as the
  end-user CLI, `datagraph`.

It is private (`"private": true`) and never published to npm.

## CLI

```bash
datagraph data.json -c config.json  # open a JSON document with an ids/refs/groups config
datagraph data.json                 # no config: structure view only
datagraph                           # no argument: built-in demo dataset
datagraph --help
```

The argument parser lives in [`src-tauri/src/cli.rs`](./src-tauri/src/cli.rs)
and runs **before any window opens**: file and JSON errors are reported on
stderr with a non-zero exit code (`2` for a bad argument, `1` for a file that
cannot be read or parsed), where a CLI user expects them, rather than inside a
WebView. Only JSON *syntax* is validated up front; a semantically invalid config
(unknown group, malformed selector) is reported in-app by the TypeScript core,
which is the single source of truth for it.

Sample files to try it with:

- [`fixtures/shop.json`](./fixtures/shop.json) — two customers, two orders, one
  order line each;
- [`fixtures/shop.config.json`](./fixtures/shop.config.json) — the matching
  `ids` / `refs` / `groups`.

```bash
datagraph apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json
```

## Commands

```bash
pnpm --filter demo dev      # Vite dev server on :5173
pnpm --filter demo build    # production build into dist/
pnpm --filter demo e2e      # Playwright suite
pnpm --filter demo typecheck

pnpm --filter demo tauri dev    # desktop app, hot-reloading the frontend
pnpm --filter demo tauri build  # release binary
```

`tauri build` produces a **raw binary** at
`src-tauri/target/release/datagraph`. `bundle.active` is `false`, so there is no
`.app` and no `.dmg`: the app is meant to be launched from a shell, which is
also what makes the CLI arguments useful. The binary is not on your `PATH` by
default — copy or symlink it somewhere on it. A Rust toolchain is required for
both `tauri` commands.

## Tests

**End-to-end (`pnpm --filter demo e2e`).** `playwright.config.ts` starts the app
itself with `pnpm dev`, and `vite.config.ts` aliases the workspace packages to
`packages/*/src` in `serve` mode. The suite therefore runs against the renderer
and core **sources**, through Vite's dev pipeline — no `pnpm build` is needed
first, and no timing it reports describes the published, minified bundle. The
specs drive the graph through `window.__graph`, the handle `src/main.ts` exposes
for exactly this purpose.

**Rust (`cargo test`, from `src-tauri/`).** The CLI parser has its own unit
tests covering argv parsing, the `-h`/`--help` and `-c` handling, the error
cases, and file loading with JSON validation. They are **not** wired into
`pnpm test` at the repo root.

## Layout

```
apps/demo/
├── e2e/            Playwright specs (smoke, view switching, refs, array tokens)
├── fixtures/       sample data + config for the CLI
├── public/         static assets (logos)
├── src/            the web app: main.ts, sample-data.ts, launch.ts
├── src-tauri/      Rust desktop shell: cli.rs, lib.rs, main.rs
├── index.html
├── playwright.config.ts
└── vite.config.ts
```

`src/launch.ts` is the seam between the two halves: it calls the Tauri command
`launch_payload` (declared in [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs))
to pick up whatever the CLI parsed, and falls back to the built-in demo dataset
in the browser or when no file was passed.
