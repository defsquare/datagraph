# demo

The reference application for [`datagraph`](../../README.md). It is two things
in one package:

- a **Vite web app** that exercises the renderer's public API end to end — small
  and large fixtures, search, theme swap, the three view buttons, a detail
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

datagraph --check data.json -c config.json          # validate the config, print a report, exit
datagraph --check data.json -c config.json --json   # same report, as JSON
```

The argument parser lives in [`src-tauri/src/cli.rs`](./src-tauri/src/cli.rs)
and runs **before any window opens**: file and JSON errors are reported on
stderr with a non-zero exit code (`2` for a bad argument, `1` for a file that
cannot be read or parsed), where a CLI user expects them, rather than inside a
WebView. Only JSON *syntax* is validated up front; a semantically invalid config
(unknown group, malformed selector) is reported in-app by the TypeScript core,
which is the single source of truth for it.

`--check` is the headless half of the same binary. It requires `-c` (without a
config there is no contract to check) and refuses `--json` on its own (that is
the format of a report). It builds the graph with the **same TypeScript core**
the window uses — bundled into
[`src-tauri/generated/check.js`](./src-tauri/generated/check.js) and evaluated in
an embedded QuickJS by [`src-tauri/src/check.rs`](./src-tauri/src/check.rs) — so
the fourteen `ConfigError` messages read identically here and on the app's error
screen. The report's shape, its text rendering and the exit-code rule live in the
core, in [`packages/core/src/validate.ts`](../../packages/core/src/validate.ts):
`check.rs` hands it the two files and the output format, then prints the string it
gets back and exits with the code on its first line, parsing nothing.

On Windows, `main.rs`'s `windows_subsystem = "windows"` leaves a release
build with no console handle for `print!`/`println!` when launched directly
from a console, so `--check`'s report is silent there; it still works when
stdout is redirected or piped, which covers an agent capturing the output.

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
`pnpm --filter @defsquare/datagraph-core generate:check` after any change to the
validation closure — `packages/core/test/check-bundle.test.ts` compares it byte
for byte and fails `pnpm test` otherwise. See
[ADR-0032](../../docs/adr/0032-embedded-core-for-headless-check.md).

Size is no longer a reason a document refuses to open: it opens on a bounded
preview (~300 cards), each expansion then reveals 100 children at a
time behind clickable `+ n` tokens, and the toolbar's **Ranger** button — the
renderer's `tidy()` — re-lays out the whole visible set when incremental
expansions have made the columns drift. See
[Structure view](../../packages/renderer/README.md#structure-view). The only
hard cap left is `maxNodes` in the `-c` config (default 1,000,000, a memory
guard); exceeding it fails with a message that says to raise it.

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

## Fonts

The three families the shell uses — **EB Garamond**, **Fira Code** and **IBM
Plex Sans Condensed** — are **vendored** as `woff2` in
[`public/fonts/`](./public/fonts) and declared in
[`src/fonts.css`](./src/fonts.css) (imported by `style.css`). Nothing is fetched
from `fonts.googleapis.com` / `fonts.gstatic.com`: `datagraph` opens local
files, so it makes no outgoing request at launch, and the typography is
identical offline.

Both the `latin` and `latin-ext` subsets are shipped, each with its
`unicode-range`, so the browser only downloads a file whose glyphs are actually
needed (`latin` alone already covers French — `é è œ` included). The family
*names* are load-bearing: the renderer measures fonts by name (`theme.ts`,
`font-metrics.ts`), so they must not change.

All three are under the SIL Open Font License 1.1; the license texts ship next
to the fonts (`public/fonts/OFL-*.txt`), as Google Fonts distributes them.

## Content Security Policy

`tauri.conf.json` sets a real `app.security.csp` (it used to be `null`). Every
directive is `'self'`; there is no external host, and
`dangerousDisableAssetCspModification` is left at its default so Tauri keeps
appending its own nonces and hashes.

Two directives are not just `'self'`, and both are forced by what the app
actually runs:

- `script-src 'self' 'unsafe-eval'` — Pixi v8 **generates its WebGL uniform
  sync functions with `new Function(...)`** and refuses to start without it
  (`AbstractRenderer._unsafeEvalCheck` throws *“Current environment does not
  allow unsafe-eval”*). Verified: drop `'unsafe-eval'` and no canvas is created
  at all. Removing the exception means importing `pixi.js/unsafe-eval` in the
  renderer — a separate decision, it trades the exception for slower uniform
  uploads.
- `connect-src 'self' ipc: http://ipc.localhost` — Tauri v2's IPC is a `fetch`
  to `ipc://localhost/<cmd>` (macOS/Linux) or `http://ipc.localhost` (Windows).
  Without it `invoke("launch_payload")` falls back to the slower `postMessage`
  interface.

