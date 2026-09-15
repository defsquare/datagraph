---
title: The Claude Code plugin
linkTitle: Claude Code plugin
weight: 6
---

`datagraph` has one non-human user worth first-class support: an agent asked to show somebody a JSON document. The repository ships a Claude Code skill that teaches the agent the whole protocol.

## Install

From Defsquare's org marketplace, [`defsquare/claude-marketplace`](https://github.com/defsquare/claude-marketplace):

```
/plugin marketplace add defsquare/claude-marketplace
/plugin install datagraph@defsquare
```

{{< callout type="info" >}}
The plugin installs the **skill only**. The binary still arrives through [Homebrew or the tarball](/docs/install/).
{{< /callout >}}

## What the skill teaches

- **When not to reach for it.** The user wants *facts* about the data — use `jq` and answer in text, since the window returns nothing to the agent. The JSON is flat with no cross-references — a table is clearer. The session is headless — nobody is there to look.
- **How to shape the data**, but only when the agent is the one producing it. The document's shape, not the config, decides what a card reads like; for a file the user already owns, the shape is theirs.
- **How to write the config** against the document's real paths, and that the [selector grammar](/docs/config/#selector-grammar) is narrower than JSONPath — a key it cannot express should be reported as such, not worked around with invented syntax.
- **To pre-flight with [`--check`](/docs/check/)** before opening anything, and to read the report even on exit `0`: data diagnostics do not change the exit code but are worth telling the user about before they look at the window.
- **To launch detached**, with both streams redirected to a file. The window holds the process for as long as the user keeps it open, so a foreground call would hang the session.

The skill is versioned with the binary whose behaviour it documents, so a CLI change and its skill update travel in the same commit.

## Related

- [Checking a config](/docs/check/) — the protocol's important step
- [Config: ids, refs, groups](/docs/config/)
- [`skills/datagraph/`](https://github.com/defsquare/datagraph/tree/main/skills/datagraph) — the skill itself
