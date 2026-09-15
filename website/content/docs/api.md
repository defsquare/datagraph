---
title: "JS API: coming soon"
linkTitle: JS API
weight: 7
---

{{< callout type="warning" >}}
**Neither package is on npm yet.** Both are built, tested and used by the apps in the repository, but no version has been published, so there is no install command and no API contract to depend on. This page says what exists and where to read it.
{{< /callout >}}

## `@defsquare/datagraph`

The Pixi.js renderer: the interactive canvas, embeddable in a page.

`createDataGraph(container, options)` mounts the graph and returns a handle — `setData`, `setView`, `search`, `select`, `focus`, `fit`, `tidy`, `stats`, `destroy` — plus events for selection and lifecycle. `options.config` is the same [`ids` / `refs` / `groups`](/docs/config/) object the CLI takes with `-c`, and `options.view` picks the starting [view](/docs/views/). Themes are exported alongside it, derived from the design tokens.

Source and README: [`packages/renderer`](https://github.com/defsquare/datagraph/tree/main/packages/renderer).

## `@defsquare/datagraph-core`

The headless half, with no rendering dependency and no DOM: `buildGraph` turns arbitrary JSON plus a config into a graph, `CollapseState` tracks what is expanded, `buildSearchIndex` indexes it, and `createStructureLayoutEngine` lays it out through elkjs.

This is the package to reach for when you want the model without the canvas — an audit, a transformation, a validation step of your own. It is also what the binary's [`--check`](/docs/check/) runs, bundled and evaluated headlessly.

Source and README: [`packages/core`](https://github.com/defsquare/datagraph/tree/main/packages/core).

## Until then

The [desktop binary](/docs/install/) is the supported way to use `datagraph`.

## Related

- [Install](/docs/install/)
- [Config: ids, refs, groups](/docs/config/)
- [The two views](/docs/views/)