`style-src` needs **no** `'unsafe-inline'`: the built `index.html` carries no
inline `<script>`, no `<style>` and no `style=` attribute, and the only runtime
styling (Pixi sizing its canvas) goes through CSSOM, which CSP does not police.

**CSP: exercised in build, still to be confirmed by launching the binary.** The
CSP header is only emitted by the `tauri://` asset protocol, i.e. in a
`tauri build` binary — `tauri dev` loads the frontend from the Vite dev server
and never applies it. It was checked by serving the real `dist/` with the exact
header and loading it in Chromium (no violation, canvas up, all three families
loaded); WKWebView still deserves one manual run.

## Tests

**End-to-end (`pnpm --filter demo e2e`).** `playwright.config.ts` starts the app
itself with `pnpm dev`, and `vite.config.ts` aliases the workspace packages to
`packages/*/src` in `serve` mode. The suite therefore runs against the renderer
and core **sources**, through Vite's dev pipeline — no `pnpm build` is needed
first, and no timing it reports describes the published, minified bundle. The
specs drive the graph through `window.__graph`, the handle `src/main.ts` exposes
for exactly this purpose.

`e2e/file-mode.spec.ts` covers the **file mode** the CLI opens
(`datagraph <data.json> [-c <config.json>]`) without a desktop build: it installs
a fake `window.__TAURI_INTERNALS__` through `addInitScript`, whose `invoke`
answers `launch_payload` with the real contents of `fixtures/shop.json` and
`fixtures/shop.config.json` read off disk. That is what makes those fixtures
load-bearing on the TypeScript side — if they drift from the ids/refs/groups
contract, the spec fails.

**Rust (`pnpm --filter demo test`, or `cargo test` from `src-tauri/`).** The CLI
parser has its own unit tests covering argv parsing, the `-h`/`--help` and `-c`
handling, the error cases, and file loading with JSON validation — including one
that loads the committed `fixtures/` files, so a syntactically broken fixture
fails the build. The `test` script of this package runs `cargo test`, so the
root `pnpm test` covers them; a Rust toolchain is required for it.

## Layout

```
apps/demo/
├── e2e/            Playwright specs (smoke, view switching, refs, array tokens, file mode, structure scale)
├── fixtures/       sample data + config for the CLI — also consumed by e2e/file-mode.spec.ts and cli.rs
├── public/         static assets (logos, fonts/ — vendored woff2 + OFL texts)
├── src/            the web app (see below)
├── src-tauri/      Rust desktop shell: cli.rs, lib.rs, main.rs
├── index.html
├── playwright.config.ts
└── vite.config.ts
```

```
src/
├── main.ts          orchestration only: resolve the launch mode, create the graph, wire the modules below
├── launch.ts        the Tauri seam: what the CLI asked for (a file, or the demo)
├── detail-panel.ts  the `#detail` panel, built from the public `select` event and `refEdges`
├── search-ui.ts     the findbar's input: debounce, `N/total` counter, next/prev navigation
├── chrome.ts        viewer chrome: search/menu disclosures, Escape, click-outside, status bar, theme, the three view buttons, the "Ranger" (tidy) button
├── demo-mode.ts     demo-only tooling: the starting dataset and the small/large dataset toggle
├── sample-data.ts   the e-commerce fixture and its `bigShop(n)` generator
├── fonts.css        the @font-face block for the vendored fonts, imported by style.css
└── style.css
```

`src/launch.ts` is the seam between the two halves: it calls the Tauri command
`launch_payload` (declared in [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs))
to pick up whatever the CLI parsed, and falls back to the built-in demo dataset
in the browser or when no file was passed.

`src/demo-mode.ts` is the seam between the **generic viewer shell** and the
**demo**: `main.ts` reaches it through a dynamic `import()` taken only when no
file was given. In file mode (`datagraph data.json`) its chunk — which carries
`sample-data.ts` and the ~4000-node generator — is never fetched nor evaluated,
so opening a document never builds a demo fixture on the side.
