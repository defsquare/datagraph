# ADR-0046 — ELK is loaded through a dynamic `import()`

**Date**: 2026-10-05
**Status**: Accepted

## Context

Core's two ELK-backed layouts (structure, tree) and the renderer's `elkWorkerUrl`
factory imported `elkjs/lib/elk.bundled.js` statically. Measured on the packaging
smoke test's consumer app (ADR-0045), that put ~1.4 MB minified into the
consumer's main chunk: three quarters of its 1.84 MB, and the source of Vite's
"chunks larger than 500 kB" warning.

`elkWorkerUrl` does not move that weight anywhere: `elk.bundled.js` only spawns a
real worker with the Node `web-worker` shim, so in a browser it runs in process.

## Decision

`lazyElkFactory(args?)` in core builds an `ElkFactory` whose `layout` imports
`elk.bundled.js` dynamically on first call. It is the default of both layouts,
and the renderer builds its `elkWorkerUrl` factory on it. `ElkFactory` narrows to
`() => Pick<ELK, "layout">`, the only method the layouts call. The renderer no
longer depends on elkjs.

`layout` was already async: no caller changes. Core's
`test/bundle-purity.test.ts` asserts no static elkjs import in `dist/index.js`'s
closure, with a counter-guard that the dynamic one is still there, and was
checked by falsification.

## Alternatives considered

- **A real Web Worker loading `elk-worker.min.js` by URL** — deferred. It would
  take ELK out of the bundle entirely (an asset, not a chunk: no warning) and off
  the main thread. But elk-api ignores worker errors: a worker that fails to load
  leaves `layout` pending forever, so the existing in-process fallback never
  fires. It needs an error/timeout wrapper, one long-lived worker instead of one
  per layout (each would re-parse 1.6 MB), and termination on `destroy()`.
  Tracked in [issue #2](https://github.com/defsquare/datagraph/issues/2).
- **Status quo, telling consumers to raise `chunkSizeWarningLimit`** — rejected:
  it hides the warning without shrinking the initial download.

## Consequences

- The consumer's main chunk drops from 1,839 kB to 378 kB minified (564 to
  120 kB gzip). A host starting on the graph view never downloads ELK.
- ELK becomes a 1.4 MB chunk of its own, which still trips Vite's 500 kB
  warning; the renderer README says it is expected.
- The first structure/tree layout also waits for that chunk.
- `lazyElkFactory` joins core's public surface (ADR-0023): the renderer consumes it.
