# Architecture Decision Records

Each file records one architectural decision in [Michael Nygard's
format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
the **Context** that made the decision necessary, the **Decision** itself stated in
the present tense, the **Alternatives considered**, and the **Consequences** that
follow from it — including the constraints it still imposes today.

Files are named `NNNN-title-in-kebab-case.md`, numbered chronologically (0001 is
the oldest). A record is never rewritten once superseded: it keeps its content and
its status becomes `Superseded by ADR-XXXX`, so that the reasoning that was true at
the time stays readable.

ADR-0001 to ADR-0028 were **reconstructed after the fact on 2026-09-07** from the
git history, the dated design documents in `docs/superpowers/specs/`, the spikes in
`docs/superpowers/spikes/` and the packages' READMEs. Dates are those of the commit
or spec that introduced the decision.

| # | Title | Date | Status |
|---|---|---|---|
| 0001 | [pnpm monorepo: headless core, Pixi renderer, demo](./0001-pnpm-monorepo-headless-core-and-renderer.md) | 2026-08-30 | Accepted |
| 0002 | [Pixi.js v8 (WebGL) as the rendering engine](./0002-pixi-v8-webgl-rendering.md) | 2026-08-30 | Accepted |
| 0003 | [Graph model: scalar rows, two kinds of edges, path-derived ids](./0003-graph-model-scalar-rows-and-reference-edges.md) | 2026-08-30 | Accepted |
| 0004 | [Declarative `entities` / `references` config (DDD vocabulary)](./0004-declarative-entities-references-config.md) | 2026-08-30 | Superseded by [ADR-0022](./0022-data-first-ids-refs-groups-contract.md) |
| 0005 | [ELK `layered` and incremental layout for the structure view](./0005-elk-layered-and-incremental-layout.md) | 2026-08-30 | Accepted |
| 0006 | [`draw.ts` takes plain data only](./0006-draw-ts-takes-plain-data-only.md) | 2026-08-30 | Accepted |
| 0007 | [Imperfect data degrades the view, it never breaks it](./0007-graceful-degradation-and-diagnostics.md) | 2026-08-30 | Accepted |
| 0008 | [Hard cap of 50,000 logical nodes (`maxNodes`)](./0008-hard-maxnodes-cap.md) | 2026-08-30 | Superseded by [ADR-0025](./0025-structure-view-at-scale.md) |
| 0009 | [`opGen` + `destroyed` guard every async mutating operation](./0009-opgen-and-destroyed-guards.md) | 2026-08-31 | Accepted |
| 0010 | [Integration proofs live in `apps/demo`'s e2e suite](./0010-integration-proofs-in-playwright-e2e.md) | 2026-08-31 | Accepted |
| 0011 | [A semantic, overridable theme contract](./0011-semantic-theme-contract.md) | 2026-08-31 | Accepted |
| 0012 | [A second view, driven by references and aggregates](./0012-second-graph-view.md) | 2026-08-31 | Accepted |
| 0013 | [Organic layout engine (cytoscape + fcose) for the graph view](./0013-fcose-organic-layout-engine.md) | 2026-08-31 | Superseded by [ADR-0017](./0017-two-level-layout-engine.md) |
| 0014 | [Isolate heavy code behind a secondary entry point and a dynamic `import()`](./0014-isolating-heavy-code-behind-dynamic-import.md) | 2026-08-31 | Accepted |
| 0015 | [Aggregate membership is a strict partition](./0015-strict-aggregate-partition.md) | 2026-09-01 | Accepted |
| 0016 | [An aggregate envelope is a minimal enclosing circle](./0016-minimal-enclosing-circle-envelopes.md) | 2026-09-01 | Accepted |
| 0017 | [An in-repo two-level layout engine](./0017-two-level-layout-engine.md) | 2026-09-01 | Accepted |
| 0018 | [An array is an expandable token row, not a card](./0018-arrays-as-expandable-token-rows.md) | 2026-09-03 | Accepted |
| 0019 | [A reference is declared by a path, not by a row key](./0019-references-declared-by-path.md) | 2026-09-03 | Accepted |
| 0020 | [Tauri v2 desktop shell, raw binary with no bundle](./0020-tauri-v2-desktop-shell.md) | 2026-09-03 | Accepted |
| 0021 | [The end-user CLI is the Tauri binary itself](./0021-cli-is-the-tauri-binary.md) | 2026-09-04 | Accepted |
| 0022 | [Data-first `ids` / `refs` / `groups` contract](./0022-data-first-ids-refs-groups-contract.md) | 2026-09-04 | Accepted |
| 0023 | [Public surfaces keep only what is consumed or documented](./0023-public-surfaces-pared-to-what-is-consumed.md) | 2026-09-06 | Accepted |
| 0024 | [The two-view machine: `ViewPolicy` and `graph-view.ts`](./0024-two-view-machine.md) | 2026-09-06 | Accepted |
| 0025 | [Structure view at scale: opening budget, aligned pages, `tidy()`](./0025-structure-view-at-scale.md) | 2026-09-07 | Accepted |
| 0026 | [Graph view at scale: spatial grid, culling, semantic zoom, worker](./0026-graph-view-at-scale.md) | 2026-09-07 | Accepted |
| 0027 | [`packages/tokens`, the single source of truth for the design system](./0027-tokens-single-source-of-truth.md) | 2026-09-07 | Accepted |
| 0028 | [`apps/design`: a never-published playground, aliased to the sources](./0028-design-playground-source-aliases.md) | 2026-09-07 | Accepted |
| 0029 | [Chrome primitives as a shared private package](./0029-chrome-primitives-shared-package.md) | 2026-09-07 | Accepted |
| 0030 | [`deselect` and `statschange`, the renderer's lifecycle events](./0030-renderer-lifecycle-events.md) | 2026-09-08 | Accepted |
| 0031 | [The LOD 1 label holds a screen floor, quantized into rebuild steps](./0031-lod1-label-screen-floor.md) | 2026-09-11 | Accepted |
| 0032 | [The `--check` report runs the core inside an embedded JS engine](./0032-embedded-core-for-headless-check.md) | 2026-09-11 | Accepted |
| 0033 | [An unsigned arm64 macOS binary, hosted on Cloudflare R2](./0033-unsigned-arm64-macos-binary-on-cloudflare-r2.md) | 2026-09-12 | Accepted |
| 0034 | [A Homebrew tap on GitHub, fed by the release script](./0034-homebrew-tap-on-github-fed-by-the-release-script.md) | 2026-09-12 | Accepted |
| 0035 | [The Claude skill ships with the repo, as a plugin](./0035-claude-skill-ships-with-the-repo-as-a-plugin.md) | 2026-09-12 | Accepted |
