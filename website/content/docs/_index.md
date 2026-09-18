---
title: Documentation
type: docs
description: "Install datagraph, write an ids/refs/groups config, check it, and read the three views."
---

`datagraph` renders a JSON document as a navigable graph: records become cards, declared foreign keys become reference edges, and declared aggregate roots become envelopes around their members. The [landing page](/) says why; these pages say how.

{{< cards >}}
  {{< card link="/docs/install/" title="Install" icon="download" subtitle="Homebrew, the tarball, a build from source — and where the npm package stands." >}}
  {{< card link="/docs/getting-started/" title="Getting started" icon="academic-cap" subtitle="Open a file, read the canvas, work a document too large to draw in full." >}}
  {{< card link="/docs/config/" title="Config reference" icon="adjustments" subtitle="ids, refs, groups, maxNodes, rootLabel, and the selector grammar." >}}
  {{< card link="/docs/check/" title="Checking a config" icon="badge-check" subtitle="--check, the report, --json, and what each exit code means." >}}
  {{< card link="/docs/views/" title="The three views" icon="view-grid" subtitle="Structure, tree and graph: what each one draws, and when to use which." >}}
  {{< card link="/docs/plugin/" title="Claude Code plugin" icon="puzzle" subtitle="The skill that teaches an agent the whole protocol, and how to install it." >}}
  {{< card link="/docs/api/" title="JS API" icon="code" subtitle="The embeddable packages — in the repository, not yet on npm." >}}
{{< /cards >}}

## Sixty-second start

macOS on Apple silicon is the only platform with a published binary; everywhere else, [build from source](/docs/install/#build-from-source).

```bash
brew install defsquare/tap/datagraph

datagraph                            # the built-in demo dataset
datagraph data.json                  # structure view only
datagraph data.json -c config.json   # records, references and aggregates
```

The `-c` file is the [`ids` / `refs` / `groups` config](/docs/config/). Run [`--check`](/docs/check/) on it before opening anything: it builds the same graph headlessly, prints a report and exits.

## What it is not

- **Not a JSON tree viewer.** A literal tree of every key is what `datagraph` deliberately does not draw. Without a config you still get the containment structure, which answers "what shape is this payload" and nothing more.
- **Not a query tool.** For counts, dangling keys or any other *fact* about the data, `jq` answers in text. The window returns nothing but a picture.
- **Not an editor.** Dragging a card moves it for the duration of the current layout; nothing is written back, to the layout or to the document.

Source: [github.com/defsquare/datagraph](https://github.com/defsquare/datagraph). License: [MIT](https://github.com/defsquare/datagraph/blob/main/LICENSE).
