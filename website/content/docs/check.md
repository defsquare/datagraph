---
title: Checking a config
linkTitle: Check
weight: 4
---

`--check` builds the graph, prints a report on stdout and exits. No window opens.

```bash
datagraph --check data.json -c config.json
datagraph --check data.json -c config.json --json
```

It requires `-c` — without a config there is no contract to check — and refuses `--json` on its own, that being the format of a report rather than a mode.

It runs the **same TypeScript core** the window runs, bundled and evaluated in an embedded JS engine, so every diagnostic reads identically here and on the app's error screen. Check before you open: every failure you can diagnose happens before the window exists.

## What the report shows

Per selector, how many instances matched and whether the path resolves at all. Per reference, how many joins resolved and how many dangled.

```
✓ config valid — 4 entities, 2 references resolved

  ids
    Customer  $.customers[*].id  2 instances
    Order     $.orders[*].id     2 instances
  refs
    $.orders[*].customerId → $.customers[*].id    2/2 resolved

  No diagnostics.
```

A `refs` line carries the ratio, which is where a silently wrong config shows up: `0/12 resolved, 12/12 dangling` means the join is declared correctly and matches nothing real.

A `(path does not resolve)` beside an `ids` entry means the selector's instance path designates nothing in the document. A malformed selector or an unknown group appears as an `errors` line; a `refs[].to` that is not one of the `ids` selectors appears as an `unresolved-reference`.

## Exit codes

The exit code answers one question: **can I fix this by editing the config?**

| Code | Meaning |
| --- | --- |
| `0` | Config valid. The report may still carry **data** diagnostics. |
| `1` | A file is unreadable, or is not valid JSON. |
| `2` | Invalid argument. |
| `3` | Invalid config: a malformed selector, an unknown group, a selector prefix that does not resolve, or a reference declaration nothing satisfied. |
| `4` | Internal error inside the validation engine. Never a verdict on your config — report it, it is a bug in the binary. |

`1` and `2` are unchanged from a normal run; `3` and `4` exist only under `--check`.

**A hole in the data stays at `0`.** A dangling foreign key, a duplicate id, a missing id — none of these is a config bug, so none changes the exit code. They are listed under `diagnostics`, and they are exactly the kind of thing worth reading before anyone looks at the window. Only a config bug exits `3`.

## `--json`

`--json` prints the same report as JSON, with a `"report": 1` version field, the same exit codes, and the full diagnostics list rather than the first twenty.

Its `totals.logicalNodes` count — the graph nodes plus the scalar rows — is the one [`maxNodes`](/docs/config/#maxnodes) bounds, so it is the number to compare against the one a `GraphTooLargeError` quotes.

{{< callout type="warning" >}}
**Windows caveat.** A release build launched directly from a console has no stdout handle, so the report is silent there. It still works when stdout is redirected or piped — which is how a script or an agent captures it anyway.
{{< /callout >}}

## Related

- [Config: ids, refs, groups](/docs/config/)
- [The Claude Code plugin](/docs/plugin/) — the agent protocol builds on `--check`
- [Getting started](/docs/getting-started/)
