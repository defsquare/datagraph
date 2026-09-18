<h1>
  <img alt="datagraph" src="packages/tokens/brand/datagraph-lockup-auto.svg" width="284">
</h1>

**Interactive visualization for complex JSON documents: keyed records and real reference edges.**

Most JSON visualizers draw a literal tree. Every object becomes a box, every
key an edge. That works on small documents, and falls apart on real domain
data: records with hundreds of nested fields, foreign keys pointing across the
document, collections with thousands of rows.

`datagraph` renders the same interactive box-and-line canvas, but on top of a
domain model instead of the raw JSON structure. You declare which paths hold
keyed records (`ids`, e.g. `Customer`, `Order`) and which fields join them
(`refs`, e.g. `Order.customerId → Customer`). The graph then carries two edge
kinds: containment (parent/child structure) and reference (real foreign keys).
Only what is expanded gets rendered, so a 10,000-node dataset stays smooth.
You can pan, zoom, expand and collapse, drag a card out of the way, click a
reference to jump to its target, and search across every field.

Three views are built in. The default structure view lays out the containment
tree (ELK layered), left to right. The tree view lays out a containment
re-derived from the references, top to bottom: a record hangs under the target
of the foreign key that claimed it, which turns a normalised document — flat
tables joined by keys — into the hierarchy it describes. The graph view
switches to records-as-vertices and joins-as-edges, grouped into DDD
aggregates drawn as circular envelopes. The tree and the graph both hang from
[`config.groups`](https://datagraph.defsquare.com/docs/config/#groups); the
graph's engine is described in [`docs/graph-view.md`](./docs/graph-view.md).

<!-- A still that links out, not an inline player. GitHub strips every <video>
     tag from Markdown, and injects a player only for URLs on its own attachment
     hosts, so neither a repository path nor a third-party URL can play in
     place here. The clip itself is website/static/video/trailer.mp4, served by
     the documentation site; the thumbnail is a still cut from it by hand. -->

[![datagraph: sixty records and their joins drawn as a graph — click to watch the thirty-second tour](./docs/trailer-poster.png)](https://datagraph.defsquare.com/)

*Thirty seconds, from `datagraph demo.json -c demo.config.json` to the graph
view: the structure view expands records and follows a foreign key to its
target, then the same sixty records are redrawn as vertices and joins, clustered
into aggregates. The tree view is not in the clip. It plays on
[datagraph.defsquare.com](https://datagraph.defsquare.com/).*

You use it as a **standalone desktop app**: the `datagraph` binary opens a
JSON file straight from the shell, no code to write; see
[Quick start](#quick-start). An embeddable JS package,
`@defsquare/datagraph`, lives in [`packages/renderer`](./packages/renderer)
but [is not published to npm yet](https://datagraph.defsquare.com/docs/api/).

## Quick start

```bash
brew install defsquare/tap/datagraph   # macOS, Apple silicon
```

Every other platform builds from source; that route, the tarball and the
macOS quarantine caveat are on the
[install page](https://datagraph.defsquare.com/docs/install/).

```bash
datagraph                            # no argument: the built-in demo dataset
datagraph data.json                  # a document, structure view only
datagraph data.json -c config.json   # with an ids/refs/groups config

datagraph apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json
```

The last line runs the fixtures that ship with the repository. A `-c` file
declares which paths hold keyed records and which fields join them, in the
grammar of the
[config reference](https://datagraph.defsquare.com/docs/config/).
`datagraph --check data.json -c config.json` validates one and prints a
report without opening a window; the exit code says whether the config
itself is at fault
([Checking a config](https://datagraph.defsquare.com/docs/check/)).

## Documentation

Full docs live at [datagraph.defsquare.com](https://datagraph.defsquare.com).

- [Install](https://datagraph.defsquare.com/docs/install/): building from source, the macOS quarantine caveat.
- [Getting started](https://datagraph.defsquare.com/docs/getting-started/): the canvas, the gestures, and [how a large file opens on a preview](https://datagraph.defsquare.com/docs/getting-started/#a-large-file-opens-on-a-preview).
- [Config reference](https://datagraph.defsquare.com/docs/config/): `ids`, `refs`, `groups`, and the [selector grammar](https://datagraph.defsquare.com/docs/config/#selector-grammar).
- [Checking a config](https://datagraph.defsquare.com/docs/check/): `--check`, the exit codes, `--json`.
- [The three views](https://datagraph.defsquare.com/docs/views/): structure, tree and graph.
- [The Claude Code plugin](https://datagraph.defsquare.com/docs/plugin/): the skill that teaches an agent the protocol, installed from [`defsquare/claude-marketplace`](https://github.com/defsquare/claude-marketplace).

What stays here documents the code rather than the product:

- [`docs/graph-view.md`](./docs/graph-view.md): the graph-view layout engine, its guarantees, and which of them a test actually holds.
- The package READMEs: [`core`](./packages/core), [`renderer`](./packages/renderer), [`chrome`](./packages/chrome), [`tokens`](./packages/tokens).
- [`apps/demo/README.md`](./apps/demo/README.md): exit codes, the CSP, the vendored fonts.

## Packages

| Package | Description |
| --- | --- |
| [`@defsquare/datagraph-tokens`](./packages/tokens) | Design tokens: the single source of truth behind both the renderer themes and the shell CSS variables. |
| [`@defsquare/datagraph-chrome`](./packages/chrome) | Chrome primitives: CSS, icons and markup factories shared by the demo and the playground. Never published. |
| [`@defsquare/datagraph-core`](./packages/core) | Headless: `buildGraph`, `CollapseState`, `buildSearchIndex`, `createStructureLayoutEngine`. No rendering, no DOM. |
| [`@defsquare/datagraph`](./packages/renderer) | Pixi.js renderer on top of core: `createDataGraph`, themes. |
| [`apps/demo`](./apps/demo) | Vite demo, Playwright e2e, and the Tauri desktop shell that doubles as the `datagraph` CLI. |
| [`apps/design`](./apps/design) | Design system playground: tokens, graph and UI components, and a live sandbox. Never published. |

## Monorepo layout

```
datagraph/
├── packages/
│   ├── tokens/    @defsquare/datagraph-tokens — design tokens, CSS generator
│   ├── chrome/    @defsquare/datagraph-chrome — chrome primitives, never published
│   ├── core/      @defsquare/datagraph-core — graph model, layout, search
│   └── renderer/  @defsquare/datagraph — Pixi.js renderer, themes
├── apps/
│   ├── demo/      Vite app demonstrating the renderer + Playwright e2e
│   │   └── src-tauri/  Tauri v2 desktop shell + `datagraph` CLI (Rust)
│   └── design/    design system playground (port 5174), never published
├── bin/           release.sh — builds, publishes and taps a version
├── Formula/       datagraph.rb.tmpl — the Homebrew formula release.sh renders
├── skills/        the Claude Code skill the plugin installs (.claude-plugin/ manifests)
├── docs/
│   ├── graph-view.md        graph-view layout, guarantees and measurements
│   └── trailer-poster.png   the README thumbnail, a still of the landing page's clip
├── website/       the Hugo site behind datagraph.defsquare.com — static/video/ holds the clip
├── CHANGELOG.md   hand-written release notes, copied into each annotated tag
├── LICENSE
└── README.md
```

## Development

```bash
pnpm install

pnpm typecheck      # tsc --noEmit across every package
pnpm build          # tsup build across every package
pnpm test           # vitest across every package, plus `cargo test` — run `pnpm build` FIRST
pnpm bench          # non-blocking perf bench (packages/core/bench/bench.ts)

pnpm --filter demo dev   # run the demo app locally
pnpm --filter demo e2e   # Playwright e2e (starts `pnpm dev` itself)
pnpm --filter design dev # design system playground on port 5174 (runs alongside the demo)

pnpm --filter demo tauri dev    # demo as a desktop app (Tauri v2) — needs a Rust toolchain
pnpm --filter demo tauri build  # standalone binary: apps/demo/src-tauri/target/release/datagraph
```

**Build before testing.** `packages/core/test/bundle-purity.test.ts` walks
`packages/core/dist/index.js` to prove the graph-view chunk stays out of the
main entry point, and `dist/` is gitignored. On a fresh clone the test fails,
with a message pointing at `pnpm build`, until something has been built. It
fails rather than skips, because a silent skip would give false assurance on a
bundle budget.

**The e2e need no build.** Playwright starts the app with `pnpm dev`, and Vite
aliases the workspace packages to `packages/*/src` in `serve` mode. The suite
always exercises the *sources* through Vite's dev pipeline, never the
published bundle, so any timing it reports is a dev-mode, unminified figure
(see [`docs/graph-view.md`](./docs/graph-view.md#what-the-tests-actually-hold)).

**Rust is part of `pnpm test`.** The CLI parser in
`apps/demo/src-tauri/src/cli.rs` has its own unit tests, run through
`cargo test` by `apps/demo`'s `test` script. A Rust toolchain is therefore
required for a full `pnpm test`; run `pnpm --filter '!demo' -r test` to skip
it.

### Release

`bin/release.sh <version>` does the whole publication from a maintainer's Mac.
It builds the arm64 binary, uploads the tarball to the Cloudflare R2 bucket
behind the download host (under a versioned key and the stable
`datagraph-darwin-arm64.tar.gz` one), tags the version, then renders
`Formula/datagraph.rb.tmpl` and pushes it to the Homebrew tap. The artifact
goes up before the formula, so a formula never points at a tarball that does
not exist yet. Uploads authenticate through Cloudflare's own OAuth: run
`wrangler login` once, and no token lives in the environment or the repo. The
bucket, the download base URL and the local tap checkout come from the
git-ignored `bin/release.env`; copy
[`bin/release.env.example`](./bin/release.env.example) and fill it in. Add
`--dry-run` to see the plan and the rendered formula without touching the
network.

The release notes are hand-written in [`CHANGELOG.md`](./CHANGELOG.md): the
script refuses to tag a version that has no section there, and copies that
section into the annotated tag, so `git tag -n99` reads the same text.

## License

[MIT](./LICENSE) © 2026 Defsquare
