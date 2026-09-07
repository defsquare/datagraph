# ADR-0020 — Tauri v2 desktop shell, raw binary with no bundle

**Date**: 2026-09-03
**Status**: Accepted

## Context

The demo only ran in a browser, behind a dev server. To hand the tool to someone
who does not write code, it needs an executable — and eventually a command-line
entry point (ADR-0021).

## Decision

Wrap `apps/demo` in a **Tauri v2** shell (`src-tauri/`), with the Vite `dist`
embedded in the binary. `.app` / `.dmg` bundling is **disabled**
(`bundle.active: false`): the application is meant to be launched from a shell, a
raw binary is enough — and that is exactly what makes command-line arguments
useful.

The web demo and its Vite config are untouched: the first commit introduces **no
custom Rust command**.

## Alternatives considered

- **Electron** — not retained: distribution weight with no upside here, the system
  WebView suffices.
- **A local server plus a browser** — explicitly rejected in the CLI design: that
  is not an application, it is one more tab.
- **Producing a `.app` / `.dmg`** — rejected: a macOS bundle hides the binary and
  complicates putting it on the `PATH`, which is the actual usage.

## Consequences

- `tauri build` produces `apps/demo/src-tauri/target/release/datagraph`, to be
  copied or symlinked onto the `PATH` by hand. A Rust toolchain is required for
  both `tauri dev` and `tauri build`.
- **Vendored fonts.** The 12 `woff2` files (latin + latin-ext, ~320 kB) are
  vendored in `public/fonts/` with their OFL licences; the Google Fonts `<link>`
  tags are gone. A launched binary makes **no outgoing request**, and typography is
  identical offline. Family **names** are load-bearing: the renderer measures fonts
  by name.
- **A real CSP** (`csp` moved from `null` to an all-`'self'` policy), with two
  exceptions forced by what the app actually runs: `script-src 'unsafe-eval'` (Pixi
  generates its uniform-sync functions with `new Function`) and
  `connect-src ipc: http://ipc.localhost` (Tauri v2's IPC is a `fetch`). The CSP is
  only emitted by the `tauri://` asset protocol, so never under `tauri dev`.
- The shell constrains the rest too: the layout worker must resolve its URL under
  `worker-src 'self'` (ADR-0026).
